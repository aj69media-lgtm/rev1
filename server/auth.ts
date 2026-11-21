import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  role_id: number;
  role_slug: string;
  role_name: string;
  is_client_role: boolean;
  job_title: string;
  phone: string;
  permissions: Array<{ module_slug: string; action: string }>;
  assigned_project_ids: number[];
  client_ids: number[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionTokenHash?: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: number, ipAddress: string, userAgent: string): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const ttlHours = Number(process.env.SESSION_TTL_HOURS || 24);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)'
  ).run(tokenHash, userId, expiresAt, ipAddress, userAgent.slice(0, 255));
  return { token, expiresAt };
}

export function getUserById(userId: number): AuthUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.role_id, u.job_title, u.phone, u.is_active,
              r.slug AS role_slug, r.name AS role_name, r.is_client_role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
    )
    .get(userId) as
    | {
        id: number;
        email: string;
        full_name: string;
        role_id: number;
        job_title: string;
        phone: string;
        is_active: number;
        role_slug: string;
        role_name: string;
        is_client_role: number;
      }
    | undefined;

  if (!row || !row.is_active) return null;

  const permissions = db
    .prepare('SELECT module_slug, action FROM role_permissions WHERE role_id = ?')
    .all(row.role_id) as Array<{ module_slug: string; action: string }>;

  const assignedProjects = db
    .prepare('SELECT project_id FROM project_assignments WHERE user_id = ?')
    .all(row.id) as Array<{ project_id: number }>;

  const clientIds = db
    .prepare('SELECT client_id FROM client_users WHERE user_id = ?')
    .all(row.id) as Array<{ client_id: number }>;

  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role_id: row.role_id,
    role_slug: row.role_slug,
    role_name: row.role_name,
    is_client_role: Boolean(row.is_client_role),
    job_title: row.job_title || '',
    phone: row.phone || '',
    permissions,
    assigned_project_ids: assignedProjects.map((p) => p.project_id),
    client_ids: clientIds.map((c) => c.client_id),
  };
}

export function resolveSessionUser(token: string): { user: AuthUser; tokenHash: string } | null {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: number; expires_at: string } | undefined;

  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  const user = getUserById(session.user_id);
  if (!user) return null;
  return { user, tokenHash };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const token = bearer || queryToken;

  const resolved = resolveSessionUser(token);
  if (!resolved) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.user = resolved.user;
  req.sessionTokenHash = resolved.tokenHash;
  next();
}

export function hasPermission(user: AuthUser, moduleSlug: string, action: string): boolean {
  if (user.role_slug === 'system_admin') return true;
  return user.permissions.some((p) => p.module_slug === moduleSlug && p.action === action);
}

export function requirePermission(moduleSlug: string, action: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.user.is_client_role && moduleSlug !== 'client_portal') {
      res.status(403).json({ error: 'Client accounts cannot access internal company modules' });
      return;
    }
    if (!hasPermission(req.user, moduleSlug, action)) {
      res.status(403).json({ error: `Permission denied (${moduleSlug}:${action})` });
      return;
    }
    next();
  };
}

export function requireInternalUser(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.is_client_role) {
    res.status(403).json({ error: 'Internal CBMS access restricted for client accounts' });
    return;
  }
  next();
}

export function canAccessProject(user: AuthUser, projectId: number): boolean {
  if (['system_admin', 'executive', 'general_manager', 'finance_officer'].includes(user.role_slug)) {
    return !user.is_client_role;
  }
  if (user.is_client_role) {
    if (user.assigned_project_ids.includes(projectId)) return true;
    if (user.client_ids.length > 0) {
      const proj = db
        .prepare('SELECT client_id FROM projects WHERE id = ?')
        .get(projectId) as { client_id: number } | undefined;
      if (proj && user.client_ids.includes(proj.client_id)) {
        // Explicit project assignment check: if client has project_assignments, restrict to those; otherwise allow company projects assigned
        const anyExplicit = db
          .prepare('SELECT 1 FROM project_assignments WHERE user_id = ? LIMIT 1')
          .get(user.id);
        return !anyExplicit;
      }
    }
    return false;
  }
  return user.assigned_project_ids.includes(projectId);
}

export function getAccessibleProjectIds(user: AuthUser): number[] | 'ALL' {
  if (['system_admin', 'executive', 'general_manager', 'finance_officer'].includes(user.role_slug)) {
    return 'ALL';
  }
  if (user.is_client_role) {
    if (user.assigned_project_ids.length > 0) {
      return user.assigned_project_ids;
    }
    if (user.client_ids.length > 0) {
      const placeholders = user.client_ids.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT id FROM projects WHERE client_id IN (${placeholders})`)
        .all(...user.client_ids) as Array<{ id: number }>;
      return rows.map((r) => r.id);
    }
    return [];
  }
  return user.assigned_project_ids;
}

export function isModuleEnabled(slug: string): boolean {
  const row = db
    .prepare('SELECT is_enabled FROM modules WHERE slug = ?')
    .get(slug) as { is_enabled: number } | undefined;
  return row ? Boolean(row.is_enabled) : true;
}

export function requireModule(slug: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!isModuleEnabled(slug)) {
      res.status(403).json({ error: `Module '${slug}' is currently disabled by administrator` });
      return;
    }
    next();
  };
}

export function logAudit(params: {
  userId: number | null;
  userEmail: string;
  action: string;
  module: string;
  recordType: string;
  recordRef: string;
  previousValue?: unknown;
  newValue?: unknown;
  remarks?: string;
  ipAddress?: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (
      user_id, user_email, action, module, record_type, record_ref,
      previous_value_json, new_value_json, remarks, ip_address
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.userId,
    params.userEmail,
    params.action,
    params.module,
    params.recordType,
    params.recordRef,
    params.previousValue !== undefined ? JSON.stringify(params.previousValue) : null,
    params.newValue !== undefined ? JSON.stringify(params.newValue) : null,
    params.remarks || '',
    params.ipAddress || ''
  );
}
