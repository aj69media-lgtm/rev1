import { Router } from 'express';
import {
  type AuthenticatedRequest,
  canAccessProject,
  getAccessibleProjectIds,
  logAudit,
  requireAuth,
  requireInternalUser,
  requireModule,
  requirePermission,
} from '../auth.ts';
import {
  computeCriticalPath,
  getProjectEvmMetrics,
  getProjectFinancialSummary,
  getProjectScheduleMetrics,
  syncProjectProgressFromSchedule,
} from '../calculations.ts';
import { db, transaction } from '../db.ts';
import { createNotification, emitSyncEvent } from '../realtime.ts';

const router = Router();
router.use(requireAuth);
router.use(requireInternalUser);

// --- Executive Dashboard (Real SQL aggregations only) ---
router.get('/dashboard/executive', requirePermission('projects', 'view'), (req: AuthenticatedRequest, res) => {
  const access = getAccessibleProjectIds(req.user!);
  const filterSql =
    access === 'ALL'
      ? ''
      : access.length > 0
      ? `WHERE p.id IN (${access.map(() => '?').join(',')})`
      : 'WHERE 1=0';
  const params = access === 'ALL' ? [] : access;

  const projects = db
    .prepare(
      `SELECT p.*, c.company_name AS client_name, u.full_name AS pm_name
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN users u ON u.id = p.project_manager_id
       ${filterSql}
       ORDER BY p.created_at DESC`
    )
    .all(...params) as any[];

  const projectRows = projects.map((p) => {
    const sched = getProjectScheduleMetrics(p.id);
    const fin = getProjectFinancialSummary(p.id);
    const evm = getProjectEvmMetrics(p.id);
    const projExpenseCats = db
      .prepare(
        `SELECT category, COALESCE(SUM(amount), 0) AS total
         FROM expenses WHERE project_id = ? AND status = 'approved'
         GROUP BY category ORDER BY total DESC`
      )
      .all(p.id) as Array<{ category: string; total: number }>;
    return {
      ...p,
      schedule: sched,
      financials: fin,
      evm,
      expenseCategories: projExpenseCats,
    };
  });

  const totalProjects = projectRows.length;
  const activeProjects = projectRows.filter((p) => p.status === 'active').length;
  const completedProjects = projectRows.filter((p) => p.status === 'completed').length;
  const awaitingApprovalProjects = projectRows.filter((p) => p.status === 'awaiting_approval').length;
  const delayedProjects = projectRows.filter((p) => p.schedule.healthStatus === 'Delayed' || p.schedule.healthStatus === 'Behind Schedule').length;
  const atRiskProjects = projectRows.filter((p) => p.schedule.healthStatus === 'At Risk').length;
  const overallCompletion =
    totalProjects > 0
      ? Number((projectRows.reduce((s, p) => s + p.schedule.actualProgress, 0) / totalProjects).toFixed(1))
      : 0;

  const totalContractValue = projectRows.reduce((s, p) => s + (p.financials.contractAmount || 0), 0);
  const totalApprovedBudgets = projectRows.reduce((s, p) => s + (p.financials.revisedBudget || 0), 0);
  const totalActualExpenditures = projectRows.reduce((s, p) => s + (p.financials.actualExpenses || 0), 0);
  const totalOutstandingCommitments = projectRows.reduce((s, p) => s + (p.financials.outstandingCommitments || 0), 0);
  const totalRemainingBudget = totalApprovedBudgets - totalActualExpenditures - totalOutstandingCommitments;
  const totalForecastFinalCost = projectRows.reduce((s, p) => s + (p.financials.forecastFinalCost || 0), 0);
  const estimatedProfit = totalContractValue - totalForecastFinalCost;
  const estimatedMarginPct =
    totalContractValue > 0 ? Number(((estimatedProfit / totalContractValue) * 100).toFixed(2)) : null;

  const pidList = projectRows.map((p) => p.id);
  const pidClause = pidList.length > 0 ? `project_id IN (${pidList.join(',')})` : '1=0';
  const paPidClause = pidList.length > 0 ? `pa.project_id IN (${pidList.join(',')})` : '1=0';

  const taskAgg = db
    .prepare(`SELECT status, COUNT(*) AS cnt FROM tasks WHERE ${pidClause} GROUP BY status`)
    .all() as Array<{ status: string; cnt: number }>;

  const totalTasks = taskAgg.reduce((s, t) => s + t.cnt, 0);
  const completedTasks = taskAgg.find((t) => t.status === 'completed')?.cnt || 0;
  const activeTasks = taskAgg
    .filter((t) => ['pending', 'acknowledged', 'in_progress', 'for_review'].includes(t.status))
    .reduce((s, t) => s + t.cnt, 0);
  const overdueTasks = taskAgg.find((t) => t.status === 'overdue')?.cnt || 0;
  const tasksAwaitingReview = taskAgg.find((t) => t.status === 'for_review')?.cnt || 0;

  const pendingPrs = (
    db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM purchase_requests WHERE ${pidClause} AND status IN ('submitted', 'under_review', 'endorsed')`
      )
      .get() as { cnt: number }
  ).cnt;

  const activePersonnel = (
    db.prepare("SELECT COUNT(*) AS cnt FROM personnel WHERE employment_status = 'active'").get() as { cnt: number }
  ).cnt;

  const today = new Date().toISOString().slice(0, 10);
  const attendanceToday = db
    .prepare("SELECT status, COUNT(*) AS cnt FROM attendance WHERE work_date = ? GROUP BY status")
    .all(today) as Array<{ status: string; cnt: number }>;

  const equipStats = db
    .prepare('SELECT condition_status, COUNT(*) AS cnt FROM equipment GROUP BY condition_status')
    .all() as Array<{ condition_status: string; cnt: number }>;

  const inventoryAlerts = (
    db.prepare('SELECT COUNT(*) AS cnt FROM inventory_items WHERE current_qty <= min_stock_level').get() as {
      cnt: number;
    }
  ).cnt;

  // Chart datasets from real SQL queries
  const expenseCategories = db
    .prepare(
      `SELECT category, COALESCE(SUM(amount), 0) AS total
       FROM expenses WHERE ${pidClause} AND status = 'approved'
       GROUP BY category ORDER BY total DESC`
    )
    .all() as Array<{ category: string; total: number }>;

  const monthlyExpenditure = db
    .prepare(
      `SELECT substr(expense_date, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total
       FROM expenses WHERE ${pidClause} AND status = 'approved'
       GROUP BY substr(expense_date, 1, 7) ORDER BY month ASC`
    )
    .all() as Array<{ month: string; total: number }>;

  const manpowerByProject = db
    .prepare(
      `SELECT p.name AS project_name, COUNT(per.id) AS headcount
       FROM personnel per
       LEFT JOIN projects p ON p.id = per.assigned_project_id
       WHERE per.employment_status = 'active'
       GROUP BY per.assigned_project_id`
    )
    .all() as Array<{ project_name: string | null; headcount: number }>;

  // Upcoming Milestones from active schedule revisions
  const upcomingMilestones = db
    .prepare(
      `SELECT pa.id, pa.project_id, p.name AS project_name, pa.name, pa.end_date,
              pa.milestone_status, pa.actual_progress
       FROM project_activities pa
       JOIN schedule_revisions sr ON sr.id = pa.revision_id AND sr.is_active = 1
       JOIN projects p ON p.id = pa.project_id
       WHERE ${paPidClause}
         AND pa.is_milestone = 1
         AND COALESCE(pa.milestone_status, 'upcoming') != 'completed'
         AND pa.actual_progress < 100
       ORDER BY pa.end_date ASC
       LIMIT 6`
    )
    .all() as Array<{
    id: number;
    project_id: number;
    project_name: string;
    name: string;
    end_date: string;
    milestone_status: string | null;
    actual_progress: number;
  }>;

  // Recent Activity feed across DPRs, Tasks, Purchase Requests, Personnel
  const recentDprs = db
    .prepare(
      `SELECT d.id, d.project_id, p.name AS project_name, d.report_date AS ref_date, d.created_at,
              'dpr' AS kind, ('Daily progress report submitted (' || d.report_date || ')') AS title
       FROM daily_progress_reports d
       JOIN projects p ON p.id = d.project_id
       WHERE ${pidClause.replace(/project_id/g, 'd.project_id')}
       ORDER BY d.created_at DESC LIMIT 4`
    )
    .all() as any[];

  const recentTasks = db
    .prepare(
      `SELECT t.id, t.project_id, p.name AS project_name, t.updated_at AS created_at,
              'task' AS kind,
              CASE WHEN t.status = 'completed' THEN ('Task completed: ' || t.title) ELSE ('Task updated: ' || t.title) END AS title
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE ${pidClause.replace(/project_id/g, 't.project_id')}
       ORDER BY t.updated_at DESC LIMIT 4`
    )
    .all() as any[];

  const recentPrs = db
    .prepare(
      `SELECT pr.id, pr.project_id, p.name AS project_name, pr.created_at,
              'procurement' AS kind, ('PR ' || pr.ref_number || ': ' || pr.item_description) AS title
       FROM purchase_requests pr
       JOIN projects p ON p.id = pr.project_id
       WHERE ${pidClause.replace(/project_id/g, 'pr.project_id')}
       ORDER BY pr.created_at DESC LIMIT 4`
    )
    .all() as any[];

  const recentPersonnel = db
    .prepare(
      `SELECT per.id, per.assigned_project_id AS project_id, COALESCE(p.name, 'Operations Pool') AS project_name,
              per.created_at, 'personnel' AS kind, ('Team member added: ' || per.full_name) AS title
       FROM personnel per
       LEFT JOIN projects p ON p.id = per.assigned_project_id
       ORDER BY per.created_at DESC LIMIT 3`
    )
    .all() as any[];

  const recentActivity = [...recentDprs, ...recentTasks, ...recentPrs, ...recentPersonnel]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 6);

  res.json({
    projectOverview: {
      totalProjects,
      activeProjects,
      completedProjects,
      delayedProjects,
      atRiskProjects,
      awaitingApprovalProjects,
      overallCompletion,
    },
    financialOverview: {
      totalContractValue,
      totalApprovedBudgets,
      totalActualExpenditures,
      totalOutstandingCommitments,
      totalRemainingBudget,
      totalForecastFinalCost,
      estimatedProfit,
      estimatedMarginPct,
    },
    operationalOverview: {
      totalTasks,
      completedTasks,
      activeTasks,
      overdueTasks,
      tasksAwaitingReview,
      pendingPrs,
      activePersonnel,
      attendanceToday,
      equipmentStats: equipStats,
      inventoryAlerts,
    },
    charts: {
      taskStatusDistribution: taskAgg,
      expenseCategories,
      monthlyExpenditure,
      manpowerByProject,
    },
    upcomingMilestones,
    recentActivity,
    projects: projectRows,
  });
});

// --- Projects CRUD ---
router.get('/projects', requireModule('projects'), requirePermission('projects', 'view'), (req: AuthenticatedRequest, res) => {
  const access = getAccessibleProjectIds(req.user!);
  const filterSql =
    access === 'ALL'
      ? ''
      : access.length > 0
      ? `WHERE p.id IN (${access.map(() => '?').join(',')})`
      : 'WHERE 1=0';
  const params = access === 'ALL' ? [] : access;

  const projects = db
    .prepare(
      `SELECT p.*, c.company_name AS client_name, u.full_name AS pm_name
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN users u ON u.id = p.project_manager_id
       ${filterSql}
       ORDER BY p.id DESC`
    )
    .all(...params) as any[];

  res.json({
    projects: projects.map((p) => ({
      ...p,
      schedule: getProjectScheduleMetrics(p.id),
      financials: getProjectFinancialSummary(p.id),
    })),
  });
});

router.post('/projects', requireModule('projects'), requirePermission('projects', 'create'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  if (!b.refNumber || !b.name || !b.clientId || !b.location || !b.startDate || !b.originalEndDate) {
    res.status(400).json({ error: 'Reference number, name, client, location, start date, and expected completion date are required' });
    return;
  }

  const exists = db.prepare('SELECT id FROM projects WHERE ref_number = ?').get(String(b.refNumber).trim());
  if (exists) {
    res.status(409).json({ error: 'Project reference number already exists' });
    return;
  }

  const projectId = transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO projects (
          ref_number, name, client_id, client_contact_info, location, address, description, scope,
          contract_amount, approved_budget, revised_budget, project_manager_id, site_supervisor_id,
          start_date, original_end_date, status, hero_image, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(b.refNumber).trim(),
        String(b.name).trim(),
        Number(b.clientId),
        b.clientContactInfo || '',
        String(b.location).trim(),
        b.address || '',
        b.description || '',
        b.scope || '',
        Number(b.contractAmount || 0),
        Number(b.approvedBudget || 0),
        Number(b.revisedBudget || b.approvedBudget || 0),
        b.projectManagerId ? Number(b.projectManagerId) : req.user!.id,
        b.siteSupervisorId ? Number(b.siteSupervisorId) : null,
        b.startDate,
        b.originalEndDate,
        b.status || 'active',
        b.heroImage || '/src/assets/images/hero_commercial_tower_1795251920498.jpg',
        req.user!.id
      );

    const pid = Number(info.lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO project_assignments (project_id, user_id, assignment_role) VALUES (?, ?, ?)').run(
      pid,
      req.user!.id,
      'creator'
    );
    if (b.projectManagerId) {
      db.prepare('INSERT OR IGNORE INTO project_assignments (project_id, user_id, assignment_role) VALUES (?, ?, ?)').run(
        pid,
        Number(b.projectManagerId),
        'project_manager'
      );
    }
    return pid;
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_PROJECT',
    module: 'projects',
    recordType: 'project',
    recordRef: String(b.refNumber).trim(),
    newValue: { name: b.name, contractAmount: b.contractAmount, approvedBudget: b.approvedBudget },
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'project:created',
    module: 'projects',
    projectId,
    payload: { id: projectId, name: b.name },
  });

  res.status(201).json({ id: projectId });
});

router.get('/projects/:id', requireModule('projects'), requirePermission('projects', 'view'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'You are not assigned to this project' });
    return;
  }

  const project = db
    .prepare(
      `SELECT p.*, c.company_name AS client_name, c.email AS client_email,
              pm.full_name AS pm_name, ss.full_name AS supervisor_name
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN users pm ON pm.id = p.project_manager_id
       LEFT JOIN users ss ON ss.id = p.site_supervisor_id
       WHERE p.id = ?`
    )
    .get(projectId);

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const team = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.job_title, r.name AS role_name, r.is_client_role, pa.assignment_role
       FROM project_assignments pa
       JOIN users u ON u.id = pa.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE pa.project_id = ?`
    )
    .all(projectId);

  const projectPersonnel = db
    .prepare(
      `SELECT per.id, per.user_id, per.employee_code, per.full_name, per.position, per.trade_skill, per.assigned_project_id
       FROM personnel per
       WHERE per.employment_status = 'active'
       ORDER BY CASE WHEN per.assigned_project_id = ? THEN 0 ELSE 1 END, per.full_name ASC`
    )
    .all(projectId);

  const assignableStaff = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.job_title, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = 1 AND r.is_client_role = 0
       ORDER BY u.full_name ASC`
    )
    .all();

  const schedule = getProjectScheduleMetrics(projectId);
  const financials = getProjectFinancialSummary(projectId);
  const evm = getProjectEvmMetrics(projectId);

  res.json({ project, team, projectPersonnel, assignableStaff, schedule, financials, evm });
});

router.patch('/projects/:id', requireModule('projects'), requirePermission('projects', 'edit'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  const prev = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  if (!prev) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const b = req.body || {};
  db.prepare(
    `UPDATE projects SET
      name = COALESCE(?, name),
      location = COALESCE(?, location),
      description = COALESCE(?, description),
      scope = COALESCE(?, scope),
      revised_budget = COALESCE(?, revised_budget),
      revised_end_date = COALESCE(?, revised_end_date),
      status = COALESCE(?, status),
      schedule_delay_explanation = COALESCE(?, schedule_delay_explanation),
      delay_explanation_client_visible = COALESCE(?, delay_explanation_client_visible),
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    b.name ?? null,
    b.location ?? null,
    b.description ?? null,
    b.scope ?? null,
    b.revisedBudget !== undefined ? Number(b.revisedBudget) : null,
    b.revisedEndDate ?? null,
    b.status ?? null,
    b.scheduleDelayExplanation ?? null,
    b.delayExplanationClientVisible !== undefined ? (b.delayExplanationClientVisible ? 1 : 0) : null,
    projectId
  );

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_PROJECT',
    module: 'projects',
    recordType: 'project',
    recordRef: prev.ref_number,
    previousValue: { status: prev.status, revised_budget: prev.revised_budget, revised_end_date: prev.revised_end_date },
    newValue: b,
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'project:updated',
    module: 'projects',
    projectId,
    clientVisible: true,
    payload: { id: projectId },
  });

  res.json({ ok: true });
});

// --- Schedule, Gantt, CPM, and Excel Schedule Import ---
router.get('/projects/:id/schedule', requireModule('schedules'), requirePermission('schedules', 'view'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const revisions = db
    .prepare(
      `SELECT sr.*, u.full_name AS created_by_name, ap.full_name AS approved_by_name
       FROM schedule_revisions sr
       LEFT JOIN users u ON u.id = sr.created_by
       LEFT JOIN users ap ON ap.id = sr.approved_by
       WHERE sr.project_id = ?
       ORDER BY sr.revision_number DESC`
    )
    .all(projectId) as any[];

  const requestedRevId = req.query.revisionId ? Number(req.query.revisionId) : null;
  const activeRev =
    revisions.find((r) => (requestedRevId ? r.id === requestedRevId : r.is_active === 1)) || revisions[0] || null;

  const phases = activeRev
    ? db
        .prepare('SELECT * FROM project_phases WHERE project_id = ? AND revision_id = ? ORDER BY sort_order ASC')
        .all(projectId, activeRev.id)
    : [];

  const activities = activeRev
    ? db
        .prepare(
          `SELECT pa.*, pp.name AS phase_name
           FROM project_activities pa
           LEFT JOIN project_phases pp ON pp.id = pa.phase_id
           WHERE pa.project_id = ? AND pa.revision_id = ?
           ORDER BY pa.start_date ASC, pa.wbs_code ASC`
        )
        .all(projectId, activeRev.id)
    : [];

  const metrics = getProjectScheduleMetrics(projectId);
  res.json({ revisions, activeRevision: activeRev, phases, activities, metrics });
});

router.post('/projects/:id/schedule/import', requireModule('schedules'), requirePermission('schedules', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const { rows, revisionNote, sourceFilename, confirmRevision, activateNow } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'Validated schedule rows are required' });
    return;
  }

  const existingActive = db
    .prepare('SELECT id, revision_number FROM schedule_revisions WHERE project_id = ? AND is_active = 1')
    .get(projectId) as { id: number; revision_number: number } | undefined;

  if (existingActive && !confirmRevision) {
    res.status(409).json({
      error: 'An approved schedule already exists. Explicit revision confirmation is required.',
      requiresConfirmation: true,
      currentRevision: existingActive.revision_number,
    });
    return;
  }

  // Validate rows server-side
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.activity || !r.startDate || !r.endDate) {
      res.status(400).json({ error: `Row ${i + 1}: Activity name, start date, and end date are required` });
      return;
    }
    if (new Date(r.endDate) < new Date(r.startDate)) {
      res.status(400).json({ error: `Row ${i + 1} (${r.activity}): End date cannot precede start date` });
      return;
    }
  }

  const canApprove = req.user!.role_slug === 'system_admin' || req.user!.permissions.some((p) => p.module_slug === 'schedules' && p.action === 'approve');
  const shouldActivate = Boolean(activateNow && canApprove);

  const newRevId = transaction(() => {
    const maxRev = db
      .prepare('SELECT COALESCE(MAX(revision_number), 0) AS m FROM schedule_revisions WHERE project_id = ?')
      .get(projectId) as { m: number };
    const nextRevNum = maxRev.m + 1;

    if (shouldActivate) {
      db.prepare('UPDATE schedule_revisions SET is_active = 0 WHERE project_id = ?').run(projectId);
    }

    const revRes = db
      .prepare(
        `INSERT INTO schedule_revisions (project_id, revision_number, revision_note, source_filename, is_approved, is_active, approved_by, approved_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        projectId,
        nextRevNum,
        revisionNote || `Imported schedule revision ${nextRevNum}`,
        sourceFilename || 'manual_import.xlsx',
        shouldActivate ? 1 : 0,
        shouldActivate ? 1 : 0,
        shouldActivate ? req.user!.id : null,
        shouldActivate ? new Date().toISOString() : null,
        req.user!.id
      );

    const revId = Number(revRes.lastInsertRowid);
    const phaseMap = new Map<string, number>();
    let phaseOrder = 1;

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const phaseName = String(r.phase || 'General Construction').trim();
      let phaseId = phaseMap.get(phaseName);
      if (!phaseId) {
        const phaseRows = rows.filter((x: any) => String(x.phase || 'General Construction').trim() === phaseName);
        const minStart = phaseRows.reduce((m: string, x: any) => (x.startDate < m ? x.startDate : m), r.startDate);
        const maxEnd = phaseRows.reduce((m: string, x: any) => (x.endDate > m ? x.endDate : m), r.endDate);
        const pRes = db
          .prepare(
            `INSERT INTO project_phases (project_id, revision_id, name, sort_order, start_date, end_date, weight_percent)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(projectId, revId, phaseName, phaseOrder++, minStart, maxEnd, 0);
        phaseId = Number(pRes.lastInsertRowid);
        phaseMap.set(phaseName, phaseId);
      }

      const dur =
        Number(r.duration) > 0
          ? Number(r.duration)
          : Math.max(1, Math.round((new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / 86400000) + 1);

      const depsArray = Array.isArray(r.dependencies)
        ? r.dependencies
        : typeof r.dependencies === 'string' && r.dependencies.trim()
        ? r.dependencies.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];

      db.prepare(
        `INSERT INTO project_activities (
          project_id, revision_id, phase_id, wbs_code, name, description, start_date, end_date,
          duration_days, dependencies_json, is_milestone, milestone_status, weight_percent,
          planned_progress, actual_progress, responsible_person, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        projectId,
        revId,
        phaseId,
        String(r.wbsCode || `${idx + 1}.0`),
        String(r.activity).trim(),
        String(r.description || ''),
        r.startDate,
        r.endDate,
        dur,
        JSON.stringify(depsArray),
        r.isMilestone ? 1 : 0,
        r.isMilestone ? (Number(r.actualProgress || 0) >= 100 ? 'completed' : 'upcoming') : null,
        Number(r.weightPercent || 0),
        Number(r.plannedProgress || 0),
        Math.min(100, Math.max(0, Number(r.actualProgress || 0))),
        String(r.responsiblePerson || ''),
        String(r.remarks || '')
      );
    }

    const insertedActs = db
      .prepare('SELECT * FROM project_activities WHERE revision_id = ?')
      .all(revId) as any[];
    const critIds = computeCriticalPath(insertedActs);
    for (const cid of critIds) {
      db.prepare('UPDATE project_activities SET is_critical_path = 1 WHERE id = ?').run(cid);
    }

    if (shouldActivate) {
      syncProjectProgressFromSchedule(projectId);
    }

    return revId;
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'IMPORT_SCHEDULE_REVISION',
    module: 'schedules',
    recordType: 'schedule_revision',
    recordRef: `PRJ-${projectId}-REV-${newRevId}`,
    newValue: { rowCount: rows.length, sourceFilename, activated: shouldActivate },
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'schedule:imported',
    module: 'schedules',
    projectId,
    clientVisible: shouldActivate,
    payload: { revisionId: newRevId },
  });

  res.status(201).json({ revisionId: newRevId, activated: shouldActivate });
});

router.post('/projects/:id/schedule/revisions/:revId/activate', requireModule('schedules'), requirePermission('schedules', 'approve'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  const revId = Number(req.params.revId);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  transaction(() => {
    db.prepare('UPDATE schedule_revisions SET is_active = 0 WHERE project_id = ?').run(projectId);
    db.prepare(
      "UPDATE schedule_revisions SET is_active = 1, is_approved = 1, approved_by = ?, approved_at = datetime('now') WHERE id = ? AND project_id = ?"
    ).run(req.user!.id, revId, projectId);
    syncProjectProgressFromSchedule(projectId);
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'ACTIVATE_SCHEDULE_REVISION',
    module: 'schedules',
    recordType: 'schedule_revision',
    recordRef: `REV-${revId}`,
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'schedule:activated',
    module: 'schedules',
    projectId,
    clientVisible: true,
    payload: { revisionId: revId },
  });

  res.json({ ok: true });
});

router.patch('/projects/:id/activities/:actId', requireModule('schedules'), requirePermission('schedules', 'edit'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  const actId = Number(req.params.actId);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const { actualProgress, remarks } = req.body || {};
  const pct = Math.min(100, Math.max(0, Number(actualProgress ?? 0)));

  transaction(() => {
    db.prepare(
      `UPDATE project_activities SET
        actual_progress = ?,
        milestone_status = CASE WHEN is_milestone = 1 THEN (CASE WHEN ? >= 100 THEN 'completed' ELSE 'upcoming' END) ELSE milestone_status END,
        remarks = COALESCE(?, remarks)
       WHERE id = ? AND project_id = ?`
    ).run(pct, pct, remarks ?? null, actId, projectId);

    syncProjectProgressFromSchedule(projectId);
  });

  emitSyncEvent({
    eventType: 'schedule:activity_updated',
    module: 'schedules',
    projectId,
    clientVisible: true,
    payload: { activityId: actId, actualProgress: pct },
  });

  res.json({ ok: true });
});

// --- Daily Progress Reports (DPR) ---
router.get('/projects/:id/dpr', requireModule('dpr'), requirePermission('dpr', 'view'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const reports = db
    .prepare(
      `SELECT d.*, prep.full_name AS prepared_by_name, rev.full_name AS reviewed_by_name, app.full_name AS approved_by_name
       FROM daily_progress_reports d
       JOIN users prep ON prep.id = d.prepared_by
       LEFT JOIN users rev ON rev.id = d.reviewed_by
       LEFT JOIN users app ON app.id = d.approved_by
       WHERE d.project_id = ?
       ORDER BY d.report_date DESC, d.id DESC`
    )
    .all(projectId);

  res.json({ reports });
});

router.post('/projects/:id/dpr', requireModule('dpr'), requirePermission('dpr', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const b = req.body || {};
  if (!b.reportDate || !b.activitiesPerformed) {
    res.status(400).json({ error: 'Reporting date and activities performed are required' });
    return;
  }

  // Idempotency check for offline sync retries
  if (b.clientIdempotencyKey) {
    const existing = db
      .prepare('SELECT id FROM daily_progress_reports WHERE client_idempotency_key = ?')
      .get(String(b.clientIdempotencyKey)) as { id: number } | undefined;
    if (existing) {
      res.status(200).json({ id: existing.id, deduplicated: true });
      return;
    }
  }

  const sanitizedPhotos = Array.isArray(b.photos)
    ? b.photos
        .slice(0, 10)
        .filter(
          (ph: any) =>
            ph &&
            typeof ph.url === 'string' &&
            (ph.url.startsWith('data:image/') || ph.url.startsWith('/src/assets/images/')) &&
            ph.url.length <= 2_500_000
        )
        .map((ph: any) => ({
          url: ph.url,
          caption: typeof ph.caption === 'string' ? ph.caption.slice(0, 200) : '',
          phase: typeof ph.phase === 'string' ? ph.phase.slice(0, 100) : 'Field Progress',
          date: b.reportDate,
        }))
    : [];

  const status = b.submitNow ? 'submitted' : 'draft';
  const info = db
    .prepare(
      `INSERT INTO daily_progress_reports (
        project_id, report_date, site_location, weather, activities_performed, accomplishments,
        work_completed_pct, manpower_count, materials_used, equipment_used, delays_problems,
        safety_observations, quality_observations, next_day_plan, remarks, status, prepared_by,
        is_published_to_client, photos_json, client_idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      projectId,
      b.reportDate,
      b.siteLocation || '',
      b.weather || '',
      b.activitiesPerformed,
      b.accomplishments || '',
      Number(b.workCompletedPct || 0),
      Number(b.manpowerCount || 0),
      b.materialsUsed || '',
      b.equipmentUsed || '',
      b.delaysProblems || '',
      b.safetyObservations || '',
      b.qualityObservations || '',
      b.nextDayPlan || '',
      b.remarks || '',
      status,
      req.user!.id,
      JSON.stringify(sanitizedPhotos),
      b.clientIdempotencyKey || null
    );

  const dprId = Number(info.lastInsertRowid);
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_DPR',
    module: 'dpr',
    recordType: 'dpr',
    recordRef: `DPR-${dprId}`,
    newValue: { projectId, reportDate: b.reportDate, status, photoCount: sanitizedPhotos.length },
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'dpr:created',
    module: 'dpr',
    projectId,
    clientVisible: false, // Private by default!
    payload: { id: dprId, reportDate: b.reportDate, status },
  });

  res.status(201).json({ id: dprId });
});

router.patch('/dpr/:id/workflow', requireModule('dpr'), requirePermission('dpr', 'review'), (req: AuthenticatedRequest, res) => {
  const dprId = Number(req.params.id);
  const { action, remarks } = req.body || {};
  const dpr = db.prepare('SELECT * FROM daily_progress_reports WHERE id = ?').get(dprId) as any;
  if (!dpr) {
    res.status(404).json({ error: 'DPR not found' });
    return;
  }
  if (!canAccessProject(req.user!, dpr.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  let nextStatus = dpr.status;
  if (action === 'submit') nextStatus = 'submitted';
  else if (action === 'review') nextStatus = 'reviewed';
  else if (action === 'approve') nextStatus = 'approved';
  else if (action === 'return') nextStatus = 'returned';
  else {
    res.status(400).json({ error: 'Invalid workflow action' });
    return;
  }

  db.prepare(
    `UPDATE daily_progress_reports SET
      status = ?,
      remarks = COALESCE(?, remarks),
      reviewed_by = CASE WHEN ? IN ('reviewed', 'approved') THEN COALESCE(reviewed_by, ?) ELSE reviewed_by END,
      reviewed_at = CASE WHEN ? = 'reviewed' THEN datetime('now') ELSE reviewed_at END,
      approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
      approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE approved_at END,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(nextStatus, remarks ?? null, nextStatus, req.user!.id, nextStatus, nextStatus, req.user!.id, nextStatus, dprId);

  createNotification({
    userId: dpr.prepared_by,
    projectId: dpr.project_id,
    type: 'dpr_workflow',
    title: `DPR ${dpr.report_date} ${nextStatus}`,
    body: `Your daily progress report status changed to ${nextStatus}.`,
    linkSection: 'dpr',
  });

  emitSyncEvent({
    eventType: 'dpr:updated',
    module: 'dpr',
    projectId: dpr.project_id,
    clientVisible: false,
    payload: { id: dprId, status: nextStatus },
  });

  res.json({ ok: true, status: nextStatus });
});

router.post('/dpr/:id/publish-client', requireModule('dpr'), requirePermission('dpr', 'publish_client'), (req: AuthenticatedRequest, res) => {
  const dprId = Number(req.params.id);
  const dpr = db.prepare('SELECT * FROM daily_progress_reports WHERE id = ?').get(dprId) as any;
  if (!dpr) {
    res.status(404).json({ error: 'DPR not found' });
    return;
  }
  if (!canAccessProject(req.user!, dpr.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const { clientSummary, completedActivities, nextActivities, approvedPhotos, publish } = req.body || {};
  const isPublished = publish === false ? 0 : 1;

  db.prepare(
    `UPDATE daily_progress_reports SET
      is_published_to_client = ?,
      client_summary = ?,
      client_completed_activities = ?,
      client_next_activities = ?,
      client_photos_json = ?,
      client_published_by = ?,
      client_published_at = datetime('now'),
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    isPublished,
    clientSummary || dpr.accomplishments || '',
    completedActivities || dpr.activities_performed || '',
    nextActivities || dpr.next_day_plan || '',
    JSON.stringify(Array.isArray(approvedPhotos) ? approvedPhotos : []),
    req.user!.id,
    dprId
  );

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: isPublished ? 'PUBLISH_DPR_TO_CLIENT' : 'UNPUBLISH_DPR_FROM_CLIENT',
    module: 'dpr',
    recordType: 'dpr',
    recordRef: `DPR-${dprId}`,
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'client_update:published',
    module: 'client_portal',
    projectId: dpr.project_id,
    clientVisible: true,
    payload: { dprId, isPublished },
  });

  res.json({ ok: true, isPublished: Boolean(isPublished) });
});

// --- Tasks Management ---
router.get('/tasks', requireModule('tasks'), requirePermission('tasks', 'view'), (req: AuthenticatedRequest, res) => {
  const access = getAccessibleProjectIds(req.user!);
  const projectId = req.query.projectId ? Number(req.query.projectId) : null;

  if (projectId && !canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  let whereSql = 'WHERE 1=1';
  const params: unknown[] = [];
  if (projectId) {
    whereSql += ' AND t.project_id = ?';
    params.push(projectId);
  } else if (access !== 'ALL') {
    if (access.length === 0) {
      res.json({ tasks: [] });
      return;
    }
    whereSql += ` AND t.project_id IN (${access.map(() => '?').join(',')})`;
    params.push(...access);
  }

  const tasks = db
    .prepare(
      `SELECT t.*, p.name AS project_name, p.ref_number AS project_ref,
              COALESCE(per.full_name, ass.full_name, NULLIF(t.assigned_team, '')) AS assigned_to_name,
              per.position AS assigned_position,
              sup.full_name AS supervisor_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users ass ON ass.id = t.assigned_to
       LEFT JOIN personnel per ON per.id = t.assigned_personnel_id
       LEFT JOIN users sup ON sup.id = t.supervisor_id
       ${whereSql}
       ORDER BY t.deadline ASC, t.id DESC`
    )
    .all(...params);

  res.json({ tasks });
});

router.post('/projects/:id/tasks', requireModule('tasks'), requirePermission('tasks', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const b = req.body || {};
  if (!b.title || !b.startDate || !b.deadline) {
    res.status(400).json({ error: 'Title, start date, and deadline are required' });
    return;
  }

  if (b.clientIdempotencyKey) {
    const existing = db
      .prepare('SELECT id FROM tasks WHERE client_idempotency_key = ?')
      .get(String(b.clientIdempotencyKey)) as { id: number } | undefined;
    if (existing) {
      res.status(200).json({ id: existing.id, deduplicated: true });
      return;
    }
  }

  let assignedUserId: number | null = b.assignedTo ? Number(b.assignedTo) : null;
  let assignedPersonnelId: number | null = b.assignedPersonnelId ? Number(b.assignedPersonnelId) : null;
  let assignedTeamLabel = b.assignedTeam || '';

  if (assignedPersonnelId) {
    const per = db
      .prepare('SELECT id, user_id, full_name FROM personnel WHERE id = ?')
      .get(assignedPersonnelId) as { id: number; user_id: number | null; full_name: string } | undefined;
    if (per) {
      if (!assignedUserId && per.user_id) assignedUserId = per.user_id;
      if (!assignedTeamLabel) assignedTeamLabel = per.full_name;
    } else {
      assignedPersonnelId = null;
    }
  }

  const allowedPriorities = ['low', 'medium', 'high', 'critical'];
  const priority = allowedPriorities.includes(String(b.priority || '').toLowerCase())
    ? String(b.priority).toLowerCase()
    : 'medium';

  const refNum = `TSK-${Date.now().toString().slice(-6)}`;
  const info = db
    .prepare(
      `INSERT INTO tasks (
        ref_number, project_id, title, description, assigned_to, assigned_personnel_id, assigned_team,
        supervisor_id, reviewer_id, priority, start_date, deadline, dependencies_json,
        progress_pct, status, client_idempotency_key, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      refNum,
      projectId,
      String(b.title).trim(),
      String(b.description || '').trim(),
      assignedUserId,
      assignedPersonnelId,
      assignedTeamLabel,
      b.supervisorId ? Number(b.supervisorId) : req.user!.id,
      b.reviewerId ? Number(b.reviewerId) : req.user!.id,
      priority,
      b.startDate,
      b.deadline,
      JSON.stringify(Array.isArray(b.dependencies) ? b.dependencies : []),
      Number(b.progressPct || 0),
      b.status || 'pending',
      b.clientIdempotencyKey || null,
      req.user!.id
    );

  const taskId = Number(info.lastInsertRowid);
  if (assignedUserId) {
    createNotification({
      userId: assignedUserId,
      projectId,
      type: 'task_assigned',
      title: `New Task Assigned: ${refNum}`,
      body: String(b.title).trim(),
      linkSection: 'tasks',
    });
  }

  emitSyncEvent({
    eventType: 'task:created',
    module: 'tasks',
    projectId,
    payload: { id: taskId, refNumber: refNum },
  });

  res.status(201).json({ id: taskId, refNumber: refNum });
});

router.patch('/tasks/:id', requireModule('tasks'), requirePermission('tasks', 'edit'), (req: AuthenticatedRequest, res) => {
  const taskId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  if (!canAccessProject(req.user!, existing.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const b = req.body || {};
  const nextStatus = b.status ?? existing.status;
  const nextPct =
    nextStatus === 'completed'
      ? 100
      : b.progressPct !== undefined
      ? Math.min(100, Math.max(0, Number(b.progressPct)))
      : existing.progress_pct;

  db.prepare(
    `UPDATE tasks SET
      status = ?,
      progress_pct = ?,
      priority = COALESCE(?, priority),
      deadline = COALESCE(?, deadline),
      completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE completed_at END,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(nextStatus, nextPct, b.priority ?? null, b.deadline ?? null, nextStatus, taskId);

  emitSyncEvent({
    eventType: 'task:updated',
    module: 'tasks',
    projectId: existing.project_id,
    payload: { id: taskId, status: nextStatus, progressPct: nextPct },
  });

  res.json({ ok: true });
});

router.get('/tasks/:id/comments', requireModule('tasks'), requirePermission('tasks', 'view'), (req: AuthenticatedRequest, res) => {
  const taskId = Number(req.params.id);
  const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId) as { project_id: number } | undefined;
  if (!task || !canAccessProject(req.user!, task.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  const comments = db
    .prepare(
      `SELECT tc.*, u.full_name AS author_name, r.name AS author_role
       FROM task_comments tc
       JOIN users u ON u.id = tc.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE tc.task_id = ? ORDER BY tc.id ASC`
    )
    .all(taskId);
  res.json({ comments });
});

router.post('/tasks/:id/comments', requireModule('tasks'), requirePermission('tasks', 'edit'), (req: AuthenticatedRequest, res) => {
  const taskId = Number(req.params.id);
  const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId) as { project_id: number } | undefined;
  if (!task || !canAccessProject(req.user!, task.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  const { comment } = req.body || {};
  if (!comment || typeof comment !== 'string' || !comment.trim()) {
    res.status(400).json({ error: 'Comment text is required' });
    return;
  }
  const info = db
    .prepare('INSERT INTO task_comments (task_id, user_id, comment) VALUES (?, ?, ?)')
    .run(taskId, req.user!.id, comment.trim());
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

export default router;
