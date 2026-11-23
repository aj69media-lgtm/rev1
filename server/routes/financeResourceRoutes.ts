import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import {
  type AuthenticatedRequest,
  canAccessProject,
  getAccessibleProjectIds,
  hasPermission,
  logAudit,
  requireAuth,
  requireInternalUser,
  requireModule,
  requirePermission,
} from '../auth.ts';
import {
  getAttachmentsForEntity,
  lockAttachments,
  saveBase64Attachment,
} from '../attachments.ts';
import { getProjectEvmMetrics, getProjectFinancialSummary } from '../calculations.ts';
import { db, transaction, UPLOADS_DIR } from '../db.ts';
import { createNotification, emitSyncEvent } from '../realtime.ts';

const router = Router();

// --- Secure File Upload Configuration (outside public/, strict allowlist) ---
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
      cb(null, safeName);
    },
  }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: JPG, PNG, WEBP, PDF, XLSX, CSV, DOCX'));
    }
  },
});

// Download route allows both internal users and authorized client representatives (only if client_visible)
router.get('/documents/:id/download', requireAuth, (req: AuthenticatedRequest, res) => {
  const docId = Number(req.params.id);
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as any;
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  if (!canAccessProject(req.user!, doc.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  if (req.user!.is_client_role && (doc.is_confidential || !doc.is_client_visible)) {
    res.status(403).json({ error: 'Confidential document access prohibited' });
    return;
  }
  if (String(doc.stored_path).startsWith('seeded://')) {
    // Serve a deterministic safe placeholder summary PDF/text for seeded sample entries
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(doc.file_name)}.txt"`);
    res.send(`BuildCore CBMS Document Record\nTitle: ${doc.title}\nCategory: ${doc.category}\nVersion: v${doc.version}\nDescription: ${doc.description}`);
    return;
  }

  const resolvedPath = path.resolve(UPLOADS_DIR, path.basename(doc.stored_path));
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: 'Stored file missing' });
    return;
  }
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(doc.file_name)}"`);
  res.sendFile(resolvedPath);
});

// All remaining routes here require internal staff user
router.use(requireAuth);
router.use(requireInternalUser);

const SPREADSHEET_CATEGORIES = [
  'Permitting',
  'Sign, Seal & Print',
  'Manpower',
  'Materials',
  'Subcon',
  'CARI / Bonds',
  'Tools',
  'Lodging',
  'Transportation',
  'Transfer/Withdrawal Fee',
  'Utilities Expense',
  'Food',
] as const;

function normalizeExpenseCategory(raw: string): string {
  const c = String(raw || '').trim();
  const lower = c.toLowerCase();
  if (lower === 'permitting' || lower.includes('permit')) return 'Permitting';
  if (lower.includes('sign') || lower.includes('seal') || lower.includes('print')) return 'Sign, Seal & Print';
  if (lower === 'manpower' || lower === 'labor' || lower.includes('payroll')) return 'Manpower';
  if (lower === 'materials' || lower.includes('material')) return 'Materials';
  if (lower === 'subcon' || lower.includes('subcontract')) return 'Subcon';
  if (lower.includes('cari') || lower.includes('bond') || lower.includes('insurance')) return 'CARI / Bonds';
  if (lower === 'tools' || lower.includes('tool')) return 'Tools';
  if (lower === 'lodging' || lower.includes('hotel') || lower.includes('accommod')) return 'Lodging';
  if (lower.includes('transport') || lower.includes('fuel') || lower.includes('logistics')) return 'Transportation';
  if (lower.includes('transfer') || lower.includes('withdrawal') || lower.includes('bank fee')) return 'Transfer/Withdrawal Fee';
  if (lower.includes('utilit') || lower.includes('electric') || lower.includes('water')) return 'Utilities Expense';
  if (lower === 'food' || lower === 'fod' || lower.includes('meal')) return 'Food';
  return c || 'Other Expenses';
}

function buildProjectFinancialPayload(projectId: number) {
  const summary = getProjectFinancialSummary(projectId);
  const evm = getProjectEvmMetrics(projectId);

  const projectRow = db
    .prepare(
      'SELECT contract_amount, approved_budget, revised_budget, tpc_rate, sales_commission, opex_amount, financial_notes FROM projects WHERE id = ?'
    )
    .get(projectId) as any;

  const allocations = db
    .prepare('SELECT * FROM budget_allocations WHERE project_id = ? ORDER BY category ASC')
    .all(projectId);

  const rawExpenses = db
    .prepare(
      `SELECT e.*, sub.full_name AS submitted_by_name, app.full_name AS approved_by_name,
              rev.full_name AS reviewed_by_name, exapp.full_name AS exception_approved_by_name,
              pr.ref_number AS pr_ref, cr.ref_number AS cr_ref, cr.description AS cr_description,
              cr.amount_requested AS cr_amount_requested,
              COALESCE(NULLIF(e.custodian_name, ''), cr.custodian_name, '') AS resolved_custodian_name
       FROM expenses e
       JOIN users sub ON sub.id = e.submitted_by
       LEFT JOIN users app ON app.id = e.approved_by
       LEFT JOIN users rev ON rev.id = e.reviewed_by
       LEFT JOIN users exapp ON exapp.id = e.exception_approved_by
       LEFT JOIN purchase_requests pr ON pr.id = e.pr_id
       LEFT JOIN cash_requests cr ON cr.id = e.cash_request_id
       WHERE e.project_id = ?
       ORDER BY e.expense_date DESC, e.id DESC`
    )
    .all(projectId) as any[];

  const expenses = hydrateExpensesWithAttachments(rawExpenses);

  const rawCategoryBreakdown = db
    .prepare(
      `SELECT category, COALESCE(SUM(amount), 0) AS actual_total
       FROM expenses WHERE project_id = ? AND status = 'approved'
       GROUP BY category`
    )
    .all(projectId) as Array<{ category: string; actual_total: number }>;

  // Map approved expenses into the 12 standardized spreadsheet categories (+ any extra custom categories)
  const bucketTotals = new Map<string, number>();
  for (const cat of SPREADSHEET_CATEGORIES) bucketTotals.set(cat, 0);
  for (const row of rawCategoryBreakdown) {
    const norm = normalizeExpenseCategory(row.category);
    bucketTotals.set(norm, (bucketTotals.get(norm) || 0) + Number(row.actual_total || 0));
  }
  const totalApproved = summary.actualExpenses || 0;
  const categorizedBreakdown = Array.from(bucketTotals.entries()).map(([category, total]) => ({
    category,
    total: Number(total.toFixed(2)),
    percentage: totalApproved > 0 ? Number(((total / totalApproved) * 100).toFixed(1)) : 0,
  }));

  const payments = db
    .prepare(
      `SELECT pp.*, u.full_name AS recorded_by_name
       FROM project_payments pp
       LEFT JOIN users u ON u.id = pp.recorded_by
       WHERE pp.project_id = ?
       ORDER BY pp.payment_date ASC, pp.id ASC`
    )
    .all(projectId);

  const cashRequests = db
    .prepare(
      `SELECT cr.*,
              COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.cash_request_id = cr.id AND e.status NOT IN ('rejected','cancelled','draft')), 0) AS liquidated_total,
              COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.cash_request_id = cr.id AND e.status = 'approved'), 0) AS approved_liquidated_total
       FROM cash_requests cr
       WHERE cr.project_id = ?
       ORDER BY cr.request_date ASC, cr.id ASC`
    )
    .all(projectId) as any[];

  // Build per-custodian running liquidation ledgers (Date | Cash Requested | Cash Liquidated | Cash on Hand)
  const custodianNames = new Set<string>();
  for (const cr of cashRequests) {
    if (cr.custodian_name) custodianNames.add(String(cr.custodian_name).trim());
  }
  for (const ex of expenses) {
    const cname = String(ex.resolved_custodian_name || '').trim();
    if (cname && !['rejected', 'cancelled', 'draft'].includes(ex.status)) custodianNames.add(cname);
  }

  const custodianLedgers = Array.from(custodianNames)
    .sort((a, b) => a.localeCompare(b))
    .map((custodian) => {
      type LedgerEvent = {
        date: string;
        sortKey: string;
        kind: 'request' | 'liquidation';
        ref: string;
        description: string;
        category: string;
        cashRequested: number;
        cashLiquidated: number;
        status: string;
      };
      const events: LedgerEvent[] = [];
      for (const cr of cashRequests) {
        if (String(cr.custodian_name || '').trim() === custodian) {
          events.push({
            date: cr.request_date,
            sortKey: `${cr.request_date}-0-${String(cr.id).padStart(6, '0')}`,
            kind: 'request',
            ref: cr.ref_number,
            description: cr.description,
            category: 'Cash Request',
            cashRequested: Number(cr.amount_requested || 0),
            cashLiquidated: 0,
            status: cr.status,
          });
        }
      }
      for (const ex of expenses) {
        if (['rejected', 'cancelled', 'draft'].includes(ex.status)) continue;
        const cname = String(ex.resolved_custodian_name || '').trim();
        if (cname === custodian) {
          events.push({
            date: ex.expense_date,
            sortKey: `${ex.expense_date}-1-${String(ex.id).padStart(6, '0')}`,
            kind: 'liquidation',
            ref: ex.ref_number,
            description: ex.description,
            category: normalizeExpenseCategory(ex.category),
            cashRequested: 0,
            cashLiquidated: Number(ex.amount || 0),
            status: ex.status,
          });
        }
      }
      events.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

      let runningOnHand = 0;
      let totalRequested = 0;
      let totalLiquidated = 0;
      const rows = events.map((ev) => {
        totalRequested += ev.cashRequested;
        totalLiquidated += ev.cashLiquidated;
        runningOnHand = Number((runningOnHand + ev.cashRequested - ev.cashLiquidated).toFixed(2));
        return {
          ...ev,
          cashOnHand: runningOnHand,
        };
      });

      return {
        custodianName: custodian,
        totalRequested: Number(totalRequested.toFixed(2)),
        totalLiquidated: Number(totalLiquidated.toFixed(2)),
        cashOnHand: Number(runningOnHand.toFixed(2)),
        entries: rows,
      };
    });

  return {
    summary,
    evm,
    allocations,
    expenses,
    categoryBreakdown: rawCategoryBreakdown,
    categorizedBreakdown,
    payments,
    cashRequests,
    custodianLedgers,
    projectNotes: projectRow?.financial_notes || '',
  };
}

function hydrateExpensesWithAttachments(expenses: any[]) {
  if (expenses.length === 0) return [];
  const ids = expenses.map((e) => e.id);
  const attRows = db
    .prepare(
      `SELECT pa.*, u.full_name AS uploaded_by_name
       FROM protected_attachments pa
       LEFT JOIN users u ON u.id = pa.uploaded_by
       WHERE pa.entity_id IN (${ids.map(() => '?').join(',')})
         AND pa.entity_type IN ('expense_receipt', 'expense_support')
       ORDER BY pa.id ASC`
    )
    .all(...ids) as any[];

  return expenses.map((e) => {
    const atts = attRows
      .filter((a) => a.entity_id === e.id)
      .map((a) => ({
        id: a.id,
        entity_type: a.entity_type,
        entity_id: a.entity_id,
        project_id: a.project_id ?? null,
        category: a.category || '',
        caption: a.caption || '',
        file_name: a.file_name,
        mime_type: a.mime_type,
        file_size: a.file_size,
        is_locked: Number(a.is_locked || 0),
        is_amended: Number(a.is_amended || 0),
        amendment_note: a.amendment_note || '',
        uploaded_by: a.uploaded_by ?? null,
        uploaded_by_name: a.uploaded_by_name || undefined,
        created_at: a.created_at,
        is_image: String(a.mime_type || '').startsWith('image/'),
      }));
    return {
      ...e,
      attachments: atts,
      receipt_count: atts.filter((a) => a.entity_type === 'expense_receipt').length,
      support_count: atts.filter((a) => a.entity_type === 'expense_support').length,
    };
  });
}

function getUsersWithModuleAction(projectId: number, moduleSlug: string, action: string, excludeUserId?: number): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
       JOIN role_permissions rp ON rp.role_id = r.id AND rp.module_slug = ? AND rp.action = ?
       LEFT JOIN project_assignments pa ON pa.user_id = u.id AND pa.project_id = ?
       WHERE u.is_active = 1
         AND (r.slug IN ('system_admin', 'executive', 'general_manager', 'finance_officer', 'procurement_officer') OR pa.project_id = ?)`
    )
    .all(moduleSlug, action, projectId, projectId) as Array<{ id: number }>;
  return rows.map((r) => r.id).filter((id) => id !== excludeUserId);
}

// --- Financials: Budgets, Expenses, Financial Analysis, Payments & Cash Requests ---
router.get('/projects/:id/financials', requireModule('financials'), requirePermission('financials', 'view'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  res.json(buildProjectFinancialPayload(projectId));
});

router.patch('/projects/:id/financial-analysis', requireModule('financials'), requirePermission('financials', 'edit'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  const prev = db.prepare('SELECT contract_amount, revised_budget, tpc_rate, sales_commission, opex_amount, financial_notes FROM projects WHERE id = ?').get(projectId) as any;
  if (!prev) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const b = req.body || {};
  db.prepare(
    `UPDATE projects SET
       contract_amount = COALESCE(?, contract_amount),
       revised_budget = COALESCE(?, revised_budget),
       tpc_rate = COALESCE(?, tpc_rate),
       sales_commission = COALESCE(?, sales_commission),
       opex_amount = COALESCE(?, opex_amount),
       financial_notes = COALESCE(?, financial_notes),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    b.contractAmount !== undefined ? Number(b.contractAmount) : null,
    b.revisedBudget !== undefined ? Number(b.revisedBudget) : null,
    b.tpcRate !== undefined ? Number(b.tpcRate) : null,
    b.salesCommission !== undefined ? Number(b.salesCommission) : null,
    b.opexAmount !== undefined ? Number(b.opexAmount) : null,
    b.financialNotes !== undefined ? String(b.financialNotes) : null,
    projectId
  );

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_FINANCIAL_ANALYSIS',
    module: 'financials',
    recordType: 'project',
    recordRef: `PRJ-${projectId}`,
    previousValue: prev,
    newValue: b,
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'financials:updated',
    module: 'financials',
    projectId,
    payload: { projectId },
  });

  res.json({ ok: true, summary: getProjectFinancialSummary(projectId) });
});

router.post('/projects/:id/payments', requireModule('financials'), requirePermission('financials', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  const b = req.body || {};
  if (!b.paymentDate || !b.amount || Number(b.amount) <= 0) {
    res.status(400).json({ error: 'Payment date and positive amount are required' });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO project_payments (project_id, payment_date, amount, remarks, reference_no, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      String(b.paymentDate),
      Number(b.amount),
      String(b.remarks || '').trim(),
      String(b.referenceNo || '').trim(),
      req.user!.id
    );

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'RECORD_CLIENT_PAYMENT',
    module: 'financials',
    recordType: 'payment',
    recordRef: `PAY-${info.lastInsertRowid}`,
    newValue: { projectId, paymentDate: b.paymentDate, amount: Number(b.amount), remarks: b.remarks || '' },
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'payment:recorded',
    module: 'financials',
    projectId,
    payload: { id: Number(info.lastInsertRowid) },
  });

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.delete('/payments/:id', requireModule('financials'), requirePermission('financials', 'edit'), (req: AuthenticatedRequest, res) => {
  const paymentId = Number(req.params.id);
  const pay = db.prepare('SELECT project_id FROM project_payments WHERE id = ?').get(paymentId) as { project_id: number } | undefined;
  if (!pay) {
    res.status(404).json({ error: 'Payment record not found' });
    return;
  }
  if (!canAccessProject(req.user!, pay.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  db.prepare('DELETE FROM project_payments WHERE id = ?').run(paymentId);
  emitSyncEvent({ eventType: 'payment:deleted', module: 'financials', projectId: pay.project_id, payload: { id: paymentId } });
  res.json({ ok: true });
});

router.post('/projects/:id/cash-requests', requireModule('financials'), requirePermission('financials', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  const b = req.body || {};
  if (!b.requestDate || !b.custodianName || !b.description || !b.amountRequested || Number(b.amountRequested) <= 0) {
    res.status(400).json({ error: 'Request date, custodian name, description, and positive amount are required' });
    return;
  }

  let custodianPersonnelId: number | null = b.custodianPersonnelId ? Number(b.custodianPersonnelId) : null;
  let custodianUserId: number | null = b.custodianUserId ? Number(b.custodianUserId) : null;
  if (custodianPersonnelId) {
    const per = db.prepare('SELECT id, user_id FROM personnel WHERE id = ?').get(custodianPersonnelId) as
      | { id: number; user_id: number | null }
      | undefined;
    if (!per) custodianPersonnelId = null;
    else if (!custodianUserId && per.user_id) custodianUserId = per.user_id;
  }

  const ref = `CR-${Date.now().toString().slice(-6)}`;
  const info = db
    .prepare(
      `INSERT INTO cash_requests (
         ref_number, project_id, request_date, custodian_name, custodian_personnel_id, custodian_user_id,
         description, amount_requested, status, remarks, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ref,
      projectId,
      String(b.requestDate),
      String(b.custodianName).trim(),
      custodianPersonnelId,
      custodianUserId,
      String(b.description).trim(),
      Number(b.amountRequested),
      b.status || 'released',
      String(b.remarks || '').trim(),
      req.user!.id
    );

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_CASH_REQUEST',
    module: 'financials',
    recordType: 'cash_request',
    recordRef: ref,
    newValue: { projectId, custodianName: b.custodianName, amountRequested: Number(b.amountRequested) },
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'cash_request:created',
    module: 'financials',
    projectId,
    payload: { id: Number(info.lastInsertRowid), refNumber: ref },
  });

  res.status(201).json({ id: Number(info.lastInsertRowid), refNumber: ref });
});

router.delete('/cash-requests/:id', requireModule('financials'), requirePermission('financials', 'edit'), (req: AuthenticatedRequest, res) => {
  const crId = Number(req.params.id);
  const cr = db.prepare('SELECT project_id FROM cash_requests WHERE id = ?').get(crId) as { project_id: number } | undefined;
  if (!cr) {
    res.status(404).json({ error: 'Cash request not found' });
    return;
  }
  if (!canAccessProject(req.user!, cr.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  db.prepare('DELETE FROM cash_requests WHERE id = ?').run(crId);
  emitSyncEvent({ eventType: 'cash_request:deleted', module: 'financials', projectId: cr.project_id, payload: { id: crId } });
  res.json({ ok: true });
});

router.put('/projects/:id/allocations', requireModule('financials'), requirePermission('financials', 'edit'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  const { allocations } = req.body || {};
  if (!Array.isArray(allocations)) {
    res.status(400).json({ error: 'allocations array required' });
    return;
  }

  transaction(() => {
    const stmt = db.prepare(
      `INSERT INTO budget_allocations (project_id, category, allocated_amount, revised_amount, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, category) DO UPDATE SET
         revised_amount = excluded.revised_amount,
         notes = excluded.notes`
    );
    for (const a of allocations) {
      stmt.run(projectId, String(a.category), Number(a.allocatedAmount || 0), Number(a.revisedAmount ?? a.allocatedAmount ?? 0), a.notes || '');
    }
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_BUDGET_ALLOCATIONS',
    module: 'financials',
    recordType: 'budget',
    recordRef: `PRJ-${projectId}`,
    ipAddress: req.ip || '',
  });

  res.json({ ok: true });
});

// --- Financial Expenses & Cash Liquidation Workflow ---
function saveExpenseAttachmentsFromPayload(
  expenseId: number,
  projectId: number,
  userId: number,
  b: any,
  isAmendment = false
): number[] {
  const createdIds: number[] = [];
  if (Array.isArray(b.receiptsBase64)) {
    for (const item of b.receiptsBase64.slice(0, 10)) {
      if (!item?.dataUrl) continue;
      const saved = saveBase64Attachment({
        dataUrl: item.dataUrl,
        fileName: item.fileName || `receipt-${expenseId}.jpg`,
        entityType: 'expense_receipt',
        entityId: expenseId,
        projectId,
        category: item.category || 'Official Receipt',
        caption: item.caption || '',
        uploadedBy: userId,
        isAmended: isAmendment,
        amendmentNote: isAmendment ? String(b.amendmentNote || '') : '',
      });
      createdIds.push(saved.id);
    }
  }
  if (Array.isArray(b.supportDocsBase64)) {
    for (const item of b.supportDocsBase64.slice(0, 10)) {
      if (!item?.dataUrl) continue;
      const saved = saveBase64Attachment({
        dataUrl: item.dataUrl,
        fileName: item.fileName || `support-${expenseId}.jpg`,
        entityType: 'expense_support',
        entityId: expenseId,
        projectId,
        category: item.category || 'Supporting Proof',
        caption: item.caption || '',
        uploadedBy: userId,
        isAmended: isAmendment,
        amendmentNote: isAmendment ? String(b.amendmentNote || '') : '',
      });
      createdIds.push(saved.id);
    }
  }
  return createdIds;
}

function assertExpenseSubmissionEvidence(expenseId: number, noReceiptException: boolean, exceptionReason: string) {
  const receipts = getAttachmentsForEntity('expense_receipt', expenseId);
  const supports = getAttachmentsForEntity('expense_support', expenseId);
  if (receipts.length > 0) return { receipts, supports };
  if (noReceiptException && exceptionReason.trim().length >= 5 && supports.length > 0) {
    return { receipts, supports };
  }
  if (noReceiptException) {
    throw new Error(
      'No-Receipt Exception requires both a clear explanation why the receipt is unavailable AND at least one alternative supporting proof attachment.'
    );
  }
  throw new Error(
    'Every expense submitted for liquidation must include at least one receipt photograph (or use the controlled No-Receipt Exception workflow with alternative proof).'
  );
}

router.post('/projects/:id/expenses', requireModule('financials'), requirePermission('financials', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const b = req.body || {};
  if (!b.expenseDate || !b.category || !b.description || !b.amount || Number(b.amount) <= 0 || !b.supplierRecipient) {
    res.status(400).json({ error: 'Date, category, description, positive amount, and supplier/payee are required' });
    return;
  }

  if (b.clientIdempotencyKey) {
    const existing = db
      .prepare('SELECT id, ref_number, status FROM expenses WHERE client_idempotency_key = ?')
      .get(String(b.clientIdempotencyKey)) as { id: number; ref_number: string; status: string } | undefined;
    if (existing) {
      res.status(200).json({ id: existing.id, refNumber: existing.ref_number, status: existing.status, deduplicated: true });
      return;
    }
  }

  let cashRequestId: number | null = b.cashRequestId ? Number(b.cashRequestId) : null;
  let custodianName = String(b.custodianName || b.employeeName || '').trim();
  if (cashRequestId) {
    const cr = db.prepare('SELECT id, custodian_name FROM cash_requests WHERE id = ? AND project_id = ?').get(cashRequestId, projectId) as
      | { id: number; custodian_name: string }
      | undefined;
    if (cr) {
      if (!custodianName) custodianName = cr.custodian_name;
    } else {
      cashRequestId = null;
    }
  }

  const saveAsDraft = Boolean(b.saveAsDraft);
  const noReceiptException = Boolean(b.noReceiptException);
  const exceptionReason = String(b.exceptionReason || '').trim();
  const employeeName = String(b.employeeName || custodianName || req.user!.full_name).trim();
  const initialStatus = saveAsDraft ? 'draft' : 'pending_review';
  const exceptionStatus = noReceiptException ? 'pending' : 'none';
  const refNum = `EXP-${Date.now().toString().slice(-6)}`;

  try {
    const result = transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO expenses (
            ref_number, project_id, expense_date, category, description, amount,
            supplier_recipient, payment_method, task_id, pr_id, cash_request_id, custodian_name,
            employee_name, submitted_by, submitted_at, no_receipt_exception, exception_reason,
            exception_status, status, remarks, client_idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          refNum,
          projectId,
          b.expenseDate,
          b.category,
          String(b.description).trim(),
          Number(b.amount),
          String(b.supplierRecipient).trim(),
          b.paymentMethod || 'Cash',
          b.taskId ? Number(b.taskId) : null,
          b.prId ? Number(b.prId) : null,
          cashRequestId,
          custodianName,
          employeeName,
          req.user!.id,
          saveAsDraft ? null : new Date().toISOString(),
          noReceiptException ? 1 : 0,
          exceptionReason,
          exceptionStatus,
          initialStatus,
          b.remarks || '',
          b.clientIdempotencyKey || null
        );

      const expenseId = Number(info.lastInsertRowid);
      const savedAttIds = saveExpenseAttachmentsFromPayload(expenseId, projectId, req.user!.id, b);

      if (!saveAsDraft) {
        assertExpenseSubmissionEvidence(expenseId, noReceiptException, exceptionReason);
      }

      db.prepare(
        `INSERT INTO expense_history (expense_id, actor_id, action, previous_status, new_status, remarks, metadata_json)
         VALUES (?, ?, ?, '', ?, ?, ?)`
      ).run(
        expenseId,
        req.user!.id,
        saveAsDraft ? 'CREATED_DRAFT' : noReceiptException ? 'SUBMITTED_WITH_EXCEPTION' : 'SUBMITTED_LIQUIDATION',
        initialStatus,
        saveAsDraft ? 'Saved expense draft' : noReceiptException ? `Exception: ${exceptionReason}` : (b.remarks || 'Submitted with receipt evidence'),
        JSON.stringify({ attachmentIds: savedAttIds, noReceiptException, amount: Number(b.amount) })
      );

      return { expenseId, savedAttIds };
    });

    logAudit({
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: saveAsDraft ? 'CREATE_EXPENSE_DRAFT' : 'SUBMIT_EXPENSE_LIQUIDATION',
      module: 'financials',
      recordType: 'expense',
      recordRef: refNum,
      newValue: { projectId, amount: Number(b.amount), status: initialStatus, noReceiptException, attachmentIds: result.savedAttIds },
      ipAddress: req.ip || '',
    });

    if (!saveAsDraft) {
      for (const uid of getUsersWithModuleAction(projectId, 'financials', 'approve', req.user!.id)) {
        createNotification({
          userId: uid,
          projectId,
          type: 'liquidation_submitted',
          title: `Cash Liquidation Awaiting Review: ${refNum}`,
          body: `${req.user!.full_name} submitted ${b.description} (${Number(b.amount).toLocaleString()}).`,
          linkSection: 'financials',
        });
      }
    }

    emitSyncEvent({
      eventType: saveAsDraft ? 'expense:draft_saved' : 'expense:submitted',
      module: 'financials',
      projectId,
      payload: { id: result.expenseId, refNumber: refNum, status: initialStatus },
    });

    res.status(201).json({ id: result.expenseId, refNumber: refNum, status: initialStatus });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to record expense' });
  }
});

router.put('/expenses/:id', requireModule('financials'), requirePermission('financials', 'create'), (req: AuthenticatedRequest, res) => {
  const expenseId = Number(req.params.id);
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!exp) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  if (!canAccessProject(req.user!, exp.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  if (!['draft', 'for_correction', 'correction_needed'].includes(exp.status)) {
    res.status(403).json({ error: 'Only draft or returned-for-correction expenses can be edited directly.' });
    return;
  }

  const b = req.body || {};
  const noReceiptException = b.noReceiptException !== undefined ? Boolean(b.noReceiptException) : Boolean(exp.no_receipt_exception);
  const exceptionReason = b.exceptionReason !== undefined ? String(b.exceptionReason).trim() : exp.exception_reason;

  try {
    transaction(() => {
      db.prepare(
        `UPDATE expenses SET
          expense_date = COALESCE(?, expense_date),
          category = COALESCE(?, category),
          description = COALESCE(?, description),
          amount = COALESCE(?, amount),
          supplier_recipient = COALESCE(?, supplier_recipient),
          payment_method = COALESCE(?, payment_method),
          cash_request_id = ?,
          custodian_name = COALESCE(?, custodian_name),
          employee_name = COALESCE(?, employee_name),
          no_receipt_exception = ?,
          exception_reason = ?,
          exception_status = CASE WHEN ? = 1 THEN (CASE WHEN exception_status = 'approved' THEN 'approved' ELSE 'pending' END) ELSE 'none' END,
          remarks = COALESCE(?, remarks)
         WHERE id = ?`
      ).run(
        b.expenseDate ?? null,
        b.category ?? null,
        b.description ? String(b.description).trim() : null,
        b.amount !== undefined ? Number(b.amount) : null,
        b.supplierRecipient ? String(b.supplierRecipient).trim() : null,
        b.paymentMethod ?? null,
        b.cashRequestId !== undefined ? (b.cashRequestId ? Number(b.cashRequestId) : null) : exp.cash_request_id,
        b.custodianName ?? null,
        b.employeeName ?? null,
        noReceiptException ? 1 : 0,
        exceptionReason,
        noReceiptException ? 1 : 0,
        b.remarks ?? null,
        expenseId
      );

      const savedAttIds = saveExpenseAttachmentsFromPayload(expenseId, exp.project_id, req.user!.id, b);

      db.prepare(
        `INSERT INTO expense_history (expense_id, actor_id, action, previous_status, new_status, remarks, metadata_json)
         VALUES (?, ?, 'UPDATED_EXPENSE', ?, ?, ?, ?)`
      ).run(expenseId, req.user!.id, exp.status, exp.status, String(b.remarks || 'Updated expense entry'), JSON.stringify({ attachmentIds: savedAttIds }));
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update expense' });
  }
});

router.post('/expenses/:id/submit', requireModule('financials'), requirePermission('financials', 'create'), (req: AuthenticatedRequest, res) => {
  const expenseId = Number(req.params.id);
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!exp) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  if (!canAccessProject(req.user!, exp.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  if (!['draft', 'for_correction', 'correction_needed', 'rejected'].includes(exp.status)) {
    res.status(400).json({ error: `Cannot submit expense in status "${exp.status}"` });
    return;
  }

  const b = req.body || {};
  const noReceiptException = b.noReceiptException !== undefined ? Boolean(b.noReceiptException) : Boolean(exp.no_receipt_exception);
  const exceptionReason = b.exceptionReason !== undefined ? String(b.exceptionReason).trim() : String(exp.exception_reason || '');
  const isResubmit = ['for_correction', 'correction_needed', 'rejected'].includes(exp.status);
  const nextStatus = isResubmit ? 'resubmitted' : 'pending_review';

  try {
    transaction(() => {
      const savedAttIds = saveExpenseAttachmentsFromPayload(expenseId, exp.project_id, req.user!.id, b);
      assertExpenseSubmissionEvidence(expenseId, noReceiptException, exceptionReason);

      db.prepare(
        `UPDATE expenses SET
          status = ?,
          submitted_at = COALESCE(submitted_at, datetime('now')),
          no_receipt_exception = ?,
          exception_reason = ?,
          exception_status = CASE WHEN ? = 1 THEN (CASE WHEN exception_status = 'approved' THEN 'approved' ELSE 'pending' END) ELSE 'none' END,
          remarks = COALESCE(?, remarks)
         WHERE id = ?`
      ).run(nextStatus, noReceiptException ? 1 : 0, exceptionReason, noReceiptException ? 1 : 0, b.remarks ?? null, expenseId);

      db.prepare(
        `INSERT INTO expense_history (expense_id, actor_id, action, previous_status, new_status, remarks, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        expenseId,
        req.user!.id,
        isResubmit ? 'RESUBMITTED_LIQUIDATION' : 'SUBMITTED_LIQUIDATION',
        exp.status,
        nextStatus,
        String(b.remarks || (isResubmit ? 'Resubmitted after correction' : 'Submitted for review')),
        JSON.stringify({ attachmentIds: savedAttIds, noReceiptException })
      );
    });

    for (const uid of getUsersWithModuleAction(exp.project_id, 'financials', 'approve', req.user!.id)) {
      createNotification({
        userId: uid,
        projectId: exp.project_id,
        type: 'liquidation_submitted',
        title: `${exp.ref_number} ${isResubmit ? 'Resubmitted' : 'Awaiting Review'}`,
        body: `${req.user!.full_name} submitted ${exp.description} (${Number(exp.amount).toLocaleString()}).`,
        linkSection: 'financials',
      });
    }

    emitSyncEvent({ eventType: 'expense:submitted', module: 'financials', projectId: exp.project_id, payload: { id: expenseId, status: nextStatus } });
    res.json({ ok: true, status: nextStatus });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Submission validation failed' });
  }
});

router.post('/expenses/:id/cancel', requireModule('financials'), requirePermission('financials', 'create'), (req: AuthenticatedRequest, res) => {
  const expenseId = Number(req.params.id);
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!exp || !canAccessProject(req.user!, exp.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  if (exp.status === 'approved') {
    res.status(403).json({ error: 'Approved expenses cannot be cancelled. Use an authorized reversal amendment.' });
    return;
  }
  transaction(() => {
    db.prepare("UPDATE expenses SET status = 'cancelled' WHERE id = ?").run(expenseId);
    db.prepare(
      `INSERT INTO expense_history (expense_id, actor_id, action, previous_status, new_status, remarks, metadata_json)
       VALUES (?, ?, 'CANCELLED_EXPENSE', ?, 'cancelled', ?, '{}')`
    ).run(expenseId, req.user!.id, exp.status, String(req.body?.remarks || 'Cancelled by user'));
  });
  res.json({ ok: true, status: 'cancelled' });
});

// Dedicated Supervisor Cash Liquidation Review Queue
router.get('/liquidations/review-queue', requireModule('financials'), requirePermission('financials', 'view'), (req: AuthenticatedRequest, res) => {
  const access = getAccessibleProjectIds(req.user!);
  const projectId = req.query.projectId ? Number(req.query.projectId) : null;
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
  const exceptionOnly = req.query.exceptionOnly === '1' || req.query.exceptionOnly === 'true';

  let where = 'WHERE 1=1';
  const params: unknown[] = [];

  if (projectId) {
    if (!canAccessProject(req.user!, projectId)) {
      res.status(403).json({ error: 'Project access denied' });
      return;
    }
    where += ' AND e.project_id = ?';
    params.push(projectId);
  } else if (access !== 'ALL') {
    if (access.length === 0) {
      res.json({ queue: [], summary: { pendingCount: 0, exceptionPendingCount: 0, forCorrectionCount: 0, approvedCount: 0 } });
      return;
    }
    where += ` AND e.project_id IN (${access.map(() => '?').join(',')})`;
    params.push(...access);
  }

  if (statusFilter && statusFilter !== 'all') {
    if (statusFilter === 'awaiting_review') {
      where += " AND e.status IN ('pending', 'submitted', 'pending_review', 'resubmitted')";
    } else {
      where += ' AND e.status = ?';
      params.push(statusFilter);
    }
  }
  if (exceptionOnly) {
    where += ' AND e.no_receipt_exception = 1';
  }

  const rows = db
    .prepare(
      `SELECT e.*, p.name AS project_name, p.ref_number AS project_ref,
              sub.full_name AS submitted_by_name, app.full_name AS approved_by_name,
              rev.full_name AS reviewed_by_name, exapp.full_name AS exception_approved_by_name,
              cr.ref_number AS cr_ref, cr.description AS cr_description,
              cr.amount_requested AS cr_amount_requested,
              COALESCE(NULLIF(e.custodian_name, ''), cr.custodian_name, '') AS resolved_custodian_name
       FROM expenses e
       JOIN projects p ON p.id = e.project_id
       JOIN users sub ON sub.id = e.submitted_by
       LEFT JOIN users app ON app.id = e.approved_by
       LEFT JOIN users rev ON rev.id = e.reviewed_by
       LEFT JOIN users exapp ON exapp.id = e.exception_approved_by
       LEFT JOIN cash_requests cr ON cr.id = e.cash_request_id
       ${where}
       ORDER BY CASE WHEN e.status IN ('pending', 'submitted', 'pending_review', 'resubmitted') THEN 0 ELSE 1 END, e.id DESC
       LIMIT 250`
    )
    .all(...params) as any[];

  const hydrated = hydrateExpensesWithAttachments(rows);
  const expIds = hydrated.map((e) => e.id);
  const historyRows =
    expIds.length > 0
      ? (db
          .prepare(
            `SELECT eh.*, u.full_name AS actor_name, r.name AS actor_role
             FROM expense_history eh
             LEFT JOIN users u ON u.id = eh.actor_id
             LEFT JOIN roles r ON r.id = u.role_id
             WHERE eh.expense_id IN (${expIds.map(() => '?').join(',')})
             ORDER BY eh.id DESC`
          )
          .all(...expIds) as any[])
      : [];

  const queue = hydrated.map((e) => ({
    ...e,
    history: historyRows.filter((h) => h.expense_id === e.id),
  }));

  res.json({
    queue,
    summary: {
      pendingCount: queue.filter((q) => ['pending', 'submitted', 'pending_review', 'resubmitted'].includes(q.status)).length,
      exceptionPendingCount: queue.filter((q) => q.no_receipt_exception === 1 && q.exception_status === 'pending').length,
      forCorrectionCount: queue.filter((q) => ['for_correction', 'correction_needed'].includes(q.status)).length,
      approvedCount: queue.filter((q) => q.status === 'approved').length,
    },
  });
});

router.get('/expenses/:id/history', requireModule('financials'), requirePermission('financials', 'view'), (req: AuthenticatedRequest, res) => {
  const expenseId = Number(req.params.id);
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!exp || !canAccessProject(req.user!, exp.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  const history = db
    .prepare(
      `SELECT eh.*, u.full_name AS actor_name, r.name AS actor_role
       FROM expense_history eh
       LEFT JOIN users u ON u.id = eh.actor_id
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE eh.expense_id = ?
       ORDER BY eh.id DESC`
    )
    .all(expenseId);
  const [hydrated] = hydrateExpensesWithAttachments([exp]);
  res.json({ expense: hydrated, history });
});

router.patch('/expenses/:id/exception-decision', requireModule('financials'), (req: AuthenticatedRequest, res) => {
  if (!hasPermission(req.user!, 'financials', 'approve_exception') && !hasPermission(req.user!, 'financials', 'approve')) {
    res.status(403).json({ error: 'Supervisor/management exception authorization required' });
    return;
  }
  const expenseId = Number(req.params.id);
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!exp) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  if (!canAccessProject(req.user!, exp.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  if (exp.no_receipt_exception !== 1) {
    res.status(400).json({ error: 'This expense does not have a no-receipt exception request.' });
    return;
  }

  const { decision, remarks, overrideSelfApproval } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) {
    res.status(400).json({ error: 'Decision must be approved or rejected' });
    return;
  }
  if (decision === 'rejected' && !String(remarks || '').trim()) {
    res.status(400).json({ error: 'Remarks are required when rejecting a no-receipt exception' });
    return;
  }

  if (exp.submitted_by === req.user!.id) {
    const setting = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'allow_self_liquidation_approval'").get() as
      | { setting_value: string }
      | undefined;
    const isMgmtOverride = Boolean(overrideSelfApproval && ['system_admin', 'executive', 'general_manager'].includes(req.user!.role_slug));
    if (setting?.setting_value !== '1' && !isMgmtOverride) {
      res.status(403).json({ error: 'Self-approval of your own no-receipt exception is not permitted.' });
      return;
    }
  }

  transaction(() => {
    db.prepare(
      `UPDATE expenses SET
        exception_status = ?,
        exception_approved_by = ?,
        exception_approved_at = datetime('now'),
        exception_remarks = ?
       WHERE id = ?`
    ).run(decision, req.user!.id, String(remarks || '').trim(), expenseId);

    db.prepare(
      `INSERT INTO expense_history (expense_id, actor_id, action, previous_status, new_status, remarks, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      expenseId,
      req.user!.id,
      decision === 'approved' ? 'EXCEPTION_APPROVED' : 'EXCEPTION_REJECTED',
      exp.status,
      exp.status,
      String(remarks || '').trim() || `No-receipt exception ${decision}`,
      JSON.stringify({ exceptionStatus: decision })
    );
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: `EXPENSE_EXCEPTION_${decision.toUpperCase()}`,
    module: 'financials',
    recordType: 'expense',
    recordRef: exp.ref_number,
    newValue: { exceptionStatus: decision, reason: exp.exception_reason },
    remarks: String(remarks || ''),
    ipAddress: req.ip || '',
  });

  res.json({ ok: true, exceptionStatus: decision });
});

router.patch('/expenses/:id/decision', requireModule('financials'), requirePermission('financials', 'approve'), (req: AuthenticatedRequest, res) => {
  const expenseId = Number(req.params.id);
  const { decision, remarks, reason, approveException, overrideSelfApproval, overrideReason } = req.body || {};
  const normalizedDecision = decision === 'correction_needed' ? 'for_correction' : decision;
  if (!['approved', 'rejected', 'for_correction'].includes(normalizedDecision)) {
    res.status(400).json({ error: 'Invalid expense decision' });
    return;
  }

  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!exp) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  if (!canAccessProject(req.user!, exp.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const decisionNote = String(reason || remarks || '').trim();
  if ((normalizedDecision === 'rejected' || normalizedDecision === 'for_correction') && !decisionNote) {
    res.status(400).json({ error: 'A clear reason is required when rejecting or returning an expense for correction.' });
    return;
  }

  // Self-approval guard
  let usedSelfOverride = false;
  if (exp.submitted_by === req.user!.id && normalizedDecision === 'approved') {
    const setting = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'allow_self_liquidation_approval'").get() as
      | { setting_value: string }
      | undefined;
    const isAuthorizedMgmt = ['system_admin', 'executive', 'general_manager'].includes(req.user!.role_slug);
    if (setting?.setting_value !== '1' && !(overrideSelfApproval && isAuthorizedMgmt)) {
      res.status(403).json({
        error: 'Users cannot approve their own cash liquidation unless explicitly authorized with a logged management override.',
        selfApprovalBlocked: true,
      });
      return;
    }
    usedSelfOverride = true;
  }

  if (normalizedDecision === 'approved') {
    const receipts = getAttachmentsForEntity('expense_receipt', expenseId);
    const supports = getAttachmentsForEntity('expense_support', expenseId);

    if (receipts.length === 0) {
      if (exp.no_receipt_exception !== 1 || supports.length === 0) {
        res.status(400).json({
          error: 'Cannot approve expense: missing receipt photograph or approved no-receipt exception supporting proof.',
        });
        return;
      }
      if (exp.exception_status !== 'approved' && !approveException) {
        res.status(400).json({
          error: 'No-Receipt Exception must be separately authorized before approving this expense.',
          requiresExceptionAuthorization: true,
        });
        return;
      }
      if (approveException && !hasPermission(req.user!, 'financials', 'approve_exception') && !hasPermission(req.user!, 'financials', 'approve')) {
        res.status(403).json({ error: 'No-Receipt Exception authorization permission required.' });
        return;
      }
    }
  }

  transaction(() => {
    const shouldAlsoApproveException = normalizedDecision === 'approved' && exp.no_receipt_exception === 1 && exp.exception_status !== 'approved' && approveException;
    db.prepare(
      `UPDATE expenses SET
        status = ?,
        approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
        approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE approved_at END,
        reviewed_by = ?,
        reviewed_at = datetime('now'),
        rejection_reason = CASE WHEN ? IN ('rejected', 'for_correction') THEN ? ELSE rejection_reason END,
        exception_status = CASE WHEN ? = 1 THEN 'approved' ELSE exception_status END,
        exception_approved_by = CASE WHEN ? = 1 THEN ? ELSE exception_approved_by END,
        exception_approved_at = CASE WHEN ? = 1 THEN datetime('now') ELSE exception_approved_at END,
        remarks = COALESCE(NULLIF(?, ''), remarks)
       WHERE id = ?`
    ).run(
      normalizedDecision,
      normalizedDecision,
      req.user!.id,
      normalizedDecision,
      req.user!.id,
      normalizedDecision,
      decisionNote,
      shouldAlsoApproveException ? 1 : 0,
      shouldAlsoApproveException ? 1 : 0,
      req.user!.id,
      shouldAlsoApproveException ? 1 : 0,
      decisionNote,
      expenseId
    );

    if (normalizedDecision === 'approved') {
      lockAttachments(['expense_receipt', 'expense_support'], expenseId);
    }

    // Avoid double-counting: settle corresponding PR commitment when linked expense is approved
    if (normalizedDecision === 'approved' && exp.status !== 'approved' && exp.pr_id) {
      db.prepare(
        `UPDATE purchase_requests
         SET settled_amount = MIN(commitment_amount, settled_amount + ?),
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(Number(exp.amount), exp.pr_id);
    }

    db.prepare(
      `INSERT INTO expense_history (expense_id, actor_id, action, previous_status, new_status, remarks, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      expenseId,
      req.user!.id,
      `LIQUIDATION_${normalizedDecision.toUpperCase()}`,
      exp.status,
      normalizedDecision,
      decisionNote || `Marked ${normalizedDecision}`,
      JSON.stringify({ usedSelfOverride, overrideReason: overrideReason || '', exceptionAutoApproved: Boolean(shouldAlsoApproveException) })
    );
  });

  if (exp.submitted_by !== req.user!.id) {
    createNotification({
      userId: exp.submitted_by,
      projectId: exp.project_id,
      type: 'liquidation_decision',
      title: `Liquidation ${exp.ref_number}: ${normalizedDecision.replace(/_/g, ' ')}`,
      body: decisionNote || `${exp.description} was marked ${normalizedDecision.replace(/_/g, ' ')}.`,
      linkSection: 'financials',
    });
  }

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: `EXPENSE_${normalizedDecision.toUpperCase()}`,
    module: 'financials',
    recordType: 'expense',
    recordRef: exp.ref_number,
    previousValue: { status: exp.status },
    newValue: { status: normalizedDecision, amount: exp.amount, pr_id: exp.pr_id, usedSelfOverride },
    remarks: decisionNote || String(overrideReason || ''),
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'expense:decided',
    module: 'financials',
    projectId: exp.project_id,
    payload: { id: expenseId, status: normalizedDecision },
  });

  res.json({ ok: true, status: normalizedDecision });
});

router.post('/expenses/:id/amend', requireModule('financials'), (req: AuthenticatedRequest, res) => {
  if (!hasPermission(req.user!, 'financials', 'amend_approved') && !hasPermission(req.user!, 'financials', 'approve')) {
    res.status(403).json({ error: 'Authorized financial amendment permission required' });
    return;
  }
  const expenseId = Number(req.params.id);
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!exp || !canAccessProject(req.user!, exp.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  if (exp.status !== 'approved') {
    res.status(400).json({ error: 'Amendments/reversals only apply to approved financial records.' });
    return;
  }

  const { amendmentType, amendmentNote, reversalAmount, receiptsBase64, supportDocsBase64 } = req.body || {};
  const note = String(amendmentNote || '').trim();
  if (!note) {
    res.status(400).json({ error: 'Amendment reason/note is required' });
    return;
  }

  const result = transaction(() => {
    const addedAttIds = saveExpenseAttachmentsFromPayload(expenseId, exp.project_id, req.user!.id, {
      amendmentNote: note,
      receiptsBase64,
      supportDocsBase64,
    }, true);
    if (addedAttIds.length > 0) {
      db.prepare(`UPDATE protected_attachments SET is_locked = 1 WHERE id IN (${addedAttIds.map(() => '?').join(',')})`).run(...addedAttIds);
    }

    let reversalId: number | null = null;
    if (amendmentType === 'reversal') {
      const revAmt = -Math.abs(Number(reversalAmount || exp.amount));
      const revRef = `EXP-REV-${Date.now().toString().slice(-6)}`;
      const rInfo = db
        .prepare(
          `INSERT INTO expenses (
            ref_number, project_id, expense_date, category, description, amount,
            supplier_recipient, payment_method, cash_request_id, custodian_name,
            employee_name, submitted_by, approved_by, approved_at, status, remarks, is_system_settlement
          ) VALUES (?, ?, date('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'approved', ?, 1)`
        )
        .run(
          revRef,
          exp.project_id,
          exp.category,
          `Reversal of ${exp.ref_number}: ${exp.description}`,
          revAmt,
          exp.supplier_recipient,
          exp.payment_method,
          exp.cash_request_id,
          exp.custodian_name,
          exp.employee_name,
          req.user!.id,
          req.user!.id,
          `Authorized Reversal: ${note}`
        );
      reversalId = Number(rInfo.lastInsertRowid);
    }

    db.prepare('UPDATE expenses SET amendment_count = amendment_count + 1 WHERE id = ?').run(expenseId);
    db.prepare(
      `INSERT INTO expense_history (expense_id, actor_id, action, previous_status, new_status, remarks, metadata_json)
       VALUES (?, ?, ?, 'approved', 'approved', ?, ?)`
    ).run(
      expenseId,
      req.user!.id,
      amendmentType === 'reversal' ? 'AUTHORIZED_REVERSAL' : 'AUTHORIZED_AMENDMENT',
      note,
      JSON.stringify({ addedAttIds, reversalId })
    );

    return { addedAttIds, reversalId };
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: amendmentType === 'reversal' ? 'REVERSE_APPROVED_EXPENSE' : 'AMEND_APPROVED_EXPENSE',
    module: 'financials',
    recordType: 'expense',
    recordRef: exp.ref_number,
    newValue: result,
    remarks: note,
    ipAddress: req.ip || '',
  });

  emitSyncEvent({ eventType: 'expense:amended', module: 'financials', projectId: exp.project_id, payload: { id: expenseId } });
  res.json({ ok: true, ...result });
});

// --- Multi-Item Purchase Requests, Procurement & Receiving Traceability ---
function hydratePurchaseRequests(prs: any[]) {
  if (prs.length === 0) return { prs: [], pos: [] };
  const prIds = prs.map((p) => p.id);
  const ph = prIds.map(() => '?').join(',');

  const approvals = db
    .prepare(
      `SELECT pra.*, u.full_name AS approver_name
       FROM purchase_request_approvals pra
       JOIN users u ON u.id = pra.approver_id
       WHERE pra.pr_id IN (${ph})
       ORDER BY pra.id ASC`
    )
    .all(...prIds) as any[];

  const items = db
    .prepare(
      `SELECT pri.*, s.name AS supplier_master_name, inv.sku AS inventory_sku, inv.current_qty AS warehouse_qty
       FROM purchase_request_items pri
       LEFT JOIN suppliers s ON s.id = pri.preferred_supplier_id
       LEFT JOIN inventory_items inv ON inv.id = pri.inventory_item_id
       WHERE pri.pr_id IN (${ph})
       ORDER BY pri.sort_order ASC, pri.id ASC`
    )
    .all(...prIds) as any[];

  const attRows = db
    .prepare(
      `SELECT pa.*, u.full_name AS uploaded_by_name
       FROM protected_attachments pa
       LEFT JOIN users u ON u.id = pa.uploaded_by
       WHERE pa.entity_id IN (${ph})
         AND pa.entity_type IN ('pr_attachment', 'pr_item_doc', 'po_receiving')
       ORDER BY pa.id ASC`
    )
    .all(...prIds) as any[];

  const pos = db
    .prepare(
      `SELECT po.*, u.full_name AS received_by_name
       FROM purchase_orders po
       LEFT JOIN users u ON u.id = po.receiving_confirmed_by
       WHERE po.pr_id IN (${ph})
       ORDER BY po.id DESC`
    )
    .all(...prIds) as any[];

  const poItems = db
    .prepare(
      `SELECT poi.*, inv.sku AS inventory_sku
       FROM purchase_order_items poi
       LEFT JOIN inventory_items inv ON inv.id = poi.inventory_item_id
       WHERE poi.pr_id IN (${ph})
       ORDER BY poi.id ASC`
    )
    .all(...prIds) as any[];

  const poReceipts = db
    .prepare(
      `SELECT por.*, u.full_name AS received_by_name, inv.name AS warehouse_item_name, inv.sku AS warehouse_sku
       FROM purchase_order_receipts por
       JOIN users u ON u.id = por.received_by
       LEFT JOIN inventory_items inv ON inv.id = por.inventory_item_id
       WHERE por.pr_id IN (${ph})
       ORDER BY por.id DESC`
    )
    .all(...prIds) as any[];

  const hydratedPos = pos.map((po) => ({
    ...po,
    items: poItems.filter((i) => i.po_id === po.id),
    receipts: poReceipts.filter((r) => r.po_id === po.id),
  }));

  const hydratedPrs = prs.map((pr) => ({
    ...pr,
    approvals: approvals.filter((a) => a.pr_id === pr.id),
    items: items.filter((i) => i.pr_id === pr.id),
    attachments: attRows.filter((a) => a.entity_id === pr.id),
    purchaseOrders: hydratedPos.filter((po) => po.pr_id === pr.id),
    receipts: poReceipts.filter((r) => r.pr_id === pr.id),
  }));

  return { prs: hydratedPrs, pos: hydratedPos };
}

router.get('/purchase-requests', requireModule('procurement'), requirePermission('procurement', 'view'), (req: AuthenticatedRequest, res) => {
  const access = getAccessibleProjectIds(req.user!);
  const projectId = req.query.projectId ? Number(req.query.projectId) : null;
  let whereSql = 'WHERE 1=1';
  const params: unknown[] = [];

  if (projectId) {
    if (!canAccessProject(req.user!, projectId)) {
      res.status(403).json({ error: 'Project access denied' });
      return;
    }
    whereSql += ' AND pr.project_id = ?';
    params.push(projectId);
  } else if (access !== 'ALL') {
    if (access.length === 0) {
      res.json({ purchaseRequests: [], purchaseOrders: [] });
      return;
    }
    whereSql += ` AND pr.project_id IN (${access.map(() => '?').join(',')})`;
    params.push(...access);
  }

  const prs = db
    .prepare(
      `SELECT pr.*, p.name AS project_name, p.ref_number AS project_ref, p.location AS project_location,
              u.full_name AS requested_by_name
       FROM purchase_requests pr
       JOIN projects p ON p.id = pr.project_id
       JOIN users u ON u.id = pr.requested_by
       ${whereSql}
       ORDER BY pr.id DESC`
    )
    .all(...params) as any[];

  const { prs: hydratedPrs, pos: hydratedPos } = hydratePurchaseRequests(prs);
  res.json({ purchaseRequests: hydratedPrs, purchaseOrders: hydratedPos });
});

router.post('/projects/:id/purchase-requests', requireModule('procurement'), requirePermission('procurement', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const projectRow = db.prepare('SELECT location FROM projects WHERE id = ?').get(projectId) as { location: string } | undefined;
  if (!projectRow) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const b = req.body || {};
  if (!b.requiredDate) {
    res.status(400).json({ error: 'Required delivery date is required' });
    return;
  }

  // Normalize multi-item or legacy single-item payload
  const rawItems: any[] = Array.isArray(b.items) && b.items.length > 0
    ? b.items
    : b.itemDescription
    ? [
        {
          itemCode: b.itemCode || '',
          itemDescription: b.itemDescription,
          specifications: b.specifications || '',
          category: b.category || 'Materials',
          requestedQty: b.quantity,
          unit: b.unit || 'pcs',
          estimatedUnitPrice: b.estimatedUnitCost || 0,
          preferredSupplierId: b.preferredSupplierId || null,
          preferredSupplierName: b.suggestedSupplier || b.preferredSupplierName || '',
          remarks: b.remarks || '',
          catalogItemId: b.catalogItemId || null,
          inventoryItemId: b.inventoryItemId || null,
        },
      ]
    : [];

  if (rawItems.length === 0) {
    res.status(400).json({ error: 'At least one purchase request line item is required' });
    return;
  }

  const normalizedItems: Array<{
    catalogItemId: number | null;
    inventoryItemId: number | null;
    itemCode: string;
    itemDescription: string;
    specifications: string;
    category: string;
    requestedQty: number;
    unit: string;
    estimatedUnitPrice: number;
    estimatedTotal: number;
    preferredSupplierId: number | null;
    preferredSupplierName: string;
    remarks: string;
    sortOrder: number;
  }> = [];
  let grandEstimatedTotal = 0;
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    const desc = String(it.itemDescription || '').trim();
    const reqQty = Number(it.requestedQty ?? it.quantity ?? 0);
    const estUnitPrice = Number(it.estimatedUnitPrice ?? it.estimatedUnitCost ?? 0);
    if (!desc) {
      res.status(400).json({ error: `Line item ${i + 1}: Item description is required` });
      return;
    }
    if (!Number.isFinite(reqQty) || reqQty <= 0) {
      res.status(400).json({ error: `Line item ${i + 1} (${desc}): Quantity must be greater than zero` });
      return;
    }
    if (!Number.isFinite(estUnitPrice) || estUnitPrice < 0) {
      res.status(400).json({ error: `Line item ${i + 1} (${desc}): Estimated unit price cannot be negative` });
      return;
    }
    const lineTotal = Number((reqQty * estUnitPrice).toFixed(2));
    grandEstimatedTotal += lineTotal;
    normalizedItems.push({
      catalogItemId: it.catalogItemId ? Number(it.catalogItemId) : null,
      inventoryItemId: it.inventoryItemId ? Number(it.inventoryItemId) : null,
      itemCode: String(it.itemCode || '').trim(),
      itemDescription: desc,
      specifications: String(it.specifications || '').trim(),
      category: String(it.category || b.category || 'Materials').trim(),
      requestedQty: reqQty,
      unit: String(it.unit || 'pcs').trim() || 'pcs',
      estimatedUnitPrice: estUnitPrice,
      estimatedTotal: lineTotal,
      preferredSupplierId: it.preferredSupplierId ? Number(it.preferredSupplierId) : null,
      preferredSupplierName: String(it.preferredSupplierName || b.preferredSupplierName || b.suggestedSupplier || '').trim(),
      remarks: String(it.remarks || '').trim(),
      sortOrder: i + 1,
    });
  }
  grandEstimatedTotal = Number(grandEstimatedTotal.toFixed(2));

  const headerSummaryDesc =
    normalizedItems.length === 1
      ? normalizedItems[0].itemDescription
      : `${normalizedItems[0].itemDescription} (+${normalizedItems.length - 1} more item${normalizedItems.length - 1 > 1 ? 's' : ''})`;
  const totalQtySum = normalizedItems.reduce((s, it) => s + it.requestedQty, 0);
  const initialStatus = b.saveAsDraft ? 'draft' : 'submitted';
  const refNum = `PR-${Date.now().toString().slice(-6)}`;

  const prId = transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO purchase_requests (
          ref_number, project_id, requested_by, task_id, request_date, required_date,
          item_description, category, quantity, unit, estimated_unit_cost, estimated_total_cost,
          suggested_supplier, preferred_supplier_id, preferred_supplier_name,
          requesting_department, site_location, item_count, reason, remarks, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        refNum,
        projectId,
        req.user!.id,
        b.taskId ? Number(b.taskId) : null,
        b.requestDate || new Date().toISOString().slice(0, 10),
        b.requiredDate,
        headerSummaryDesc,
        normalizedItems[0].category || 'Materials',
        normalizedItems.length === 1 ? normalizedItems[0].requestedQty : totalQtySum,
        normalizedItems.length === 1 ? normalizedItems[0].unit : 'items',
        normalizedItems.length === 1 ? normalizedItems[0].estimatedUnitPrice : 0,
        grandEstimatedTotal,
        String(b.preferredSupplierName || b.suggestedSupplier || normalizedItems[0].preferredSupplierName || '').trim(),
        b.preferredSupplierId ? Number(b.preferredSupplierId) : null,
        String(b.preferredSupplierName || b.suggestedSupplier || '').trim(),
        String(b.requestingDepartment || 'Construction Operations').trim(),
        String(b.siteLocation || projectRow.location || '').trim(),
        normalizedItems.length,
        String(b.reason || '').trim(),
        String(b.remarks || '').trim(),
        initialStatus
      );

    const newPrId = Number(info.lastInsertRowid);
    const insItem = db.prepare(
      `INSERT INTO purchase_request_items (
        pr_id, catalog_item_id, inventory_item_id, item_code, item_description, specifications,
        category, requested_qty, approved_qty, unit, estimated_unit_price, estimated_total,
        preferred_supplier_id, preferred_supplier_name, item_status, remarks, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    );
    for (const it of normalizedItems) {
      insItem.run(
        newPrId,
        it.catalogItemId,
        it.inventoryItemId,
        it.itemCode,
        it.itemDescription,
        it.specifications,
        it.category,
        it.requestedQty,
        it.unit,
        it.estimatedUnitPrice,
        it.estimatedTotal,
        it.preferredSupplierId,
        it.preferredSupplierName,
        it.remarks,
        it.sortOrder
      );
    }

    if (Array.isArray(b.attachmentsBase64)) {
      for (const att of b.attachmentsBase64.slice(0, 10)) {
        if (!att?.dataUrl) continue;
        saveBase64Attachment({
          dataUrl: att.dataUrl,
          fileName: att.fileName || `pr-${refNum}.pdf`,
          entityType: 'pr_attachment',
          entityId: newPrId,
          projectId,
          category: att.category || 'Specification / Supporting Document',
          caption: att.caption || '',
          uploadedBy: req.user!.id,
        });
      }
    }

    return newPrId;
  });

  if (!b.saveAsDraft) {
    for (const uid of getUsersWithModuleAction(projectId, 'procurement', 'approve', req.user!.id)) {
      createNotification({
        userId: uid,
        projectId,
        type: 'pr_awaiting_approval',
        title: `New Purchase Request Awaiting Approval: ${refNum}`,
        body: `${normalizedItems.length} item(s) · Est. Total ${grandEstimatedTotal.toLocaleString()} (${headerSummaryDesc})`,
        linkSection: 'procurement',
      });
    }
  }

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: b.saveAsDraft ? 'CREATE_PR_DRAFT' : 'CREATE_MULTI_ITEM_PR',
    module: 'procurement',
    recordType: 'purchase_request',
    recordRef: refNum,
    newValue: { itemCount: normalizedItems.length, estimatedTotal: grandEstimatedTotal, status: initialStatus },
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'pr:created',
    module: 'procurement',
    projectId,
    payload: { id: prId, refNumber: refNum, itemCount: normalizedItems.length },
  });

  res.status(201).json({ id: prId, refNumber: refNum, itemCount: normalizedItems.length, estimatedTotalCost: grandEstimatedTotal });
});

router.put('/purchase-requests/:id', requireModule('procurement'), requirePermission('procurement', 'create'), (req: AuthenticatedRequest, res) => {
  const prId = Number(req.params.id);
  const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(prId) as any;
  if (!pr || !canAccessProject(req.user!, pr.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  if (!['draft', 'returned_for_correction', 'submitted'].includes(pr.status)) {
    res.status(403).json({ error: 'Cannot edit a purchase request once approved or ordered.' });
    return;
  }

  const b = req.body || {};
  const rawItems: any[] = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length === 0) {
    res.status(400).json({ error: 'At least one line item is required' });
    return;
  }

  let grandTotal = 0;
  const cleanItems: Array<Record<string, any> & {
    requestedQty: number;
    estimatedUnitPrice: number;
    estimatedTotal: number;
    sortOrder: number;
  }> = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    const reqQty = Number(it.requestedQty ?? it.quantity ?? 0);
    const estPrice = Number(it.estimatedUnitPrice ?? it.estimatedUnitCost ?? 0);
    if (!String(it.itemDescription || '').trim() || reqQty <= 0 || estPrice < 0) {
      res.status(400).json({ error: `Line item ${i + 1}: Valid description, positive quantity, and non-negative price required` });
      return;
    }
    const lineTotal = Number((reqQty * estPrice).toFixed(2));
    grandTotal += lineTotal;
    cleanItems.push({ ...it, requestedQty: reqQty, estimatedUnitPrice: estPrice, estimatedTotal: lineTotal, sortOrder: i + 1 });
  }
  grandTotal = Number(grandTotal.toFixed(2));

  const nextStatus = b.submitNow ? 'submitted' : b.saveAsDraft ? 'draft' : pr.status === 'returned_for_correction' ? 'submitted' : pr.status;
  const summaryDesc =
    cleanItems.length === 1
      ? cleanItems[0].itemDescription
      : `${cleanItems[0].itemDescription} (+${cleanItems.length - 1} more item${cleanItems.length - 1 > 1 ? 's' : ''})`;

  transaction(() => {
    db.prepare(
      `UPDATE purchase_requests SET
        required_date = COALESCE(?, required_date),
        requesting_department = COALESCE(?, requesting_department),
        site_location = COALESCE(?, site_location),
        preferred_supplier_id = ?,
        preferred_supplier_name = COALESCE(?, preferred_supplier_name),
        suggested_supplier = COALESCE(?, suggested_supplier),
        item_description = ?,
        item_count = ?,
        estimated_total_cost = ?,
        reason = COALESCE(?, reason),
        remarks = COALESCE(?, remarks),
        status = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      b.requiredDate ?? null,
      b.requestingDepartment ?? null,
      b.siteLocation ?? null,
      b.preferredSupplierId !== undefined ? (b.preferredSupplierId ? Number(b.preferredSupplierId) : null) : pr.preferred_supplier_id,
      b.preferredSupplierName ?? null,
      b.preferredSupplierName ?? b.suggestedSupplier ?? null,
      summaryDesc,
      cleanItems.length,
      grandTotal,
      b.reason ?? null,
      b.remarks ?? null,
      nextStatus,
      prId
    );

    db.prepare('DELETE FROM purchase_request_items WHERE pr_id = ?').run(prId);
    const ins = db.prepare(
      `INSERT INTO purchase_request_items (
        pr_id, catalog_item_id, inventory_item_id, item_code, item_description, specifications,
        category, requested_qty, approved_qty, unit, estimated_unit_price, estimated_total,
        preferred_supplier_id, preferred_supplier_name, item_status, remarks, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    );
    for (const it of cleanItems) {
      ins.run(
        prId,
        it.catalogItemId ? Number(it.catalogItemId) : null,
        it.inventoryItemId ? Number(it.inventoryItemId) : null,
        String(it.itemCode || ''),
        String(it.itemDescription).trim(),
        String(it.specifications || ''),
        String(it.category || 'Materials'),
        it.requestedQty,
        String(it.unit || 'pcs'),
        it.estimatedUnitPrice,
        it.estimatedTotal,
        it.preferredSupplierId ? Number(it.preferredSupplierId) : null,
        String(it.preferredSupplierName || ''),
        String(it.remarks || ''),
        it.sortOrder
      );
    }
  });

  res.json({ ok: true, status: nextStatus, estimatedTotalCost: grandTotal });
});

router.patch('/purchase-requests/:id/workflow', requireModule('procurement'), requirePermission('procurement', 'review'), (req: AuthenticatedRequest, res) => {
  const prId = Number(req.params.id);
  const { status, stage, remarks, itemDecisions } = req.body || {};
  const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(prId) as any;
  if (!pr) {
    res.status(404).json({ error: 'Purchase request not found' });
    return;
  }
  if (!canAccessProject(req.user!, pr.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const allowed = [
    'submitted',
    'under_review',
    'endorsed',
    'approved',
    'partially_approved',
    'returned_for_correction',
    'rejected',
    'for_procurement',
    'ordered',
    'cancelled',
  ];
  if (!allowed.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  if (['approved', 'partially_approved', 'rejected'].includes(status) && !hasPermission(req.user!, 'procurement', 'approve')) {
    res.status(403).json({ error: 'Approval permission required' });
    return;
  }
  if ((status === 'returned_for_correction' || status === 'rejected') && !String(remarks || '').trim() && !Array.isArray(itemDecisions)) {
    res.status(400).json({ error: 'Remarks/reason required when rejecting or returning a purchase request' });
    return;
  }

  let finalPrStatus = status;

  transaction(() => {
    const existingItems = db.prepare('SELECT * FROM purchase_request_items WHERE pr_id = ? ORDER BY sort_order ASC, id ASC').all(prId) as any[];
    let approvedTotal = 0;

    if (Array.isArray(itemDecisions) && itemDecisions.length > 0) {
      // Partial / per-item approval preserving requested_qty untouched!
      let approvedItemCount = 0;
      let rejectedItemCount = 0;
      let returnedItemCount = 0;
      for (const dec of itemDecisions) {
        const item = existingItems.find((x) => x.id === Number(dec.itemId));
        if (!item) continue;
        const itemStatus = String(dec.itemStatus || 'approved');
        let appQty = Number(dec.approvedQty ?? (itemStatus === 'approved' ? item.requested_qty : 0));
        if (itemStatus === 'rejected' || itemStatus === 'returned') appQty = 0;
        if (appQty < 0) throw new Error(`Approved quantity cannot be negative for ${item.item_description}`);
        if (appQty > Number(item.requested_qty)) {
          throw new Error(`Approved quantity (${appQty}) cannot exceed requested quantity (${item.requested_qty}) for ${item.item_description}`);
        }
        const computedItemStatus =
          itemStatus === 'rejected'
            ? 'rejected'
            : itemStatus === 'returned'
            ? 'returned'
            : appQty === 0
            ? 'rejected'
            : appQty < Number(item.requested_qty)
            ? 'partially_approved'
            : 'approved';

        const appTotal = Number((appQty * Number(item.estimated_unit_price)).toFixed(2));
        approvedTotal += appTotal;

        if (computedItemStatus === 'approved' && appQty === Number(item.requested_qty)) approvedItemCount++;
        else if (computedItemStatus === 'rejected') rejectedItemCount++;
        else if (computedItemStatus === 'returned') returnedItemCount++;

        db.prepare(
          `UPDATE purchase_request_items SET
            approved_qty = ?,
            approved_total = ?,
            item_status = ?,
            approver_remarks = ?
           WHERE id = ?`
        ).run(appQty, appTotal, computedItemStatus, String(dec.remarks || ''), item.id);
      }

      if (returnedItemCount > 0 && approvedItemCount === 0) finalPrStatus = 'returned_for_correction';
      else if (rejectedItemCount === existingItems.length) finalPrStatus = 'rejected';
      else if (approvedItemCount === existingItems.length) finalPrStatus = 'approved';
      else finalPrStatus = 'partially_approved';
    } else if (status === 'approved') {
      for (const item of existingItems) {
        const appTotal = Number((Number(item.requested_qty) * Number(item.estimated_unit_price)).toFixed(2));
        approvedTotal += appTotal;
        db.prepare(
          `UPDATE purchase_request_items SET
            approved_qty = requested_qty,
            approved_total = ?,
            item_status = 'approved',
            approver_remarks = CASE WHEN ? != '' THEN ? ELSE approver_remarks END
           WHERE id = ?`
        ).run(appTotal, String(remarks || ''), String(remarks || ''), item.id);
      }
      if (existingItems.length === 0) approvedTotal = Number(pr.estimated_total_cost || 0);
    } else if (status === 'rejected' || status === 'cancelled' || status === 'returned_for_correction') {
      approvedTotal = 0;
      const mappedItemStatus = status === 'returned_for_correction' ? 'returned' : status;
      db.prepare('UPDATE purchase_request_items SET approved_qty = 0, approved_total = 0, item_status = ? WHERE pr_id = ?').run(
        mappedItemStatus,
        prId
      );
    } else {
      approvedTotal = Number(pr.approved_total_cost || pr.commitment_amount || 0);
    }

    approvedTotal = Number(approvedTotal.toFixed(2));

    // Approved PR creates financial commitment strictly from APPROVED quantities (never updates warehouse inventory!)
    const commitment =
      ['approved', 'partially_approved', 'for_procurement', 'ordered'].includes(finalPrStatus)
        ? approvedTotal > 0 ? approvedTotal : Number(pr.commitment_amount || pr.estimated_total_cost)
        : ['rejected', 'cancelled', 'returned_for_correction'].includes(finalPrStatus)
        ? 0
        : Number(pr.commitment_amount || 0);

    db.prepare(
      `UPDATE purchase_requests SET
        status = ?,
        approved_total_cost = ?,
        commitment_amount = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(finalPrStatus, approvedTotal, commitment, prId);

    db.prepare(
      'INSERT INTO purchase_request_approvals (pr_id, approver_id, stage, decision, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(prId, req.user!.id, stage || req.user!.role_name, finalPrStatus, String(remarks || ''));

    if (finalPrStatus === 'ordered') {
      const existingPo = db.prepare('SELECT id FROM purchase_orders WHERE pr_id = ?').get(prId);
      if (!existingPo) {
        const approvedLines = db
          .prepare("SELECT * FROM purchase_request_items WHERE pr_id = ? AND approved_qty > 0 AND item_status IN ('approved', 'partially_approved', 'ordered')")
          .all(prId) as any[];
        const totalApprovedQty = approvedLines.length > 0 ? approvedLines.reduce((s, l) => s + Number(l.approved_qty), 0) : Number(pr.quantity);
        const totalOrderCost = approvedLines.length > 0 ? approvedLines.reduce((s, l) => s + Number(l.approved_total), 0) : commitment;

        const poRes = db
          .prepare(
            `INSERT INTO purchase_orders (po_number, pr_id, project_id, supplier_id, supplier_name, approved_qty, ordered_qty, actual_unit_cost, actual_total_cost, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ordered')`
          )
          .run(
            `PO-${Date.now().toString().slice(-6)}`,
            prId,
            pr.project_id,
            pr.preferred_supplier_id || null,
            pr.preferred_supplier_name || pr.suggested_supplier || 'Designated Supplier',
            totalApprovedQty,
            totalApprovedQty,
            approvedLines.length === 1 ? approvedLines[0].estimated_unit_price : pr.estimated_unit_cost,
            totalOrderCost
          );
        const poId = Number(poRes.lastInsertRowid);
        for (const l of approvedLines) {
          db.prepare(
            `INSERT INTO purchase_order_items (
              po_id, pr_id, pr_item_id, catalog_item_id, inventory_item_id, item_code,
              item_description, unit, approved_qty, ordered_qty, actual_unit_price, actual_total,
              supplier_id, supplier_name, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ordered')`
          ).run(
            poId,
            prId,
            l.id,
            l.catalog_item_id,
            l.inventory_item_id,
            l.item_code,
            l.item_description,
            l.unit,
            l.approved_qty,
            l.approved_qty,
            l.estimated_unit_price,
            l.approved_total,
            l.preferred_supplier_id,
            l.preferred_supplier_name || pr.preferred_supplier_name || pr.suggested_supplier || ''
          );
          db.prepare("UPDATE purchase_request_items SET ordered_qty = approved_qty, item_status = 'ordered' WHERE id = ?").run(l.id);
        }
      }
    }
  });

  createNotification({
    userId: pr.requested_by,
    projectId: pr.project_id,
    type: 'pr_decision',
    title: `${pr.ref_number}: ${finalPrStatus.replace(/_/g, ' ')}`,
    body: remarks || `Purchase request moved to ${finalPrStatus.replace(/_/g, ' ')}.`,
    linkSection: 'procurement',
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: `PR_WORKFLOW_${finalPrStatus.toUpperCase()}`,
    module: 'procurement',
    recordType: 'purchase_request',
    recordRef: pr.ref_number,
    newValue: { status: finalPrStatus, hasItemDecisions: Array.isArray(itemDecisions) },
    remarks: String(remarks || ''),
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'pr:updated',
    module: 'procurement',
    projectId: pr.project_id,
    payload: { id: prId, status: finalPrStatus },
  });

  res.json({ ok: true, status: finalPrStatus });
});

// Create Purchase Order with per-item supplier selection & actual purchase pricing
router.post('/purchase-requests/:id/create-po', requireModule('procurement'), requirePermission('procurement', 'edit'), (req: AuthenticatedRequest, res) => {
  const prId = Number(req.params.id);
  const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(prId) as any;
  if (!pr || !canAccessProject(req.user!, pr.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  if (!['approved', 'partially_approved', 'for_procurement'].includes(pr.status)) {
    res.status(400).json({ error: 'Only approved or partially approved purchase requests can generate Purchase Orders' });
    return;
  }

  const b = req.body || {};
  const prItems = db
    .prepare("SELECT * FROM purchase_request_items WHERE pr_id = ? AND approved_qty > 0 AND item_status IN ('approved', 'partially_approved')")
    .all(prId) as any[];
  if (prItems.length === 0) {
    res.status(400).json({ error: 'No approved line items found to order' });
    return;
  }

  const lineInputs: any[] = Array.isArray(b.items) && b.items.length > 0
    ? b.items
    : prItems.map((it) => ({
        prItemId: it.id,
        orderedQty: it.approved_qty,
        actualUnitPrice: it.estimated_unit_price,
        supplierId: b.supplierId || it.preferred_supplier_id || pr.preferred_supplier_id || null,
        supplierName: b.supplierName || it.preferred_supplier_name || pr.preferred_supplier_name || pr.suggested_supplier || 'Designated Supplier',
      }));

  const poResult = transaction(() => {
    let totalOrderedQty = 0;
    let totalApprovedQty = 0;
    let totalActualCost = 0;
    const primarySupplier = String(
      b.supplierName || lineInputs[0]?.supplierName || pr.preferred_supplier_name || pr.suggested_supplier || 'Designated Supplier'
    ).trim();

    const poNumber = `PO-${Date.now().toString().slice(-6)}`;
    const poRes = db
      .prepare(
        `INSERT INTO purchase_orders (
          po_number, pr_id, project_id, supplier_id, supplier_name, approved_qty, ordered_qty,
          actual_unit_cost, actual_total_cost, remarks, status
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, 'ordered')`
      )
      .run(poNumber, prId, pr.project_id, b.supplierId ? Number(b.supplierId) : null, primarySupplier, String(b.remarks || ''), );
    const poId = Number(poRes.lastInsertRowid);

    for (const inp of lineInputs) {
      const prItem = prItems.find((x) => x.id === Number(inp.prItemId));
      if (!prItem) continue;
      const ordQty = Math.min(Number(prItem.approved_qty), Math.max(0, Number(inp.orderedQty ?? prItem.approved_qty)));
      if (ordQty <= 0) continue;
      const unitPrice = Math.max(0, Number(inp.actualUnitPrice ?? prItem.estimated_unit_price));
      const lineTotal = Number((ordQty * unitPrice).toFixed(2));
      totalApprovedQty += Number(prItem.approved_qty);
      totalOrderedQty += ordQty;
      totalActualCost += lineTotal;

      db.prepare(
        `INSERT INTO purchase_order_items (
          po_id, pr_id, pr_item_id, catalog_item_id, inventory_item_id, item_code,
          item_description, unit, approved_qty, ordered_qty, actual_unit_price, actual_total,
          supplier_id, supplier_name, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ordered')`
      ).run(
        poId,
        prId,
        prItem.id,
        prItem.catalog_item_id,
        prItem.inventory_item_id,
        prItem.item_code,
        prItem.item_description,
        prItem.unit,
        prItem.approved_qty,
        ordQty,
        unitPrice,
        lineTotal,
        inp.supplierId ? Number(inp.supplierId) : prItem.preferred_supplier_id,
        String(inp.supplierName || prItem.preferred_supplier_name || primarySupplier)
      );

      db.prepare("UPDATE purchase_request_items SET ordered_qty = ordered_qty + ?, item_status = 'ordered' WHERE id = ?").run(ordQty, prItem.id);
    }

    db.prepare(
      `UPDATE purchase_orders SET
        approved_qty = ?,
        ordered_qty = ?,
        actual_unit_cost = ?,
        actual_total_cost = ?
       WHERE id = ?`
    ).run(totalApprovedQty, totalOrderedQty, totalOrderedQty > 0 ? Number((totalActualCost / totalOrderedQty).toFixed(2)) : 0, Number(totalActualCost.toFixed(2)), poId);

    db.prepare("UPDATE purchase_requests SET status = 'ordered', updated_at = datetime('now') WHERE id = ?").run(prId);

    return { poId, poNumber, totalActualCost: Number(totalActualCost.toFixed(2)) };
  });

  createNotification({
    userId: pr.requested_by,
    projectId: pr.project_id,
    type: 'po_issued',
    title: `Purchase Order Issued: ${poResult.poNumber}`,
    body: `PO created for ${pr.ref_number} (${poResult.totalActualCost.toLocaleString()}).`,
    linkSection: 'procurement',
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_PURCHASE_ORDER',
    module: 'procurement',
    recordType: 'purchase_order',
    recordRef: poResult.poNumber,
    newValue: { prId, prRef: pr.ref_number, totalActualCost: poResult.totalActualCost },
    ipAddress: req.ip || '',
  });

  emitSyncEvent({ eventType: 'po:created', module: 'procurement', projectId: pr.project_id, payload: poResult });
  res.status(201).json({ ok: true, ...poResult });
});

router.post('/purchase-requests/:id/receive', requireModule('procurement'), requirePermission('procurement', 'edit'), (req: AuthenticatedRequest, res) => {
  const prId = Number(req.params.id);
  const b = req.body || {};
  const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(prId) as any;
  if (!pr || !canAccessProject(req.user!, pr.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const deliveryDate = String(b.deliveryDate || new Date().toISOString().slice(0, 10));
  const drNumber = String(b.drNumber || '').trim();
  const invoiceNumber = String(b.invoiceNumber || '').trim();

  try {
    const receiptSummary = transaction(() => {
      let po = db.prepare('SELECT * FROM purchase_orders WHERE pr_id = ? ORDER BY id DESC LIMIT 1').get(prId) as any;
      if (!po) {
        const poNumber = `PO-${Date.now().toString().slice(-6)}`;
        const info = db
          .prepare(
            `INSERT INTO purchase_orders (po_number, pr_id, project_id, supplier_name, approved_qty, ordered_qty, actual_unit_cost, actual_total_cost, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ordered')`
          )
          .run(poNumber, prId, pr.project_id, pr.preferred_supplier_name || pr.suggested_supplier || 'Supplier', pr.quantity, pr.quantity, pr.estimated_unit_cost, pr.approved_total_cost || pr.estimated_total_cost);
        po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(info.lastInsertRowid));
      }

      const prItems = db.prepare('SELECT * FROM purchase_request_items WHERE pr_id = ? ORDER BY sort_order ASC, id ASC').all(prId) as any[];
      const lineReceipts: any[] = Array.isArray(b.items) && b.items.length > 0
        ? b.items
        : [
            {
              prItemId: prItems[0]?.id || null,
              inventoryItemId: b.inventoryItemId || prItems[0]?.inventory_item_id || null,
              deliveredQty: b.deliveredQty ?? prItems[0]?.approved_qty ?? pr.quantity,
              acceptedQty: b.acceptedQty ?? b.deliveredQty ?? prItems[0]?.approved_qty ?? pr.quantity,
              actualUnitCost: b.actualUnitCost ?? prItems[0]?.estimated_unit_price ?? pr.estimated_unit_cost,
              discrepancyNotes: b.discrepancyNotes || '',
              addToWarehouse: b.addToWarehouse !== false,
            },
          ];

      let batchDeliveredQty = 0;
      let batchAcceptedCost = 0;
      let warehouseUpdatedCount = 0;

      for (const lr of lineReceipts) {
        const deliveredQty = Math.max(0, Number(lr.deliveredQty || 0));
        const acceptedQty = Math.min(deliveredQty, Math.max(0, Number(lr.acceptedQty ?? deliveredQty)));
        const rejectedQty = Number((deliveredQty - acceptedQty).toFixed(3));
        if (deliveredQty <= 0) continue;

        const prItem = lr.prItemId ? prItems.find((x) => x.id === Number(lr.prItemId)) : null;
        const unitCost = Math.max(0, Number(lr.actualUnitCost ?? prItem?.estimated_unit_price ?? pr.estimated_unit_cost));
        const lineActualCost = Number((acceptedQty * unitCost).toFixed(2));
        let invItemId: number | null = lr.inventoryItemId ? Number(lr.inventoryItemId) : prItem?.inventory_item_id || null;

        // Auto-match by SKU if catalog/item code corresponds to an inventory item
        if (!invItemId && lr.addToWarehouse !== false && prItem?.item_code) {
          const matchedInv = db.prepare('SELECT id FROM inventory_items WHERE sku = ?').get(prItem.item_code) as { id: number } | undefined;
          if (matchedInv) invItemId = matchedInv.id;
        }

        let addedToWarehouse = 0;
        // CRITICAL: Warehouse inventory increases ONLY on physically received & accepted deliveries!
        if (lr.addToWarehouse !== false && acceptedQty > 0 && invItemId) {
          const invItem = db.prepare('SELECT id FROM inventory_items WHERE id = ?').get(invItemId);
          if (invItem) {
            db.prepare("UPDATE inventory_items SET current_qty = current_qty + ?, unit_cost = CASE WHEN ? > 0 THEN ? ELSE unit_cost END, updated_at = datetime('now') WHERE id = ?").run(
              acceptedQty,
              unitCost,
              unitCost,
              invItemId
            );
            db.prepare(
              `INSERT INTO inventory_transactions (item_id, project_id, tx_type, quantity, unit_cost, reference_doc, notes, performed_by)
               VALUES (?, ?, 'receive', ?, ?, ?, ?, ?)`
            ).run(
              invItemId,
              pr.project_id,
              acceptedQty,
              unitCost,
              `${po.po_number}${drNumber ? ` / DR:${drNumber}` : ''}`,
              lr.discrepancyNotes || `Received against ${pr.ref_number}`,
              req.user!.id
            );
            addedToWarehouse = 1;
            warehouseUpdatedCount++;
          }
        }

        db.prepare(
          `INSERT INTO purchase_order_receipts (
            po_id, pr_id, pr_item_id, project_id, inventory_item_id, delivered_qty, accepted_qty,
            rejected_qty, actual_unit_cost, actual_total_cost, delivery_date, dr_number,
            invoice_number, discrepancy_notes, added_to_warehouse, received_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          po.id,
          prId,
          prItem?.id || null,
          pr.project_id,
          invItemId,
          deliveredQty,
          acceptedQty,
          rejectedQty,
          unitCost,
          lineActualCost,
          deliveryDate,
          drNumber,
          invoiceNumber,
          String(lr.discrepancyNotes || ''),
          addedToWarehouse,
          req.user!.id
        );

        if (prItem) {
          const nextItemDel = Number(prItem.delivered_qty || 0) + acceptedQty;
          const itemDone = nextItemDel >= Number(prItem.approved_qty || prItem.requested_qty);
          db.prepare(
            `UPDATE purchase_request_items SET
              delivered_qty = ?,
              item_status = ?
             WHERE id = ?`
          ).run(nextItemDel, itemDone ? 'delivered' : 'partially_delivered', prItem.id);

          db.prepare(
            `UPDATE purchase_order_items SET
              delivered_qty = delivered_qty + ?,
              actual_unit_price = ?,
              actual_total = actual_total + ?,
              discrepancy_qty = discrepancy_qty + ?,
              discrepancy_notes = COALESCE(NULLIF(?, ''), discrepancy_notes),
              status = ?
             WHERE po_id = ? AND pr_item_id = ?`
          ).run(acceptedQty, unitCost, lineActualCost, rejectedQty, String(lr.discrepancyNotes || ''), itemDone ? 'delivered' : 'partially_delivered', po.id, prItem.id);
        }

        batchDeliveredQty += acceptedQty;
        batchAcceptedCost += lineActualCost;
      }

      if (batchDeliveredQty <= 0) {
        throw new Error('Delivered quantity must be greater than zero');
      }

      const refreshedItems = db.prepare("SELECT * FROM purchase_request_items WHERE pr_id = ? AND approved_qty > 0").all(prId) as any[];
      const allDelivered =
        refreshedItems.length > 0
          ? refreshedItems.every((it) => Number(it.delivered_qty) >= Number(it.approved_qty))
          : Number(po.delivered_qty || 0) + batchDeliveredQty >= Number(pr.quantity);
      const nextStatus = allDelivered ? 'delivered' : 'partially_delivered';

      db.prepare(
        `UPDATE purchase_orders SET
          delivered_qty = delivered_qty + ?,
          actual_total_cost = actual_total_cost + ?,
          delivery_date = ?,
          receiving_confirmed_by = ?,
          discrepancy_notes = COALESCE(NULLIF(?, ''), discrepancy_notes),
          status = ?
         WHERE id = ?`
      ).run(batchDeliveredQty, Number(batchAcceptedCost.toFixed(2)), deliveryDate, req.user!.id, String(b.discrepancyNotes || ''), nextStatus, po.id);

      db.prepare("UPDATE purchase_requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(nextStatus, prId);

      // Attach any delivery receipt / supplier invoice to protected storage
      const savedDocIds: number[] = [];
      if (Array.isArray(b.attachmentsBase64)) {
        for (const att of b.attachmentsBase64.slice(0, 10)) {
          if (!att?.dataUrl) continue;
          const saved = saveBase64Attachment({
            dataUrl: att.dataUrl,
            fileName: att.fileName || `receiving-${po.po_number}.jpg`,
            entityType: 'po_receiving',
            entityId: prId,
            projectId: pr.project_id,
            category: att.category || 'Delivery Receipt / Supplier Invoice',
            caption: `${po.po_number} (${deliveryDate})`,
            uploadedBy: req.user!.id,
          });
          savedDocIds.push(saved.id);
        }
      }

      if (b.recordExpense && batchAcceptedCost > 0) {
        const expRef = `EXP-${Date.now().toString().slice(-6)}`;
        const expInfo = db
          .prepare(
            `INSERT INTO expenses (
              ref_number, project_id, expense_date, category, description, amount, supplier_recipient,
              payment_method, pr_id, employee_name, submitted_by, approved_by, approved_at, status,
              remarks, is_system_settlement
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Bank Transfer', ?, ?, ?, ?, datetime('now'), 'approved', ?, 1)`
          )
          .run(
            expRef,
            pr.project_id,
            deliveryDate,
            pr.category || 'Materials',
            `Receiving settlement: ${pr.ref_number} (${po.po_number})`,
            Number(batchAcceptedCost.toFixed(2)),
            po.supplier_name || pr.preferred_supplier_name || pr.suggested_supplier || 'Supplier',
            prId,
            req.user!.full_name,
            req.user!.id,
            req.user!.id,
            `Auto-settled from PO receiving${drNumber ? ` · DR ${drNumber}` : ''}${invoiceNumber ? ` · Inv ${invoiceNumber}` : ''}`
          );
        const settlementExpId = Number(expInfo.lastInsertRowid);
        // Copy any uploaded receiving receipt proof reference onto the expense as well
        if (Array.isArray(b.attachmentsBase64)) {
          for (const att of b.attachmentsBase64.slice(0, 5)) {
            if (!att?.dataUrl) continue;
            const recAtt = saveBase64Attachment({
              dataUrl: att.dataUrl,
              fileName: att.fileName || `po-receipt-${po.po_number}.jpg`,
              entityType: 'expense_receipt',
              entityId: settlementExpId,
              projectId: pr.project_id,
              category: 'Supplier Invoice / DR',
              caption: `Settled ${po.po_number}`,
              uploadedBy: req.user!.id,
            });
            db.prepare('UPDATE protected_attachments SET is_locked = 1 WHERE id = ?').run(recAtt.id);
          }
        }

        db.prepare(
          'UPDATE purchase_requests SET settled_amount = MIN(commitment_amount, settled_amount + ?) WHERE id = ?'
        ).run(Number(batchAcceptedCost.toFixed(2)), prId);
      }

      return { poNumber: po.po_number, nextStatus, batchDeliveredQty, batchAcceptedCost: Number(batchAcceptedCost.toFixed(2)), warehouseUpdatedCount, savedDocIds };
    });

    createNotification({
      userId: pr.requested_by,
      projectId: pr.project_id,
      type: 'po_received',
      title: `Delivery Recorded for ${pr.ref_number} (${receiptSummary.nextStatus.replace(/_/g, ' ')})`,
      body: `Accepted qty: ${receiptSummary.batchDeliveredQty}. Warehouse items updated: ${receiptSummary.warehouseUpdatedCount}.`,
      linkSection: 'procurement',
    });

    logAudit({
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'RECEIVE_PO_DELIVERY',
      module: 'procurement',
      recordType: 'purchase_request',
      recordRef: pr.ref_number,
      newValue: receiptSummary,
      ipAddress: req.ip || '',
    });

    emitSyncEvent({
      eventType: 'procurement:received',
      module: 'procurement',
      projectId: pr.project_id,
      payload: { prId, ...receiptSummary },
    });

    res.json({ ok: true, ...receiptSummary });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to record PO receiving' });
  }
});

// --- Personnel & Attendance ---
router.get('/personnel', requireModule('personnel'), requirePermission('personnel', 'view'), (req: AuthenticatedRequest, res) => {
  const showSensitive = ['system_admin', 'executive', 'general_manager', 'hr_admin', 'project_manager'].includes(
    req.user!.role_slug
  );
  const personnel = db
    .prepare(
      `SELECT per.*, p.name AS project_name
       FROM personnel per
       LEFT JOIN projects p ON p.id = per.assigned_project_id
       ORDER BY per.full_name ASC`
    )
    .all() as any[];

  res.json({
    personnel: personnel.map((per) => ({
      ...per,
      emergency_contact: showSensitive ? per.emergency_contact : 'Restricted',
      daily_rate: showSensitive ? per.daily_rate : null,
    })),
  });
});

router.post('/personnel', requireModule('personnel'), requirePermission('personnel', 'create'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  if (!b.employeeCode || !b.fullName || !b.position || !b.tradeSkill) {
    res.status(400).json({ error: 'Employee code, full name, position, and trade/skill are required' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO personnel (employee_code, full_name, email, phone, position, trade_skill, employment_status, assigned_project_id, emergency_contact, daily_rate, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(b.employeeCode).trim(),
      String(b.fullName).trim(),
      b.email || '',
      b.phone || '',
      b.position,
      b.tradeSkill,
      b.employmentStatus || 'active',
      b.assignedProjectId ? Number(b.assignedProjectId) : null,
      b.emergencyContact || '',
      Number(b.dailyRate || 0),
      b.remarks || ''
    );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.patch('/personnel/:id', requireModule('personnel'), requirePermission('personnel', 'edit'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const { assignedProjectId, employmentStatus, position } = req.body || {};
  db.prepare(
    `UPDATE personnel SET
      assigned_project_id = COALESCE(?, assigned_project_id),
      employment_status = COALESCE(?, employment_status),
      position = COALESCE(?, position)
     WHERE id = ?`
  ).run(assignedProjectId !== undefined ? (assignedProjectId ? Number(assignedProjectId) : null) : null, employmentStatus ?? null, position ?? null, id);
  res.json({ ok: true });
});

router.get('/attendance', requireModule('personnel'), requirePermission('personnel', 'view'), (req: AuthenticatedRequest, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  const projectId = req.query.projectId ? Number(req.query.projectId) : null;
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (date) {
    where += ' AND a.work_date = ?';
    params.push(date);
  }
  if (projectId) {
    where += ' AND a.project_id = ?';
    params.push(projectId);
  }
  const records = db
    .prepare(
      `SELECT a.*, per.full_name, per.employee_code, per.position, p.name AS project_name
       FROM attendance a
       JOIN personnel per ON per.id = a.personnel_id
       JOIN projects p ON p.id = a.project_id
       ${where}
       ORDER BY a.work_date DESC, per.full_name ASC LIMIT 200`
    )
    .all(...params);
  res.json({ attendance: records });
});

router.post('/attendance', requireModule('personnel'), requirePermission('personnel', 'create'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  if (!b.projectId || !b.personnelId || !b.workDate || !b.status) {
    res.status(400).json({ error: 'Project, personnel, date, and status are required' });
    return;
  }

  if (b.clientIdempotencyKey) {
    const existing = db
      .prepare('SELECT id FROM attendance WHERE client_idempotency_key = ?')
      .get(String(b.clientIdempotencyKey)) as { id: number } | undefined;
    if (existing) {
      res.status(200).json({ id: existing.id, deduplicated: true });
      return;
    }
  }

  const timeIn = b.timeIn || '08:00';
  const timeOut = b.timeOut || '17:00';
  let totalHours = Number(b.totalHours || 0);
  if (!totalHours && b.status !== 'absent' && b.status !== 'on_leave') {
    const [h1, m1] = timeIn.split(':').map(Number);
    const [h2, m2] = timeOut.split(':').map(Number);
    if (!Number.isNaN(h1) && !Number.isNaN(h2)) {
      totalHours = Math.max(0, Number(((h2 * 60 + m2 - (h1 * 60 + m1)) / 60 - 1).toFixed(2)));
    }
  }
  const overtimeHours = Number(b.overtimeHours ?? Math.max(0, totalHours - 8));

  const info = db
    .prepare(
      `INSERT INTO attendance (project_id, personnel_id, work_date, time_in, time_out, status, total_hours, overtime_hours, remarks, recorded_by, client_idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, personnel_id, work_date) DO UPDATE SET
         time_in = excluded.time_in,
         time_out = excluded.time_out,
         status = excluded.status,
         total_hours = excluded.total_hours,
         overtime_hours = excluded.overtime_hours,
         remarks = excluded.remarks,
         updated_by = excluded.recorded_by`
    )
    .run(
      Number(b.projectId),
      Number(b.personnelId),
      b.workDate,
      timeIn,
      timeOut,
      b.status,
      totalHours,
      overtimeHours,
      b.remarks || '',
      req.user!.id,
      b.clientIdempotencyKey || null
    );

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPSERT_ATTENDANCE',
    module: 'personnel',
    recordType: 'attendance',
    recordRef: `ATT-${b.workDate}-${b.personnelId}`,
    newValue: { status: b.status, totalHours, overtimeHours },
    ipAddress: req.ip || '',
  });

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// --- Equipment & Inventory ---
router.get('/equipment', requireModule('equipment'), requirePermission('equipment', 'view'), (_req, res) => {
  const equipment = db
    .prepare(
      `SELECT eq.*, p.name AS project_name, per.full_name AS operator_name
       FROM equipment eq
       LEFT JOIN projects p ON p.id = eq.assigned_project_id
       LEFT JOIN personnel per ON per.id = eq.assigned_operator_id
       ORDER BY eq.id DESC`
    )
    .all();
  const logs = db
    .prepare(
      `SELECT el.*, eq.name AS equipment_name, u.full_name AS logged_by_name
       FROM equipment_logs el
       JOIN equipment eq ON eq.id = el.equipment_id
       JOIN users u ON u.id = el.logged_by
       ORDER BY el.id DESC LIMIT 50`
    )
    .all();
  res.json({ equipment, logs });
});

router.post('/equipment', requireModule('equipment'), requirePermission('equipment', 'create'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  if (!b.equipmentCode || !b.name || !b.type) {
    res.status(400).json({ error: 'Equipment code, name, and type are required' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO equipment (equipment_code, name, type, brand_model, serial_number, ownership_type, current_location, assigned_project_id, condition_status, next_maintenance_date, daily_operating_cost, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.equipmentCode,
      b.name,
      b.type,
      b.brandModel || '',
      b.serialNumber || '',
      b.ownershipType || 'company_owned',
      b.currentLocation || 'Central Yard',
      b.assignedProjectId ? Number(b.assignedProjectId) : null,
      b.conditionStatus || 'operational',
      b.nextMaintenanceDate || null,
      Number(b.dailyOperatingCost || 0),
      b.notes || ''
    );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.post('/equipment/:id/logs', requireModule('equipment'), requirePermission('equipment', 'edit'), (req: AuthenticatedRequest, res) => {
  const eqId = Number(req.params.id);
  const { logType, projectId, hoursLogged, cost, notes, conditionStatus } = req.body || {};
  transaction(() => {
    db.prepare(
      `INSERT INTO equipment_logs (equipment_id, project_id, log_type, hours_logged, cost, notes, logged_by, log_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, date('now'))`
    ).run(eqId, projectId ? Number(projectId) : null, logType || 'maintenance', Number(hoursLogged || 0), Number(cost || 0), notes || '', req.user!.id);

    db.prepare(
      `UPDATE equipment SET
        operating_hours = operating_hours + ?,
        assigned_project_id = CASE WHEN ? IN ('assign','transfer') THEN ? WHEN ? = 'return' THEN NULL ELSE assigned_project_id END,
        condition_status = COALESCE(?, condition_status)
       WHERE id = ?`
    ).run(Number(hoursLogged || 0), logType, projectId ? Number(projectId) : null, logType, conditionStatus ?? null, eqId);
  });
  res.status(201).json({ ok: true });
});

router.get('/inventory', requireModule('equipment'), requirePermission('equipment', 'view'), (_req, res) => {
  const items = db
    .prepare(
      `SELECT i.*, p.name AS project_name
       FROM inventory_items i
       LEFT JOIN projects p ON p.id = i.assigned_project_id
       ORDER BY i.name ASC`
    )
    .all();
  const transactions = db
    .prepare(
      `SELECT it.*, i.name AS item_name, i.sku, p.name AS project_name, u.full_name AS performed_by_name
       FROM inventory_transactions it
       JOIN inventory_items i ON i.id = it.item_id
       LEFT JOIN projects p ON p.id = it.project_id
       JOIN users u ON u.id = it.performed_by
       ORDER BY it.id DESC LIMIT 60`
    )
    .all();
  res.json({ items, transactions });
});

router.post('/inventory', requireModule('equipment'), requirePermission('equipment', 'create'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  if (!b.sku || !b.name || !b.category) {
    res.status(400).json({ error: 'SKU, name, and category are required' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO inventory_items (sku, name, category, description, unit, current_qty, min_stock_level, storage_location, supplier, unit_cost, assigned_project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.sku,
      b.name,
      b.category,
      b.description || '',
      b.unit || 'pcs',
      Number(b.currentQty || 0),
      Number(b.minStockLevel || 10),
      b.storageLocation || 'Central Warehouse',
      b.supplier || '',
      Number(b.unitCost || 0),
      b.assignedProjectId ? Number(b.assignedProjectId) : null
    );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.post('/inventory/:id/transaction', requireModule('equipment'), requirePermission('equipment', 'edit'), (req: AuthenticatedRequest, res) => {
  const itemId = Number(req.params.id);
  const { txType, quantity, projectId, referenceDoc, notes } = req.body || {};
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId) as any;
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }
  const qty = Number(quantity || 0);
  if (qty <= 0) {
    res.status(400).json({ error: 'Positive quantity required' });
    return;
  }

  let delta = qty;
  if (txType === 'issue' || txType === 'transfer') {
    if (item.current_qty < qty) {
      res.status(400).json({ error: 'Insufficient stock for issue/transfer' });
      return;
    }
    delta = -qty;
  }

  transaction(() => {
    db.prepare("UPDATE inventory_items SET current_qty = current_qty + ?, updated_at = datetime('now') WHERE id = ?").run(
      delta,
      itemId
    );
    db.prepare(
      `INSERT INTO inventory_transactions (item_id, project_id, tx_type, quantity, unit_cost, reference_doc, notes, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(itemId, projectId ? Number(projectId) : null, txType || 'receive', qty, item.unit_cost, referenceDoc || '', notes || '', req.user!.id);
  });

  res.status(201).json({ ok: true });
});

// --- Quality Control ---
router.get('/projects/:id/quality', requireModule('quality'), requirePermission('quality', 'view'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const inspections = db
    .prepare(
      `SELECT qi.*, COALESCE(per.full_name, u.full_name) AS inspector_name,
              per.position AS inspector_position, u.full_name AS logged_by_name
       FROM quality_inspections qi
       JOIN users u ON u.id = qi.inspector_id
       LEFT JOIN personnel per ON per.id = qi.reported_by_personnel_id
       WHERE qi.project_id = ?
       ORDER BY qi.inspection_date DESC, qi.id DESC`
    )
    .all(projectId);

  const defects = db
    .prepare(
      `SELECT qd.*, u.full_name AS assigned_to_name, t.ref_number AS linked_task_ref
       FROM quality_defects qd
       LEFT JOIN users u ON u.id = qd.assigned_to
       LEFT JOIN tasks t ON t.id = qd.linked_task_id
       WHERE qd.project_id = ?
       ORDER BY qd.id DESC`
    )
    .all(projectId);

  res.json({ inspections, defects });
});

router.post('/projects/:id/quality', requireModule('quality'), requirePermission('quality', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  const b = req.body || {};
  if (!b.title || !b.inspectionDate) {
    res.status(400).json({ error: 'Inspection title and date are required' });
    return;
  }

  let inspectorId = req.user!.id;
  if (b.inspectorId) {
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(Number(b.inspectorId)) as
      | { id: number }
      | undefined;
    if (u) inspectorId = u.id;
  }

  let reportedByPersonnelId: number | null = b.reportedByPersonnelId ? Number(b.reportedByPersonnelId) : null;
  if (reportedByPersonnelId) {
    const per = db
      .prepare('SELECT id, user_id FROM personnel WHERE id = ?')
      .get(reportedByPersonnelId) as { id: number; user_id: number | null } | undefined;
    if (per) {
      if (!b.inspectorId && per.user_id) inspectorId = per.user_id;
    } else {
      reportedByPersonnelId = null;
    }
  }

  const ref = `QC-${Date.now().toString().slice(-6)}`;
  const info = db
    .prepare(
      `INSERT INTO quality_inspections (ref_number, project_id, title, checklist_json, inspection_date, inspector_id, reported_by_personnel_id, status, defects_summary, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ref,
      projectId,
      b.title,
      JSON.stringify(Array.isArray(b.checklist) ? b.checklist : []),
      b.inspectionDate,
      inspectorId,
      reportedByPersonnelId,
      b.status || 'scheduled',
      b.defectsSummary || '',
      b.remarks || ''
    );
  res.status(201).json({ id: Number(info.lastInsertRowid), refNumber: ref });
});

router.post('/quality/:inspectionId/defects', requireModule('quality'), requirePermission('quality', 'create'), (req: AuthenticatedRequest, res) => {
  const inspectionId = Number(req.params.inspectionId);
  const insp = db.prepare('SELECT project_id FROM quality_inspections WHERE id = ?').get(inspectionId) as
    | { project_id: number }
    | undefined;
  if (!insp || !canAccessProject(req.user!, insp.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const { description, severity, assignedTo, deadline, generateTask } = req.body || {};
  if (!description || !deadline) {
    res.status(400).json({ error: 'Defect description and deadline are required' });
    return;
  }

  const defectId = transaction(() => {
    let linkedTaskId: number | null = null;
    if (generateTask) {
      const tRef = `TSK-QC-${Date.now().toString().slice(-5)}`;
      const tRes = db
        .prepare(
          `INSERT INTO tasks (ref_number, project_id, title, description, assigned_to, supervisor_id, priority, start_date, deadline, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?, 'pending', ?)`
        )
        .run(
          tRef,
          insp.project_id,
          `QC Corrective Action: ${String(description).slice(0, 80)}`,
          String(description),
          assignedTo ? Number(assignedTo) : null,
          req.user!.id,
          severity === 'critical' ? 'critical' : 'high',
          deadline,
          req.user!.id
        );
      linkedTaskId = Number(tRes.lastInsertRowid);
    }

    const dRes = db
      .prepare(
        `INSERT INTO quality_defects (inspection_id, project_id, description, severity, assigned_to, deadline, status, linked_task_id)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
      )
      .run(inspectionId, insp.project_id, description, severity || 'minor', assignedTo ? Number(assignedTo) : null, deadline, linkedTaskId);
    return Number(dRes.lastInsertRowid);
  });

  res.status(201).json({ id: defectId });
});

router.patch('/quality/defects/:defectId', requireModule('quality'), requirePermission('quality', 'edit'), (req: AuthenticatedRequest, res) => {
  const defectId = Number(req.params.defectId);
  const defect = db.prepare('SELECT * FROM quality_defects WHERE id = ?').get(defectId) as any;
  if (!defect || !canAccessProject(req.user!, defect.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  const { status, resolutionNotes } = req.body || {};
  db.prepare(
    `UPDATE quality_defects SET
      status = COALESCE(?, status),
      resolution_notes = COALESCE(?, resolution_notes),
      resolved_at = CASE WHEN ? IN ('resolved','verified') THEN datetime('now') ELSE resolved_at END
     WHERE id = ?`
  ).run(status ?? null, resolutionNotes ?? null, status ?? '', defectId);
  res.json({ ok: true });
});

// --- Project Document Repository ---
router.get('/projects/:id/documents', requireModule('documents'), requirePermission('documents', 'view'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }
  const docs = db
    .prepare(
      `SELECT d.*, u.full_name AS uploaded_by_name
       FROM documents d
       JOIN users u ON u.id = d.uploaded_by
       WHERE d.project_id = ?
       ORDER BY d.created_at DESC, d.id DESC`
    )
    .all(projectId);
  res.json({ documents: docs });
});

router.post(
  '/projects/:id/documents',
  requireModule('documents'),
  requirePermission('documents', 'create'),
  upload.single('file'),
  (req: AuthenticatedRequest, res) => {
    const projectId = Number(req.params.id);
    if (!canAccessProject(req.user!, projectId)) {
      res.status(403).json({ error: 'Project access denied' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Valid file upload is required' });
      return;
    }

    const b = req.body || {};
    const title = String(b.title || req.file.originalname).trim();
    const existing = db
      .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM documents WHERE project_id = ? AND title = ?')
      .get(projectId, title) as { v: number };

    const isClientVisible = b.isClientVisible === 'true' || b.isClientVisible === '1' ? 1 : 0;
    const isConfidential = isClientVisible ? 0 : b.isConfidential === 'false' ? 0 : 1;

    const info = db
      .prepare(
        `INSERT INTO documents (
          project_id, category, folder, title, file_name, stored_path, mime_type, file_size,
          version, description, is_confidential, is_client_visible, phase_name, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        projectId,
        b.category || 'Other project records',
        b.folder || 'General',
        title,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        existing.v + 1,
        b.description || '',
        isConfidential,
        isClientVisible,
        b.phaseName || '',
        req.user!.id
      );

    logAudit({
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'UPLOAD_DOCUMENT',
      module: 'documents',
      recordType: 'document',
      recordRef: `DOC-${Number(info.lastInsertRowid)}`,
      newValue: { title, version: existing.v + 1, isConfidential, isClientVisible },
      ipAddress: req.ip || '',
    });

    res.status(201).json({ id: Number(info.lastInsertRowid), version: existing.v + 1 });
  }
);

router.delete('/documents/:id', requireModule('documents'), requirePermission('documents', 'delete'), (req: AuthenticatedRequest, res) => {
  const docId = Number(req.params.id);
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as any;
  if (!doc || !canAccessProject(req.user!, doc.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
  if (!String(doc.stored_path).startsWith('seeded://')) {
    const target = path.resolve(UPLOADS_DIR, path.basename(doc.stored_path));
    if (target.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'DELETE_DOCUMENT',
    module: 'documents',
    recordType: 'document',
    recordRef: `DOC-${docId}`,
    previousValue: { title: doc.title, file_name: doc.file_name },
    ipAddress: req.ip || '',
  });
  res.json({ ok: true });
});

// --- Communications, Notifications & Sync Polling ---
router.get('/projects/:id/messages', requireModule('communications'), requirePermission('communications', 'view'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  const messages = db
    .prepare(
      `SELECT m.*, u.full_name AS sender_name, r.name AS sender_role
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       JOIN roles r ON r.id = u.role_id
       WHERE m.project_id = ?
       ORDER BY m.id DESC`
    )
    .all(projectId);
  res.json({ messages });
});

router.post('/projects/:id/messages', requireModule('communications'), requirePermission('communications', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  const { channel, subject, body, isAnnouncement } = req.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) {
    res.status(400).json({ error: 'Message body is required' });
    return;
  }
  const safeChannel = channel === 'client' ? 'client' : 'internal';
  const info = db
    .prepare(
      'INSERT INTO messages (project_id, channel, sender_id, subject, body, is_announcement) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(projectId, safeChannel, req.user!.id, subject || '', body.trim(), isAnnouncement ? 1 : 0);

  emitSyncEvent({
    eventType: 'message:new',
    module: 'communications',
    projectId,
    clientVisible: safeChannel === 'client',
    payload: { id: Number(info.lastInsertRowid), channel: safeChannel },
  });

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.get('/notifications', (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40')
    .all(req.user!.id);
  res.json({ notifications: rows });
});

router.patch('/notifications/:id/read', (req: AuthenticatedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.user!.id
  );
  res.json({ ok: true });
});

router.get('/sync/events', (req: AuthenticatedRequest, res) => {
  const since = Number(req.query.since || 0);
  const events = db
    .prepare('SELECT * FROM sync_events WHERE id > ? ORDER BY id ASC LIMIT 100')
    .all(since) as any[];
  const filtered = events.filter((e) => {
    if (req.user!.is_client_role && !e.client_only) return false;
    if (e.project_id && !canAccessProject(req.user!, e.project_id)) return false;
    return true;
  });
  res.json({ events: filtered });
});

// --- Client Revision Request Internal Workflow ---
router.get('/revisions', requireModule('client_portal'), requirePermission('projects', 'view'), (req: AuthenticatedRequest, res) => {
  const access = getAccessibleProjectIds(req.user!);
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (access !== 'ALL') {
    if (access.length === 0) {
      res.json({ revisions: [] });
      return;
    }
    where += ` AND cr.project_id IN (${access.map(() => '?').join(',')})`;
    params.push(...access);
  }
  const revisions = db
    .prepare(
      `SELECT cr.*, p.name AS project_name, p.ref_number AS project_ref, u.full_name AS client_name
       FROM client_revision_requests cr
       JOIN projects p ON p.id = cr.project_id
       JOIN users u ON u.id = cr.client_user_id
       ${where}
       ORDER BY cr.id DESC`
    )
    .all(...params) as any[];

  const history = db
    .prepare(
      `SELECT crh.*, u.full_name AS actor_name
       FROM client_revision_history crh
       JOIN users u ON u.id = crh.actor_id
       ORDER BY crh.id ASC`
    )
    .all() as any[];

  res.json({
    revisions: revisions.map((r) => ({
      ...r,
      history: history.filter((h) => h.request_id === r.id),
    })),
  });
});

router.patch('/revisions/:id/workflow', requireModule('client_portal'), requirePermission('projects', 'edit'), (req: AuthenticatedRequest, res) => {
  const revId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM client_revision_requests WHERE id = ?').get(revId) as any;
  if (!existing || !canAccessProject(req.user!, existing.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const { status, technicalNotes, costImpact, scheduleImpactDays, changeOrderRef, remarks } = req.body || {};
  const validStatuses = [
    'submitted',
    'received',
    'under_technical_review',
    'under_cost_evaluation',
    'awaiting_management_approval',
    'approved',
    'rejected',
    'awaiting_client_confirmation',
    'in_progress',
    'completed',
    'cancelled',
  ];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid revision status' });
    return;
  }

  // Note: Updating a revision request NEVER automatically modifies projects.contract_amount, approved_budget, or schedules!
  transaction(() => {
    db.prepare(
      `UPDATE client_revision_requests SET
        status = ?,
        technical_notes = COALESCE(?, technical_notes),
        cost_impact = COALESCE(?, cost_impact),
        schedule_impact_days = COALESCE(?, schedule_impact_days),
        change_order_ref = COALESCE(?, change_order_ref),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      status,
      technicalNotes ?? null,
      costImpact !== undefined && costImpact !== '' ? Number(costImpact) : null,
      scheduleImpactDays !== undefined && scheduleImpactDays !== '' ? Number(scheduleImpactDays) : null,
      changeOrderRef ?? null,
      revId
    );

    db.prepare(
      'INSERT INTO client_revision_history (request_id, actor_id, previous_status, new_status, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(revId, req.user!.id, existing.status, status, remarks || `Status updated to ${status}`);
  });

  createNotification({
    userId: existing.client_user_id,
    projectId: existing.project_id,
    type: 'revision_update',
    title: `Revision Request ${existing.ref_number}: ${status.replace(/_/g, ' ')}`,
    body: remarks || 'Your revision request status has been updated.',
    linkSection: 'revisions',
  });

  emitSyncEvent({
    eventType: 'revision:updated',
    module: 'client_portal',
    projectId: existing.project_id,
    clientVisible: true,
    payload: { id: revId, status },
  });

  res.json({ ok: true });
});

export default router;
