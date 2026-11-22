import { Router } from 'express';
import {
  type AuthenticatedRequest,
  hasPermission,
  logAudit,
  requireAuth,
  requireInternalUser,
  requireModule,
  requirePermission,
} from '../auth.ts';
import { db, transaction } from '../db.ts';
import { createNotification, emitSyncEvent } from '../realtime.ts';
import {
  buildDefaultScopeSubject,
  recalculateRevision,
  runReferenceReconciliation,
  sanitizeRevisionForUser,
  type QuotationItemInput,
  type QuotationSectionInput,
  type ScopeOptions,
} from '../quotationEngine.ts';
import { DEFAULT_SCOPE_OPTIONS, DEFAULT_TERMS, ensureQuotationReferenceData } from '../quotationSeed.ts';

const router = Router();
router.use(requireAuth, requireInternalUser, requireModule('quotations'));

function csvSafeCell(v: unknown): string {
  const s = String(v ?? '');
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function getSettingsRow(): any {
  ensureQuotationReferenceData();
  return db.prepare('SELECT * FROM quotation_settings WHERE id = 1').get();
}

function generateNextQuotationNumber(): string {
  const settings = getSettingsRow();
  let seq = Number(settings.next_seq || 1998068);
  const prefix = String(settings.prefix || 'RCC').toUpperCase();
  const year = String(settings.year_code || new Date().getFullYear().toString().slice(-2));
  const docType = String(settings.doc_type || 'CONS').toUpperCase();

  let candidate = `${prefix}${year}-${seq}-${docType}`;
  while (db.prepare('SELECT 1 FROM quotations WHERE quote_number = ?').get(candidate)) {
    seq += 1;
    candidate = `${prefix}${year}-${seq}-${docType}`;
  }
  db.prepare('UPDATE quotation_settings SET next_seq = ? WHERE id = 1').run(seq + 1);
  return candidate;
}

function loadRevisionHydrated(revisionId: number) {
  const rev = db
    .prepare(
      `SELECT qr.*, u1.full_name AS prepared_by_name, u2.full_name AS reviewed_by_name, u3.full_name AS approved_by_name
       FROM quotation_revisions qr
       LEFT JOIN users u1 ON u1.id = qr.prepared_by
       LEFT JOIN users u2 ON u2.id = qr.reviewed_by
       LEFT JOIN users u3 ON u3.id = qr.approved_by
       WHERE qr.id = ?`
    )
    .get(revisionId) as any;
  if (!rev) return null;

  const rawSections = db
    .prepare('SELECT * FROM quotation_sections WHERE revision_id = ? ORDER BY sort_order ASC, id ASC')
    .all(revisionId) as any[];
  const items = db
    .prepare('SELECT * FROM quotation_items WHERE revision_id = ? ORDER BY sort_order ASC, id ASC')
    .all(revisionId) as any[];

  const sections = rawSections.map((s) => {
    const visibleItems = items.filter(
      (i) => i.section_id === s.id && i.row_type === 'item' && i.visibility_mode === 'visible'
    );
    const matCostSubtotal = Math.round(visibleItems.reduce((acc, i) => acc + Number(i.extended_mat_cost || 0), 0) * 100) / 100;
    const lbrCostSubtotal = Math.round(visibleItems.reduce((acc, i) => acc + Number(i.extended_lbr_cost || 0), 0) * 100) / 100;
    const totalDirectCost = Math.round((matCostSubtotal + lbrCostSubtotal) * 100) / 100;
    const matSellSubtotal = Math.round(visibleItems.reduce((acc, i) => acc + Number(i.extended_mat_sell || 0), 0) * 100) / 100;
    const lbrSellSubtotal = Math.round(visibleItems.reduce((acc, i) => acc + Number(i.extended_lbr_sell || 0), 0) * 100) / 100;
    const totalSellingSubtotal = Math.round(visibleItems.reduce((acc, i) => acc + Number(i.extended_selling || 0), 0) * 100) / 100;
    const grossProfitAmount = Math.round((totalSellingSubtotal - totalDirectCost) * 100) / 100;
    const grossProfitPct = totalSellingSubtotal > 0 ? Math.round((grossProfitAmount / totalSellingSubtotal) * 10000) / 100 : 0;

    return {
      ...s,
      mat_cost_subtotal: matCostSubtotal,
      lbr_cost_subtotal: lbrCostSubtotal,
      total_direct_cost: totalDirectCost,
      mat_sell_subtotal: matSellSubtotal,
      lbr_sell_subtotal: lbrSellSubtotal,
      total_selling_subtotal: totalSellingSubtotal,
      gross_profit_amount: grossProfitAmount,
      gross_profit_pct: grossProfitPct,
    };
  });

  let scopeOptions = DEFAULT_SCOPE_OPTIONS;
  let terms = DEFAULT_TERMS;
  let notes: string[] = [];
  try {
    scopeOptions = { ...DEFAULT_SCOPE_OPTIONS, ...JSON.parse(rev.scope_options_json || '{}') };
  } catch { /* ignore */ }
  try {
    terms = { ...DEFAULT_TERMS, ...JSON.parse(rev.terms_json || '{}') };
  } catch { /* ignore */ }
  try {
    notes = JSON.parse(rev.notes_json || '[]');
  } catch { /* ignore */ }

  return {
    ...rev,
    scope_options: scopeOptions,
    terms,
    notes,
    sections,
    items,
  };
}

function hydrateLegacyOrEmptyQuotation(quotationId: number) {
  const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quotationId) as any;
  if (!quote || quote.current_revision_id) return quote?.current_revision_id || null;

  return transaction(() => {
    const revRes = db
      .prepare(
        `INSERT INTO quotation_revisions (
          quotation_id, revision_code, status, subject, site_location,
          vat_rate, discount_pct, scope_options_json, terms_json, notes_json,
          total_direct_cost, total_selling_pre_vat, final_amount, prepared_by
        ) VALUES (?, 'REV00', ?, ?, ?, 12, 0, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        quote.id,
        quote.status || 'draft',
        quote.subject || quote.title,
        quote.location || '',
        JSON.stringify(DEFAULT_SCOPE_OPTIONS),
        JSON.stringify(DEFAULT_TERMS),
        JSON.stringify([quote.scope || 'Construction works']),
        Number(quote.direct_cost || 0),
        Number(quote.total_amount || 0),
        Number(quote.total_amount || 0),
        quote.prepared_by || null
      );
    const revId = Number(revRes.lastInsertRowid);

    const secA = db.prepare("INSERT INTO quotation_sections (revision_id, code, title, sort_order) VALUES (?, 'A', 'GENERAL REQUIREMENTS', 1)").run(revId);
    const secB = db.prepare("INSERT INTO quotation_sections (revision_id, code, title, sort_order) VALUES (?, 'B', 'GENERAL ITEMS', 2)").run(revId);
    const secC = db.prepare("INSERT INTO quotation_sections (revision_id, code, title, sort_order) VALUES (?, 'C', 'COMMERCIAL FIXTURES', 3)").run(revId);
    void secA; void secC;

    if (Number(quote.total_amount || 0) > 0 || Number(quote.direct_cost || 0) > 0) {
      db.prepare(
        `INSERT INTO quotation_items (
          revision_id, section_id, row_type, line_no, item_code, description, qty, unit,
          mat_unit_cost, lbr_unit_cost, mat_sell_rate, combined_unit_rate, extended_selling, extended_cost
        ) VALUES (?, ?, 'item', '1', 'GEN-01', ?, 1, 'lot', ?, 0, ?, ?, ?, ?)`
      ).run(
        revId,
        Number(secB.lastInsertRowid),
        quote.scope || quote.title,
        Number(quote.direct_cost || 0),
        Number(quote.total_amount || 0),
        Number(quote.total_amount || 0),
        Number(quote.total_amount || 0),
        Number(quote.direct_cost || 0)
      );
    }

    db.prepare('UPDATE quotations SET current_revision_id = ?, current_revision_code = ? WHERE id = ?').run(revId, 'REV00', quote.id);
    return revId;
  });
}

// 1. Dashboard & Directory
router.get('/quotations/dashboard', requirePermission('quotations', 'view'), (req: AuthenticatedRequest, res) => {
  ensureQuotationReferenceData();
  const canViewCosting =
    req.user!.role_slug === 'system_admin' || hasPermission(req.user!, 'quotations', 'view_internal_costing');

  const { status, search, clientId, preparerId, dateFrom, dateTo } = req.query;
  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  if (status && status !== 'all') {
    where.push('q.status = ?');
    params.push(String(status));
  }
  if (clientId) {
    where.push('q.client_id = ?');
    params.push(Number(clientId));
  }
  if (preparerId) {
    where.push('q.prepared_by = ?');
    params.push(Number(preparerId));
  }
  if (dateFrom) {
    where.push('date(q.created_at) >= date(?)');
    params.push(String(dateFrom));
  }
  if (dateTo) {
    where.push('date(q.created_at) <= date(?)');
    params.push(String(dateTo));
  }
  if (search) {
    const like = `%${String(search).trim()}%`;
    where.push('(q.quote_number LIKE ? OR q.title LIKE ? OR q.subject LIKE ? OR c.company_name LIKE ? OR q.site_location LIKE ?)');
    params.push(like, like, like, like, like);
  }

  const rows = db
    .prepare(
      `SELECT q.id, q.quote_number, q.current_revision_id, q.current_revision_code, q.client_id, q.project_id,
              q.title, q.subject, q.location, q.site_location, q.province, q.municipality,
              q.validity_date, q.status, q.currency, q.vat_rate, q.discount_pct, q.discount_amount,
              q.subtotal_pre_vat, q.vat_amount, q.final_amount, q.total_amount,
              q.estimated_manpower, q.estimated_duration_days, q.revision_count,
              q.prepared_by, q.approved_by, q.sent_at, q.accepted_at, q.converted_at, q.created_at,
              ${canViewCosting ? 'q.direct_cost, qr.gross_profit_amount, qr.gross_profit_pct,' : ''}
              c.company_name AS client_name, u.full_name AS prepared_by_name, p.ref_number AS converted_project_ref
       FROM quotations q
       JOIN clients c ON c.id = q.client_id
       LEFT JOIN users u ON u.id = q.prepared_by
       LEFT JOIN projects p ON p.id = q.project_id
       LEFT JOIN quotation_revisions qr ON qr.id = q.current_revision_id
       WHERE ${where.join(' AND ')}
       ORDER BY q.id DESC`
    )
    .all(...params) as any[];

  const allQuotes = db
    .prepare(
      `SELECT q.status, q.final_amount, q.total_amount, q.direct_cost, q.project_id, strftime('%Y-%m', q.created_at) AS month
       FROM quotations q`
    )
    .all() as any[];

  const countBy = (st: string) => allQuotes.filter((x) => x.status === st).length;
  const totalQuotes = allQuotes.length;
  const acceptedQuotes = allQuotes.filter((x) => x.status === 'accepted' || x.project_id);
  const resolvedValue = (x: any) => Number(x.final_amount || x.total_amount || 0);

  const totalQuotationValue = Math.round(allQuotes.reduce((s, x) => s + resolvedValue(x), 0) * 100) / 100;
  const acceptedValue = Math.round(acceptedQuotes.reduce((s, x) => s + resolvedValue(x), 0) * 100) / 100;
  const convertedCount = allQuotes.filter((x) => Boolean(x.project_id)).length;
  const decidedCount = allQuotes.filter((x) => ['accepted', 'declined'].includes(x.status) || x.project_id).length;

  const monthlyMap = new Map<string, { month: string; count: number; totalValue: number; acceptedValue: number }>();
  for (const q of allQuotes) {
    const m = q.month || new Date().toISOString().slice(0, 7);
    const cur = monthlyMap.get(m) || { month: m, count: 0, totalValue: 0, acceptedValue: 0 };
    cur.count += 1;
    cur.totalValue = Math.round((cur.totalValue + resolvedValue(q)) * 100) / 100;
    if (q.status === 'accepted' || q.project_id) {
      cur.acceptedValue = Math.round((cur.acceptedValue + resolvedValue(q)) * 100) / 100;
    }
    monthlyMap.set(m, cur);
  }

  const kpis: Record<string, unknown> = {
    totalQuotations: totalQuotes,
    draft: countBy('draft'),
    forReview: countBy('for_review'),
    forApproval: countBy('for_approval'),
    approved: countBy('approved'),
    sentToClient: countBy('sent_to_client'),
    accepted: acceptedQuotes.length,
    declined: countBy('declined'),
    expired: countBy('expired'),
    convertedCount,
    totalQuotationValue,
    acceptedValue,
    averageQuotationValue: totalQuotes > 0 ? Math.round((totalQuotationValue / totalQuotes) * 100) / 100 : 0,
    conversionRate: decidedCount > 0 ? Math.round((acceptedQuotes.length / decidedCount) * 1000) / 10 : 0,
  };

  if (canViewCosting) {
    const totalDirectCost = Math.round(allQuotes.reduce((s, x) => s + Number(x.direct_cost || 0), 0) * 100) / 100;
    kpis.totalDirectCost = totalDirectCost;
    kpis.estimatedGrossProfit = Math.round((totalQuotationValue / 1.12 - totalDirectCost) * 100) / 100;
  }

  res.json({
    quotations: rows,
    kpis,
    monthlySeries: Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
    canViewInternalCosting: canViewCosting,
  });
});

// Compatibility list endpoint
router.get('/quotations', requirePermission('quotations', 'view'), (req: AuthenticatedRequest, res) => {
  ensureQuotationReferenceData();
  const canViewCosting =
    req.user!.role_slug === 'system_admin' || hasPermission(req.user!, 'quotations', 'view_internal_costing');

  const quotes = db
    .prepare(
      `SELECT q.id, q.quote_number, q.current_revision_code, q.client_id, q.project_id,
              q.title, q.subject, q.site_location, q.validity_date, q.status, q.currency,
              q.final_amount, q.total_amount, q.subtotal_pre_vat, q.vat_amount,
              ${canViewCosting ? 'q.direct_cost,' : ''}
              c.company_name AS client_name, u.full_name AS prepared_by_name, p.ref_number AS converted_project_ref
       FROM quotations q
       JOIN clients c ON c.id = q.client_id
       LEFT JOIN users u ON u.id = q.prepared_by
       LEFT JOIN projects p ON p.id = q.project_id
       ORDER BY q.id DESC`
    )
    .all();
  res.json({ quotations: quotes, canViewInternalCosting: canViewCosting });
});

// 2. Reference Workbook Reconciliation Verification Endpoint
router.get('/quotations/reference/reconciliation', requirePermission('quotations', 'view'), (_req, res) => {
  const report = runReferenceReconciliation();
  res.json(report);
});

// 3. Catalog, General Requirements, Units, Categories, Price History, Locations, Settings
router.get('/quotations/catalog/meta', requirePermission('quotations', 'view'), (_req, res) => {
  ensureQuotationReferenceData();
  const units = db.prepare('SELECT * FROM quotation_units WHERE is_active = 1 ORDER BY code ASC').all();
  const categories = db.prepare('SELECT * FROM quotation_categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC').all();
  const locations = db.prepare('SELECT * FROM ph_locations ORDER BY province ASC, municipality ASC').all();
  const clients = db.prepare('SELECT id, company_name, primary_contact, representative_title, email, phone, address FROM clients ORDER BY company_name ASC').all();
  const settings = getSettingsRow();
  res.json({ units, categories, locations, clients, settings });
});

router.get('/quotations/catalog/items', requirePermission('quotations', 'view'), (req: AuthenticatedRequest, res) => {
  ensureQuotationReferenceData();
  const canViewCosting =
    req.user!.role_slug === 'system_admin' || hasPermission(req.user!, 'quotations', 'view_internal_costing');

  const { category, search, grOnly, includeInactive } = req.query;
  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  if (!includeInactive) {
    where.push('is_active = 1');
  }
  if (category && category !== 'all') {
    where.push('category = ?');
    params.push(String(category));
  }
  if (grOnly === '1') {
    where.push('is_general_requirement = 1');
  }
  if (search) {
    const like = `%${String(search).trim()}%`;
    where.push('(item_code LIKE ? OR name LIKE ? OR description LIKE ? OR specification LIKE ?)');
    params.push(like, like, like, like);
  }

  const rawItems = db
    .prepare(`SELECT * FROM quotation_catalog_items WHERE ${where.join(' AND ')} ORDER BY is_general_requirement DESC, category ASC, name ASC`)
    .all(...params) as any[];

  const items = rawItems.map((it) => {
    const matSell = it.mat_unit_cost > 0 ? Math.ceil(Number((it.mat_unit_cost / (1 - it.default_mat_gp_pct)).toFixed(10))) : 0;
    const lbrSell = it.lbr_unit_cost > 0 ? Math.ceil(Number((it.lbr_unit_cost / (1 - it.default_lbr_gp_pct)).toFixed(10))) : 0;
    if (!canViewCosting) {
      return {
        id: it.id,
        item_code: it.item_code,
        name: it.name,
        description: it.description,
        specification: it.specification,
        category: it.category,
        subcategory: it.subcategory,
        default_unit: it.default_unit,
        is_general_requirement: it.is_general_requirement,
        is_active: it.is_active,
        mat_sell_rate: matSell,
        lbr_sell_rate: lbrSell,
        combined_sell_rate: matSell + lbrSell,
      };
    }
    return {
      ...it,
      mat_sell_rate: matSell,
      lbr_sell_rate: lbrSell,
      combined_sell_rate: matSell + lbrSell,
    };
  });

  res.json({ items, canViewInternalCosting: canViewCosting });
});

router.post('/quotations/catalog/items', requirePermission('quotations', 'edit'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  if (!b.itemCode || !b.name || !b.category) {
    res.status(400).json({ error: 'Item code, name, and category are required' });
    return;
  }
  const matCost = Math.max(0, Number(b.matUnitCost || 0));
  const lbrCost = Math.max(0, Number(b.lbrUnitCost || 0));
  const matGp = Math.min(0.9, Math.max(0, Number(b.defaultMatGpPct ?? 0.3)));
  const lbrGp = Math.min(0.9, Math.max(0, Number(b.defaultLbrGpPct ?? 0.3)));

  const id = transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO quotation_catalog_items (
          item_code, name, description, specification, category, subcategory, default_unit,
          mat_unit_cost, lbr_unit_cost, default_mat_gp_pct, default_lbr_gp_pct,
          supplier_ref, is_general_requirement, calc_rule, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(b.itemCode).trim().toUpperCase(),
        String(b.name).trim(),
        b.description || '',
        b.specification || '',
        b.category,
        b.subcategory || '',
        b.defaultUnit || 'lot',
        matCost,
        lbrCost,
        matGp,
        lbrGp,
        b.supplierRef || '',
        b.isGeneralRequirement ? 1 : 0,
        b.calcRule || 'fixed',
        b.remarks || '',
        req.user!.id
      );
    const cid = Number(info.lastInsertRowid);
    if (matCost > 0) {
      db.prepare(
        `INSERT INTO quotation_item_price_history (catalog_item_id, cost_type, previous_cost, new_cost, effective_date, supplier_ref, updated_by, remarks)
         VALUES (?, 'material', 0, ?, date('now'), ?, ?, 'Catalog item created')`
      ).run(cid, matCost, b.supplierRef || '', req.user!.id);
    }
    if (lbrCost > 0) {
      db.prepare(
        `INSERT INTO quotation_item_price_history (catalog_item_id, cost_type, previous_cost, new_cost, effective_date, supplier_ref, updated_by, remarks)
         VALUES (?, 'labor', 0, ?, date('now'), ?, ?, 'Catalog item created')`
      ).run(cid, lbrCost, b.supplierRef || '', req.user!.id);
    }
    return cid;
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_CATALOG_ITEM',
    module: 'quotations',
    recordType: 'quotation_catalog_item',
    recordRef: String(b.itemCode).trim().toUpperCase(),
    newValue: { id, name: b.name, category: b.category },
    ipAddress: req.ip || '',
  });

  res.status(201).json({ id });
});

router.put('/quotations/catalog/items/:id', requirePermission('quotations', 'edit'), (req: AuthenticatedRequest, res) => {
  const itemId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM quotation_catalog_items WHERE id = ?').get(itemId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Catalog item not found' });
    return;
  }
  const b = req.body || {};
  const newMat = b.matUnitCost !== undefined ? Math.max(0, Number(b.matUnitCost)) : existing.mat_unit_cost;
  const newLbr = b.lbrUnitCost !== undefined ? Math.max(0, Number(b.lbrUnitCost)) : existing.lbr_unit_cost;

  transaction(() => {
    db.prepare(
      `UPDATE quotation_catalog_items SET
        name = ?, description = ?, specification = ?, category = ?, subcategory = ?, default_unit = ?,
        mat_unit_cost = ?, lbr_unit_cost = ?, default_mat_gp_pct = ?, default_lbr_gp_pct = ?,
        supplier_ref = ?, is_general_requirement = ?, is_active = ?, remarks = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      b.name ?? existing.name,
      b.description ?? existing.description,
      b.specification ?? existing.specification,
      b.category ?? existing.category,
      b.subcategory ?? existing.subcategory,
      b.defaultUnit ?? existing.default_unit,
      newMat,
      newLbr,
      b.defaultMatGpPct !== undefined ? Number(b.defaultMatGpPct) : existing.default_mat_gp_pct,
      b.defaultLbrGpPct !== undefined ? Number(b.defaultLbrGpPct) : existing.default_lbr_gp_pct,
      b.supplierRef ?? existing.supplier_ref,
      b.isGeneralRequirement !== undefined ? (b.isGeneralRequirement ? 1 : 0) : existing.is_general_requirement,
      b.isActive !== undefined ? (b.isActive ? 1 : 0) : existing.is_active,
      b.remarks ?? existing.remarks,
      itemId
    );

    if (newMat !== existing.mat_unit_cost) {
      db.prepare(
        `INSERT INTO quotation_item_price_history (catalog_item_id, cost_type, previous_cost, new_cost, effective_date, supplier_ref, updated_by, remarks)
         VALUES (?, 'material', ?, ?, date('now'), ?, ?, ?)`
      ).run(itemId, existing.mat_unit_cost, newMat, b.supplierRef ?? existing.supplier_ref, req.user!.id, b.priceChangeRemarks || 'Catalog update');
    }
    if (newLbr !== existing.lbr_unit_cost) {
      db.prepare(
        `INSERT INTO quotation_item_price_history (catalog_item_id, cost_type, previous_cost, new_cost, effective_date, supplier_ref, updated_by, remarks)
         VALUES (?, 'labor', ?, ?, date('now'), ?, ?, ?)`
      ).run(itemId, existing.lbr_unit_cost, newLbr, b.supplierRef ?? existing.supplier_ref, req.user!.id, b.priceChangeRemarks || 'Catalog update');
    }
  });

  res.json({ ok: true });
});

router.get('/quotations/catalog/price-history', requirePermission('quotations', 'view_internal_costing'), (req, res) => {
  const { catalogItemId } = req.query;
  const rows = db
    .prepare(
      `SELECT ph.*, ci.item_code, ci.name AS item_name, u.full_name AS updated_by_name
       FROM quotation_item_price_history ph
       JOIN quotation_catalog_items ci ON ci.id = ph.catalog_item_id
       LEFT JOIN users u ON u.id = ph.updated_by
       ${catalogItemId ? 'WHERE ph.catalog_item_id = ?' : ''}
       ORDER BY ph.id DESC
       LIMIT 150`
    )
    .all(...(catalogItemId ? [Number(catalogItemId)] : []));
  res.json({ history: rows });
});

router.post('/quotations/locations', requirePermission('quotations', 'manage_settings'), (req, res) => {
  const b = req.body || {};
  if (!b.region || !b.province || !b.municipality) {
    res.status(400).json({ error: 'Region, province, and municipality are required' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO ph_locations (region, province, municipality, barangay, zip_code, distance_km, mobilization_tier, base_mobilization_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.region,
      b.province,
      b.municipality,
      b.barangay || '',
      b.zipCode || '',
      Number(b.distanceKm || 0),
      b.mobilizationTier || 'Regional',
      Number(b.baseMobilizationCost || 0)
    );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put('/quotations/settings', requirePermission('quotations', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  const current = getSettingsRow();
  const b = req.body || {};
  db.prepare(
    `UPDATE quotation_settings SET
      company_name = ?, company_address = ?, company_email = ?, company_phone = ?, payee_name = ?,
      prefix = ?, year_code = ?, next_seq = ?, doc_type = ?,
      default_vat_rate = ?, default_mat_gp_pct = ?, default_lbr_gp_pct = ?,
      max_estimator_discount_pct = ?, max_pm_discount_pct = ?, min_gp_warning_pct = ?,
      require_two_step_approval = ?, allow_self_approval = ?
     WHERE id = 1`
  ).run(
    b.companyName ?? current.company_name,
    b.companyAddress ?? current.company_address,
    b.companyEmail ?? current.company_email,
    b.companyPhone ?? current.company_phone,
    b.payeeName ?? current.payee_name,
    String(b.prefix ?? current.prefix).toUpperCase(),
    String(b.yearCode ?? current.year_code),
    Math.max(1, Number(b.nextSeq ?? current.next_seq)),
    String(b.docType ?? current.doc_type).toUpperCase(),
    Number(b.defaultVatRate ?? current.default_vat_rate),
    Number(b.defaultMatGpPct ?? current.default_mat_gp_pct),
    Number(b.defaultLbrGpPct ?? current.default_lbr_gp_pct),
    Number(b.maxEstimatorDiscountPct ?? current.max_estimator_discount_pct),
    Number(b.maxPmDiscountPct ?? current.max_pm_discount_pct),
    Number(b.minGpWarningPct ?? current.min_gp_warning_pct),
    b.requireTwoStepApproval !== undefined ? (b.requireTwoStepApproval ? 1 : 0) : current.require_two_step_approval,
    b.allowSelfApproval !== undefined ? (b.allowSelfApproval ? 1 : 0) : current.allow_self_approval
  );

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_QUOTATION_SETTINGS',
    module: 'quotations',
    recordType: 'quotation_settings',
    recordRef: 'SETTINGS-1',
    previousValue: current,
    newValue: b,
    ipAddress: req.ip || '',
  });
  res.json({ settings: getSettingsRow() });
});

// 4. Create New Quotation (Guided Creation + Initial REV00 Sections + Selected General Requirements)
router.post('/quotations', requirePermission('quotations', 'create'), (req: AuthenticatedRequest, res) => {
  ensureQuotationReferenceData();
  const b = req.body || {};
  if (!b.clientId || !b.title) {
    res.status(400).json({ error: 'Client and project/quotation title are required' });
    return;
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(b.clientId)) as any;
  if (!client) {
    res.status(404).json({ error: 'Selected client not found' });
    return;
  }

  const settings = getSettingsRow();
  const validityDate =
    b.validityDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const scopeOptions: ScopeOptions = { ...DEFAULT_SCOPE_OPTIONS, ...(b.scopeOptions || {}) };
  const subject = b.subject || buildDefaultScopeSubject(scopeOptions, b.title);
  const vatRate = Number(b.vatRate ?? settings.default_vat_rate ?? 12);
  const manpower = Math.max(0, Number(b.estimatedManpower || 10));
  const durationDays = Math.max(1, Number(b.estimatedDurationDays || 30));

  const result = transaction(() => {
    const quoteNumber = b.quoteNumber ? String(b.quoteNumber).trim().toUpperCase() : generateNextQuotationNumber();
    const initialSections: QuotationSectionInput[] = [
      { tempKey: 'A', code: 'A', title: 'GENERAL REQUIREMENTS', sortOrder: 1 },
      { tempKey: 'B', code: 'B', title: 'GENERAL ITEMS', sortOrder: 2 },
      { tempKey: 'C', code: 'C', title: 'COMMERCIAL FIXTURES', sortOrder: 3 },
    ];

    const initialItems: QuotationItemInput[] = [];
    if (b.includeDefaultGeneralRequirements !== false) {
      const mobCost = Number(b.mobilizationCostOverride ?? 30000);
      initialItems.push({
        tempKey: 'A-1',
        sectionKey: 'A',
        rowType: 'item',
        lineNo: '1',
        itemCode: 'GR-01',
        description: 'Site Management & Temporary Facilities',
        specification: 'Mobilization, Supervision, Safety/PPE & Temporary Site Facilities',
        qty: 1,
        unit: 'lot',
        matPricingMode: 'included',
        lbrPricingMode: 'computed',
        visibilityMode: 'visible',
        matUnitCost: 0,
        lbrUnitCost: mobCost,
        matGpPct: Number(settings.default_mat_gp_pct || 0.3),
        lbrGpPct: Number(settings.default_lbr_gp_pct || 0.3),
        sortOrder: 1,
      });
      if (scopeOptions.chkDelivery) {
        initialItems.push({
          tempKey: 'A-2',
          sectionKey: 'A',
          rowType: 'item',
          lineNo: '2',
          itemCode: 'GR-DEL',
          description: 'Delivery Fee',
          qty: 1,
          unit: 'lot',
          matPricingMode: 'included',
          lbrPricingMode: 'computed',
          visibilityMode: 'visible',
          matUnitCost: 0,
          lbrUnitCost: 15000,
          matGpPct: Number(settings.default_mat_gp_pct || 0.3),
          lbrGpPct: Number(settings.default_lbr_gp_pct || 0.3),
          sortOrder: 2,
        });
      }
    }

    const summary = recalculateRevision({
      sections: initialSections,
      items: initialItems,
      vatRate,
      discountPct: 0,
      estimatedManpower: manpower,
      estimatedDurationDays: durationDays,
    });

    const siteLocation = b.siteLocation || [b.municipality, b.province].filter(Boolean).join(', ') || client.address || '';
    const attentionTo = b.attentionTo || client.primary_contact || '';
    const attentionTitle = b.attentionTitle || client.representative_title || '';

    const qRes = db
      .prepare(
        `INSERT INTO quotations (
          quote_number, client_id, title, location, scope, validity_date, status,
          direct_cost, tax_pct, total_amount, prepared_by, notes,
          current_revision_code, subject, site_location, province, municipality, barangay, zip_code,
          attention_to, attention_title, thru_person, thru_title, currency,
          vat_rate, discount_pct, discount_amount, estimated_manpower, estimated_duration_days,
          subtotal_pre_vat, vat_amount, final_amount, revision_count
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 'REV00', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PHP', ?, 0, 0, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        quoteNumber,
        Number(b.clientId),
        b.title,
        siteLocation,
        b.scope || subject,
        validityDate,
        summary.totalDirectCost,
        vatRate,
        summary.finalAmount,
        req.user!.id,
        b.notes || '',
        subject,
        siteLocation,
        b.province || '',
        b.municipality || '',
        b.barangay || '',
        b.zipCode || '',
        attentionTo,
        attentionTitle,
        b.thruPerson || '',
        b.thruTitle || '',
        vatRate,
        manpower,
        durationDays,
        summary.totalSellingPreVat,
        summary.vatAmount,
        summary.finalAmount
      );
    const quotationId = Number(qRes.lastInsertRowid);

    const revRes = db
      .prepare(
        `INSERT INTO quotation_revisions (
          quotation_id, revision_code, status, subject, site_location, province, municipality, barangay, zip_code,
          attention_to, attention_title, thru_person, thru_title,
          estimated_manpower, estimated_duration_days, vat_rate, discount_pct,
          scope_options_json, terms_json, notes_json,
          subtotal_mat_cost, subtotal_lbr_cost, total_direct_cost,
          subtotal_mat_sell, subtotal_lbr_sell, total_selling_pre_vat,
          vat_amount, total_selling_vat_inc, discount_amount, final_amount,
          gross_profit_amount, gross_profit_pct, snapshot_json, revision_reason,
          prepared_by, prepared_by_title
        ) VALUES (?, 'REV00', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'Initial estimate', ?, ?)`
      )
      .run(
        quotationId,
        subject,
        siteLocation,
        b.province || '',
        b.municipality || '',
        b.barangay || '',
        b.zipCode || '',
        attentionTo,
        attentionTitle,
        b.thruPerson || '',
        b.thruTitle || '',
        manpower,
        durationDays,
        vatRate,
        JSON.stringify(scopeOptions),
        JSON.stringify(DEFAULT_TERMS),
        JSON.stringify([
          'Client Considerations: N/A',
          'Supply of above Equipment and/or Services.',
          'Excludes all others not mentioned on the above Quote.',
        ]),
        summary.subtotalMatCost,
        summary.subtotalLbrCost,
        summary.totalDirectCost,
        summary.subtotalMatSell,
        summary.subtotalLbrSell,
        summary.totalSellingPreVat,
        summary.vatAmount,
        summary.totalSellingVatInc,
        summary.finalAmount,
        summary.grossProfitAmount,
        summary.grossProfitPct,
        JSON.stringify({ vatRate, discountPct: 0, sections: summary.sectionSubtotals }),
        req.user!.id,
        req.user!.job_title || req.user!.role_name
      );
    const revisionId = Number(revRes.lastInsertRowid);
    db.prepare('UPDATE quotations SET current_revision_id = ? WHERE id = ?').run(revisionId, quotationId);

    const secIdMap = new Map<string, number>();
    const insSec = db.prepare(
      'INSERT INTO quotation_sections (revision_id, code, title, sort_order) VALUES (?, ?, ?, ?)'
    );
    for (const s of initialSections) {
      const sRes = insSec.run(revisionId, s.code, s.title, s.sortOrder);
      secIdMap.set(s.tempKey!, Number(sRes.lastInsertRowid));
    }

    const insIt = db.prepare(
      `INSERT INTO quotation_items (
        revision_id, section_id, row_type, line_no, item_code, description, specification,
        qty, unit, mat_pricing_mode, lbr_pricing_mode, visibility_mode,
        mat_unit_cost, lbr_unit_cost, mat_gp_pct, lbr_gp_pct,
        mat_sell_rate, lbr_sell_rate, combined_unit_rate,
        extended_mat_sell, extended_lbr_sell, extended_selling,
        extended_mat_cost, extended_lbr_cost, extended_cost, gross_profit, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of summary.items) {
      insIt.run(
        revisionId,
        secIdMap.get(it.sectionKey!)!,
        it.rowType,
        it.lineNo,
        it.itemCode,
        it.description,
        it.specification || '',
        it.qty,
        it.unit,
        it.matPricingMode,
        it.lbrPricingMode,
        it.visibilityMode,
        it.matUnitCost,
        it.lbrUnitCost,
        it.matGpPct,
        it.lbrGpPct,
        it.matSellRate,
        it.lbrSellRate,
        it.combinedUnitRate,
        it.extendedMatSell,
        it.extendedLbrSell,
        it.extendedSelling,
        it.extendedMatCost,
        it.extendedLbrCost,
        it.extendedCost,
        it.grossProfit,
        it.sortOrder
      );
    }

    return { quotationId, quoteNumber, revisionId };
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_QUOTATION',
    module: 'quotations',
    recordType: 'quotation',
    recordRef: result.quoteNumber,
    newValue: { id: result.quotationId, title: b.title },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({
    eventType: 'quotation:created',
    module: 'quotations',
    payload: { quotationId: result.quotationId, quoteNumber: result.quoteNumber },
  });

  res.status(201).json(result);
});

// 5. Get Single Quotation (Hydrated, Strictly Confidentiality-Filtered)
router.get('/quotations/:id', requirePermission('quotations', 'view'), (req: AuthenticatedRequest, res) => {
  const quoteId = Number(req.params.id);
  const canViewCosting =
    req.user!.role_slug === 'system_admin' || hasPermission(req.user!, 'quotations', 'view_internal_costing');

  let quote = db
    .prepare(
      `SELECT q.*, c.company_name AS client_name, c.primary_contact AS client_contact, c.representative_title AS client_rep_title,
              c.email AS client_email, c.phone AS client_phone, c.address AS client_address,
              p.ref_number AS converted_project_ref, p.name AS converted_project_name,
              u.full_name AS prepared_by_name, u2.full_name AS converted_by_name
       FROM quotations q
       JOIN clients c ON c.id = q.client_id
       LEFT JOIN projects p ON p.id = q.project_id
       LEFT JOIN users u ON u.id = q.prepared_by
       LEFT JOIN users u2 ON u2.id = q.converted_by
       WHERE q.id = ?`
    )
    .get(quoteId) as any;

  if (!quote) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }

  if (!quote.current_revision_id) {
    const revId = hydrateLegacyOrEmptyQuotation(quoteId);
    quote = { ...quote, current_revision_id: revId, current_revision_code: 'REV00' };
  }

  const requestedRevId = req.query.revisionId ? Number(req.query.revisionId) : quote.current_revision_id;
  const revisionRaw = loadRevisionHydrated(requestedRevId);
  if (!revisionRaw || revisionRaw.quotation_id !== quoteId) {
    res.status(404).json({ error: 'Quotation revision not found' });
    return;
  }

  const revisions = db
    .prepare(
      `SELECT id, revision_code, status, final_amount, total_selling_pre_vat, discount_pct, is_locked, revision_reason, created_at
       FROM quotation_revisions
       WHERE quotation_id = ?
       ORDER BY id DESC`
    )
    .all(quoteId);

  const approvals = db
    .prepare(
      `SELECT qa.*, u.full_name AS actor_name, r.name AS actor_role
       FROM quotation_approvals qa
       JOIN users u ON u.id = qa.actor_id
       JOIN roles r ON r.id = u.role_id
       WHERE qa.quotation_id = ?
       ORDER BY qa.id DESC`
    )
    .all(quoteId);

  const commentsQuery = canViewCosting
    ? `SELECT qc.*, u.full_name AS author_name FROM quotation_comments qc JOIN users u ON u.id = qc.user_id WHERE qc.quotation_id = ? ORDER BY qc.id DESC`
    : `SELECT qc.*, u.full_name AS author_name FROM quotation_comments qc JOIN users u ON u.id = qc.user_id WHERE qc.quotation_id = ? AND qc.is_internal = 0 ORDER BY qc.id DESC`;
  const comments = db.prepare(commentsQuery).all(quoteId);

  const settings = getSettingsRow();
  const sanitizedRevision = sanitizeRevisionForUser(revisionRaw, req.user!);

  const safeQuote = { ...quote };
  if (!canViewCosting) {
    delete safeQuote.direct_cost;
  }

  res.json({
    quotation: safeQuote,
    revision: sanitizedRevision,
    revisions,
    approvals,
    comments,
    companyHeader: {
      companyName: settings.company_name,
      companyAddress: settings.company_address,
      companyEmail: settings.company_email,
      companyPhone: settings.company_phone,
      payeeName: settings.payee_name,
    },
    canViewInternalCosting: canViewCosting,
    permissions: {
      canEdit: hasPermission(req.user!, 'quotations', 'edit'),
      canOverridePricing: hasPermission(req.user!, 'quotations', 'override_pricing'),
      canApplyDiscount: hasPermission(req.user!, 'quotations', 'apply_discount'),
      canApproveDiscount: hasPermission(req.user!, 'quotations', 'approve_discount'),
      canSubmit: hasPermission(req.user!, 'quotations', 'submit'),
      canReview: hasPermission(req.user!, 'quotations', 'review'),
      canApprove: hasPermission(req.user!, 'quotations', 'approve'),
      canConvertProject: hasPermission(req.user!, 'quotations', 'convert_project'),
      canExport: hasPermission(req.user!, 'quotations', 'export'),
    },
  });
});

// 6. Save Draft & Recalculate Entire Revision on Backend
router.put('/quotations/:id/draft', requirePermission('quotations', 'edit'), (req: AuthenticatedRequest, res) => {
  const quoteId = Number(req.params.id);
  const b = req.body || {};

  const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId) as any;
  if (!quote) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }

  const revId = Number(b.revisionId || quote.current_revision_id);
  const rev = db.prepare('SELECT * FROM quotation_revisions WHERE id = ? AND quotation_id = ?').get(revId, quoteId) as any;
  if (!rev) {
    res.status(404).json({ error: 'Revision not found' });
    return;
  }

  if (rev.is_locked || !['draft', 'rejected', 'revised'].includes(rev.status)) {
    res.status(409).json({
      error: `Revision ${rev.revision_code} is '${rev.status}' and cannot be overwritten. Create a new revision instead.`,
    });
    return;
  }

  const canOverride =
    req.user!.role_slug === 'system_admin' || hasPermission(req.user!, 'quotations', 'override_pricing');
  const canApplyDiscount =
    req.user!.role_slug === 'system_admin' || hasPermission(req.user!, 'quotations', 'apply_discount');

  const requestedDiscount = Number(b.discountPct ?? rev.discount_pct ?? 0);
  if (requestedDiscount !== Number(rev.discount_pct) && !canApplyDiscount) {
    res.status(403).json({ error: 'You do not have permission to apply quotation discounts' });
    return;
  }

  const incomingItems = Array.isArray(b.items) ? b.items : [];
  for (const it of incomingItems) {
    if ((it.matPricingMode === 'override' || it.lbrPricingMode === 'override') && !canOverride) {
      res.status(403).json({ error: 'Manual price overrides require quotations:override_pricing permission' });
      return;
    }
    if ((it.matPricingMode === 'override' || it.lbrPricingMode === 'override') && !String(it.overrideReason || '').trim()) {
      res.status(400).json({ error: `Override reason is required for "${it.description}"` });
      return;
    }
  }

  const sectionsInput: QuotationSectionInput[] = (Array.isArray(b.sections) ? b.sections : []).map((s: any, idx: number) => ({
    tempKey: String(s.tempKey || s.id || `sec-${idx}`),
    code: String(s.code || String.fromCharCode(65 + idx)),
    title: String(s.title || 'SECTION'),
    sortOrder: Number(s.sortOrder ?? idx + 1),
    isCollapsed: Boolean(s.isCollapsed),
  }));

  const itemsInput: QuotationItemInput[] = incomingItems.map((it: any, idx: number) => ({
    tempKey: String(it.tempKey || it.id || `row-${idx}`),
    sectionKey: String(it.sectionKey || it.section_id || sectionsInput[0]?.tempKey || 'sec-0'),
    parentKey: it.parentKey ? String(it.parentKey) : (it.parent_item_id ? String(it.parent_item_id) : null),
    rowType: it.rowType || it.row_type || 'item',
    lineNo: String(it.lineNo ?? it.line_no ?? ''),
    itemCode: String(it.itemCode ?? it.item_code ?? ''),
    description: String(it.description || 'Untitled Item'),
    specification: String(it.specification || ''),
    qty: Number(it.qty ?? 1),
    unit: String(it.unit || 'lot'),
    matPricingMode: it.matPricingMode || it.mat_pricing_mode || 'computed',
    lbrPricingMode: it.lbrPricingMode || it.lbr_pricing_mode || 'computed',
    visibilityMode: it.visibilityMode || it.visibility_mode || 'visible',
    rollupChildren: Boolean(it.rollupChildren ?? it.rollup_children),
    matUnitCost: Number(it.matUnitCost ?? it.mat_unit_cost ?? 0),
    lbrUnitCost: Number(it.lbrUnitCost ?? it.lbr_unit_cost ?? 0),
    matGpPct: Number(it.matGpPct ?? it.mat_gp_pct ?? 0.3),
    lbrGpPct: Number(it.lbrGpPct ?? it.lbr_gp_pct ?? 0.3),
    overrideMatRate: it.overrideMatRate ?? it.override_mat_rate ?? null,
    overrideLbrRate: it.overrideLbrRate ?? it.override_lbr_rate ?? null,
    overrideReason: String(it.overrideReason ?? it.override_reason ?? ''),
    catalogItemId: it.catalogItemId ?? it.catalog_item_id ?? null,
    supplierRef: String(it.supplierRef ?? it.supplier_ref ?? ''),
    sortOrder: Number(it.sortOrder ?? idx + 1),
  }));

  const vatRate = b.vatRate !== undefined ? Number(b.vatRate) : Number(rev.vat_rate ?? 12);
  const manpower = Math.max(0, Number(b.estimatedManpower ?? rev.estimated_manpower ?? 0));
  const durationDays = Math.max(0, Number(b.estimatedDurationDays ?? rev.estimated_duration_days ?? 0));

  const summary = recalculateRevision({
    sections: sectionsInput,
    items: itemsInput,
    vatRate,
    discountPct: requestedDiscount,
    estimatedManpower: manpower,
    estimatedDurationDays: durationDays,
  });

  transaction(() => {
    db.prepare('DELETE FROM quotation_items WHERE revision_id = ?').run(revId);
    db.prepare('DELETE FROM quotation_sections WHERE revision_id = ?').run(revId);

    const secMap = new Map<string, number>();
    const insSec = db.prepare(
      'INSERT INTO quotation_sections (revision_id, code, title, sort_order, is_collapsed) VALUES (?, ?, ?, ?, ?)'
    );
    for (const s of sectionsInput) {
      const sRes = insSec.run(revId, s.code, s.title, s.sortOrder, s.isCollapsed ? 1 : 0);
      secMap.set(s.tempKey!, Number(sRes.lastInsertRowid));
    }

    const rowMap = new Map<string, number>();
    const insIt = db.prepare(
      `INSERT INTO quotation_items (
        revision_id, section_id, parent_item_id, row_type, line_no, item_code, description, specification,
        qty, unit, mat_pricing_mode, lbr_pricing_mode, visibility_mode, rollup_children,
        mat_unit_cost, lbr_unit_cost, mat_gp_pct, lbr_gp_pct,
        mat_sell_rate, lbr_sell_rate, combined_unit_rate,
        extended_mat_sell, extended_lbr_sell, extended_selling,
        extended_mat_cost, extended_lbr_cost, extended_cost, gross_profit,
        override_mat_rate, override_lbr_rate, override_reason, overridden_by, overridden_at,
        catalog_item_id, supplier_ref, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const it of summary.items) {
      const sectionId = secMap.get(it.sectionKey!) || Array.from(secMap.values())[0];
      const parentId = it.parentKey ? rowMap.get(it.parentKey) ?? null : null;
      const isOverride = it.matPricingMode === 'override' || it.lbrPricingMode === 'override';
      const itRes = insIt.run(
        revId,
        sectionId,
        parentId,
        it.rowType,
        it.lineNo,
        it.itemCode,
        it.description,
        it.specification || '',
        it.qty,
        it.unit,
        it.matPricingMode,
        it.lbrPricingMode,
        it.visibilityMode,
        it.rollupChildren ? 1 : 0,
        it.matUnitCost,
        it.lbrUnitCost,
        it.matGpPct,
        it.lbrGpPct,
        it.matSellRate,
        it.lbrSellRate,
        it.combinedUnitRate,
        it.extendedMatSell,
        it.extendedLbrSell,
        it.extendedSelling,
        it.extendedMatCost,
        it.extendedLbrCost,
        it.extendedCost,
        it.grossProfit,
        it.overrideMatRate ?? null,
        it.overrideLbrRate ?? null,
        it.overrideReason || '',
        isOverride ? req.user!.id : null,
        isOverride ? new Date().toISOString() : null,
        it.catalogItemId ?? null,
        it.supplierRef || '',
        it.sortOrder
      );
      if (it.tempKey) rowMap.set(it.tempKey, Number(itRes.lastInsertRowid));
    }

    const subject = b.subject ?? rev.subject;
    const siteLocation = b.siteLocation ?? rev.site_location;
    const scopeOptionsJson = JSON.stringify(b.scopeOptions || JSON.parse(rev.scope_options_json || '{}'));
    const termsJson = JSON.stringify(b.terms || JSON.parse(rev.terms_json || '{}'));
    const notesJson = JSON.stringify(Array.isArray(b.notes) ? b.notes : JSON.parse(rev.notes_json || '[]'));

    db.prepare(
      `UPDATE quotation_revisions SET
        subject = ?, site_location = ?, province = ?, municipality = ?, barangay = ?, zip_code = ?,
        attention_to = ?, attention_title = ?, thru_person = ?, thru_title = ?,
        estimated_manpower = ?, estimated_duration_days = ?, vat_rate = ?, discount_pct = ?,
        scope_options_json = ?, terms_json = ?, notes_json = ?,
        subtotal_mat_cost = ?, subtotal_lbr_cost = ?, total_direct_cost = ?,
        subtotal_mat_sell = ?, subtotal_lbr_sell = ?, total_selling_pre_vat = ?,
        vat_amount = ?, total_selling_vat_inc = ?, discount_amount = ?, final_amount = ?,
        gross_profit_amount = ?, gross_profit_pct = ?,
        snapshot_json = ?
       WHERE id = ?`
    ).run(
      subject,
      siteLocation,
      b.province ?? rev.province,
      b.municipality ?? rev.municipality,
      b.barangay ?? rev.barangay,
      b.zipCode ?? rev.zip_code,
      b.attentionTo ?? rev.attention_to,
      b.attentionTitle ?? rev.attention_title,
      b.thruPerson ?? rev.thru_person,
      b.thruTitle ?? rev.thru_title,
      manpower,
      durationDays,
      vatRate,
      requestedDiscount,
      scopeOptionsJson,
      termsJson,
      notesJson,
      summary.subtotalMatCost,
      summary.subtotalLbrCost,
      summary.totalDirectCost,
      summary.subtotalMatSell,
      summary.subtotalLbrSell,
      summary.totalSellingPreVat,
      summary.vatAmount,
      summary.totalSellingVatInc,
      summary.discountAmount,
      summary.finalAmount,
      summary.grossProfitAmount,
      summary.grossProfitPct,
      JSON.stringify({ vatRate, discountPct: requestedDiscount, sections: summary.sectionSubtotals, manpowerTeamUnits: summary.manpowerTeamUnits }),
      revId
    );

    if (revId === quote.current_revision_id) {
      db.prepare(
        `UPDATE quotations SET
          title = ?, subject = ?, site_location = ?, location = ?, province = ?, municipality = ?, barangay = ?, zip_code = ?,
          attention_to = ?, attention_title = ?, thru_person = ?, thru_title = ?, validity_date = ?,
          direct_cost = ?, tax_pct = ?, vat_rate = ?, discount_pct = ?, discount_amount = ?,
          estimated_manpower = ?, estimated_duration_days = ?,
          subtotal_pre_vat = ?, vat_amount = ?, final_amount = ?, total_amount = ?
         WHERE id = ?`
      ).run(
        b.title ?? quote.title,
        subject,
        siteLocation,
        siteLocation,
        b.province ?? quote.province,
        b.municipality ?? quote.municipality,
        b.barangay ?? quote.barangay,
        b.zipCode ?? quote.zip_code,
        b.attentionTo ?? quote.attention_to,
        b.attentionTitle ?? quote.attention_title,
        b.thruPerson ?? quote.thru_person,
        b.thruTitle ?? quote.thru_title,
        b.validityDate ?? quote.validity_date,
        summary.totalDirectCost,
        vatRate,
        vatRate,
        requestedDiscount,
        summary.discountAmount,
        manpower,
        durationDays,
        summary.totalSellingPreVat,
        summary.vatAmount,
        summary.finalAmount,
        summary.finalAmount,
        quoteId
      );
    }
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_QUOTATION_DRAFT',
    module: 'quotations',
    recordType: 'quotation_revision',
    recordRef: `${quote.quote_number}-${rev.revision_code}`,
    newValue: { finalAmount: summary.finalAmount, totalSellingPreVat: summary.totalSellingPreVat, itemCount: summary.items.length },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({
    eventType: 'quotation:updated',
    module: 'quotations',
    payload: { quotationId: quoteId, revisionId: revId },
  });

  const updated = loadRevisionHydrated(revId);
  res.json({ revision: sanitizeRevisionForUser(updated, req.user!), summary: sanitizeRevisionForUser({ ...updated, ...summary }, req.user!) });
});

// 7. Create New Revision (REV00 -> REV01 -> REV02) Preserving Prior Issued Snapshot
router.post('/quotations/:id/revisions', requirePermission('quotations', 'edit'), (req: AuthenticatedRequest, res) => {
  const quoteId = Number(req.params.id);
  const { reason } = req.body || {};
  const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId) as any;
  if (!quote) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }

  const baseRev = loadRevisionHydrated(quote.current_revision_id);
  if (!baseRev) {
    res.status(404).json({ error: 'Base revision not found' });
    return;
  }

  const count = db.prepare('SELECT COUNT(*) AS cnt FROM quotation_revisions WHERE quotation_id = ?').get(quoteId) as { cnt: number };
  const nextCode = `REV${String(count.cnt).padStart(2, '0')}`;

  const newRevId = transaction(() => {
    // Lock previous revision
    db.prepare('UPDATE quotation_revisions SET is_locked = 1 WHERE id = ?').run(baseRev.id);

    const rRes = db
      .prepare(
        `INSERT INTO quotation_revisions (
          quotation_id, revision_code, status, subject, site_location, province, municipality, barangay, zip_code,
          attention_to, attention_title, thru_person, thru_title,
          estimated_manpower, estimated_duration_days, vat_rate, discount_pct,
          scope_options_json, terms_json, notes_json,
          subtotal_mat_cost, subtotal_lbr_cost, total_direct_cost,
          subtotal_mat_sell, subtotal_lbr_sell, total_selling_pre_vat,
          vat_amount, total_selling_vat_inc, discount_amount, final_amount,
          gross_profit_amount, gross_profit_pct, snapshot_json, revision_reason,
          prepared_by, prepared_by_title, is_locked
        ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        quoteId,
        nextCode,
        baseRev.subject,
        baseRev.site_location,
        baseRev.province,
        baseRev.municipality,
        baseRev.barangay,
        baseRev.zip_code,
        baseRev.attention_to,
        baseRev.attention_title,
        baseRev.thru_person,
        baseRev.thru_title,
        baseRev.estimated_manpower,
        baseRev.estimated_duration_days,
        baseRev.vat_rate,
        baseRev.discount_pct,
        baseRev.scope_options_json,
        baseRev.terms_json,
        baseRev.notes_json,
        baseRev.subtotal_mat_cost,
        baseRev.subtotal_lbr_cost,
        baseRev.total_direct_cost,
        baseRev.subtotal_mat_sell,
        baseRev.subtotal_lbr_sell,
        baseRev.total_selling_pre_vat,
        baseRev.vat_amount,
        baseRev.total_selling_vat_inc,
        baseRev.discount_amount,
        baseRev.final_amount,
        baseRev.gross_profit_amount,
        baseRev.gross_profit_pct,
        baseRev.snapshot_json,
        reason || `Revision created from ${baseRev.revision_code}`,
        req.user!.id,
        req.user!.job_title || req.user!.role_name
      );
    const revId = Number(rRes.lastInsertRowid);

    const secMap = new Map<number, number>();
    const insSec = db.prepare(
      'INSERT INTO quotation_sections (revision_id, code, title, sort_order, is_collapsed) VALUES (?, ?, ?, ?, ?)'
    );
    for (const s of baseRev.sections) {
      const sRes = insSec.run(revId, s.code, s.title, s.sort_order, s.is_collapsed || 0);
      secMap.set(s.id, Number(sRes.lastInsertRowid));
    }

    const itemMap = new Map<number, number>();
    const insIt = db.prepare(
      `INSERT INTO quotation_items (
        revision_id, section_id, parent_item_id, row_type, line_no, item_code, description, specification,
        qty, unit, mat_pricing_mode, lbr_pricing_mode, visibility_mode, rollup_children,
        mat_unit_cost, lbr_unit_cost, mat_gp_pct, lbr_gp_pct,
        mat_sell_rate, lbr_sell_rate, combined_unit_rate,
        extended_mat_sell, extended_lbr_sell, extended_selling,
        extended_mat_cost, extended_lbr_cost, extended_cost, gross_profit,
        override_mat_rate, override_lbr_rate, override_reason, catalog_item_id, supplier_ref, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of baseRev.items) {
      const newSecId = secMap.get(it.section_id)!;
      const newParent = it.parent_item_id ? itemMap.get(it.parent_item_id) ?? null : null;
      const itRes = insIt.run(
        revId, newSecId, newParent, it.row_type, it.line_no, it.item_code, it.description, it.specification || '',
        it.qty, it.unit, it.mat_pricing_mode, it.lbr_pricing_mode, it.visibility_mode, it.rollup_children || 0,
        it.mat_unit_cost, it.lbr_unit_cost, it.mat_gp_pct, it.lbr_gp_pct,
        it.mat_sell_rate, it.lbr_sell_rate, it.combined_unit_rate,
        it.extended_mat_sell, it.extended_lbr_sell, it.extended_selling,
        it.extended_mat_cost, it.extended_lbr_cost, it.extended_cost, it.gross_profit,
        it.override_mat_rate ?? null, it.override_lbr_rate ?? null, it.override_reason || '',
        it.catalog_item_id ?? null, it.supplier_ref || '', it.sort_order
      );
      itemMap.set(it.id, Number(itRes.lastInsertRowid));
    }

    db.prepare(
      `UPDATE quotations SET current_revision_id = ?, current_revision_code = ?, status = 'draft', revision_count = revision_count + 1 WHERE id = ?`
    ).run(revId, nextCode, quoteId);
    return revId;
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_QUOTATION_REVISION',
    module: 'quotations',
    recordType: 'quotation_revision',
    recordRef: `${quote.quote_number}-${nextCode}`,
    newValue: { revisionId: newRevId, reason: reason || '' },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'quotation:revised', module: 'quotations', payload: { quotationId: quoteId, revisionId: newRevId } });

  res.status(201).json({ revisionId: newRevId, revisionCode: nextCode });
});

// 8. Compare Two Revisions Side-by-Side
router.get('/quotations/:id/compare', requirePermission('quotations', 'view'), (req: AuthenticatedRequest, res) => {
  const quoteId = Number(req.params.id);
  const revAId = Number(req.query.revA);
  const revBId = Number(req.query.revB);
  const revA = loadRevisionHydrated(revAId);
  const revB = loadRevisionHydrated(revBId);

  if (!revA || !revB || revA.quotation_id !== quoteId || revB.quotation_id !== quoteId) {
    res.status(404).json({ error: 'Both revisions must belong to the quotation' });
    return;
  }

  const safeA = sanitizeRevisionForUser(revA, req.user!);
  const safeB = sanitizeRevisionForUser(revB, req.user!);

  const mapA = new Map<string, any>();
  for (const it of safeA.items) {
    mapA.set(`${it.item_code || ''}::${it.description}`, it);
  }
  const mapB = new Map<string, any>();
  for (const it of safeB.items) {
    mapB.set(`${it.item_code || ''}::${it.description}`, it);
  }

  const allKeys = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
  const itemDiffs = allKeys.map((key) => {
    const a = mapA.get(key);
    const b = mapB.get(key);
    if (!a && b) return { key, change: 'added', description: b.description, oldQty: 0, newQty: b.qty, oldAmount: 0, newAmount: b.extended_selling, delta: b.extended_selling };
    if (a && !b) return { key, change: 'removed', description: a.description, oldQty: a.qty, newQty: 0, oldAmount: a.extended_selling, newAmount: 0, delta: -a.extended_selling };
    const delta = Math.round(((b.extended_selling || 0) - (a.extended_selling || 0)) * 100) / 100;
    const change = delta !== 0 || a.qty !== b.qty || a.unit !== b.unit ? 'modified' : 'unchanged';
    return { key, change, description: b.description, oldQty: a.qty, newQty: b.qty, oldAmount: a.extended_selling, newAmount: b.extended_selling, delta };
  });

  res.json({
    revA: { id: safeA.id, code: safeA.revision_code, finalAmount: safeA.final_amount, totalSellingPreVat: safeA.total_selling_pre_vat, vatRate: safeA.vat_rate, discountPct: safeA.discount_pct, durationDays: safeA.estimated_duration_days, manpower: safeA.estimated_manpower },
    revB: { id: safeB.id, code: safeB.revision_code, finalAmount: safeB.final_amount, totalSellingPreVat: safeB.total_selling_pre_vat, vatRate: safeB.vat_rate, discountPct: safeB.discount_pct, durationDays: safeB.estimated_duration_days, manpower: safeB.estimated_manpower },
    deltaAmount: Math.round((safeB.final_amount - safeA.final_amount) * 100) / 100,
    itemDiffs: itemDiffs.filter((d) => d.change !== 'unchanged'),
  });
});

// 9. Approval & Client Decision Workflow
router.post('/quotations/:id/workflow', requirePermission('quotations', 'view'), (req: AuthenticatedRequest, res) => {
  const quoteId = Number(req.params.id);
  const { action, remarks } = req.body || {};
  const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId) as any;
  if (!quote) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }

  const rev = db.prepare('SELECT * FROM quotation_revisions WHERE id = ?').get(quote.current_revision_id) as any;
  if (!rev) {
    res.status(404).json({ error: 'Current revision not found' });
    return;
  }

  const settings = getSettingsRow();
  const prevStatus = rev.status;
  let newStatus = prevStatus;
  let stage = 'Workflow Update';
  let lockRevision = rev.is_locked;

  const checkPerm = (act: string) =>
    req.user!.role_slug === 'system_admin' || hasPermission(req.user!, 'quotations', act);

  if (action === 'submit') {
    if (!checkPerm('submit') && !checkPerm('create')) {
      res.status(403).json({ error: 'Permission denied (quotations:submit)' });
      return;
    }
    newStatus = 'for_review';
    stage = 'Estimator Submission';
  } else if (action === 'review') {
    if (!checkPerm('review')) {
      res.status(403).json({ error: 'Permission denied (quotations:review)' });
      return;
    }
    newStatus = 'for_approval';
    stage = 'Commercial / Engineering Review';
  } else if (action === 'approve') {
    if (!checkPerm('approve')) {
      res.status(403).json({ error: 'Permission denied (quotations:approve)' });
      return;
    }
    if (!settings.allow_self_approval && rev.prepared_by === req.user!.id && req.user!.role_slug !== 'system_admin') {
      res.status(403).json({ error: 'Separation of duties: quotation preparer cannot approve their own quotation' });
      return;
    }
    if (Number(rev.discount_pct || 0) > Number(settings.max_pm_discount_pct || 5) && !checkPerm('approve_discount')) {
      res.status(403).json({ error: `Discount (${rev.discount_pct}%) exceeds threshold (${settings.max_pm_discount_pct}%) and requires approve_discount authority` });
      return;
    }
    newStatus = 'approved';
    stage = 'Management Approval';
    lockRevision = 1;
  } else if (action === 'reject' || action === 'return_for_revision') {
    if (!checkPerm('reject') && !checkPerm('review') && !checkPerm('approve')) {
      res.status(403).json({ error: 'Permission denied to reject/return quotation' });
      return;
    }
    newStatus = action === 'reject' ? 'rejected' : 'draft';
    stage = action === 'reject' ? 'Rejected' : 'Returned for Revision';
    lockRevision = 0;
  } else if (action === 'send_to_client') {
    if (!checkPerm('approve') && !checkPerm('submit')) {
      res.status(403).json({ error: 'Permission denied to issue quotation to client' });
      return;
    }
    if (prevStatus !== 'approved') {
      res.status(400).json({ error: 'Quotation must be approved before issuing to client' });
      return;
    }
    newStatus = 'sent_to_client';
    stage = 'Client Issuance';
    lockRevision = 1;
  } else if (action === 'accept') {
    if (!checkPerm('approve') && !checkPerm('edit')) {
      res.status(403).json({ error: 'Permission denied to record client acceptance' });
      return;
    }
    if (!['approved', 'sent_to_client'].includes(prevStatus)) {
      res.status(400).json({ error: 'Quotation must be approved or sent to client before marking accepted' });
      return;
    }
    newStatus = 'accepted';
    stage = 'Client Acceptance';
    lockRevision = 1;
  } else if (action === 'decline' || action === 'expired' || action === 'cancelled') {
    if (!checkPerm('edit') && !checkPerm('approve')) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }
    newStatus = action === 'decline' ? 'declined' : action;
    stage = `Marked ${newStatus}`;
  } else {
    res.status(400).json({ error: 'Unsupported workflow action' });
    return;
  }

  transaction(() => {
    db.prepare(
      `UPDATE quotation_revisions SET
        status = ?, is_locked = ?,
        reviewed_by = CASE WHEN ? = 'review' THEN ? ELSE reviewed_by END,
        approved_by = CASE WHEN ? = 'approve' THEN ? ELSE approved_by END,
        approved_by_title = CASE WHEN ? = 'approve' THEN ? ELSE approved_by_title END
       WHERE id = ?`
    ).run(
      newStatus,
      lockRevision,
      action,
      req.user!.id,
      action,
      req.user!.id,
      action,
      req.user!.job_title || req.user!.role_name,
      rev.id
    );

    db.prepare(
      `UPDATE quotations SET
        status = ?,
        approved_by = CASE WHEN ? = 'approve' THEN ? ELSE approved_by END,
        sent_at = CASE WHEN ? = 'send_to_client' THEN datetime('now') ELSE sent_at END,
        accepted_at = CASE WHEN ? = 'accept' THEN datetime('now') ELSE accepted_at END
       WHERE id = ?`
    ).run(newStatus, action, req.user!.id, action, action, quoteId);

    db.prepare(
      `INSERT INTO quotation_approvals (quotation_id, revision_id, actor_id, stage, decision, previous_status, new_status, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(quoteId, rev.id, req.user!.id, stage, action, prevStatus, newStatus, remarks || '');

    if (quote.prepared_by && quote.prepared_by !== req.user!.id) {
      createNotification({
        userId: quote.prepared_by,
        type: 'quotation_workflow',
        title: `${quote.quote_number} (${rev.revision_code}) ${stage}`,
        body: `Status updated from ${prevStatus} to ${newStatus}.${remarks ? ` Note: ${remarks}` : ''}`,
        linkSection: 'quotations',
      });
    }
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: `QUOTATION_WORKFLOW_${String(action).toUpperCase()}`,
    module: 'quotations',
    recordType: 'quotation',
    recordRef: `${quote.quote_number}-${rev.revision_code}`,
    previousValue: { status: prevStatus },
    newValue: { status: newStatus, remarks: remarks || '' },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'quotation:workflow', module: 'quotations', payload: { quotationId: quoteId, status: newStatus } });

  res.json({ ok: true, status: newStatus });
});

// 10. Comments (Internal vs Client Notes)
router.post('/quotations/:id/comments', requirePermission('quotations', 'view'), (req: AuthenticatedRequest, res) => {
  const quoteId = Number(req.params.id);
  const { comment, isInternal = true, revisionId } = req.body || {};
  if (!String(comment || '').trim()) {
    res.status(400).json({ error: 'Comment text is required' });
    return;
  }
  const quote = db.prepare('SELECT current_revision_id FROM quotations WHERE id = ?').get(quoteId) as any;
  if (!quote) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }
  db.prepare(
    'INSERT INTO quotation_comments (quotation_id, revision_id, user_id, comment, is_internal) VALUES (?, ?, ?, ?, ?)'
  ).run(quoteId, revisionId || quote.current_revision_id, req.user!.id, String(comment).trim(), isInternal ? 1 : 0);
  res.status(201).json({ ok: true });
});

// 11. Export CSV (Strictly Enforcing Confidentiality)
router.get('/quotations/:id/export-csv', requirePermission('quotations', 'export'), (req: AuthenticatedRequest, res) => {
  const quoteId = Number(req.params.id);
  const mode = String(req.query.type || 'client');
  const canViewCosting =
    req.user!.role_slug === 'system_admin' || hasPermission(req.user!, 'quotations', 'view_internal_costing');

  if (mode === 'internal' && !canViewCosting) {
    res.status(403).json({ error: 'Internal costing export denied: missing view_internal_costing permission' });
    return;
  }

  const quote = db
    .prepare(
      `SELECT q.*, c.company_name AS client_name
       FROM quotations q JOIN clients c ON c.id = q.client_id WHERE q.id = ?`
    )
    .get(quoteId) as any;
  if (!quote) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }

  const revId = req.query.revisionId ? Number(req.query.revisionId) : quote.current_revision_id;
  const rev = loadRevisionHydrated(revId);
  if (!rev) {
    res.status(404).json({ error: 'Revision not found' });
    return;
  }

  const includeInternal = mode === 'internal' && canViewCosting;
  const lines: string[] = [];
  lines.push(['REV1 CONSTRUCTION CORP.', quote.quote_number, rev.revision_code, quote.client_name, quote.title].map(csvSafeCell).join(','));
  lines.push(['SUBJECT', rev.subject, 'SITE', rev.site_location].map(csvSafeCell).join(','));
  lines.push('');

  if (includeInternal) {
    lines.push([
      'Section', 'Line', 'Item Code', 'Description', 'Visibility', 'Qty', 'Unit',
      'Mat Cost', 'Lbr Cost', 'Mat GP%', 'Lbr GP%', 'Mat Sell', 'Lbr Sell', 'Combined Rate',
      'Extended Cost', 'Extended Selling', 'Gross Profit',
    ].map(csvSafeCell).join(','));
  } else {
    lines.push([
      'Section', 'Line', 'Item Code', 'Description', 'Qty', 'Unit',
      'Materials Unit Rate (PHP)', 'Labor Unit Rate (PHP)', 'Combined Unit Rate (PHP)', 'Extended Selling (PHP)',
    ].map(csvSafeCell).join(','));
  }

  for (const sec of rev.sections) {
    lines.push([`SECTION ${sec.code}`, sec.title].map(csvSafeCell).join(','));
    const secItems = rev.items.filter((i: any) => i.section_id === sec.id);
    for (const it of secItems) {
      if (!includeInternal && (it.visibility_mode === 'hidden' || it.row_type === 'subitem')) {
        continue;
      }
      const matSellDisplay = it.mat_pricing_mode === 'included' ? 'included' : it.mat_sell_rate;
      const lbrSellDisplay = it.lbr_pricing_mode === 'included' ? 'included' : it.lbr_sell_rate;
      if (includeInternal) {
        lines.push([
          sec.code, it.line_no, it.item_code, it.description, it.visibility_mode, it.qty, it.unit,
          it.mat_unit_cost, it.lbr_unit_cost, it.mat_gp_pct, it.lbr_gp_pct,
          matSellDisplay, lbrSellDisplay, it.combined_unit_rate,
          it.extended_cost, it.extended_selling, it.gross_profit,
        ].map(csvSafeCell).join(','));
      } else {
        lines.push([
          sec.code, it.line_no, it.item_code, it.description, it.qty, it.unit,
          matSellDisplay, lbrSellDisplay, it.combined_unit_rate, it.extended_selling,
        ].map(csvSafeCell).join(','));
      }
    }
    lines.push([`SUB-TOTAL ${sec.title}`, '', '', '', '', '', '', '', '', sec.total_selling_subtotal].map(csvSafeCell).join(','));
  }

  lines.push('');
  lines.push(['TOTAL AMOUNT (PRE-VAT)', rev.total_selling_pre_vat].map(csvSafeCell).join(','));
  lines.push([`${rev.vat_rate}% VAT`, rev.vat_amount].map(csvSafeCell).join(','));
  lines.push(['TOTAL SELLING PRICE (VAT INC)', rev.total_selling_vat_inc].map(csvSafeCell).join(','));
  if (Number(rev.discount_pct || 0) > 0) {
    lines.push([`LESS SPECIAL DISCOUNT (${rev.discount_pct}%)`, rev.discount_amount].map(csvSafeCell).join(','));
  }
  lines.push(['TOTAL DISCOUNTED PRICE', rev.final_amount].map(csvSafeCell).join(','));

  const filename = `${quote.quote_number}_${rev.revision_code}_${includeInternal ? 'INTERNAL_COSTING' : 'CLIENT_QUOTE'}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
});

// 12. Controlled Quotation-to-Project Conversion
router.post('/quotations/:id/convert-to-project', requirePermission('quotations', 'convert_project'), (req: AuthenticatedRequest, res) => {
  const quoteId = Number(req.params.id);
  const { overrideReason, initializeBudget = true, projectManagerId } = req.body || {};

  const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId) as any;
  if (!quote) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }
  if (quote.project_id) {
    res.status(409).json({ error: 'Quotation has already been converted into a CBMS project' });
    return;
  }
  if (!['approved', 'accepted'].includes(quote.status) && !String(overrideReason || '').trim()) {
    res.status(400).json({ error: 'Only approved or client-accepted quotations may convert without an authorized override reason' });
    return;
  }

  const rev = loadRevisionHydrated(quote.current_revision_id);
  if (!rev) {
    res.status(404).json({ error: 'Current revision missing' });
    return;
  }

  const result = transaction(() => {
    const year = new Date().getFullYear();
    const prefix = `PRJ-${year}-`;
    const rows = db.prepare('SELECT ref_number FROM projects WHERE ref_number LIKE ?').all(`${prefix}%`) as Array<{ ref_number: string }>;
    let maxSeq = 0;
    for (const r of rows) {
      const m = r.ref_number.match(new RegExp(`^PRJ-${year}-(\\d+)$`));
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
    }
    const refNumber = `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;

    const today = new Date().toISOString().slice(0, 10);
    const days = Math.max(30, Number(rev.estimated_duration_days || 90));
    const endDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const pmId = Number(projectManagerId || req.user!.id);

    const contractAmount = Number(rev.final_amount || rev.total_selling_vat_inc || quote.total_amount || 0);
    const approvedBudget = Number(rev.total_direct_cost || quote.direct_cost || 0);

    const pRes = db
      .prepare(
        `INSERT INTO projects (
          ref_number, name, client_id, location, scope, contract_amount,
          approved_budget, revised_budget, project_manager_id,
          start_date, original_end_date, status, financial_notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(
        refNumber,
        quote.title,
        quote.client_id,
        rev.site_location || quote.location || 'TBD',
        rev.subject || quote.scope || '',
        contractAmount,
        approvedBudget,
        approvedBudget,
        pmId,
        today,
        endDate,
        `Converted from ${quote.quote_number} (${rev.revision_code}). Est. Manpower: ${rev.estimated_manpower}, Est. Duration: ${days} days.`,
        req.user!.id
      );
    const projectId = Number(pRes.lastInsertRowid);

    db.prepare(
      'INSERT OR IGNORE INTO project_assignments (project_id, user_id, assignment_role) VALUES (?, ?, ?)'
    ).run(projectId, pmId, 'Project Manager');
    if (quote.prepared_by) {
      db.prepare(
        'INSERT OR IGNORE INTO project_assignments (project_id, user_id, assignment_role) VALUES (?, ?, ?)'
      ).run(projectId, quote.prepared_by, 'Estimator');
    }

    // Initialize categorized budgets from estimated direct costs ONLY (never creates fake actual expenses or duplicate PRs)
    if (initializeBudget && approvedBudget > 0) {
      const matBudget = Number(rev.subtotal_mat_cost || 0);
      const lbrBudget = Number(rev.subtotal_lbr_cost || 0);
      const insAlloc = db.prepare(
        'INSERT INTO budget_allocations (project_id, category, allocated_amount, revised_amount, notes) VALUES (?, ?, ?, ?, ?)'
      );
      if (matBudget > 0) {
        insAlloc.run(projectId, 'Materials', matBudget, matBudget, `Initial budget from ${quote.quote_number} ${rev.revision_code} (Estimated Mat Cost)`);
      }
      if (lbrBudget > 0) {
        insAlloc.run(projectId, 'Manpower', lbrBudget, lbrBudget, `Initial budget from ${quote.quote_number} ${rev.revision_code} (Estimated Labor & GR Cost)`);
      }
    }

    db.prepare(
      `UPDATE quotations SET project_id = ?, status = 'accepted', accepted_at = COALESCE(accepted_at, datetime('now')), converted_at = datetime('now'), converted_by = ? WHERE id = ?`
    ).run(projectId, req.user!.id, quoteId);

    db.prepare(
      `INSERT INTO quotation_conversion_history (quotation_id, revision_id, project_id, converted_by, override_reason, budget_initialized)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(quoteId, rev.id, projectId, req.user!.id, overrideReason || '', initializeBudget ? 1 : 0);

    return { projectId, refNumber };
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CONVERT_QUOTATION_TO_PROJECT',
    module: 'quotations',
    recordType: 'quotation',
    recordRef: `${quote.quote_number}-${rev.revision_code}`,
    newValue: { projectId: result.projectId, refNumber: result.refNumber, budgetInitialized: Boolean(initializeBudget), overrideReason: overrideReason || null },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'quotation:converted', module: 'quotations', projectId: result.projectId, payload: result });

  res.status(201).json(result);
});

export default router;
