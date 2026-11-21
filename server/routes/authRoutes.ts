import crypto from 'crypto';
import { Router } from 'express';
import {
  type AuthenticatedRequest,
  createSession,
  getUserById,
  hashPassword,
  hashToken,
  logAudit,
  requireAuth,
  verifyPassword,
} from '../auth.ts';
import { db, transaction } from '../db.ts';
import { seedSampleWorkspace } from '../seed.ts';

const router = Router();

function hasAnyAdmin(): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.slug = 'system_admin'`
    )
    .get() as { cnt: number };
  return row.cnt > 0;
}

router.get('/status', (_req, res) => {
  const companySetting = db
    .prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'company_name'")
    .get() as { setting_value: string } | undefined;

  res.json({
    requiresBootstrap: !hasAnyAdmin(),
    hasAdminPasscodeEnv: Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0),
    companyName: companySetting?.setting_value || 'BuildCore Construction Group',
  });
});

router.post('/bootstrap-admin', (req, res) => {
  if (hasAnyAdmin()) {
    res.status(409).json({ error: 'System administrator account has already been claimed' });
    return;
  }

  const { fullName, email, password, companyName, seedDemoData, demoStaffPassword } = req.body || {};
  if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
    res.status(400).json({ error: 'Full name is required (at least 2 characters)' });
    return;
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email address is required' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const adminRole = db.prepare("SELECT id FROM roles WHERE slug = 'system_admin'").get() as
    | { id: number }
    | undefined;
  if (!adminRole) {
    res.status(500).json({ error: 'System roles not initialized' });
    return;
  }

  let createdAdminId = 0;
  transaction(() => {
    // Re-check atomically inside transaction
    if (hasAnyAdmin()) {
      throw new Error('ALREADY_CLAIMED');
    }

    const pwHash = hashPassword(password);
    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, role_id, job_title, is_active)
         VALUES (?, ?, ?, ?, 'System Administrator', 1)`
      )
      .run(email.trim().toLowerCase(), pwHash, fullName.trim(), adminRole.id);
    createdAdminId = Number(info.lastInsertRowid);

    if (companyName && typeof companyName === 'string' && companyName.trim()) {
      db.prepare(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES ('company_name', ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')`
      ).run(companyName.trim());
    }
  });

  if (seedDemoData) {
    seedSampleWorkspace(createdAdminId, typeof demoStaffPassword === 'string' && demoStaffPassword.length >= 8 ? demoStaffPassword : password);
  }

  logAudit({
    userId: createdAdminId,
    userEmail: email.trim().toLowerCase(),
    action: 'BOOTSTRAP_ADMIN',
    module: 'admin',
    recordType: 'user',
    recordRef: `USR-${createdAdminId}`,
    remarks: seedDemoData ? 'Claimed first-run admin account with sample workspace data' : 'Claimed first-run admin account',
    ipAddress: req.ip || '',
  });

  const session = createSession(createdAdminId, req.ip || '', req.headers['user-agent'] || '');
  const user = getUserById(createdAdminId);

  res.status(201).json({
    token: session.token,
    expiresAt: session.expiresAt,
    user,
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const userRow = db
    .prepare(
      `SELECT u.id, u.email, u.password_hash, u.is_active, u.failed_login_attempts, u.locked_until, r.slug AS role_slug
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.email = ?`
    )
    .get(normalizedEmail) as
    | {
        id: number;
        email: string;
        password_hash: string;
        is_active: number;
        failed_login_attempts: number;
        locked_until: string | null;
        role_slug: string;
      }
    | undefined;

  const ip = req.ip || '';
  if (!userRow) {
    db.prepare('INSERT INTO login_logs (email, success, ip_address, reason) VALUES (?, 0, ?, ?)').run(
      normalizedEmail,
      ip,
      'Account not found'
    );
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (!userRow.is_active) {
    db.prepare('INSERT INTO login_logs (email, user_id, success, ip_address, reason) VALUES (?, ?, 0, ?, ?)').run(
      normalizedEmail,
      userRow.id,
      ip,
      'Account deactivated'
    );
    res.status(403).json({ error: 'Account is deactivated. Contact administrator.' });
    return;
  }

  if (userRow.locked_until && new Date(userRow.locked_until).getTime() > Date.now()) {
    res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
    return;
  }

  const envAdminPasscode = process.env.ADMIN_PASSCODE?.trim();
  const envPasscodeMatches =
    userRow.role_slug === 'system_admin' &&
    Boolean(envAdminPasscode) &&
    password.length === envAdminPasscode!.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(envAdminPasscode!));

  const valid = envPasscodeMatches || verifyPassword(password, userRow.password_hash);

  if (!valid) {
    const attempts = userRow.failed_login_attempts + 1;
    const maxAttempts = Number(process.env.MAX_FAILED_LOGINS || 5);
    const lockMinutes = Number(process.env.LOCKOUT_MINUTES || 15);
    const lockedUntil = attempts >= maxAttempts ? new Date(Date.now() + lockMinutes * 60000).toISOString() : null;
    db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?').run(
      attempts,
      lockedUntil,
      userRow.id
    );
    db.prepare('INSERT INTO login_logs (email, user_id, success, ip_address, reason) VALUES (?, ?, 0, ?, ?)').run(
      normalizedEmail,
      userRow.id,
      ip,
      'Invalid password'
    );
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  db.prepare(
    "UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?"
  ).run(userRow.id);
  db.prepare('INSERT INTO login_logs (email, user_id, success, ip_address, reason) VALUES (?, ?, 1, ?, ?)').run(
    normalizedEmail,
    userRow.id,
    ip,
    'Login successful'
  );

  const session = createSession(userRow.id, ip, req.headers['user-agent'] || '');
  const user = getUserById(userRow.id);

  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user,
  });
});

router.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.sessionTokenHash) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
  }
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Current password and new password (min 8 chars) are required' });
    return;
  }

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
    password_hash: string;
  };
  if (!verifyPassword(currentPassword, row.password_hash)) {
    res.status(400).json({ error: 'Current password is incorrect' });
    return;
  }

  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
    hashPassword(newPassword),
    req.user!.id
  );
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CHANGE_PASSWORD',
    module: 'auth',
    recordType: 'user',
    recordRef: `USR-${req.user!.id}`,
    ipAddress: req.ip || '',
  });
  res.json({ ok: true });
});

router.post('/request-reset', (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required' });
    return;
  }
  const user = db.prepare('SELECT id FROM users WHERE email = ? AND is_active = 1').get(email.trim().toLowerCase()) as
    | { id: number }
    | undefined;

  if (!user) {
    // Do not leak user existence
    res.json({ ok: true, message: 'If an active account matches this email, a reset request has been logged.' });
    return;
  }

  const rawToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
  db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(
    user.id,
    hashToken(rawToken),
    expiresAt
  );

  // In production with SMTP configured, email rawToken; without SMTP, administrator resets via User Management
  res.json({
    ok: true,
    message: 'Password reset request created. Contact your System Administrator or check configured SMTP mail.',
  });
});

export default router;
