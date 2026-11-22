import { Router } from 'express';
import {
  type AuthenticatedRequest,
  hashPassword,
  logAudit,
  requireAuth,
  requirePermission,
} from '../auth.ts';
import { db, transaction } from '../db.ts';
import { createNotification } from '../realtime.ts';
import { seedSampleWorkspace } from '../seed.ts';

const router = Router();
router.use(requireAuth);

// --- Users & Client Account Management ---
router.get('/users', requirePermission('admin', 'view'), (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.role_id, u.phone, u.job_title, u.is_active,
              u.last_login_at, u.created_at, r.slug AS role_slug, r.name AS role_name, r.is_client_role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id ASC`
    )
    .all() as any[];

  const assignments = db.prepare('SELECT user_id, project_id FROM project_assignments').all() as Array<{
    user_id: number;
    project_id: number;
  }>;
  const clientLinks = db.prepare('SELECT user_id, client_id FROM client_users').all() as Array<{
    user_id: number;
    client_id: number;
  }>;

  const enriched = users.map((u) => ({
    ...u,
    assigned_project_ids: assignments.filter((a) => a.user_id === u.id).map((a) => a.project_id),
    client_ids: clientLinks.filter((c) => c.user_id === u.id).map((c) => c.client_id),
  }));

  res.json({ users: enriched });
});

router.post('/users', requirePermission('admin', 'create'), (req: AuthenticatedRequest, res) => {
  const { email, fullName, password, roleId, phone, jobTitle, assignedProjectIds, clientId } = req.body || {};
  if (!email || !fullName || !password || !roleId) {
    res.status(400).json({ error: 'Email, full name, password, and role are required' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const normalized = String(email).trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (exists) {
    res.status(409).json({ error: 'Email address already exists' });
    return;
  }

  const newUserId = transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, role_id, phone, job_title, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      )
      .run(normalized, hashPassword(password), String(fullName).trim(), Number(roleId), phone || '', jobTitle || '');
    const uid = Number(info.lastInsertRowid);

    if (Array.isArray(assignedProjectIds)) {
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO project_assignments (project_id, user_id, assignment_role) VALUES (?, ?, ?)'
      );
      for (const pid of assignedProjectIds) {
        stmt.run(Number(pid), uid, 'assigned');
      }
    }

    if (clientId) {
      db.prepare('INSERT OR IGNORE INTO client_users (user_id, client_id, is_primary) VALUES (?, ?, 1)').run(
        uid,
        Number(clientId)
      );
    }

    return uid;
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_USER',
    module: 'admin',
    recordType: 'user',
    recordRef: `USR-${newUserId}`,
    newValue: { email: normalized, fullName, roleId, assignedProjectIds, clientId },
    ipAddress: req.ip || '',
  });

  res.status(201).json({ id: newUserId });
});

router.patch('/users/:id', requirePermission('admin', 'edit'), (req: AuthenticatedRequest, res) => {
  const userId = Number(req.params.id);
  const { fullName, roleId, isActive, phone, jobTitle, resetPassword, assignedProjectIds, clientId } = req.body || {};

  const existing = db.prepare('SELECT id, email, role_id, is_active FROM users WHERE id = ?').get(userId) as
    | { id: number; email: string; role_id: number; is_active: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  transaction(() => {
    if (fullName !== undefined || roleId !== undefined || isActive !== undefined || phone !== undefined || jobTitle !== undefined) {
      db.prepare(
        `UPDATE users SET
          full_name = COALESCE(?, full_name),
          role_id = COALESCE(?, role_id),
          is_active = COALESCE(?, is_active),
          phone = COALESCE(?, phone),
          job_title = COALESCE(?, job_title),
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        fullName ?? null,
        roleId !== undefined ? Number(roleId) : null,
        isActive !== undefined ? (isActive ? 1 : 0) : null,
        phone ?? null,
        jobTitle ?? null,
        userId
      );
    }

    if (resetPassword && typeof resetPassword === 'string' && resetPassword.length >= 8) {
      db.prepare("UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?").run(
        hashPassword(resetPassword),
        userId
      );
    }

    if (Array.isArray(assignedProjectIds)) {
      db.prepare('DELETE FROM project_assignments WHERE user_id = ?').run(userId);
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO project_assignments (project_id, user_id, assignment_role) VALUES (?, ?, ?)'
      );
      for (const pid of assignedProjectIds) {
        stmt.run(Number(pid), userId, 'assigned');
      }
    }

    if (clientId !== undefined) {
      db.prepare('DELETE FROM client_users WHERE user_id = ?').run(userId);
      if (clientId) {
        db.prepare('INSERT INTO client_users (user_id, client_id, is_primary) VALUES (?, ?, 1)').run(
          userId,
          Number(clientId)
        );
      }
    }
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_USER',
    module: 'admin',
    recordType: 'user',
    recordRef: `USR-${userId}`,
    previousValue: existing,
    newValue: { fullName, roleId, isActive, assignedProjectIds, clientId, passwordReset: Boolean(resetPassword) },
    ipAddress: req.ip || '',
  });

  res.json({ ok: true });
});

// --- Roles & Permissions ---
router.get('/roles', requirePermission('admin', 'view'), (_req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY id ASC').all() as any[];
  const perms = db.prepare('SELECT role_id, module_slug, action FROM role_permissions').all() as Array<{
    role_id: number;
    module_slug: string;
    action: string;
  }>;
  res.json({
    roles: roles.map((r) => ({
      ...r,
      permissions: perms.filter((p) => p.role_id === r.id),
    })),
  });
});

router.put('/roles/:id/permissions', requirePermission('admin', 'edit'), (req: AuthenticatedRequest, res) => {
  const roleId = Number(req.params.id);
  const { permissions } = req.body || {};
  if (!Array.isArray(permissions)) {
    res.status(400).json({ error: 'permissions array required' });
    return;
  }

  transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, module_slug, action) VALUES (?, ?, ?)'
    );
    for (const p of permissions) {
      if (p.module_slug && p.action) {
        stmt.run(roleId, String(p.module_slug), String(p.action));
      }
    }
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_ROLE_PERMISSIONS',
    module: 'admin',
    recordType: 'role',
    recordRef: `ROLE-${roleId}`,
    newValue: { count: permissions.length },
    ipAddress: req.ip || '',
  });

  res.json({ ok: true });
});

// --- Modules Registry ---
router.get('/modules', (_req, res) => {
  const modules = db.prepare('SELECT * FROM modules ORDER BY id ASC').all();
  res.json({ modules });
});

router.patch('/modules/:slug/toggle', requirePermission('admin', 'edit'), (req: AuthenticatedRequest, res) => {
  const slug = req.params.slug;
  const { isEnabled } = req.body || {};
  const mod = db.prepare('SELECT * FROM modules WHERE slug = ?').get(slug) as any;
  if (!mod) {
    res.status(404).json({ error: 'Module not found' });
    return;
  }
  if (slug === 'projects' && !isEnabled) {
    res.status(400).json({ error: 'Core Projects module cannot be disabled' });
    return;
  }

  db.prepare("UPDATE modules SET is_enabled = ?, updated_at = datetime('now') WHERE slug = ?").run(
    isEnabled ? 1 : 0,
    slug
  );

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: isEnabled ? 'ENABLE_MODULE' : 'DISABLE_MODULE',
    module: 'admin',
    recordType: 'module',
    recordRef: slug,
    remarks: 'Existing module records preserved in database',
    ipAddress: req.ip || '',
  });

  res.json({ ok: true });
});

// --- Clients Directory ---
router.get('/clients', requirePermission('projects', 'view'), (_req, res) => {
  const clients = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count
       FROM clients c
       ORDER BY c.company_name ASC`
    )
    .all() as any[];

  const portalLinks = db
    .prepare(
      `SELECT cu.client_id, u.id, u.full_name, u.email, u.phone, u.is_active
       FROM client_users cu
       JOIN users u ON u.id = cu.user_id
       ORDER BY u.full_name ASC`
    )
    .all() as Array<{
    client_id: number;
    id: number;
    full_name: string;
    email: string;
    phone: string;
    is_active: number;
  }>;

  const enriched = clients.map((c) => ({
    ...c,
    portal_users: portalLinks.filter((u) => u.client_id === c.id),
  }));

  res.json({ clients: enriched });
});

router.post('/clients', requirePermission('projects', 'create'), (req: AuthenticatedRequest, res) => {
  const {
    companyName,
    primaryContact,
    representativeTitle,
    email,
    phone,
    secondaryContact,
    address,
    notes,
  } = req.body || {};

  if (
    !companyName ||
    !String(companyName).trim() ||
    !primaryContact ||
    !String(primaryContact).trim() ||
    !email ||
    !String(email).trim()
  ) {
    res.status(400).json({ error: 'Company name, client representative, and email are required' });
    return;
  }

  const cleanCompany = String(companyName).trim();
  const cleanRep = String(primaryContact).trim();
  const cleanTitle = typeof representativeTitle === 'string' ? representativeTitle.trim() : '';
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
  const cleanSecondary = typeof secondaryContact === 'string' ? secondaryContact.trim() : '';
  const cleanAddress = typeof address === 'string' ? address.trim() : '';
  const cleanNotes = typeof notes === 'string' ? notes.trim() : '';

  const info = db
    .prepare(
      `INSERT INTO clients (
        company_name, primary_contact, representative_title, email, phone, secondary_contact, address, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(cleanCompany, cleanRep, cleanTitle, cleanEmail, cleanPhone, cleanSecondary, cleanAddress, cleanNotes);

  const clientId = Number(info.lastInsertRowid);
  const created = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_CLIENT',
    module: 'admin',
    recordType: 'client',
    recordRef: `CLT-${clientId}`,
    newValue: { companyName: cleanCompany, primaryContact: cleanRep, email: cleanEmail, phone: cleanPhone, address: cleanAddress },
    ipAddress: req.ip || '',
  });

  res.status(201).json({ id: clientId, client: created });
});

router.patch('/clients/:id', requirePermission('projects', 'edit'), (req: AuthenticatedRequest, res) => {
  const clientId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  const {
    companyName,
    primaryContact,
    representativeTitle,
    email,
    phone,
    secondaryContact,
    address,
    notes,
  } = req.body || {};

  const nextCompany = companyName !== undefined ? String(companyName).trim() : existing.company_name;
  const nextRep = primaryContact !== undefined ? String(primaryContact).trim() : existing.primary_contact;
  const nextTitle = representativeTitle !== undefined ? String(representativeTitle).trim() : existing.representative_title || '';
  const nextEmail = email !== undefined ? String(email).trim().toLowerCase() : existing.email;
  const nextPhone = phone !== undefined ? String(phone).trim() : existing.phone || '';
  const nextSecondary = secondaryContact !== undefined ? String(secondaryContact).trim() : existing.secondary_contact || '';
  const nextAddress = address !== undefined ? String(address).trim() : existing.address || '';
  const nextNotes = notes !== undefined ? String(notes).trim() : existing.notes || '';

  if (!nextCompany || !nextRep || !nextEmail) {
    res.status(400).json({ error: 'Company name, client representative, and email cannot be empty' });
    return;
  }

  db.prepare(
    `UPDATE clients SET
      company_name = ?,
      primary_contact = ?,
      representative_title = ?,
      email = ?,
      phone = ?,
      secondary_contact = ?,
      address = ?,
      notes = ?
     WHERE id = ?`
  ).run(nextCompany, nextRep, nextTitle, nextEmail, nextPhone, nextSecondary, nextAddress, nextNotes, clientId);

  const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_CLIENT',
    module: 'admin',
    recordType: 'client',
    recordRef: `CLT-${clientId}`,
    previousValue: {
      companyName: existing.company_name,
      primaryContact: existing.primary_contact,
      email: existing.email,
      phone: existing.phone,
      address: existing.address,
    },
    newValue: {
      companyName: nextCompany,
      primaryContact: nextRep,
      representativeTitle: nextTitle,
      email: nextEmail,
      phone: nextPhone,
      address: nextAddress,
    },
    ipAddress: req.ip || '',
  });

  res.json({ ok: true, client: updated });
});

// --- Audit Trail (Read-Only, immutable) ---
router.get('/audit-logs', requirePermission('admin', 'view'), (req, res) => {
  const moduleFilter = typeof req.query.module === 'string' ? req.query.module : '';
  const limit = Math.min(200, Number(req.query.limit || 100));
  const rows = moduleFilter
    ? db
        .prepare('SELECT * FROM audit_logs WHERE module = ? ORDER BY id DESC LIMIT ?')
        .all(moduleFilter, limit)
    : db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
  res.json({ logs: rows });
});

// --- Maintenance, Cron Execution & Backup Export ---
router.get('/maintenance', requirePermission('admin', 'view'), (_req, res) => {
  const migrations = db.prepare('SELECT * FROM schema_migrations ORDER BY version ASC').all();
  const counts = {
    projects: (db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c,
    users: (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c,
    dprs: (db.prepare('SELECT COUNT(*) AS c FROM daily_progress_reports').get() as { c: number }).c,
    tasks: (db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c,
    expenses: (db.prepare('SELECT COUNT(*) AS c FROM expenses').get() as { c: number }).c,
    documents: (db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }).c,
    auditLogs: (db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }).c,
  };
  const recentLogins = db.prepare('SELECT * FROM login_logs ORDER BY id DESC LIMIT 15').all();
  const lastCron = db
    .prepare("SELECT setting_value, updated_at FROM system_settings WHERE setting_key = 'last_cron_run'")
    .get();

  res.json({
    appVersion: '1.0.0',
    runtime: `Node ${process.version}`,
    migrations,
    counts,
    recentLogins,
    lastCron: lastCron || null,
  });
});

router.post('/cron/run', requirePermission('admin', 'edit'), (req: AuthenticatedRequest, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const overdueTasks = db
    .prepare(
      "SELECT id, project_id, ref_number, title, assigned_to FROM tasks WHERE deadline < ? AND status NOT IN ('completed', 'rejected', 'overdue')"
    )
    .all(today) as Array<{ id: number; project_id: number; ref_number: string; title: string; assigned_to: number | null }>;

  transaction(() => {
    for (const t of overdueTasks) {
      db.prepare("UPDATE tasks SET status = 'overdue', updated_at = datetime('now') WHERE id = ?").run(t.id);
      if (t.assigned_to) {
        createNotification({
          userId: t.assigned_to,
          projectId: t.project_id,
          type: 'task_overdue',
          title: `Overdue Task: ${t.ref_number}`,
          body: `${t.title} has passed its deadline.`,
          linkSection: 'tasks',
        });
      }
    }

    const lowStock = db
      .prepare('SELECT id, name, current_qty, min_stock_level FROM inventory_items WHERE current_qty <= min_stock_level')
      .all() as Array<{ id: number; name: string; current_qty: number; min_stock_level: number }>;

    db.prepare(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_cron_run', ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')`
    ).run(
      JSON.stringify({
        ranAt: new Date().toISOString(),
        overdueMarked: overdueTasks.length,
        lowStockDetected: lowStock.length,
      })
    );
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'MANUAL_CRON_EXECUTION',
    module: 'admin',
    recordType: 'system',
    recordRef: 'CRON',
    newValue: { overdueMarked: overdueTasks.length },
    ipAddress: req.ip || '',
  });

  res.json({ ok: true, overdueMarked: overdueTasks.length });
});

router.post('/seed-sample', requirePermission('admin', 'create'), (req: AuthenticatedRequest, res) => {
  const { staffTestPassword } = req.body || {};
  seedSampleWorkspace(req.user!.id, typeof staffTestPassword === 'string' ? staffTestPassword : undefined);
  res.json({ ok: true });
});

router.get('/backup/export', requirePermission('admin', 'export'), (_req, res) => {
  const tables = [
    'clients',
    'projects',
    'schedule_revisions',
    'project_phases',
    'project_activities',
    'daily_progress_reports',
    'tasks',
    'budget_allocations',
    'purchase_requests',
    'purchase_orders',
    'expenses',
    'personnel',
    'attendance',
    'equipment',
    'inventory_items',
    'quality_inspections',
    'quality_defects',
    'client_revision_requests',
  ];
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) {
    dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  res.setHeader('Content-Disposition', `attachment; filename="cbms-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), version: '1.0.0', data: dump });
});

export default router;
