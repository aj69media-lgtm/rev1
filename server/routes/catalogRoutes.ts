import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import {
  type AuthenticatedRequest,
  hasPermission,
  logAudit,
  requireAuth,
  requireInternalUser,
  requireModule,
  requirePermission,
} from '../auth.ts';
import { db, transaction, UPLOADS_DIR } from '../db.ts';
import { calcSellingRate } from '../quotationEngine.ts';
import { ensureCatalogOfWorksSeed } from '../quotationSeed.ts';
import { createNotification, emitSyncEvent } from '../realtime.ts';

const router = Router();

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
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      cb(null, `cat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
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

function canViewInternalCosting(user: AuthenticatedRequest['user']): boolean {
  if (!user) return false;
  return user.role_slug === 'system_admin' || hasPermission(user, 'catalog', 'view_internal_costing');
}

function canCatalog(user: AuthenticatedRequest['user'], action: string): boolean {
  if (!user) return false;
  return user.role_slug === 'system_admin' || hasPermission(user, 'catalog', action);
}

function csvSafeCell(v: unknown): string {
  const s = String(v ?? '');
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function normalizeText(v: string): string {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function notifyCatalogStakeholders(title: string, body: string, excludeUserId?: number): void {
  const recipients = db
    .prepare(
      `SELECT DISTINCT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       WHERE u.is_active = 1
         AND r.is_client_role = 0
         AND rp.module_slug = 'catalog'
         AND rp.action IN ('create_assembly','edit_assembly','create_item','manage_supplier_prices')`
    )
    .all() as Array<{ id: number }>;

  for (const r of recipients) {
    if (excludeUserId && r.id === excludeUserId) continue;
    createNotification({
      userId: r.id,
      type: 'catalog_update',
      title,
      body,
      linkSection: 'catalog',
    });
  }
}

function buildAssemblySnapshot(assemblyId: number) {
  const asm = db.prepare('SELECT * FROM work_assemblies WHERE id = ?').get(assemblyId) as any;
  if (!asm) return null;
  const items = db
    .prepare(
      `SELECT wai.*, ci.mat_unit_cost, ci.lbr_unit_cost, ci.default_mat_gp_pct, ci.default_lbr_gp_pct,
              s.name AS preferred_supplier_name
       FROM work_assembly_items wai
       LEFT JOIN quotation_catalog_items ci ON ci.id = wai.catalog_item_id
       LEFT JOIN suppliers s ON s.id = wai.preferred_supplier_id
       WHERE wai.assembly_id = ?
       ORDER BY wai.sort_order ASC, wai.id ASC`
    )
    .all(assemblyId) as any[];

  return {
    assembly_code: asm.assembly_code,
    name: asm.name,
    category_id: asm.category_id,
    category_name: asm.category_name,
    description: asm.description,
    specifications: asm.specifications,
    unit: asm.unit,
    default_calc_method: asm.default_calc_method,
    default_qty: asm.default_qty,
    labor_requirements: asm.labor_requirements,
    installation_instructions: asm.installation_instructions,
    notes: asm.notes,
    components: items.map((it) => ({
      catalog_item_id: it.catalog_item_id,
      component_type: it.component_type,
      item_code: it.item_code,
      item_name: it.item_name,
      specification: it.specification,
      unit: it.unit,
      calc_basis: it.calc_basis,
      consumption_rate: Number(it.consumption_rate || 0),
      wastage_pct: Number(it.wastage_pct || 0),
      preferred_supplier_id: it.preferred_supplier_id,
      preferred_supplier_name: it.preferred_supplier_name || '',
      mat_unit_cost: Number(it.mat_unit_cost || 0),
      lbr_unit_cost: Number(it.lbr_unit_cost || 0),
      notes: it.notes || '',
      sort_order: it.sort_order,
    })),
  };
}

function sanitizeAssemblyForUser(asm: any, items: any[], user: AuthenticatedRequest['user']) {
  const showCost = canViewInternalCosting(user);
  return {
    ...asm,
    components: items.map((it) => {
      const matSell = it.mat_unit_cost > 0 ? calcSellingRate(Number(it.mat_unit_cost), Number(it.default_mat_gp_pct ?? 0.3), 'computed') : 0;
      const lbrSell = it.lbr_unit_cost > 0 ? calcSellingRate(Number(it.lbr_unit_cost), Number(it.default_lbr_gp_pct ?? 0.3), 'computed') : 0;
      if (!showCost) {
        const {
          mat_unit_cost: _mc,
          lbr_unit_cost: _lc,
          default_mat_gp_pct: _mg,
          default_lbr_gp_pct: _lg,
          preferred_supplier_price: _sp,
          ...safe
        } = it;
        return {
          ...safe,
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
    }),
  };
}

// All Catalog routes require authenticated internal staff and enabled catalog module
router.use(requireAuth, requireInternalUser, requireModule('catalog'));

// 1. Metadata & Permissions
router.get('/catalog/meta', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  ensureCatalogOfWorksSeed();
  const categories = db
    .prepare('SELECT * FROM quotation_categories ORDER BY sort_order ASC, name ASC')
    .all();
  const units = db.prepare('SELECT * FROM quotation_units ORDER BY code ASC').all();
  const suppliers = db
    .prepare('SELECT id, supplier_code, name, contact_person, email, phone, address, category_tags, payment_terms, is_active FROM suppliers ORDER BY name ASC')
    .all();
  const pendingRequests = (
    db.prepare("SELECT COUNT(*) AS cnt FROM catalog_requests WHERE status = 'pending'").get() as { cnt: number }
  ).cnt;

  const u = req.user!;
  res.json({
    categories,
    units,
    suppliers,
    pendingRequestCount: pendingRequests,
    permissions: {
      view: canCatalog(u, 'view'),
      createItem: canCatalog(u, 'create_item'),
      editItem: canCatalog(u, 'edit_item'),
      manageCategories: canCatalog(u, 'manage_categories'),
      createAssembly: canCatalog(u, 'create_assembly'),
      editAssembly: canCatalog(u, 'edit_assembly'),
      duplicateAssembly: canCatalog(u, 'duplicate_assembly'),
      archiveRecord: canCatalog(u, 'archive_record'),
      restoreRecord: canCatalog(u, 'restore_record'),
      manageSuppliers: canCatalog(u, 'manage_suppliers'),
      manageSupplierPrices: canCatalog(u, 'manage_supplier_prices'),
      overrideCost: canCatalog(u, 'override_cost'),
      viewInternalCosting: canViewInternalCosting(u),
      requestItem: canCatalog(u, 'request_item'),
    },
  });
});

// 2. Configurable Work Categories & Units
router.post('/catalog/categories', requirePermission('catalog', 'manage_categories'), (req: AuthenticatedRequest, res) => {
  const { name, sectionDefault = 'B', sortOrder } = req.body || {};
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    res.status(400).json({ error: 'Category name is required' });
    return;
  }
  const dup = db.prepare('SELECT id FROM quotation_categories WHERE LOWER(name) = LOWER(?)').get(trimmed);
  if (dup) {
    res.status(409).json({ error: `Category "${trimmed}" already exists` });
    return;
  }
  const maxSort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM quotation_categories').get() as { m: number }).m;
  const info = db
    .prepare('INSERT INTO quotation_categories (name, section_default, sort_order, is_active) VALUES (?, ?, ?, 1)')
    .run(trimmed, String(sectionDefault || 'B').toUpperCase(), Number(sortOrder ?? maxSort + 1));

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_WORK_CATEGORY',
    module: 'catalog',
    recordType: 'quotation_category',
    recordRef: `CAT-${info.lastInsertRowid}`,
    newValue: { name: trimmed, sectionDefault },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'catalog:category_updated', module: 'catalog', payload: { id: Number(info.lastInsertRowid) } });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put('/catalog/categories/:id', requirePermission('catalog', 'manage_categories'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM quotation_categories WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }
  const { name, sectionDefault, sortOrder, isActive } = req.body || {};
  const nextName = name !== undefined ? String(name).trim() : existing.name;
  if (!nextName) {
    res.status(400).json({ error: 'Category name cannot be empty' });
    return;
  }

  const clash = db
    .prepare('SELECT id FROM quotation_categories WHERE LOWER(name) = LOWER(?) AND id != ?')
    .get(nextName, id);
  if (clash) {
    res.status(409).json({ error: `Another category named "${nextName}" already exists` });
    return;
  }

  transaction(() => {
    db.prepare(
      'UPDATE quotation_categories SET name = ?, section_default = ?, sort_order = ?, is_active = ? WHERE id = ?'
    ).run(
      nextName,
      sectionDefault !== undefined ? String(sectionDefault).toUpperCase() : existing.section_default,
      sortOrder !== undefined ? Number(sortOrder) : existing.sort_order,
      isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active,
      id
    );
    if (nextName !== existing.name) {
      db.prepare('UPDATE quotation_catalog_items SET category = ? WHERE category = ?').run(nextName, existing.name);
      db.prepare('UPDATE work_assemblies SET category_name = ? WHERE category_id = ? OR category_name = ?').run(
        nextName,
        id,
        existing.name
      );
    }
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_WORK_CATEGORY',
    module: 'catalog',
    recordType: 'quotation_category',
    recordRef: `CAT-${id}`,
    previousValue: existing,
    newValue: { name: nextName, sectionDefault, sortOrder, isActive },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'catalog:category_updated', module: 'catalog', payload: { id } });
  res.json({ ok: true });
});

router.post('/catalog/categories/reorder', requirePermission('catalog', 'manage_categories'), (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    res.status(400).json({ error: 'orderedIds array is required' });
    return;
  }
  transaction(() => {
    const stmt = db.prepare('UPDATE quotation_categories SET sort_order = ? WHERE id = ?');
    orderedIds.forEach((cid: number, idx: number) => stmt.run(idx + 1, Number(cid)));
  });
  res.json({ ok: true });
});

router.post('/catalog/units', requirePermission('catalog', 'manage_categories'), (req: AuthenticatedRequest, res) => {
  const { code, label } = req.body || {};
  const c = String(code || '').trim();
  const l = String(label || c).trim();
  if (!c) {
    res.status(400).json({ error: 'Unit code is required' });
    return;
  }
  const dup = db.prepare('SELECT id FROM quotation_units WHERE LOWER(code) = LOWER(?)').get(c);
  if (dup) {
    res.status(409).json({ error: `Unit "${c}" already exists` });
    return;
  }
  const info = db.prepare('INSERT INTO quotation_units (code, label, is_active) VALUES (?, ?, 1)').run(c, l);
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_CATALOG_UNIT',
    module: 'catalog',
    recordType: 'quotation_unit',
    recordRef: c,
    newValue: { code: c, label: l },
    ipAddress: req.ip || '',
  });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put('/catalog/units/:id', requirePermission('catalog', 'manage_categories'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM quotation_units WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Unit not found' });
    return;
  }
  const { label, isActive } = req.body || {};
  db.prepare('UPDATE quotation_units SET label = ?, is_active = ? WHERE id = ?').run(
    label !== undefined ? String(label).trim() : existing.label,
    isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active,
    id
  );
  res.json({ ok: true });
});

// 3. Individual Items Catalog (Master CRUD, Duplicate Check, Archive/Restore, CSV Import/Export)
router.get('/catalog/items', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  ensureCatalogOfWorksSeed();
  const showCost = canViewInternalCosting(req.user);
  const { search, category, itemType, status = 'active', supplierId } = req.query;

  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  if (status === 'active') {
    where.push('ci.is_active = 1');
  } else if (status === 'archived') {
    where.push('ci.is_active = 0');
  }
  if (category && category !== 'all') {
    where.push('ci.category = ?');
    params.push(String(category));
  }
  if (itemType && itemType !== 'all') {
    where.push('ci.item_type = ?');
    params.push(String(itemType));
  }
  if (supplierId && supplierId !== 'all') {
    where.push('EXISTS (SELECT 1 FROM catalog_item_supplier_prices sp WHERE sp.catalog_item_id = ci.id AND sp.supplier_id = ? AND sp.is_active = 1)');
    params.push(Number(supplierId));
  }
  if (search) {
    const like = `%${String(search).trim()}%`;
    where.push(`(
      ci.item_code LIKE ? OR ci.name LIKE ? OR ci.description LIKE ? OR ci.specification LIKE ? OR ci.supplier_ref LIKE ?
      OR EXISTS (
        SELECT 1 FROM catalog_item_supplier_prices sp
        JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.catalog_item_id = ci.id AND sp.is_active = 1 AND (s.name LIKE ? OR sp.brand LIKE ?)
      )
    )`);
    params.push(like, like, like, like, like, like, like);
  }

  const rawItems = db
    .prepare(
      `SELECT ci.*,
              (SELECT COUNT(*) FROM catalog_item_supplier_prices sp WHERE sp.catalog_item_id = ci.id AND sp.is_active = 1) AS supplier_count,
              (SELECT COUNT(*) FROM protected_attachments pa WHERE pa.entity_type = 'catalog_item' AND pa.entity_id = ci.id) AS attachment_count
       FROM quotation_catalog_items ci
       WHERE ${where.join(' AND ')}
       ORDER BY ci.is_active DESC, ci.category ASC, ci.name ASC`
    )
    .all(...params) as any[];

  const supplierLinks = db
    .prepare(
      `SELECT sp.id, sp.catalog_item_id, sp.supplier_id, s.name AS supplier_name, sp.brand,
              sp.unit, sp.unit_price, sp.is_preferred, sp.effective_date
       FROM catalog_item_supplier_prices sp
       JOIN suppliers s ON s.id = sp.supplier_id
       WHERE sp.is_active = 1
       ORDER BY sp.is_preferred DESC, sp.unit_price ASC`
    )
    .all() as any[];

  const items = rawItems.map((it) => {
    const matSell = it.mat_unit_cost > 0 ? calcSellingRate(Number(it.mat_unit_cost), Number(it.default_mat_gp_pct ?? 0.3), 'computed') : 0;
    const lbrSell = it.lbr_unit_cost > 0 ? calcSellingRate(Number(it.lbr_unit_cost), Number(it.default_lbr_gp_pct ?? 0.3), 'computed') : 0;
    const links = supplierLinks.filter((l) => l.catalog_item_id === it.id);

    if (!showCost) {
      return {
        id: it.id,
        item_code: it.item_code,
        name: it.name,
        description: it.description,
        specification: it.specification,
        category: it.category,
        subcategory: it.subcategory,
        default_unit: it.default_unit,
        item_type: it.item_type,
        is_general_requirement: it.is_general_requirement,
        is_active: it.is_active,
        remarks: it.remarks,
        supplier_count: it.supplier_count,
        attachment_count: it.attachment_count,
        suppliers: links.map((l) => ({
          supplier_id: l.supplier_id,
          supplier_name: l.supplier_name,
          brand: l.brand,
          is_preferred: l.is_preferred,
        })),
        mat_sell_rate: matSell,
        lbr_sell_rate: lbrSell,
        combined_sell_rate: matSell + lbrSell,
        archived_at: it.archived_at,
        updated_at: it.updated_at,
      };
    }

    return {
      ...it,
      suppliers: links,
      mat_sell_rate: matSell,
      lbr_sell_rate: lbrSell,
      combined_sell_rate: matSell + lbrSell,
    };
  });

  res.json({ items, canViewInternalCosting: showCost });
});

router.get('/catalog/items/check-duplicate', requirePermission('catalog', 'view'), (req, res) => {
  const { itemCode = '', name = '', specification = '', excludeId } = req.query;
  const codeNorm = String(itemCode).trim().toUpperCase();
  const nameNorm = normalizeText(String(name));
  const specNorm = normalizeText(String(specification));
  const exId = excludeId ? Number(excludeId) : -1;

  const all = db
    .prepare('SELECT id, item_code, name, specification, category, is_active FROM quotation_catalog_items WHERE id != ?')
    .all(exId) as any[];

  const exactCode = codeNorm ? all.find((x) => x.item_code.toUpperCase() === codeNorm) : null;
  const similar = all.filter((x) => {
    const n = normalizeText(x.name);
    const s = normalizeText(x.specification);
    if (!nameNorm) return false;
    return n === nameNorm || (n.includes(nameNorm) && (!specNorm || s === specNorm));
  });

  res.json({
    hasExactCodeConflict: Boolean(exactCode),
    exactCodeMatch: exactCode || null,
    similarMatches: similar.slice(0, 5),
  });
});

router.get('/catalog/items/export-csv', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  const showCost = canViewInternalCosting(req.user);
  const items = db
    .prepare('SELECT * FROM quotation_catalog_items ORDER BY category ASC, name ASC')
    .all() as any[];

  const lines: string[] = [];
  if (showCost) {
    lines.push(
      ['Item Code', 'Name', 'Item Type', 'Category', 'Unit', 'Specification', 'Description', 'Mat Cost', 'Lbr Cost', 'Mat GP%', 'Lbr GP%', 'Supplier', 'Status', 'Remarks']
        .map(csvSafeCell)
        .join(',')
    );
    for (const it of items) {
      lines.push(
        [
          it.item_code, it.name, it.item_type, it.category, it.default_unit,
          it.specification, it.description, it.mat_unit_cost, it.lbr_unit_cost,
          it.default_mat_gp_pct, it.default_lbr_gp_pct, it.supplier_ref,
          it.is_active ? 'Active' : 'Archived', it.remarks,
        ]
          .map(csvSafeCell)
          .join(',')
      );
    }
  } else {
    lines.push(
      ['Item Code', 'Name', 'Item Type', 'Category', 'Unit', 'Specification', 'Description', 'Mat Sell Rate', 'Lbr Sell Rate', 'Status', 'Remarks']
        .map(csvSafeCell)
        .join(',')
    );
    for (const it of items) {
      const matSell = it.mat_unit_cost > 0 ? calcSellingRate(Number(it.mat_unit_cost), Number(it.default_mat_gp_pct ?? 0.3), 'computed') : 0;
      const lbrSell = it.lbr_unit_cost > 0 ? calcSellingRate(Number(it.lbr_unit_cost), Number(it.default_lbr_gp_pct ?? 0.3), 'computed') : 0;
      lines.push(
        [
          it.item_code, it.name, it.item_type, it.category, it.default_unit,
          it.specification, it.description, matSell, lbrSell,
          it.is_active ? 'Active' : 'Archived', it.remarks,
        ]
          .map(csvSafeCell)
          .join(',')
      );
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="CBMS_Catalog_Items.csv"');
  res.send(lines.join('\n'));
});

router.post('/catalog/items/import-csv', requirePermission('catalog', 'create_item'), (req: AuthenticatedRequest, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'rows array required' });
    return;
  }

  let inserted = 0;
  let skipped = 0;
  const skippedReasons: string[] = [];

  transaction(() => {
    const ins = db.prepare(
      `INSERT INTO quotation_catalog_items (
        item_code, name, description, specification, category, subcategory, default_unit,
        item_type, mat_unit_cost, lbr_unit_cost, default_mat_gp_pct, default_lbr_gp_pct,
        supplier_ref, is_general_requirement, calc_rule, is_active, remarks, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 0, 'fixed', 1, ?, ?, datetime('now'))`
    );

    for (const r of rows) {
      const code = String(r.itemCode || r.item_code || '').trim().toUpperCase();
      const name = String(r.name || '').trim();
      const cat = String(r.category || 'Custom Works').trim();
      if (!code || !name) {
        skipped++;
        skippedReasons.push(`Missing code or name for row "${name || code}"`);
        continue;
      }
      const exists = db.prepare('SELECT id FROM quotation_catalog_items WHERE UPPER(item_code) = ?').get(code);
      if (exists) {
        skipped++;
        skippedReasons.push(`Duplicate SKU "${code}" skipped`);
        continue;
      }
      ins.run(
        code,
        name,
        String(r.description || ''),
        String(r.specification || ''),
        cat,
        String(r.defaultUnit || r.unit || 'pcs'),
        String(r.itemType || r.item_type || 'Material'),
        Math.max(0, Number(r.matUnitCost || 0)),
        Math.max(0, Number(r.lbrUnitCost || 0)),
        Math.min(0.9, Math.max(0, Number(r.defaultMatGpPct ?? 0.3))),
        Math.min(0.9, Math.max(0, Number(r.defaultLbrGpPct ?? 0.3))),
        String(r.supplierRef || ''),
        String(r.remarks || ''),
        req.user!.id
      );
      inserted++;
    }
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'IMPORT_CATALOG_ITEMS_CSV',
    module: 'catalog',
    recordType: 'quotation_catalog_item',
    recordRef: `BATCH-${inserted}`,
    newValue: { inserted, skipped },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'catalog:items_imported', module: 'catalog', payload: { inserted, skipped } });
  res.json({ inserted, skipped, skippedReasons });
});

router.get('/catalog/items/:id', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  const itemId = Number(req.params.id);
  const item = db.prepare('SELECT * FROM quotation_catalog_items WHERE id = ?').get(itemId) as any;
  if (!item) {
    res.status(404).json({ error: 'Catalog item not found' });
    return;
  }
  const showCost = canViewInternalCosting(req.user);

  const supplierPrices = db
    .prepare(
      `SELECT sp.*, s.name AS supplier_name, s.supplier_code, s.contact_person, s.phone,
              u.full_name AS created_by_name
       FROM catalog_item_supplier_prices sp
       JOIN suppliers s ON s.id = sp.supplier_id
       LEFT JOIN users u ON u.id = sp.created_by
       WHERE sp.catalog_item_id = ?
       ORDER BY sp.is_active DESC, sp.is_preferred DESC, sp.id DESC`
    )
    .all(itemId) as any[];

  const priceHistory = showCost
    ? db
        .prepare(
          `SELECT ph.*, u.full_name AS updated_by_name
           FROM quotation_item_price_history ph
           LEFT JOIN users u ON u.id = ph.updated_by
           WHERE ph.catalog_item_id = ?
           ORDER BY ph.id DESC LIMIT 50`
        )
        .all(itemId)
    : [];

  const attachments = db
    .prepare(
      `SELECT pa.*, u.full_name AS uploaded_by_name
       FROM protected_attachments pa
       LEFT JOIN users u ON u.id = pa.uploaded_by
       WHERE pa.entity_type = 'catalog_item' AND pa.entity_id = ?
       ORDER BY pa.id DESC`
    )
    .all(itemId);

  const usedInAssemblies = db
    .prepare(
      `SELECT DISTINCT wa.id, wa.assembly_code, wa.name, wa.category_name, wa.current_version
       FROM work_assembly_items wai
       JOIN work_assemblies wa ON wa.id = wai.assembly_id
       WHERE wai.catalog_item_id = ?
       ORDER BY wa.name ASC`
    )
    .all(itemId);

  const matSell = item.mat_unit_cost > 0 ? calcSellingRate(Number(item.mat_unit_cost), Number(item.default_mat_gp_pct ?? 0.3), 'computed') : 0;
  const lbrSell = item.lbr_unit_cost > 0 ? calcSellingRate(Number(item.lbr_unit_cost), Number(item.default_lbr_gp_pct ?? 0.3), 'computed') : 0;

  const safeItem = showCost
    ? { ...item, mat_sell_rate: matSell, lbr_sell_rate: lbrSell, combined_sell_rate: matSell + lbrSell }
    : {
        id: item.id,
        item_code: item.item_code,
        name: item.name,
        description: item.description,
        specification: item.specification,
        category: item.category,
        subcategory: item.subcategory,
        default_unit: item.default_unit,
        item_type: item.item_type,
        is_general_requirement: item.is_general_requirement,
        is_active: item.is_active,
        remarks: item.remarks,
        mat_sell_rate: matSell,
        lbr_sell_rate: lbrSell,
        combined_sell_rate: matSell + lbrSell,
        archived_at: item.archived_at,
        updated_at: item.updated_at,
      };

  const safeSupplierPrices = showCost
    ? supplierPrices
    : supplierPrices.map(({ unit_price: _up, ...rest }) => rest);

  res.json({
    item: safeItem,
    supplierPrices: safeSupplierPrices,
    priceHistory,
    attachments,
    usedInAssemblies,
    canViewInternalCosting: showCost,
  });
});

router.post('/catalog/items', requirePermission('catalog', 'create_item'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  const itemCode = String(b.itemCode || '').trim().toUpperCase();
  const name = String(b.name || '').trim();
  const category = String(b.category || '').trim();

  if (!itemCode || !name || !category) {
    res.status(400).json({ error: 'Item code, name, and category are required' });
    return;
  }

  const codeDup = db.prepare('SELECT id, item_code, name FROM quotation_catalog_items WHERE UPPER(item_code) = ?').get(itemCode) as any;
  if (codeDup) {
    res.status(409).json({ error: `Duplicate Item Code "${itemCode}" already belongs to "${codeDup.name}"` });
    return;
  }

  const normName = normalizeText(name);
  const normSpec = normalizeText(String(b.specification || ''));
  if (!b.confirmNotDuplicate) {
    const existingAll = db.prepare('SELECT id, item_code, name, specification FROM quotation_catalog_items').all() as any[];
    const match = existingAll.find((x) => normalizeText(x.name) === normName && normalizeText(x.specification) === normSpec);
    if (match) {
      res.status(409).json({
        error: `Potential duplicate item detected: [${match.item_code}] ${match.name} matches this name and specification.`,
      });
      return;
    }
  }

  const matCost = Math.max(0, Number(b.matUnitCost || 0));
  const lbrCost = Math.max(0, Number(b.lbrUnitCost || 0));
  const matGp = Math.min(0.9, Math.max(0, Number(b.defaultMatGpPct ?? 0.3)));
  const lbrGp = Math.min(0.9, Math.max(0, Number(b.defaultLbrGpPct ?? 0.3)));

  const itemId = transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO quotation_catalog_items (
          item_code, name, description, specification, category, subcategory, default_unit,
          item_type, mat_unit_cost, lbr_unit_cost, default_mat_gp_pct, default_lbr_gp_pct,
          supplier_ref, is_general_requirement, calc_rule, is_active, remarks, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'))`
      )
      .run(
        itemCode,
        name,
        b.description || '',
        b.specification || '',
        category,
        b.subcategory || '',
        b.defaultUnit || 'pcs',
        b.itemType || 'Material',
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

    if (b.supplierId && matCost > 0) {
      db.prepare(
        `INSERT INTO catalog_item_supplier_prices (
          catalog_item_id, supplier_id, supplier_item_ref, brand, specifications, unit,
          unit_price, effective_date, is_preferred, is_active, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), 1, 1, 'Initial supplier price on creation', ?)`
      ).run(
        cid,
        Number(b.supplierId),
        b.supplierItemRef || '',
        b.brand || '',
        b.specification || '',
        b.defaultUnit || 'pcs',
        matCost,
        req.user!.id
      );
    }

    return cid;
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_CATALOG_ITEM',
    module: 'catalog',
    recordType: 'quotation_catalog_item',
    recordRef: itemCode,
    newValue: { id: itemId, name, category, itemType: b.itemType || 'Material' },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'catalog:item_created', module: 'catalog', payload: { itemId, itemCode } });
  res.status(201).json({ id: itemId, itemCode });
});

router.put('/catalog/items/:id', requirePermission('catalog', 'edit_item'), (req: AuthenticatedRequest, res) => {
  const itemId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM quotation_catalog_items WHERE id = ?').get(itemId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Catalog item not found' });
    return;
  }
  const b = req.body || {};
  const nextCode = b.itemCode !== undefined ? String(b.itemCode).trim().toUpperCase() : existing.item_code;
  if (nextCode !== existing.item_code) {
    const clash = db.prepare('SELECT id FROM quotation_catalog_items WHERE UPPER(item_code) = ? AND id != ?').get(nextCode, itemId);
    if (clash) {
      res.status(409).json({ error: `Item code "${nextCode}" is already used by another record` });
      return;
    }
  }

  const newMat = b.matUnitCost !== undefined ? Math.max(0, Number(b.matUnitCost)) : existing.mat_unit_cost;
  const newLbr = b.lbrUnitCost !== undefined ? Math.max(0, Number(b.lbrUnitCost)) : existing.lbr_unit_cost;
  const costChanged = newMat !== existing.mat_unit_cost || newLbr !== existing.lbr_unit_cost;
  if (costChanged && !canCatalog(req.user, 'override_cost') && !canCatalog(req.user, 'manage_supplier_prices')) {
    res.status(403).json({ error: 'Permission denied to modify item unit costs (requires override_cost or manage_supplier_prices)' });
    return;
  }

  transaction(() => {
    db.prepare(
      `UPDATE quotation_catalog_items SET
        item_code = ?, name = ?, description = ?, specification = ?, category = ?, subcategory = ?,
        default_unit = ?, item_type = ?, mat_unit_cost = ?, lbr_unit_cost = ?,
        default_mat_gp_pct = ?, default_lbr_gp_pct = ?, supplier_ref = ?,
        is_general_requirement = ?, remarks = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      nextCode,
      b.name !== undefined ? String(b.name).trim() : existing.name,
      b.description ?? existing.description,
      b.specification ?? existing.specification,
      b.category ?? existing.category,
      b.subcategory ?? existing.subcategory,
      b.defaultUnit ?? existing.default_unit,
      b.itemType ?? existing.item_type,
      newMat,
      newLbr,
      b.defaultMatGpPct !== undefined ? Math.min(0.9, Math.max(0, Number(b.defaultMatGpPct))) : existing.default_mat_gp_pct,
      b.defaultLbrGpPct !== undefined ? Math.min(0.9, Math.max(0, Number(b.defaultLbrGpPct))) : existing.default_lbr_gp_pct,
      b.supplierRef ?? existing.supplier_ref,
      b.isGeneralRequirement !== undefined ? (b.isGeneralRequirement ? 1 : 0) : existing.is_general_requirement,
      b.remarks ?? existing.remarks,
      itemId
    );

    if (newMat !== existing.mat_unit_cost) {
      db.prepare(
        `INSERT INTO quotation_item_price_history (catalog_item_id, cost_type, previous_cost, new_cost, effective_date, supplier_ref, updated_by, remarks)
         VALUES (?, 'material', ?, ?, date('now'), ?, ?, ?)`
      ).run(itemId, existing.mat_unit_cost, newMat, b.supplierRef ?? existing.supplier_ref, req.user!.id, b.priceChangeRemarks || 'Catalog item updated');
    }
    if (newLbr !== existing.lbr_unit_cost) {
      db.prepare(
        `INSERT INTO quotation_item_price_history (catalog_item_id, cost_type, previous_cost, new_cost, effective_date, supplier_ref, updated_by, remarks)
         VALUES (?, 'labor', ?, ?, date('now'), ?, ?, ?)`
      ).run(itemId, existing.lbr_unit_cost, newLbr, b.supplierRef ?? existing.supplier_ref, req.user!.id, b.priceChangeRemarks || 'Catalog item updated');
    }
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_CATALOG_ITEM',
    module: 'catalog',
    recordType: 'quotation_catalog_item',
    recordRef: nextCode,
    previousValue: { matCost: existing.mat_unit_cost, lbrCost: existing.lbr_unit_cost, name: existing.name },
    newValue: { matCost: newMat, lbrCost: newLbr, name: b.name ?? existing.name },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'catalog:item_updated', module: 'catalog', payload: { itemId } });
  res.json({ ok: true });
});

router.post('/catalog/items/:id/duplicate', requirePermission('catalog', 'create_item'), (req: AuthenticatedRequest, res) => {
  const itemId = Number(req.params.id);
  const src = db.prepare('SELECT * FROM quotation_catalog_items WHERE id = ?').get(itemId) as any;
  if (!src) {
    res.status(404).json({ error: 'Catalog item not found' });
    return;
  }
  let suffix = 1;
  let newCode = `${src.item_code}-COPY`;
  while (db.prepare('SELECT 1 FROM quotation_catalog_items WHERE item_code = ?').get(newCode)) {
    suffix += 1;
    newCode = `${src.item_code}-COPY${suffix}`;
  }

  const info = db
    .prepare(
      `INSERT INTO quotation_catalog_items (
        item_code, name, description, specification, category, subcategory, default_unit,
        item_type, mat_unit_cost, lbr_unit_cost, default_mat_gp_pct, default_lbr_gp_pct,
        supplier_ref, is_general_requirement, calc_rule, is_active, remarks, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'))`
    )
    .run(
      newCode,
      `${src.name} (Copy)`,
      src.description,
      src.specification,
      src.category,
      src.subcategory,
      src.default_unit,
      src.item_type,
      src.mat_unit_cost,
      src.lbr_unit_cost,
      src.default_mat_gp_pct,
      src.default_lbr_gp_pct,
      src.supplier_ref,
      src.is_general_requirement,
      src.calc_rule,
      src.remarks,
      req.user!.id
    );

  const newId = Number(info.lastInsertRowid);
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'DUPLICATE_CATALOG_ITEM',
    module: 'catalog',
    recordType: 'quotation_catalog_item',
    recordRef: newCode,
    newValue: { sourceId: itemId, newId },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'catalog:item_created', module: 'catalog', payload: { itemId: newId } });
  res.status(201).json({ id: newId, itemCode: newCode });
});

router.post('/catalog/items/:id/archive', requirePermission('catalog', 'archive_record'), (req: AuthenticatedRequest, res) => {
  const itemId = Number(req.params.id);
  const src = db.prepare('SELECT * FROM quotation_catalog_items WHERE id = ?').get(itemId) as any;
  if (!src) {
    res.status(404).json({ error: 'Catalog item not found' });
    return;
  }
  db.prepare("UPDATE quotation_catalog_items SET is_active = 0, archived_at = datetime('now'), archived_by = ?, updated_at = datetime('now') WHERE id = ?").run(
    req.user!.id,
    itemId
  );
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'ARCHIVE_CATALOG_ITEM',
    module: 'catalog',
    recordType: 'quotation_catalog_item',
    recordRef: src.item_code,
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'catalog:item_archived', module: 'catalog', payload: { itemId } });
  res.json({ ok: true });
});

router.post('/catalog/items/:id/restore', requirePermission('catalog', 'restore_record'), (req: AuthenticatedRequest, res) => {
  const itemId = Number(req.params.id);
  const src = db.prepare('SELECT * FROM quotation_catalog_items WHERE id = ?').get(itemId) as any;
  if (!src) {
    res.status(404).json({ error: 'Catalog item not found' });
    return;
  }
  db.prepare("UPDATE quotation_catalog_items SET is_active = 1, archived_at = NULL, archived_by = NULL, updated_at = datetime('now') WHERE id = ?").run(
    itemId
  );
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'RESTORE_CATALOG_ITEM',
    module: 'catalog',
    recordType: 'quotation_catalog_item',
    recordRef: src.item_code,
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'catalog:item_restored', module: 'catalog', payload: { itemId } });
  res.json({ ok: true });
});

// 4. Master Suppliers & Supplier Price Records (Preserves Historical Prices)
router.get('/catalog/suppliers', requirePermission('catalog', 'view'), (_req, res) => {
  ensureCatalogOfWorksSeed();
  const suppliers = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM catalog_item_supplier_prices sp WHERE sp.supplier_id = s.id AND sp.is_active = 1) AS active_price_count
       FROM suppliers s
       ORDER BY s.is_active DESC, s.name ASC`
    )
    .all();
  res.json({ suppliers });
});

router.post('/catalog/suppliers', requirePermission('catalog', 'manage_suppliers'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'Supplier name is required' });
    return;
  }
  const dup = db.prepare('SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?)').get(name);
  if (dup) {
    res.status(409).json({ error: `Supplier "${name}" already exists` });
    return;
  }
  let code = String(b.supplierCode || '').trim().toUpperCase();
  if (!code) {
    const cnt = (db.prepare('SELECT COUNT(*) AS c FROM suppliers').get() as { c: number }).c;
    code = `SUP-${String(cnt + 1).padStart(3, '0')}`;
    while (db.prepare('SELECT 1 FROM suppliers WHERE supplier_code = ?').get(code)) {
      code = `SUP-${Date.now().toString().slice(-4)}`;
    }
  }
  const info = db
    .prepare(
      `INSERT INTO suppliers (supplier_code, name, contact_person, email, phone, address, category_tags, payment_terms, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      code,
      name,
      b.contactPerson || '',
      b.email || '',
      b.phone || '',
      b.address || '',
      b.categoryTags || '',
      b.paymentTerms || '30 Days',
      b.notes || '',
      req.user!.id
    );

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_SUPPLIER',
    module: 'catalog',
    recordType: 'supplier',
    recordRef: code,
    newValue: { id: Number(info.lastInsertRowid), name },
    ipAddress: req.ip || '',
  });
  res.status(201).json({ id: Number(info.lastInsertRowid), supplierCode: code });
});

router.put('/catalog/suppliers/:id', requirePermission('catalog', 'manage_suppliers'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Supplier not found' });
    return;
  }
  const b = req.body || {};
  db.prepare(
    `UPDATE suppliers SET
      name = ?, contact_person = ?, email = ?, phone = ?, address = ?, category_tags = ?,
      payment_terms = ?, is_active = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    b.name !== undefined ? String(b.name).trim() : existing.name,
    b.contactPerson ?? existing.contact_person,
    b.email ?? existing.email,
    b.phone ?? existing.phone,
    b.address ?? existing.address,
    b.categoryTags ?? existing.category_tags,
    b.paymentTerms ?? existing.payment_terms,
    b.isActive !== undefined ? (b.isActive ? 1 : 0) : existing.is_active,
    b.notes ?? existing.notes,
    id
  );
  res.json({ ok: true });
});

router.post('/catalog/items/:id/supplier-prices', requirePermission('catalog', 'manage_supplier_prices'), (req: AuthenticatedRequest, res) => {
  const itemId = Number(req.params.id);
  const item = db.prepare('SELECT * FROM quotation_catalog_items WHERE id = ?').get(itemId) as any;
  if (!item) {
    res.status(404).json({ error: 'Catalog item not found' });
    return;
  }

  const b = req.body || {};
  const supplierId = Number(b.supplierId);
  const unitPrice = Number(b.unitPrice);
  if (!supplierId || isNaN(unitPrice) || unitPrice <= 0) {
    res.status(400).json({ error: 'Valid supplier and positive unit price are required' });
    return;
  }
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId) as any;
  if (!supplier) {
    res.status(404).json({ error: 'Supplier not found' });
    return;
  }

  const priceId = transaction(() => {
    // Preserve previous price records as historical (never overwrite); deactivate older active record for same supplier+unit so history stays intact
    db.prepare(
      `UPDATE catalog_item_supplier_prices
       SET is_active = 0, is_preferred = 0
       WHERE catalog_item_id = ? AND supplier_id = ? AND is_active = 1`
    ).run(itemId, supplierId);

    if (b.isPreferred) {
      db.prepare('UPDATE catalog_item_supplier_prices SET is_preferred = 0 WHERE catalog_item_id = ?').run(itemId);
    }

    const info = db
      .prepare(
        `INSERT INTO catalog_item_supplier_prices (
          catalog_item_id, supplier_id, supplier_item_ref, brand, specifications, unit,
          unit_price, effective_date, valid_until, remarks, is_preferred, is_active, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        itemId,
        supplierId,
        b.supplierItemRef || '',
        b.brand || '',
        b.specifications || item.specification || '',
        b.unit || item.default_unit,
        unitPrice,
        b.effectiveDate || new Date().toISOString().slice(0, 10),
        b.validUntil || null,
        b.remarks || '',
        b.isPreferred ? 1 : 0,
        req.user!.id
      );

    if (b.syncDefaultItemCost || b.isPreferred) {
      db.prepare(
        `INSERT INTO quotation_item_price_history (catalog_item_id, cost_type, previous_cost, new_cost, effective_date, supplier_ref, updated_by, remarks)
         VALUES (?, 'material', ?, ?, ?, ?, ?, ?)`
      ).run(
        itemId,
        item.mat_unit_cost,
        unitPrice,
        b.effectiveDate || new Date().toISOString().slice(0, 10),
        supplier.name,
        req.user!.id,
        b.remarks || `Preferred supplier price updated (${supplier.name})`
      );
      if (b.syncDefaultItemCost) {
        db.prepare(
          "UPDATE quotation_catalog_items SET mat_unit_cost = ?, supplier_ref = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(unitPrice, supplier.name, itemId);
      }
    }

    return Number(info.lastInsertRowid);
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'RECORD_SUPPLIER_PRICE',
    module: 'catalog',
    recordType: 'catalog_item_supplier_price',
    recordRef: `${item.item_code}/${supplier.supplier_code}`,
    newValue: { priceId, unitPrice, supplierName: supplier.name },
    ipAddress: req.ip || '',
  });
  notifyCatalogStakeholders(
    `Supplier price recorded: ${item.name}`,
    `${supplier.name} price updated to ${unitPrice} per ${b.unit || item.default_unit}.`,
    req.user!.id
  );
  emitSyncEvent({ eventType: 'catalog:supplier_price_updated', module: 'catalog', payload: { itemId, supplierId } });

  res.status(201).json({ id: priceId });
});

router.patch('/catalog/supplier-prices/:priceId/toggle', requirePermission('catalog', 'manage_supplier_prices'), (req: AuthenticatedRequest, res) => {
  const priceId = Number(req.params.priceId);
  const existing = db.prepare('SELECT * FROM catalog_item_supplier_prices WHERE id = ?').get(priceId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Supplier price record not found' });
    return;
  }
  const { isPreferred, isActive } = req.body || {};
  transaction(() => {
    if (isPreferred) {
      db.prepare('UPDATE catalog_item_supplier_prices SET is_preferred = 0 WHERE catalog_item_id = ?').run(existing.catalog_item_id);
      db.prepare('UPDATE catalog_item_supplier_prices SET is_preferred = 1, is_active = 1 WHERE id = ?').run(priceId);
    } else if (isActive !== undefined) {
      db.prepare('UPDATE catalog_item_supplier_prices SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, priceId);
    }
  });
  res.json({ ok: true });
});

// 5. Sets of Works (Reusable Construction Assemblies) + Visual Editor + Version Control
router.get('/catalog/assemblies', requirePermission('catalog', 'view'), (req, res) => {
  ensureCatalogOfWorksSeed();
  const { category, search, status = 'active' } = req.query;
  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  if (status === 'active') where.push('wa.is_active = 1');
  else if (status === 'archived') where.push('wa.is_active = 0');

  if (category && category !== 'all') {
    where.push('wa.category_name = ?');
    params.push(String(category));
  }
  if (search) {
    const like = `%${String(search).trim()}%`;
    where.push('(wa.assembly_code LIKE ? OR wa.name LIKE ? OR wa.description LIKE ? OR wa.specifications LIKE ?)');
    params.push(like, like, like, like);
  }

  const rows = db
    .prepare(
      `SELECT wa.*,
              u.full_name AS updated_by_name,
              (SELECT COUNT(*) FROM work_assembly_items wai WHERE wai.assembly_id = wa.id) AS total_components,
              (SELECT COUNT(*) FROM work_assembly_items wai WHERE wai.assembly_id = wa.id AND wai.component_type = 'Material') AS material_count,
              (SELECT COUNT(*) FROM work_assembly_items wai WHERE wai.assembly_id = wa.id AND wai.component_type = 'Labor') AS labor_count,
              (SELECT COUNT(*) FROM work_assembly_items wai WHERE wai.assembly_id = wa.id AND wai.component_type NOT IN ('Material', 'Labor')) AS other_count
       FROM work_assemblies wa
       LEFT JOIN users u ON u.id = wa.updated_by
       WHERE ${where.join(' AND ')}
       ORDER BY wa.is_active DESC, wa.category_name ASC, wa.name ASC`
    )
    .all(...params);

  res.json({ assemblies: rows });
});

router.get('/catalog/assemblies/:id', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const asm = db
    .prepare(
      `SELECT wa.*, u1.full_name AS created_by_name, u2.full_name AS updated_by_name
       FROM work_assemblies wa
       LEFT JOIN users u1 ON u1.id = wa.created_by
       LEFT JOIN users u2 ON u2.id = wa.updated_by
       WHERE wa.id = ?`
    )
    .get(id) as any;
  if (!asm) {
    res.status(404).json({ error: 'Set of Works assembly not found' });
    return;
  }

  const items = db
    .prepare(
      `SELECT wai.*,
              ci.mat_unit_cost, ci.lbr_unit_cost, ci.default_mat_gp_pct, ci.default_lbr_gp_pct,
              ci.is_active AS catalog_item_active,
              s.name AS preferred_supplier_name,
              (SELECT sp.unit_price FROM catalog_item_supplier_prices sp
               WHERE sp.catalog_item_id = wai.catalog_item_id AND sp.supplier_id = wai.preferred_supplier_id AND sp.is_active = 1
               ORDER BY sp.id DESC LIMIT 1) AS preferred_supplier_price
       FROM work_assembly_items wai
       LEFT JOIN quotation_catalog_items ci ON ci.id = wai.catalog_item_id
       LEFT JOIN suppliers s ON s.id = wai.preferred_supplier_id
       WHERE wai.assembly_id = ?
       ORDER BY wai.sort_order ASC, wai.id ASC`
    )
    .all(id) as any[];

  const showCost = canViewInternalCosting(req.user);
  const supChoicesRaw = db
    .prepare(
      `SELECT sp.catalog_item_id, sp.supplier_id, s.name AS supplier_name, sp.unit_price, sp.unit, sp.brand, sp.is_preferred
       FROM catalog_item_supplier_prices sp
       JOIN suppliers s ON s.id = sp.supplier_id
       WHERE sp.is_active = 1`
    )
    .all() as any[];

  const supplierChoicesByItem: Record<number, any[]> = {};
  for (const sc of supChoicesRaw) {
    if (!supplierChoicesByItem[sc.catalog_item_id]) supplierChoicesByItem[sc.catalog_item_id] = [];
    supplierChoicesByItem[sc.catalog_item_id].push(
      showCost
        ? sc
        : {
            catalog_item_id: sc.catalog_item_id,
            supplier_id: sc.supplier_id,
            supplier_name: sc.supplier_name,
            unit: sc.unit,
            brand: sc.brand,
            is_preferred: sc.is_preferred,
          }
    );
  }

  const versions = db
    .prepare(
      `SELECT wav.id, wav.version_number, wav.change_summary, wav.created_at, u.full_name AS changed_by_name
       FROM work_assembly_versions wav
       LEFT JOIN users u ON u.id = wav.changed_by
       WHERE wav.assembly_id = ?
       ORDER BY wav.version_number DESC`
    )
    .all(id);

  res.json({
    assembly: sanitizeAssemblyForUser(asm, items, req.user),
    supplierChoicesByItem,
    versions,
    canViewInternalCosting: showCost,
  });
});

router.post('/catalog/assemblies', requirePermission('catalog', 'create_assembly'), (req: AuthenticatedRequest, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const categoryName = String(b.categoryName || '').trim();
  if (!name || !categoryName) {
    res.status(400).json({ error: 'Assembly name and work category are required' });
    return;
  }

  let asmCode = String(b.assemblyCode || '').trim().toUpperCase();
  if (!asmCode) {
    const prefix = categoryName.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase() || 'WRK';
    const cnt = (db.prepare('SELECT COUNT(*) AS c FROM work_assemblies').get() as { c: number }).c;
    asmCode = `SOW-${prefix}-${String(cnt + 1).padStart(3, '0')}`;
    while (db.prepare('SELECT 1 FROM work_assemblies WHERE assembly_code = ?').get(asmCode)) {
      asmCode = `SOW-${prefix}-${Date.now().toString().slice(-4)}`;
    }
  } else if (db.prepare('SELECT 1 FROM work_assemblies WHERE UPPER(assembly_code) = ?').get(asmCode)) {
    res.status(409).json({ error: `Assembly code "${asmCode}" already exists` });
    return;
  }

  const components = Array.isArray(b.components) ? b.components : [];
  const catRow = db.prepare('SELECT id FROM quotation_categories WHERE LOWER(name) = LOWER(?)').get(categoryName) as
    | { id: number }
    | undefined;

  const assemblyId = transaction(() => {
    const aRes = db
      .prepare(
        `INSERT INTO work_assemblies (
          assembly_code, name, category_id, category_name, description, specifications,
          unit, default_calc_method, default_qty, labor_requirements, installation_instructions,
          notes, current_version, is_active, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
      )
      .run(
        asmCode,
        name,
        catRow?.id ?? null,
        categoryName,
        b.description || '',
        b.specifications || '',
        b.unit || 'sq.m',
        b.defaultCalcMethod || 'per_sqm',
        Math.max(0.0001, Number(b.defaultQty || 1)),
        b.laborRequirements || '',
        b.installationInstructions || '',
        b.notes || '',
        req.user!.id,
        req.user!.id
      );
    const aid = Number(aRes.lastInsertRowid);

    const insComp = db.prepare(
      `INSERT INTO work_assembly_items (
        assembly_id, catalog_item_id, component_type, item_code, item_name,
        specification, unit, calc_basis, consumption_rate, wastage_pct,
        preferred_supplier_id, notes, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    components.forEach((c: any, idx: number) => {
      insComp.run(
        aid,
        c.catalogItemId ? Number(c.catalogItemId) : null,
        c.componentType || 'Material',
        c.itemCode || '',
        String(c.itemName || 'Component').trim(),
        c.specification || '',
        c.unit || 'pcs',
        c.calcBasis === 'fixed' ? 'fixed' : 'per_unit',
        Math.max(0, Number(c.consumptionRate ?? 1)),
        Math.min(100, Math.max(0, Number(c.wastagePct ?? 0))),
        c.preferredSupplierId ? Number(c.preferredSupplierId) : null,
        c.notes || '',
        idx + 1
      );
    });

    const snapshot = buildAssemblySnapshot(aid);
    db.prepare(
      `INSERT INTO work_assembly_versions (assembly_id, version_number, change_summary, snapshot_json, changed_by)
       VALUES (?, 1, ?, ?, ?)`
    ).run(aid, b.changeSummary || 'Created initial Set of Works template', JSON.stringify(snapshot), req.user!.id);

    return aid;
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CREATE_WORK_ASSEMBLY',
    module: 'catalog',
    recordType: 'work_assembly',
    recordRef: asmCode,
    newValue: { assemblyId, name, categoryName, componentCount: components.length },
    ipAddress: req.ip || '',
  });
  notifyCatalogStakeholders(
    `New Set of Works: ${name}`,
    `${req.user!.full_name} created reusable assembly [${asmCode}] in ${categoryName}.`,
    req.user!.id
  );
  emitSyncEvent({ eventType: 'catalog:assembly_created', module: 'catalog', payload: { assemblyId } });

  res.status(201).json({ id: assemblyId, assemblyCode: asmCode });
});

router.put('/catalog/assemblies/:id', requirePermission('catalog', 'edit_assembly'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM work_assemblies WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Set of Works assembly not found' });
    return;
  }

  const b = req.body || {};
  const nextName = b.name !== undefined ? String(b.name).trim() : existing.name;
  const nextCat = b.categoryName !== undefined ? String(b.categoryName).trim() : existing.category_name;
  if (!nextName || !nextCat) {
    res.status(400).json({ error: 'Assembly name and category are required' });
    return;
  }

  const catRow = db.prepare('SELECT id FROM quotation_categories WHERE LOWER(name) = LOWER(?)').get(nextCat) as
    | { id: number }
    | undefined;
  const components = Array.isArray(b.components) ? b.components : null;
  const nextVersion = Number(existing.current_version || 1) + 1;

  transaction(() => {
    db.prepare(
      `UPDATE work_assemblies SET
        name = ?, category_id = ?, category_name = ?, description = ?, specifications = ?,
        unit = ?, default_calc_method = ?, default_qty = ?, labor_requirements = ?,
        installation_instructions = ?, notes = ?, current_version = ?, updated_by = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      nextName,
      catRow?.id ?? existing.category_id,
      nextCat,
      b.description ?? existing.description,
      b.specifications ?? existing.specifications,
      b.unit ?? existing.unit,
      b.defaultCalcMethod ?? existing.default_calc_method,
      b.defaultQty !== undefined ? Math.max(0.0001, Number(b.defaultQty)) : existing.default_qty,
      b.laborRequirements ?? existing.labor_requirements,
      b.installationInstructions ?? existing.installation_instructions,
      b.notes ?? existing.notes,
      nextVersion,
      req.user!.id,
      id
    );

    if (components !== null) {
      db.prepare('DELETE FROM work_assembly_items WHERE assembly_id = ?').run(id);
      const insComp = db.prepare(
        `INSERT INTO work_assembly_items (
          assembly_id, catalog_item_id, component_type, item_code, item_name,
          specification, unit, calc_basis, consumption_rate, wastage_pct,
          preferred_supplier_id, notes, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      components.forEach((c: any, idx: number) => {
        insComp.run(
          id,
          c.catalogItemId ? Number(c.catalogItemId) : null,
          c.componentType || 'Material',
          c.itemCode || '',
          String(c.itemName || 'Component').trim(),
          c.specification || '',
          c.unit || 'pcs',
          c.calcBasis === 'fixed' ? 'fixed' : 'per_unit',
          Math.max(0, Number(c.consumptionRate ?? 1)),
          Math.min(100, Math.max(0, Number(c.wastagePct ?? 0))),
          c.preferredSupplierId ? Number(c.preferredSupplierId) : null,
          c.notes || '',
          idx + 1
        );
      });
    }

    const snapshot = buildAssemblySnapshot(id);
    db.prepare(
      `INSERT INTO work_assembly_versions (assembly_id, version_number, change_summary, snapshot_json, changed_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      id,
      nextVersion,
      String(b.changeSummary || '').trim() || `Updated assembly to v${nextVersion}`,
      JSON.stringify(snapshot),
      req.user!.id
    );
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_WORK_ASSEMBLY',
    module: 'catalog',
    recordType: 'work_assembly',
    recordRef: `${existing.assembly_code}-v${nextVersion}`,
    previousValue: { version: existing.current_version, name: existing.name },
    newValue: { version: nextVersion, name: nextName, changeSummary: b.changeSummary || '' },
    ipAddress: req.ip || '',
  });
  notifyCatalogStakeholders(
    `Set of Works updated: ${nextName} (v${nextVersion})`,
    `${req.user!.full_name} saved v${nextVersion}. Historical quotations remain unchanged.`,
    req.user!.id
  );
  emitSyncEvent({ eventType: 'catalog:assembly_updated', module: 'catalog', payload: { id, version: nextVersion } });

  res.json({ ok: true, version: nextVersion });
});

router.post('/catalog/assemblies/:id/duplicate', requirePermission('catalog', 'duplicate_assembly'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const src = db.prepare('SELECT * FROM work_assemblies WHERE id = ?').get(id) as any;
  if (!src) {
    res.status(404).json({ error: 'Set of Works assembly not found' });
    return;
  }
  const srcItems = db.prepare('SELECT * FROM work_assembly_items WHERE assembly_id = ? ORDER BY sort_order ASC').all(id) as any[];

  let newCode = `${src.assembly_code}-COPY`;
  let suffix = 1;
  while (db.prepare('SELECT 1 FROM work_assemblies WHERE assembly_code = ?').get(newCode)) {
    suffix += 1;
    newCode = `${src.assembly_code}-COPY${suffix}`;
  }

  const newId = transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO work_assemblies (
          assembly_code, name, category_id, category_name, description, specifications,
          unit, default_calc_method, default_qty, labor_requirements, installation_instructions,
          notes, current_version, is_active, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
      )
      .run(
        newCode,
        `${src.name} (Copy)`,
        src.category_id,
        src.category_name,
        src.description,
        src.specifications,
        src.unit,
        src.default_calc_method,
        src.default_qty,
        src.labor_requirements,
        src.installation_instructions,
        src.notes,
        req.user!.id,
        req.user!.id
      );
    const aid = Number(info.lastInsertRowid);

    const insComp = db.prepare(
      `INSERT INTO work_assembly_items (
        assembly_id, catalog_item_id, component_type, item_code, item_name,
        specification, unit, calc_basis, consumption_rate, wastage_pct,
        preferred_supplier_id, notes, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    srcItems.forEach((c, idx) => {
      insComp.run(
        aid,
        c.catalog_item_id,
        c.component_type,
        c.item_code,
        c.item_name,
        c.specification,
        c.unit,
        c.calc_basis,
        c.consumption_rate,
        c.wastage_pct,
        c.preferred_supplier_id,
        c.notes,
        idx + 1
      );
    });

    const snapshot = buildAssemblySnapshot(aid);
    db.prepare(
      `INSERT INTO work_assembly_versions (assembly_id, version_number, change_summary, snapshot_json, changed_by)
       VALUES (?, 1, ?, ?, ?)`
    ).run(aid, `Duplicated from ${src.assembly_code} v${src.current_version}`, JSON.stringify(snapshot), req.user!.id);

    return aid;
  });

  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'DUPLICATE_WORK_ASSEMBLY',
    module: 'catalog',
    recordType: 'work_assembly',
    recordRef: newCode,
    newValue: { sourceId: id, newId },
    ipAddress: req.ip || '',
  });
  emitSyncEvent({ eventType: 'catalog:assembly_created', module: 'catalog', payload: { assemblyId: newId } });
  res.status(201).json({ id: newId, assemblyCode: newCode });
});

router.post('/catalog/assemblies/:id/archive', requirePermission('catalog', 'archive_record'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const src = db.prepare('SELECT * FROM work_assemblies WHERE id = ?').get(id) as any;
  if (!src) {
    res.status(404).json({ error: 'Assembly not found' });
    return;
  }
  db.prepare("UPDATE work_assemblies SET is_active = 0, archived_at = datetime('now'), archived_by = ?, updated_at = datetime('now') WHERE id = ?").run(
    req.user!.id,
    id
  );
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'ARCHIVE_WORK_ASSEMBLY',
    module: 'catalog',
    recordType: 'work_assembly',
    recordRef: src.assembly_code,
    ipAddress: req.ip || '',
  });
  res.json({ ok: true });
});

router.post('/catalog/assemblies/:id/restore', requirePermission('catalog', 'restore_record'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const src = db.prepare('SELECT * FROM work_assemblies WHERE id = ?').get(id) as any;
  if (!src) {
    res.status(404).json({ error: 'Assembly not found' });
    return;
  }
  db.prepare("UPDATE work_assemblies SET is_active = 1, archived_at = NULL, archived_by = NULL, updated_at = datetime('now') WHERE id = ?").run(
    id
  );
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'RESTORE_WORK_ASSEMBLY',
    module: 'catalog',
    recordType: 'work_assembly',
    recordRef: src.assembly_code,
    ipAddress: req.ip || '',
  });
  res.json({ ok: true });
});

router.get('/catalog/assemblies/:id/versions/:versionNumber', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const vNum = Number(req.params.versionNumber);
  const row = db
    .prepare(
      `SELECT wav.*, u.full_name AS changed_by_name
       FROM work_assembly_versions wav
       LEFT JOIN users u ON u.id = wav.changed_by
       WHERE wav.assembly_id = ? AND wav.version_number = ?`
    )
    .get(id, vNum) as any;
  if (!row) {
    res.status(404).json({ error: 'Assembly version not found' });
    return;
  }

  const snapshot = JSON.parse(row.snapshot_json || '{}');
  if (!canViewInternalCosting(req.user) && Array.isArray(snapshot.components)) {
    snapshot.components = snapshot.components.map(({ mat_unit_cost: _m, lbr_unit_cost: _l, ...rest }: any) => rest);
  }

  res.json({
    versionNumber: row.version_number,
    changeSummary: row.change_summary,
    changedByName: row.changed_by_name,
    createdAt: row.created_at,
    snapshot,
  });
});

router.get('/catalog/assemblies/:id/compare', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const vA = Number(req.query.vA);
  const vB = Number(req.query.vB);

  const rowA = db.prepare('SELECT * FROM work_assembly_versions WHERE assembly_id = ? AND version_number = ?').get(id, vA) as any;
  const rowB = db.prepare('SELECT * FROM work_assembly_versions WHERE assembly_id = ? AND version_number = ?').get(id, vB) as any;
  if (!rowA || !rowB) {
    res.status(404).json({ error: 'Both versions must exist for comparison' });
    return;
  }

  const snapA = JSON.parse(rowA.snapshot_json || '{}');
  const snapB = JSON.parse(rowB.snapshot_json || '{}');

  const metaFields = ['name', 'category_name', 'unit', 'default_calc_method', 'description', 'specifications', 'labor_requirements', 'installation_instructions', 'notes'];
  const metadataDiffs = metaFields
    .filter((f) => String(snapA[f] ?? '') !== String(snapB[f] ?? ''))
    .map((f) => ({ field: f, before: snapA[f] ?? '', after: snapB[f] ?? '' }));

  const mapA = new Map<string, any>();
  for (const c of snapA.components || []) {
    mapA.set(`${c.item_code || ''}::${c.item_name}`, c);
  }
  const mapB = new Map<string, any>();
  for (const c of snapB.components || []) {
    mapB.set(`${c.item_code || ''}::${c.item_name}`, c);
  }

  const keys = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
  const componentDiffs = keys.map((k) => {
    const a = mapA.get(k);
    const b = mapB.get(k);
    if (!a && b) {
      return { key: k, change: 'added', itemName: b.item_name, unit: b.unit, oldRate: 0, newRate: b.consumption_rate, oldWastage: 0, newWastage: b.wastage_pct };
    }
    if (a && !b) {
      return { key: k, change: 'removed', itemName: a.item_name, unit: a.unit, oldRate: a.consumption_rate, newRate: 0, oldWastage: a.wastage_pct, newWastage: 0 };
    }
    const modified =
      a.consumption_rate !== b.consumption_rate ||
      a.wastage_pct !== b.wastage_pct ||
      a.calc_basis !== b.calc_basis ||
      a.preferred_supplier_id !== b.preferred_supplier_id;
    return {
      key: k,
      change: modified ? 'modified' : 'unchanged',
      itemName: b.item_name,
      unit: b.unit,
      oldRate: a.consumption_rate,
      newRate: b.consumption_rate,
      oldWastage: a.wastage_pct,
      newWastage: b.wastage_pct,
      oldSupplier: a.preferred_supplier_name || '',
      newSupplier: b.preferred_supplier_name || '',
    };
  });

  res.json({
    vA: { version: rowA.version_number, summary: rowA.change_summary, createdAt: rowA.created_at },
    vB: { version: rowB.version_number, summary: rowB.change_summary, createdAt: rowB.created_at },
    metadataDiffs,
    componentDiffs,
  });
});

router.post('/catalog/assemblies/:id/preview', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const measurementQty = Math.max(0, Number(req.body?.measurementQty ?? 1));
  const showCost = canViewInternalCosting(req.user);

  const asm = db.prepare('SELECT * FROM work_assemblies WHERE id = ?').get(id) as any;
  if (!asm) {
    res.status(404).json({ error: 'Assembly not found' });
    return;
  }

  const items = db
    .prepare(
      `SELECT wai.*, ci.mat_unit_cost, ci.lbr_unit_cost, ci.default_mat_gp_pct, ci.default_lbr_gp_pct,
              s.name AS preferred_supplier_name,
              (SELECT sp.unit_price FROM catalog_item_supplier_prices sp
               WHERE sp.catalog_item_id = wai.catalog_item_id AND sp.supplier_id = wai.preferred_supplier_id AND sp.is_active = 1
               ORDER BY sp.id DESC LIMIT 1) AS supplier_unit_price
       FROM work_assembly_items wai
       LEFT JOIN quotation_catalog_items ci ON ci.id = wai.catalog_item_id
       LEFT JOIN suppliers s ON s.id = wai.preferred_supplier_id
       WHERE wai.assembly_id = ?
       ORDER BY wai.sort_order ASC`
    )
    .all(id) as any[];

  const computed = items.map((it) => {
    const rate = Number(it.consumption_rate || 0);
    const waste = Number(it.wastage_pct || 0);
    const factor = 1 + waste / 100;
    const baseQty = it.calc_basis === 'fixed' ? rate : measurementQty * rate;
    const finalQty = Math.round(baseQty * factor * 10000) / 10000;
    const formulaText =
      it.calc_basis === 'fixed'
        ? `Fixed ${rate} ${it.unit}${waste > 0 ? ` × (1 + ${waste}% waste)` : ''}`
        : `${measurementQty} ${asm.unit} × ${rate} ${it.unit}/${asm.unit}${waste > 0 ? ` × (1 + ${waste}% waste)` : ''}`;

    const matUnitCost =
      it.supplier_unit_price !== null && it.supplier_unit_price !== undefined
        ? Number(it.supplier_unit_price)
        : Number(it.mat_unit_cost || 0);
    const lbrUnitCost = Number(it.lbr_unit_cost || 0);
    const matSell = matUnitCost > 0 ? calcSellingRate(matUnitCost, Number(it.default_mat_gp_pct ?? 0.3), 'computed') : 0;
    const lbrSell = lbrUnitCost > 0 ? calcSellingRate(lbrUnitCost, Number(it.default_lbr_gp_pct ?? 0.3), 'computed') : 0;
    const extSell = Math.round(finalQty * (matSell + lbrSell) * 100) / 100;
    const extCost = Math.round(finalQty * (matUnitCost + lbrUnitCost) * 100) / 100;

    return {
      id: it.id,
      component_type: it.component_type,
      item_code: it.item_code,
      item_name: it.item_name,
      unit: it.unit,
      calc_basis: it.calc_basis,
      consumption_rate: rate,
      wastage_pct: waste,
      calculated_qty: finalQty,
      formula_explanation: formulaText,
      preferred_supplier_name: it.preferred_supplier_name || '',
      mat_sell_rate: matSell,
      lbr_sell_rate: lbrSell,
      extended_selling: extSell,
      ...(showCost ? { unit_cost: matUnitCost + lbrUnitCost, extended_cost: extCost } : {}),
    };
  });

  const totalSelling = Math.round(computed.reduce((s, x) => s + x.extended_selling, 0) * 100) / 100;
  const totalCost = showCost ? Math.round(computed.reduce((s, x: any) => s + (x.extended_cost || 0), 0) * 100) / 100 : undefined;

  res.json({
    measurementQty,
    unit: asm.unit,
    components: computed,
    totalSelling,
    ...(showCost ? { totalCost } : {}),
  });
});

// 6. Estimator Missing Item / Catalog Modification Requests
router.get('/catalog/requests', requirePermission('catalog', 'view'), (_req, res) => {
  const requests = db
    .prepare(
      `SELECT cr.*, u1.full_name AS requested_by_name, u2.full_name AS reviewed_by_name
       FROM catalog_requests cr
       JOIN users u1 ON u1.id = cr.requested_by
       LEFT JOIN users u2 ON u2.id = cr.reviewed_by
       ORDER BY CASE WHEN cr.status = 'pending' THEN 0 ELSE 1 END, cr.id DESC`
    )
    .all();
  res.json({ requests });
});

router.post('/catalog/requests', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  if (!canCatalog(req.user, 'request_item') && !canCatalog(req.user, 'create_item')) {
    res.status(403).json({ error: 'Permission denied to request catalog items' });
    return;
  }
  const b = req.body || {};
  const requestedName = String(b.requestedName || '').trim();
  if (!requestedName) {
    res.status(400).json({ error: 'Requested item name is required' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO catalog_requests (
        request_type, requested_name, category, item_type, specification,
        suggested_unit, suggested_supplier, estimated_price, notes, requested_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.requestType || 'new_item',
      requestedName,
      b.category || 'Custom Works',
      b.itemType || 'Material',
      b.specification || '',
      b.suggestedUnit || 'pcs',
      b.suggestedSupplier || '',
      Math.max(0, Number(b.estimatedPrice || 0)),
      b.notes || '',
      req.user!.id
    );

  const reqId = Number(info.lastInsertRowid);
  notifyCatalogStakeholders(
    `Catalog addition requested: ${requestedName}`,
    `${req.user!.full_name} requested a new catalog entry (${b.category || 'Custom Works'}).`,
    req.user!.id
  );
  logAudit({
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'REQUEST_CATALOG_ITEM',
    module: 'catalog',
    recordType: 'catalog_request',
    recordRef: `CREQ-${reqId}`,
    newValue: { requestedName, category: b.category },
    ipAddress: req.ip || '',
  });
  res.status(201).json({ id: reqId });
});

router.patch('/catalog/requests/:id/decide', requirePermission('catalog', 'create_item'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM catalog_requests WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Catalog request not found' });
    return;
  }
  const { decision, reviewNotes = '', itemCode } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) {
    res.status(400).json({ error: 'Decision must be approved or rejected' });
    return;
  }

  let createdItemId: number | null = null;
  transaction(() => {
    if (decision === 'approved') {
      const code =
        String(itemCode || '')
          .trim()
          .toUpperCase() || `CAT-${Date.now().toString().slice(-6)}`;
      const isLabor = existing.item_type === 'Labor';
      const ins = db
        .prepare(
          `INSERT INTO quotation_catalog_items (
            item_code, name, description, specification, category, default_unit, item_type,
            mat_unit_cost, lbr_unit_cost, default_mat_gp_pct, default_lbr_gp_pct,
            supplier_ref, remarks, is_active, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.3, 0.3, ?, ?, 1, ?, datetime('now'))`
        )
        .run(
          code,
          existing.requested_name,
          existing.notes || existing.requested_name,
          existing.specification || '',
          existing.category || 'Custom Works',
          existing.suggested_unit || 'pcs',
          existing.item_type || 'Material',
          isLabor ? 0 : Number(existing.estimated_price || 0),
          isLabor ? Number(existing.estimated_price || 0) : 0,
          existing.suggested_supplier || '',
          `Created from request #${id}: ${reviewNotes}`,
          req.user!.id
        );
      createdItemId = Number(ins.lastInsertRowid);
    }

    db.prepare(
      `UPDATE catalog_requests
       SET status = ?, reviewed_by = ?, review_notes = ?, created_item_id = ?, reviewed_at = datetime('now')
       WHERE id = ?`
    ).run(decision, req.user!.id, reviewNotes, createdItemId, id);
  });

  createNotification({
    userId: existing.requested_by,
    type: 'catalog_request_decision',
    title: `Catalog Request ${decision === 'approved' ? 'Approved' : 'Rejected'}: ${existing.requested_name}`,
    body: reviewNotes || (decision === 'approved' ? 'Item added to master catalog.' : 'Request was declined.'),
    linkSection: 'catalog',
  });
  emitSyncEvent({ eventType: 'catalog:request_decided', module: 'catalog', payload: { id, decision } });
  res.json({ ok: true, createdItemId });
});

// 7. Protected Attachments for Catalog Items & Supplier Docs (Never Public URLs)
router.post('/catalog/attachments/:entityType/:entityId', upload.single('file'), (req: AuthenticatedRequest, res) => {
  const { entityType, entityId } = req.params;
  if (!['catalog_item', 'supplier_price', 'work_assembly'].includes(entityType)) {
    res.status(400).json({ error: 'Unsupported catalog attachment entity type' });
    return;
  }
  if (!canCatalog(req.user, 'edit_item') && !canCatalog(req.user, 'create_item') && !canCatalog(req.user, 'edit_assembly')) {
    res.status(403).json({ error: 'Permission denied to upload catalog attachments' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'File upload is required' });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO protected_attachments (entity_type, entity_id, file_name, stored_path, mime_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(entityType, Number(entityId), req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user!.id);

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    fileSize: req.file.size,
  });
});

router.get('/catalog/attachments/:id/download', requirePermission('catalog', 'view'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const att = db.prepare('SELECT * FROM protected_attachments WHERE id = ?').get(id) as any;
  if (!att) {
    res.status(404).json({ error: 'Attachment not found' });
    return;
  }
  if (att.entity_type === 'supplier_price' && !canViewInternalCosting(req.user)) {
    res.status(403).json({ error: 'Internal supplier price document access prohibited' });
    return;
  }
  const resolved = path.resolve(UPLOADS_DIR, path.basename(att.stored_path));
  if (!resolved.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolved)) {
    res.status(404).json({ error: 'Stored file not found' });
    return;
  }
  res.setHeader('Content-Type', att.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(att.file_name)}"`);
  res.sendFile(resolved);
});

router.delete('/catalog/attachments/:id', requirePermission('catalog', 'edit_item'), (req, res) => {
  const id = Number(req.params.id);
  const att = db.prepare('SELECT * FROM protected_attachments WHERE id = ?').get(id) as any;
  if (!att) {
    res.status(404).json({ error: 'Attachment not found' });
    return;
  }
  if (att.is_locked) {
    res.status(403).json({ error: 'Locked attachment cannot be deleted' });
    return;
  }
  const resolved = path.resolve(UPLOADS_DIR, path.basename(att.stored_path));
  db.prepare('DELETE FROM protected_attachments WHERE id = ?').run(id);
  if (resolved.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(resolved)) {
    try {
      fs.unlinkSync(resolved);
    } catch { /* ignore unlink error */ }
  }
  res.json({ ok: true });
});

export default router;
