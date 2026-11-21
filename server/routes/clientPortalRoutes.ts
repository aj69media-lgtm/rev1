import { Router } from 'express';
import {
  type AuthenticatedRequest,
  canAccessProject,
  getAccessibleProjectIds,
  logAudit,
  requireAuth,
  requireModule,
} from '../auth.ts';
import { getProjectScheduleMetrics } from '../calculations.ts';
import { db, transaction } from '../db.ts';
import { createNotification, emitSyncEvent } from '../realtime.ts';

const router = Router();
router.use(requireAuth);
router.use(requireModule('client_portal'));

function assertClientPortalAccess(req: AuthenticatedRequest, projectId?: number): boolean {
  if (!req.user) return false;
  // Allow client_rep (only assigned projects) OR authorized internal managers previewing client portal
  if (req.user.is_client_role) {
    return projectId ? canAccessProject(req.user, projectId) : true;
  }
  return projectId ? canAccessProject(req.user, projectId) : true;
}

router.get('/overview', (req: AuthenticatedRequest, res) => {
  const access = getAccessibleProjectIds(req.user!);
  const filterSql =
    access === 'ALL'
      ? ''
      : access.length > 0
      ? `WHERE p.id IN (${access.map(() => '?').join(',')})`
      : 'WHERE 1=0';
  const params = access === 'ALL' ? [] : access;

  // Strictly project non-confidential client fields (NEVER expose budgets, expenses, internal costs, or margins!)
  const rows = db
    .prepare(
      `SELECT p.id, p.ref_number, p.name, p.location, p.address, p.description, p.scope,
              p.start_date, p.original_end_date, p.revised_end_date, p.actual_end_date,
              p.status, p.overall_progress, p.hero_image,
              p.schedule_delay_explanation, p.delay_explanation_client_visible,
              c.company_name AS client_company,
              pm.full_name AS pm_name, pm.email AS pm_email, pm.phone AS pm_phone
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN users pm ON pm.id = p.project_manager_id
       ${filterSql}
       ORDER BY p.id DESC`
    )
    .all(...params) as any[];

  const projects = rows.map((p) => {
    const sched = getProjectScheduleMetrics(p.id);
    const activeRev = db
      .prepare('SELECT id FROM schedule_revisions WHERE project_id = ? AND is_active = 1 LIMIT 1')
      .get(p.id) as { id: number } | undefined;

    const phases = activeRev
      ? (db
          .prepare(
            'SELECT id, name, sort_order, start_date, end_date, planned_progress, actual_progress, status FROM project_phases WHERE project_id = ? AND revision_id = ? ORDER BY sort_order ASC'
          )
          .all(p.id, activeRev.id) as any[])
      : [];

    const currentPhase =
      phases.find((ph) => ph.status === 'in_progress') ||
      phases.find((ph) => ph.actual_progress < 100) ||
      phases[phases.length - 1] ||
      null;

    const nextMilestone = activeRev
      ? db
          .prepare(
            "SELECT name, end_date, milestone_status, actual_progress FROM project_activities WHERE project_id = ? AND revision_id = ? AND is_milestone = 1 AND (milestone_status IS NULL OR milestone_status != 'completed') ORDER BY end_date ASC LIMIT 1"
          )
          .get(p.id, activeRev.id)
      : null;

    return {
      id: p.id,
      ref_number: p.ref_number,
      name: p.name,
      location: p.location,
      address: p.address,
      description: p.description,
      client_company: p.client_company,
      start_date: p.start_date,
      expected_completion_date: p.revised_end_date || p.original_end_date,
      actual_end_date: p.actual_end_date,
      status: p.status,
      hero_image: p.hero_image,
      pm_contact: {
        name: p.pm_name || 'Assigned Project Manager',
        email: p.pm_email || '',
        phone: p.pm_phone || '',
      },
      delay_explanation: p.delay_explanation_client_visible ? p.schedule_delay_explanation : '',
      schedule_summary: {
        planned_progress: sched.plannedProgress,
        actual_progress: sched.actualProgress,
        progress_variance: sched.progressVariance,
        health_status: sched.healthStatus,
        as_of_date: sched.asOfDate,
        completed_milestones: sched.completedMilestones,
        total_milestones: sched.totalMilestones,
      },
      current_phase: currentPhase,
      next_milestone: nextMilestone,
    };
  });

  const activeCount = projects.filter((p) => p.status === 'active').length;
  const completedCount = projects.filter((p) => p.status === 'completed').length;
  const avgProgress =
    projects.length > 0
      ? Number(
          (projects.reduce((s, p) => s + p.schedule_summary.actual_progress, 0) / projects.length).toFixed(1)
        )
      : 0;

  res.json({
    stats: {
      totalProjects: projects.length,
      activeProjects: activeCount,
      completedProjects: completedCount,
      overallProgress: avgProgress,
    },
    projects,
  });
});

router.get('/projects/:id', (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!assertClientPortalAccess(req, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const p = db
    .prepare(
      `SELECT p.id, p.ref_number, p.name, p.location, p.address, p.description, p.scope,
              p.start_date, p.original_end_date, p.revised_end_date, p.actual_end_date,
              p.status, p.overall_progress, p.hero_image,
              p.schedule_delay_explanation, p.delay_explanation_client_visible,
              c.company_name AS client_company,
              pm.full_name AS pm_name, pm.email AS pm_email, pm.phone AS pm_phone
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN users pm ON pm.id = p.project_manager_id
       WHERE p.id = ?`
    )
    .get(projectId) as any;

  if (!p) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const sched = getProjectScheduleMetrics(projectId);
  const activeRev = db
    .prepare('SELECT id, revision_number, approved_at FROM schedule_revisions WHERE project_id = ? AND is_active = 1 LIMIT 1')
    .get(projectId) as { id: number; revision_number: number; approved_at: string } | undefined;

  const phases = activeRev
    ? (db
        .prepare(
          'SELECT id, name, sort_order, start_date, end_date, actual_start_date, actual_end_date, planned_progress, actual_progress, status FROM project_phases WHERE project_id = ? AND revision_id = ? ORDER BY sort_order ASC'
        )
        .all(projectId, activeRev.id) as any[])
    : [];

  const milestones = activeRev
    ? db
        .prepare(
          'SELECT id, wbs_code, name, start_date, end_date, actual_end_date, milestone_status, actual_progress, phase_id FROM project_activities WHERE project_id = ? AND revision_id = ? AND is_milestone = 1 ORDER BY end_date ASC'
        )
        .all(projectId, activeRev.id)
    : [];

  // ONLY explicitly published DPR updates and approved client photos! Never leak internal comments, delays, or unapproved photos.
  const publishedUpdates = db
    .prepare(
      `SELECT d.id, d.report_date, d.client_summary, d.client_completed_activities,
              d.client_next_activities, d.client_photos_json, d.client_published_at,
              pub.full_name AS published_by_name
       FROM daily_progress_reports d
       LEFT JOIN users pub ON pub.id = d.client_published_by
       WHERE d.project_id = ? AND d.is_published_to_client = 1
       ORDER BY d.report_date DESC, d.id DESC`
    )
    .all(projectId) as any[];

  const galleryPhotos: Array<{ url: string; caption: string; phase: string; date: string; updateId: number }> = [];
  for (const upd of publishedUpdates) {
    try {
      const arr = JSON.parse(upd.client_photos_json || '[]');
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item?.url) {
            galleryPhotos.push({
              url: item.url,
              caption: item.caption || upd.client_summary || 'Construction progress photograph',
              phase: item.phase || 'Construction Progress',
              date: item.date || upd.report_date,
              updateId: upd.id,
            });
          }
        }
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  // Also include explicitly client-visible non-confidential documents
  const clientDocuments = db
    .prepare(
      `SELECT id, category, title, file_name, mime_type, version, description, phase_name, created_at
       FROM documents
       WHERE project_id = ? AND is_client_visible = 1 AND is_confidential = 0
       ORDER BY created_at DESC`
    )
    .all(projectId);

  // ONLY client-channel messages (NEVER internal staff discussions)
  const clientMessages = db
    .prepare(
      `SELECT m.id, m.subject, m.body, m.is_announcement, m.created_at, u.full_name AS sender_name, r.name AS sender_role
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       JOIN roles r ON r.id = u.role_id
       WHERE m.project_id = ? AND m.channel = 'client'
       ORDER BY m.id DESC`
    )
    .all(projectId);

  // Client Revision Requests & full decision history (excluding internal-only confidential notes if desired, keeping cost_impact/change_order_ref visible when evaluated)
  const revisions = db
    .prepare(
      `SELECT cr.id, cr.ref_number, cr.category, cr.description, cr.reason, cr.preferred_date,
              cr.status, cr.technical_notes, cr.cost_impact, cr.schedule_impact_days, cr.change_order_ref,
              cr.created_at, cr.updated_at, u.full_name AS submitted_by_name
       FROM client_revision_requests cr
       JOIN users u ON u.id = cr.client_user_id
       WHERE cr.project_id = ?
       ORDER BY cr.id DESC`
    )
    .all(projectId) as any[];

  const revHistory = db
    .prepare(
      `SELECT crh.request_id, crh.previous_status, crh.new_status, crh.remarks, crh.created_at, u.full_name AS actor_name
       FROM client_revision_history crh
       JOIN users u ON u.id = crh.actor_id
       ORDER BY crh.id ASC`
    )
    .all() as any[];

  res.json({
    project: {
      id: p.id,
      ref_number: p.ref_number,
      name: p.name,
      location: p.location,
      address: p.address,
      description: p.description,
      scope: p.scope,
      client_company: p.client_company,
      start_date: p.start_date,
      expected_completion_date: p.revised_end_date || p.original_end_date,
      actual_end_date: p.actual_end_date,
      status: p.status,
      hero_image: p.hero_image,
      delay_explanation: p.delay_explanation_client_visible ? p.schedule_delay_explanation : '',
      pm_contact: {
        name: p.pm_name || 'Project Manager',
        email: p.pm_email || '',
        phone: p.pm_phone || '',
      },
    },
    scheduleSummary: sched,
    phases,
    milestones,
    publishedUpdates,
    galleryPhotos,
    clientDocuments,
    clientMessages,
    revisions: revisions.map((r) => ({
      ...r,
      history: revHistory.filter((h) => h.request_id === r.id),
    })),
  });
});

router.post('/projects/:id/revisions', (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!assertClientPortalAccess(req, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const { category, description, reason, preferredDate } = req.body || {};
  if (!category || !description || typeof description !== 'string' || !description.trim()) {
    res.status(400).json({ error: 'Request category and description are required' });
    return;
  }

  const refNum = `CR-${Date.now().toString().slice(-6)}`;
  const reqId = transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO client_revision_requests (ref_number, project_id, client_user_id, category, description, reason, preferred_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')`
      )
      .run(refNum, projectId, req.user!.id, String(category).trim(), description.trim(), reason || '', preferredDate || '');
    const id = Number(info.lastInsertRowid);

    db.prepare(
      'INSERT INTO client_revision_history (request_id, actor_id, previous_status, new_status, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(id, req.user!.id, '', 'submitted', 'Client submitted revision request');
    return id;
  });

  const proj = db.prepare('SELECT project_manager_id, name FROM projects WHERE id = ?').get(projectId) as
    | { project_manager_id: number | null; name: string }
    | undefined;
  if (proj?.project_manager_id) {
    createNotification({
      userId: proj.project_manager_id,
      projectId,
      type: 'client_revision',
      title: `New Client Revision Request ${refNum}`,
      body: `${proj.name}: ${String(description).slice(0, 90)}`,
      linkSection: 'revisions',
    });
  }

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'SUBMIT_CLIENT_REVISION',
    module: 'client_portal',
    recordType: 'client_revision_request',
    recordRef: refNum,
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'revision:created',
    module: 'client_portal',
    projectId,
    clientVisible: true,
    payload: { id: reqId, refNumber: refNum },
  });

  res.status(201).json({ id: reqId, refNumber: refNum });
});

router.post('/projects/:id/messages', (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!assertClientPortalAccess(req, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const { subject, body } = req.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) {
    res.status(400).json({ error: 'Message body is required' });
    return;
  }

  const info = db
    .prepare("INSERT INTO messages (project_id, channel, sender_id, subject, body, is_announcement) VALUES (?, 'client', ?, ?, ?, 0)")
    .run(projectId, req.user!.id, subject || 'Client Inquiry', body.trim());

  emitSyncEvent({
    eventType: 'message:new',
    module: 'communications',
    projectId,
    clientVisible: true,
    payload: { id: Number(info.lastInsertRowid), channel: 'client' },
  });

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

export default router;
