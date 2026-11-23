import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  type AuthenticatedRequest,
  hasPermission,
  logAudit,
  requireAuth,
  requireInternalUser,
} from '../auth.ts';
import {
  getAttachmentsForEntity,
  protectedUpload,
  resolveAttachmentAuthorization,
  saveBase64Attachment,
  saveUploadedMulterFile,
} from '../attachments.ts';
import { db, UPLOADS_DIR } from '../db.ts';

const router = Router();

router.use(requireAuth);
router.use(requireInternalUser);

// List attachments metadata for an entity (requires module & project access)
router.get('/attachments', (req: AuthenticatedRequest, res) => {
  const entityType = String(req.query.entityType || '').trim();
  const entityId = Number(req.query.entityId || 0);
  if (!entityType || !entityId) {
    res.status(400).json({ error: 'entityType and entityId are required' });
    return;
  }

  const types = entityType.split(',').map((s) => s.trim()).filter(Boolean);
  const authCheck = resolveAttachmentAuthorization(req.user!, { entity_type: types[0], entity_id: entityId, project_id: null });
  if (!authCheck.allowed) {
    res.status(403).json({ error: authCheck.reason || 'Access denied' });
    return;
  }

  const attachments = getAttachmentsForEntity(types, entityId);
  res.json({ attachments });
});

// Upload multipart file(s) OR base64 photo evidence to protected storage
router.post(
  '/attachments/upload',
  (req, res, next) => {
    if (req.is('multipart/form-data')) {
      protectedUpload.array('files', 10)(req, res, (err: any) => {
        if (err) {
          res.status(400).json({ error: err.message || 'File upload failed validation' });
          return;
        }
        next();
      });
    } else {
      next();
    }
  },
  (req: AuthenticatedRequest, res) => {
    const body = req.body || {};
    const entityType = String(body.entityType || '').trim();
    const entityId = Number(body.entityId || 0);
    const projectId = body.projectId ? Number(body.projectId) : null;
    const category = String(body.category || '');
    const caption = String(body.caption || '');

    if (!entityType || !entityId) {
      res.status(400).json({ error: 'entityType and entityId are required' });
      return;
    }

    const authCheck = resolveAttachmentAuthorization(req.user!, {
      entity_type: entityType,
      entity_id: entityId,
      project_id: projectId,
    });
    if (!authCheck.allowed) {
      res.status(403).json({ error: authCheck.reason || 'Access denied' });
      return;
    }

    // Prevent modifying locked evidence directly unless using dedicated amendment flow
    if (entityType.startsWith('expense')) {
      const exp = db.prepare('SELECT status FROM expenses WHERE id = ?').get(entityId) as { status: string } | undefined;
      if (exp && exp.status === 'approved' && !hasPermission(req.user!, 'financials', 'amend_approved')) {
        res.status(403).json({ error: 'Approved financial evidence is locked. Use an authorized amendment workflow.' });
        return;
      }
    } else if (entityType.startsWith('task')) {
      const task = db.prepare('SELECT status, evidence_locked FROM tasks WHERE id = ?').get(entityId) as
        | { status: string; evidence_locked: number }
        | undefined;
      if (task && (task.status === 'completed' || task.evidence_locked === 1) && !hasPermission(req.user!, 'tasks', 'amend_evidence')) {
        res.status(403).json({ error: 'Verified task completion evidence is locked.' });
        return;
      }
    }

    const saved: any[] = [];
    const multerFiles = (req.files as Express.Multer.File[]) || [];

    if (multerFiles.length > 0) {
      for (const file of multerFiles) {
        saved.push(
          saveUploadedMulterFile({
            file,
            entityType,
            entityId,
            projectId: authCheck.projectId,
            category,
            caption,
            uploadedBy: req.user!.id,
          })
        );
      }
    } else if (Array.isArray(body.filesBase64)) {
      for (const item of body.filesBase64.slice(0, 10)) {
        saved.push(
          saveBase64Attachment({
            dataUrl: item.dataUrl,
            fileName: item.fileName,
            entityType,
            entityId,
            projectId: authCheck.projectId,
            category: item.category || category,
            caption: item.caption || caption,
            uploadedBy: req.user!.id,
          })
        );
      }
    } else if (typeof body.dataUrl === 'string') {
      saved.push(
        saveBase64Attachment({
          dataUrl: body.dataUrl,
          fileName: body.fileName,
          entityType,
          entityId,
          projectId: authCheck.projectId,
          category,
          caption,
          uploadedBy: req.user!.id,
        })
      );
    } else {
      res.status(400).json({ error: 'No valid file or photo payload provided' });
      return;
    }

    logAudit({
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'UPLOAD_PROTECTED_ATTACHMENT',
      module: entityType.startsWith('expense') ? 'financials' : entityType.startsWith('task') ? 'tasks' : 'procurement',
      recordType: entityType,
      recordRef: `${entityType.toUpperCase()}-${entityId}`,
      newValue: { count: saved.length, ids: saved.map((s) => s.id) },
      ipAddress: req.ip || '',
    });

    res.status(201).json({ attachments: saved });
  }
);

// Authenticated inline preview or download (never exposed via public URL)
router.get('/attachments/:id/file', (req: AuthenticatedRequest, res) => {
  const attId = Number(req.params.id);
  const att = db.prepare('SELECT * FROM protected_attachments WHERE id = ?').get(attId) as any;
  if (!att) {
    res.status(404).json({ error: 'Attachment not found' });
    return;
  }

  const authCheck = resolveAttachmentAuthorization(req.user!, att);
  if (!authCheck.allowed) {
    res.status(403).json({ error: authCheck.reason || 'Access denied' });
    return;
  }

  const resolvedPath = path.resolve(UPLOADS_DIR, path.basename(att.stored_path));
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: 'Stored attachment file missing' });
    return;
  }

  const isDownload = req.query.download === '1' || req.query.download === 'true';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=1800');
  res.setHeader('Content-Type', att.mime_type);
  res.setHeader(
    'Content-Disposition',
    `${isDownload ? 'attachment' : 'inline'}; filename="${path.basename(att.file_name)}"`
  );
  res.sendFile(resolvedPath);
});

// Delete attachment (strictly blocked if locked or approved/verified)
router.delete('/attachments/:id', (req: AuthenticatedRequest, res) => {
  const attId = Number(req.params.id);
  const att = db.prepare('SELECT * FROM protected_attachments WHERE id = ?').get(attId) as any;
  if (!att) {
    res.status(404).json({ error: 'Attachment not found' });
    return;
  }

  const authCheck = resolveAttachmentAuthorization(req.user!, att);
  if (!authCheck.allowed) {
    res.status(403).json({ error: authCheck.reason || 'Access denied' });
    return;
  }

  if (att.is_locked === 1) {
    res.status(403).json({ error: 'This evidence is locked after approval/verification and cannot be deleted.' });
    return;
  }

  if (att.entity_type.startsWith('expense')) {
    const exp = db.prepare('SELECT status, submitted_by FROM expenses WHERE id = ?').get(att.entity_id) as any;
    if (exp?.status === 'approved') {
      res.status(403).json({ error: 'Cannot delete receipt evidence attached to an approved expense.' });
      return;
    }
    if (exp && exp.submitted_by !== req.user!.id && !hasPermission(req.user!, 'financials', 'edit')) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }
  }

  if (att.entity_type.startsWith('task')) {
    const task = db.prepare('SELECT status, evidence_locked FROM tasks WHERE id = ?').get(att.entity_id) as any;
    if (task && (task.status === 'completed' || task.evidence_locked === 1)) {
      res.status(403).json({ error: 'Cannot delete verified task completion evidence.' });
      return;
    }
  }

  db.prepare('DELETE FROM protected_attachments WHERE id = ?').run(attId);
  const target = path.resolve(UPLOADS_DIR, path.basename(att.stored_path));
  if (target.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
    } catch {
      // ignore missing file
    }
  }

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'DELETE_PROTECTED_ATTACHMENT',
    module: att.entity_type.startsWith('expense') ? 'financials' : att.entity_type.startsWith('task') ? 'tasks' : 'procurement',
    recordType: att.entity_type,
    recordRef: `ATT-${attId}`,
    previousValue: { fileName: att.file_name, entityId: att.entity_id },
    ipAddress: req.ip || '',
  });

  res.json({ ok: true });
});

export default router;
