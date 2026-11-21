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

  const expenses = db
    .prepare(
      `SELECT e.*, sub.full_name AS submitted_by_name, app.full_name AS approved_by_name,
              pr.ref_number AS pr_ref, cr.ref_number AS cr_ref, cr.description AS cr_description,
              COALESCE(NULLIF(e.custodian_name, ''), cr.custodian_name, '') AS resolved_custodian_name
       FROM expenses e
       JOIN users sub ON sub.id = e.submitted_by
       LEFT JOIN users app ON app.id = e.approved_by
       LEFT JOIN purchase_requests pr ON pr.id = e.pr_id
       LEFT JOIN cash_requests cr ON cr.id = e.cash_request_id
       WHERE e.project_id = ?
       ORDER BY e.expense_date DESC, e.id DESC`
    )
    .all(projectId) as any[];

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
              COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.cash_request_id = cr.id AND e.status != 'rejected'), 0) AS liquidated_total,
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
    if (cname && ex.status !== 'rejected') custodianNames.add(cname);
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
        if (ex.status === 'rejected') continue;
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

router.post('/projects/:id/expenses', requireModule('financials'), requirePermission('financials', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const b = req.body || {};
  if (!b.expenseDate || !b.category || !b.description || !b.amount || !b.supplierRecipient) {
    res.status(400).json({ error: 'Date, category, description, amount, and supplier/recipient are required' });
    return;
  }

  if (b.clientIdempotencyKey) {
    const existing = db
      .prepare('SELECT id FROM expenses WHERE client_idempotency_key = ?')
      .get(String(b.clientIdempotencyKey)) as { id: number } | undefined;
    if (existing) {
      res.status(200).json({ id: existing.id, deduplicated: true });
      return;
    }
  }

  let cashRequestId: number | null = b.cashRequestId ? Number(b.cashRequestId) : null;
  let custodianName = String(b.custodianName || '').trim();
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

  const refNum = `EXP-${Date.now().toString().slice(-6)}`;
  const info = db
    .prepare(
      `INSERT INTO expenses (
        ref_number, project_id, expense_date, category, description, amount,
        supplier_recipient, payment_method, task_id, pr_id, cash_request_id, custodian_name,
        submitted_by, status, remarks, client_idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(
      refNum,
      projectId,
      b.expenseDate,
      b.category,
      String(b.description).trim(),
      Number(b.amount),
      String(b.supplierRecipient).trim(),
      b.paymentMethod || 'Bank Transfer',
      b.taskId ? Number(b.taskId) : null,
      b.prId ? Number(b.prId) : null,
      cashRequestId,
      custodianName,
      req.user!.id,
      b.remarks || '',
      b.clientIdempotencyKey || null
    );

  emitSyncEvent({
    eventType: 'expense:submitted',
    module: 'financials',
    projectId,
    payload: { id: Number(info.lastInsertRowid), refNumber: refNum },
  });

  res.status(201).json({ id: Number(info.lastInsertRowid), refNumber: refNum });
});

router.patch('/expenses/:id/decision', requireModule('financials'), requirePermission('financials', 'approve'), (req: AuthenticatedRequest, res) => {
  const expenseId = Number(req.params.id);
  const { decision, remarks } = req.body || {};
  if (!['approved', 'rejected', 'correction_needed'].includes(decision)) {
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

  transaction(() => {
    db.prepare('UPDATE expenses SET status = ?, approved_by = ?, remarks = COALESCE(?, remarks) WHERE id = ?').run(
      decision,
      req.user!.id,
      remarks ?? null,
      expenseId
    );

    // Avoid double-counting: settle corresponding PR commitment when linked expense is approved
    if (decision === 'approved' && exp.status !== 'approved' && exp.pr_id) {
      db.prepare(
        `UPDATE purchase_requests
         SET settled_amount = MIN(commitment_amount, settled_amount + ?),
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(Number(exp.amount), exp.pr_id);
    }
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: `EXPENSE_${decision.toUpperCase()}`,
    module: 'financials',
    recordType: 'expense',
    recordRef: exp.ref_number,
    previousValue: { status: exp.status },
    newValue: { status: decision, amount: exp.amount, pr_id: exp.pr_id },
    ipAddress: req.ip || '',
  });

  emitSyncEvent({
    eventType: 'expense:decided',
    module: 'financials',
    projectId: exp.project_id,
    payload: { id: expenseId, status: decision },
  });

  res.json({ ok: true, status: decision });
});

// --- Purchase Requests & Procurement ---
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
      `SELECT pr.*, p.name AS project_name, p.ref_number AS project_ref, u.full_name AS requested_by_name
       FROM purchase_requests pr
       JOIN projects p ON p.id = pr.project_id
       JOIN users u ON u.id = pr.requested_by
       ${whereSql}
       ORDER BY pr.id DESC`
    )
    .all(...params) as any[];

  const approvals = db
    .prepare(
      `SELECT pra.*, u.full_name AS approver_name
       FROM purchase_request_approvals pra
       JOIN users u ON u.id = pra.approver_id
       ORDER BY pra.id ASC`
    )
    .all() as any[];

  const pos = db.prepare('SELECT * FROM purchase_orders ORDER BY id DESC').all();

  res.json({
    purchaseRequests: prs.map((pr) => ({
      ...pr,
      approvals: approvals.filter((a) => a.pr_id === pr.id),
    })),
    purchaseOrders: pos,
  });
});

router.post('/projects/:id/purchase-requests', requireModule('procurement'), requirePermission('procurement', 'create'), (req: AuthenticatedRequest, res) => {
  const projectId = Number(req.params.id);
  if (!canAccessProject(req.user!, projectId)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const b = req.body || {};
  if (!b.itemDescription || !b.quantity || !b.requiredDate) {
    res.status(400).json({ error: 'Item description, quantity, and required date are required' });
    return;
  }

  const qty = Number(b.quantity);
  const unitCost = Number(b.estimatedUnitCost || 0);
  const totalCost = Number((qty * unitCost).toFixed(2));
  const refNum = `PR-${Date.now().toString().slice(-6)}`;

  const info = db
    .prepare(
      `INSERT INTO purchase_requests (
        ref_number, project_id, requested_by, task_id, request_date, required_date,
        item_description, category, quantity, unit, estimated_unit_cost, estimated_total_cost,
        suggested_supplier, reason, remarks, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      refNum,
      projectId,
      req.user!.id,
      b.taskId ? Number(b.taskId) : null,
      b.requestDate || new Date().toISOString().slice(0, 10),
      b.requiredDate,
      String(b.itemDescription).trim(),
      b.category || 'Materials',
      qty,
      b.unit || 'pcs',
      unitCost,
      totalCost,
      b.suggestedSupplier || '',
      b.reason || '',
      b.remarks || '',
      b.saveAsDraft ? 'draft' : 'submitted'
    );

  emitSyncEvent({
    eventType: 'pr:created',
    module: 'procurement',
    projectId,
    payload: { id: Number(info.lastInsertRowid), refNumber: refNum },
  });

  res.status(201).json({ id: Number(info.lastInsertRowid), refNumber: refNum });
});

router.patch('/purchase-requests/:id/workflow', requireModule('procurement'), requirePermission('procurement', 'review'), (req: AuthenticatedRequest, res) => {
  const prId = Number(req.params.id);
  const { status, stage, remarks } = req.body || {};
  const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(prId) as any;
  if (!pr) {
    res.status(404).json({ error: 'Purchase request not found' });
    return;
  }
  if (!canAccessProject(req.user!, pr.project_id)) {
    res.status(403).json({ error: 'Project access denied' });
    return;
  }

  const allowed = ['submitted', 'under_review', 'endorsed', 'approved', 'rejected', 'for_procurement', 'ordered', 'cancelled'];
  if (!allowed.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  if (status === 'approved' && !hasPermission(req.user!, 'procurement', 'approve')) {
    res.status(403).json({ error: 'Approval permission required' });
    return;
  }

  transaction(() => {
    // Approved PR creates financial commitment without becoming actual expense!
    const commitment =
      status === 'approved' || status === 'for_procurement' || status === 'ordered'
        ? Math.max(pr.commitment_amount, pr.estimated_total_cost)
        : status === 'rejected' || status === 'cancelled'
        ? 0
        : pr.commitment_amount;

    db.prepare(
      "UPDATE purchase_requests SET status = ?, commitment_amount = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, commitment, prId);

    db.prepare(
      'INSERT INTO purchase_request_approvals (pr_id, approver_id, stage, decision, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(prId, req.user!.id, stage || req.user!.role_name, status, remarks || '');

    if (status === 'ordered') {
      const existingPo = db.prepare('SELECT id FROM purchase_orders WHERE pr_id = ?').get(prId);
      if (!existingPo) {
        db.prepare(
          `INSERT INTO purchase_orders (po_number, pr_id, project_id, supplier_name, approved_qty, ordered_qty, actual_unit_cost, actual_total_cost, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ordered')`
        ).run(
          `PO-${Date.now().toString().slice(-6)}`,
          prId,
          pr.project_id,
          pr.suggested_supplier || 'Designated Supplier',
          pr.quantity,
          pr.quantity,
          pr.estimated_unit_cost,
          pr.estimated_total_cost
        );
      }
    }
  });

  createNotification({
    userId: pr.requested_by,
    projectId: pr.project_id,
    type: 'pr_decision',
    title: `${pr.ref_number} is now ${status}`,
    body: remarks || `Purchase request moved to ${status}.`,
    linkSection: 'procurement',
  });

  emitSyncEvent({
    eventType: 'pr:updated',
    module: 'procurement',
    projectId: pr.project_id,
    payload: { id: prId, status },
  });

  res.json({ ok: true, status });
});

router.post('/purchase-requests/:id/receive', requireModule('procurement'), requirePermission('procurement', 'edit'), (req: AuthenticatedRequest, res) => {
  const prId = Number(req.params.id);
  const { deliveredQty, actualUnitCost, recordExpense } = req.body || {};
  const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(prId) as any;
  if (!pr || !canAccessProject(req.user!, pr.project_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const qty = Number(deliveredQty || 0);
  const unitCost = Number(actualUnitCost || pr.estimated_unit_cost);
  const actualCost = Number((qty * unitCost).toFixed(2));

  transaction(() => {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE pr_id = ?').get(prId) as any;
    const prevDelivered = po ? Number(po.delivered_qty) : 0;
    const newDelivered = prevDelivered + qty;
    const fullyDelivered = newDelivered >= pr.quantity;
    const nextStatus = fullyDelivered ? 'delivered' : 'partially_delivered';

    if (po) {
      db.prepare(
        `UPDATE purchase_orders SET
          delivered_qty = ?,
          actual_unit_cost = ?,
          actual_total_cost = actual_total_cost + ?,
          delivery_date = date('now'),
          receiving_confirmed_by = ?,
          status = ?
         WHERE id = ?`
      ).run(newDelivered, unitCost, actualCost, req.user!.id, nextStatus, po.id);
    } else {
      db.prepare(
        `INSERT INTO purchase_orders (po_number, pr_id, project_id, supplier_name, approved_qty, ordered_qty, delivered_qty, actual_unit_cost, actual_total_cost, delivery_date, receiving_confirmed_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), ?, ?)`
      ).run(
        `PO-${Date.now().toString().slice(-6)}`,
        prId,
        pr.project_id,
        pr.suggested_supplier || 'Supplier',
        pr.quantity,
        pr.quantity,
        newDelivered,
        unitCost,
        actualCost,
        req.user!.id,
        nextStatus
      );
    }

    db.prepare("UPDATE purchase_requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(nextStatus, prId);

    if (recordExpense && actualCost > 0) {
      db.prepare(
        `INSERT INTO expenses (ref_number, project_id, expense_date, category, description, amount, supplier_recipient, payment_method, pr_id, submitted_by, approved_by, status, remarks)
         VALUES (?, ?, date('now'), ?, ?, ?, ?, 'Bank Transfer', ?, ?, ?, 'approved', 'Auto-settled from PO receiving')`
      ).run(
        `EXP-${Date.now().toString().slice(-6)}`,
        pr.project_id,
        pr.category || 'Materials',
        `Receiving settlement: ${pr.item_description} (${qty} ${pr.unit})`,
        actualCost,
        pr.suggested_supplier || 'Supplier',
        prId,
        req.user!.id,
        req.user!.id
      );

      db.prepare(
        'UPDATE purchase_requests SET settled_amount = MIN(commitment_amount, settled_amount + ?) WHERE id = ?'
      ).run(actualCost, prId);
    }
  });

  emitSyncEvent({
    eventType: 'procurement:received',
    module: 'procurement',
    projectId: pr.project_id,
    payload: { prId, deliveredQty: qty },
  });

  res.json({ ok: true });
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

// --- Phase 6 Quotations Foundation ---
router.get('/quotations', requireModule('quotations'), requirePermission('quotations', 'view'), (_req, res) => {
  const quotes = db
    .prepare(
      `SELECT q.*, c.company_name AS client_name, u.full_name AS prepared_by_name, p.ref_number AS converted_project_ref
       FROM quotations q
       JOIN clients c ON c.id = q.client_id
       LEFT JOIN users u ON u.id = q.prepared_by
       LEFT JOIN projects p ON p.id = q.project_id
       ORDER BY q.id DESC`
    )
    .all();
  res.json({ quotations: quotes });
});

router.post('/quotations', requireModule('quotations'), requirePermission('quotations', 'create'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  if (!b.clientId || !b.title || !b.validityDate) {
    res.status(400).json({ error: 'Client, title, and validity date are required' });
    return;
  }
  const quoteNum = `QT-${Date.now().toString().slice(-6)}`;
  const info = db
    .prepare(
      `INSERT INTO quotations (quote_number, client_id, title, location, scope, validity_date, status, notes, prepared_by)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    )
    .run(quoteNum, Number(b.clientId), b.title, b.location || '', b.scope || '', b.validityDate, b.notes || 'Awaiting company Excel estimating workbook integration.', req.user!.id);
  res.status(201).json({ id: Number(info.lastInsertRowid), quoteNumber: quoteNum });
});

router.post('/quotations/:id/convert-to-project', requireModule('quotations'), requirePermission('quotations', 'approve'), (req: AuthenticatedRequest, res) => {
  const quoteId = Number(req.params.id);
  const { overrideReason } = req.body || {};
  const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId) as any;
  if (!quote) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }
  if (quote.project_id) {
    res.status(409).json({ error: 'Quotation has already been converted to a project' });
    return;
  }
  if (!['approved', 'accepted'].includes(quote.status) && !overrideReason) {
    res.status(400).json({ error: 'Only approved/accepted quotations may convert without an authorized override reason' });
    return;
  }

  const projectId = transaction(() => {
    const ref = `PRJ-QT-${Date.now().toString().slice(-5)}`;
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
    const pRes = db
      .prepare(
        `INSERT INTO projects (ref_number, name, client_id, location, scope, contract_amount, approved_budget, revised_budget, project_manager_id, start_date, original_end_date, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(ref, quote.title, quote.client_id, quote.location || 'TBD', quote.scope || '', quote.total_amount, quote.direct_cost, quote.direct_cost, req.user!.id, today, end, req.user!.id);
    const pid = Number(pRes.lastInsertRowid);
    db.prepare('UPDATE quotations SET project_id = ?, status = ? WHERE id = ?').run(pid, 'accepted', quoteId);
    return pid;
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CONVERT_QUOTATION_TO_PROJECT',
    module: 'quotations',
    recordType: 'quotation',
    recordRef: quote.quote_number,
    newValue: { projectId, overrideReason: overrideReason || null },
    ipAddress: req.ip || '',
  });

  res.status(201).json({ projectId });
});

export default router;
