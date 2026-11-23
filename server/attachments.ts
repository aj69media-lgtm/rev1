import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { type AuthUser, canAccessProject, hasPermission } from './auth.ts';
import { db, UPLOADS_DIR } from './db.ts';

export const ALLOWED_MIME_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

export const IMAGE_MIME_SET = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export const ALLOWED_EXT_SET = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.pdf',
  '.xlsx',
  '.xls',
  '.csv',
  '.docx',
]);

export const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024;

export function verifyMagicBytes(buf: Buffer, mime: string): boolean {
  if (!buf || buf.length < 4) return false;
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mime === 'image/png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (mime === 'image/webp') {
    return (
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mime === 'application/pdf') {
    return buf.subarray(0, 4).toString('ascii') === '%PDF';
  }
  if (mime.includes('openxmlformats') || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return buf[0] === 0x50 && buf[1] === 0x4b; // ZIP container
  }
  return true;
}

export function sanitizeOriginalName(name: string): string {
  const base = path.basename(String(name || 'attachment')).replace(/[^a-zA-Z0-9._ -]/g, '_');
  return base.slice(0, 140) || 'attachment';
}

export function makeUniqueStoredName(ext: string): string {
  return `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
}

export const protectedUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const mapped = ALLOWED_MIME_MAP[file.mimetype] || ext;
      if (!ALLOWED_MIME_MAP[file.mimetype] || !ALLOWED_EXT_SET.has(ext || mapped)) {
        cb(new Error('Unsupported or executable file type blocked'), '');
        return;
      }
      cb(null, makeUniqueStoredName(mapped));
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME_MAP[file.mimetype] || (ext && !ALLOWED_EXT_SET.has(ext))) {
      cb(new Error('Unsupported file type. Allowed: JPG, JPEG, PNG, WEBP, PDF, XLSX, CSV, DOCX'));
      return;
    }
    cb(null, true);
  },
});

export interface AttachmentMetadata {
  id: number;
  entity_type: string;
  entity_id: number;
  project_id: number | null;
  category: string;
  caption: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  is_locked: number;
  is_amended: number;
  amendment_note: string;
  uploaded_by: number | null;
  uploaded_by_name?: string;
  created_at: string;
  is_image: boolean;
}

export function serializeAttachment(row: any): AttachmentMetadata {
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    project_id: row.project_id ?? null,
    category: row.category || '',
    caption: row.caption || '',
    file_name: row.file_name,
    mime_type: row.mime_type,
    file_size: row.file_size,
    is_locked: Number(row.is_locked || 0),
    is_amended: Number(row.is_amended || 0),
    amendment_note: row.amendment_note || '',
    uploaded_by: row.uploaded_by ?? null,
    uploaded_by_name: row.uploaded_by_name || undefined,
    created_at: row.created_at,
    is_image: IMAGE_MIME_SET.has(String(row.mime_type || '').toLowerCase()),
  };
}

export function getAttachmentsForEntity(entityTypes: string | string[], entityId: number): AttachmentMetadata[] {
  const types = Array.isArray(entityTypes) ? entityTypes : [entityTypes];
  if (types.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT pa.*, u.full_name AS uploaded_by_name
       FROM protected_attachments pa
       LEFT JOIN users u ON u.id = pa.uploaded_by
       WHERE pa.entity_id = ? AND pa.entity_type IN (${types.map(() => '?').join(',')})
       ORDER BY pa.id ASC`
    )
    .all(entityId, ...types) as any[];
  return rows.map(serializeAttachment);
}

export function saveUploadedMulterFile(params: {
  file: Express.Multer.File;
  entityType: string;
  entityId: number;
  projectId?: number | null;
  category?: string;
  caption?: string;
  uploadedBy: number;
  isAmended?: boolean;
  amendmentNote?: string;
}): AttachmentMetadata {
  const fullPath = path.resolve(UPLOADS_DIR, path.basename(params.file.filename));
  if (!fullPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(fullPath)) {
    throw new Error('Failed to verify stored file path');
  }

  const head = fs.readFileSync(fullPath).subarray(0, 32);
  if (!verifyMagicBytes(head, params.file.mimetype)) {
    try {
      fs.unlinkSync(fullPath);
    } catch {
      // ignore cleanup error
    }
    throw new Error(`Invalid file signature for declared type ${params.file.mimetype}`);
  }

  const cleanName = sanitizeOriginalName(params.file.originalname);
  const info = db
    .prepare(
      `INSERT INTO protected_attachments (
        entity_type, entity_id, project_id, category, caption,
        file_name, stored_path, mime_type, file_size, is_locked,
        is_amended, amendment_note, amended_by, amended_at, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    )
    .run(
      params.entityType,
      params.entityId,
      params.projectId ?? null,
      params.category || '',
      params.caption || '',
      cleanName,
      path.basename(params.file.filename),
      params.file.mimetype,
      params.file.size,
      params.isAmended ? 1 : 0,
      params.amendmentNote || '',
      params.isAmended ? params.uploadedBy : null,
      params.isAmended ? new Date().toISOString() : null,
      params.uploadedBy
    );

  const row = db
    .prepare(
      `SELECT pa.*, u.full_name AS uploaded_by_name
       FROM protected_attachments pa
       LEFT JOIN users u ON u.id = pa.uploaded_by
       WHERE pa.id = ?`
    )
    .get(Number(info.lastInsertRowid)) as any;

  return serializeAttachment(row);
}

export function saveBase64Attachment(params: {
  dataUrl: string;
  fileName?: string;
  entityType: string;
  entityId: number;
  projectId?: number | null;
  category?: string;
  caption?: string;
  uploadedBy: number;
  isAmended?: boolean;
  amendmentNote?: string;
}): AttachmentMetadata {
  const match = String(params.dataUrl || '').match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid encoded attachment payload');
  }
  const mime = match[1].toLowerCase();
  const mappedExt = ALLOWED_MIME_MAP[mime];
  if (!mappedExt) {
    throw new Error(`Unsupported file type (${mime}). Allowed: JPG, JPEG, PNG, WEBP, PDF`);
  }
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length === 0 || buf.length > MAX_FILE_BYTES) {
    throw new Error(`Attachment exceeds maximum allowed size (${MAX_FILE_BYTES / (1024 * 1024)} MB)`);
  }
  if (!verifyMagicBytes(buf, mime)) {
    throw new Error('Uploaded attachment failed binary signature check');
  }

  const storedName = makeUniqueStoredName(mappedExt);
  const fullPath = path.resolve(UPLOADS_DIR, storedName);
  if (!fullPath.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Invalid upload path');
  }
  fs.writeFileSync(fullPath, buf);

  const cleanName = sanitizeOriginalName(params.fileName || `${params.entityType}_${Date.now()}${mappedExt}`);
  const info = db
    .prepare(
      `INSERT INTO protected_attachments (
        entity_type, entity_id, project_id, category, caption,
        file_name, stored_path, mime_type, file_size, is_locked,
        is_amended, amendment_note, amended_by, amended_at, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    )
    .run(
      params.entityType,
      params.entityId,
      params.projectId ?? null,
      params.category || '',
      params.caption || '',
      cleanName,
      storedName,
      mime,
      buf.length,
      params.isAmended ? 1 : 0,
      params.amendmentNote || '',
      params.isAmended ? params.uploadedBy : null,
      params.isAmended ? new Date().toISOString() : null,
      params.uploadedBy
    );

  const row = db
    .prepare(
      `SELECT pa.*, u.full_name AS uploaded_by_name
       FROM protected_attachments pa
       LEFT JOIN users u ON u.id = pa.uploaded_by
       WHERE pa.id = ?`
    )
    .get(Number(info.lastInsertRowid)) as any;

  return serializeAttachment(row);
}

export function resolveAttachmentAuthorization(
  user: AuthUser,
  att: any
): { allowed: boolean; projectId: number | null; reason?: string } {
  if (user.is_client_role) {
    return { allowed: false, projectId: null, reason: 'Private attachments are prohibited for client accounts' };
  }

  let projectId: number | null = att.project_id ? Number(att.project_id) : null;
  let requiredModule = 'projects';

  if (att.entity_type.startsWith('expense')) {
    requiredModule = 'financials';
    if (!projectId && att.entity_id) {
      const exp = db.prepare('SELECT project_id FROM expenses WHERE id = ?').get(att.entity_id) as { project_id: number } | undefined;
      if (exp) projectId = exp.project_id;
    }
  } else if (att.entity_type.startsWith('pr') || att.entity_type.startsWith('po')) {
    requiredModule = 'procurement';
    if (!projectId && att.entity_id) {
      if (att.entity_type.startsWith('po')) {
        const po = db.prepare('SELECT project_id FROM purchase_orders WHERE id = ?').get(att.entity_id) as { project_id: number } | undefined;
        if (po) projectId = po.project_id;
      } else {
        const pr = db.prepare('SELECT project_id FROM purchase_requests WHERE id = ?').get(att.entity_id) as { project_id: number } | undefined;
        if (pr) projectId = pr.project_id;
      }
    }
  } else if (att.entity_type.startsWith('task')) {
    requiredModule = 'tasks';
    if (!projectId && att.entity_id) {
      const t = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(att.entity_id) as { project_id: number } | undefined;
      if (t) projectId = t.project_id;
    }
  } else if (att.entity_type.startsWith('catalog') || att.entity_type.startsWith('supplier')) {
    requiredModule = 'catalog';
  }

  if (!hasPermission(user, requiredModule, 'view') && !hasPermission(user, 'projects', 'view')) {
    return { allowed: false, projectId, reason: `Missing ${requiredModule}:view permission` };
  }

  if (projectId !== null && !canAccessProject(user, projectId)) {
    return { allowed: false, projectId, reason: 'Project access denied' };
  }

  return { allowed: true, projectId };
}

export function lockAttachments(entityTypes: string[], entityId: number): void {
  if (entityTypes.length === 0) return;
  db.prepare(
    `UPDATE protected_attachments SET is_locked = 1 WHERE entity_id = ? AND entity_type IN (${entityTypes.map(() => '?').join(',')})`
  ).run(entityId, ...entityTypes);
}
