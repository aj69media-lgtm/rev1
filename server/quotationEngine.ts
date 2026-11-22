import { type AuthUser, hasPermission } from './auth.ts';

export type PricingMode = 'computed' | 'included' | 'excluded' | 'override';
export type VisibilityMode = 'visible' | 'hidden';
export type RowType = 'section' | 'subsection' | 'item' | 'subitem' | 'note';

export interface ScopeOptions {
  chkSupply: boolean;
  chkInstall: boolean;
  chkDelivery: boolean;
  chkDesign: boolean;
  chkTC: boolean;
  tradeType: 'optCons' | 'optAux' | 'optMEPF' | 'optMisc' | 'optOptions';
}

export interface QuotationTerms {
  mobilization: string;
  delivery: string;
  warranty: string;
  paymentTerms: string;
  downPaymentPct: number;
  progressBillingPct: number;
  retentionPct: number;
  payeeName: string;
  validity: string;
  clientConsiderations: string;
  inclusions: string;
  exclusions: string;
  additionalConditions: string;
}

export interface QuotationSectionInput {
  id?: number;
  tempKey?: string;
  code: string;
  title: string;
  sortOrder: number;
  isCollapsed?: boolean;
}

export interface QuotationItemInput {
  id?: number;
  tempKey?: string;
  sectionId?: number | null;
  sectionKey?: string;
  parentItemId?: number | null;
  parentKey?: string | null;
  rowType: RowType;
  lineNo: string;
  itemCode: string;
  description: string;
  specification?: string;
  qty: number;
  unit: string;
  matPricingMode: PricingMode;
  lbrPricingMode: PricingMode;
  visibilityMode: VisibilityMode;
  rollupChildren?: boolean;
  matUnitCost: number;
  lbrUnitCost: number;
  matGpPct: number;
  lbrGpPct: number;
  overrideMatRate?: number | null;
  overrideLbrRate?: number | null;
  overrideReason?: string;
  overriddenBy?: number | null;
  overriddenAt?: string | null;
  catalogItemId?: number | null;
  supplierRef?: string;
  sortOrder: number;
}

export interface ComputedQuotationItem extends QuotationItemInput {
  matSellRate: number;
  lbrSellRate: number;
  combinedUnitRate: number;
  extendedMatSell: number;
  extendedLbrSell: number;
  extendedSelling: number;
  extendedMatCost: number;
  extendedLbrCost: number;
  extendedCost: number;
  grossProfit: number;
  grossProfitPct: number;
}

export interface SectionSubtotalSummary {
  sectionKey: string;
  code: string;
  title: string;
  matCostSubtotal: number;
  lbrCostSubtotal: number;
  totalDirectCost: number;
  matSellSubtotal: number;
  lbrSellSubtotal: number;
  totalSellingSubtotal: number;
  grossProfitAmount: number;
  grossProfitPct: number;
  visibleItemCount: number;
  hiddenItemCount: number;
}

export interface RevisionCalculationSummary {
  items: ComputedQuotationItem[];
  sectionSubtotals: SectionSubtotalSummary[];
  subtotalMatCost: number;
  subtotalLbrCost: number;
  totalDirectCost: number;
  subtotalMatSell: number;
  subtotalLbrSell: number;
  totalSellingPreVat: number;
  vatRate: number;
  vatAmount: number;
  totalSellingVatInc: number;
  discountPct: number;
  discountAmount: number;
  finalAmount: number;
  grossProfitAmount: number;
  grossProfitPct: number;
  manpowerTeamUnits: number;
  durationWeeks: number;
  durationMonths: number;
}

export function round2(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Reproduces Excel ROUNDUP(unitCost / (1 - gpPct), 0) while eliminating
 * IEEE-754 binary division noise (e.g., 75.60 / 0.7 = 108.00000000000001 -> 108, not 109).
 */
export function calcSellingRate(
  unitCost: number,
  gpPct: number,
  mode: PricingMode,
  overrideRate?: number | null
): number {
  if (mode === 'included' || mode === 'excluded') return 0;
  if (mode === 'override') {
    return Math.max(0, round2(Number(overrideRate ?? 0)));
  }
  const cost = Number(unitCost || 0);
  if (cost <= 0) return 0;
  const gp = Math.min(0.95, Math.max(0, Number(gpPct || 0)));
  const raw = Number((cost / (1 - gp)).toFixed(10));
  return Math.ceil(raw);
}

/**
 * Reproduces Hidden sheet manpower team formula:
 * ROUNDUP(Manpower / 10, 0) + 1 + QUOTIENT(Manpower, 25) + 3 * QUOTIENT(Manpower, 100)
 */
export function calcManpowerTeamUnits(manpower: number): number {
  const m = Math.max(0, Math.floor(Number(manpower || 0)));
  if (m === 0) return 0;
  return Math.ceil(m / 10) + 1 + Math.floor(m / 25) + 3 * Math.floor(m / 100);
}

export function buildDefaultScopeSubject(scope: ScopeOptions, projectName: string): string {
  const cleanName = (projectName || 'CONSTRUCTION PROJECT').trim().toUpperCase();
  if (scope.chkSupply && scope.chkInstall) {
    return `SUPPLY OF LABOR AND MATERIALS FOR ${cleanName}`;
  }
  if (scope.chkSupply && !scope.chkInstall) {
    return `SUPPLY AND DELIVERY OF MATERIALS FOR ${cleanName}`;
  }
  if (!scope.chkSupply && scope.chkInstall) {
    return `SUPPLY OF LABOR AND INSTALLATION FOR ${cleanName}`;
  }
  if (scope.chkDesign) {
    return `DESIGN AND ENGINEERING SERVICES FOR ${cleanName}`;
  }
  return `QUOTATION PROPOSAL FOR ${cleanName}`;
}

export function recalculateRevision(params: {
  sections: QuotationSectionInput[];
  items: QuotationItemInput[];
  vatRate: number;
  discountPct: number;
  estimatedManpower: number;
  estimatedDurationDays: number;
}): RevisionCalculationSummary {
  const vatRate = Math.max(0, Number(params.vatRate ?? 12));
  const discountPct = Math.max(0, Math.min(100, Number(params.discountPct ?? 0)));

  // First pass: compute base rates for every row
  const computedMap = new Map<string, ComputedQuotationItem>();
  const rawComputed: ComputedQuotationItem[] = params.items.map((item, idx) => {
    const qty = Number(item.qty || 0);
    const isPricedRow = item.rowType === 'item' || item.rowType === 'subitem';
    const matSellRate = isPricedRow
      ? calcSellingRate(item.matUnitCost, item.matGpPct, item.matPricingMode, item.overrideMatRate)
      : 0;
    const lbrSellRate = isPricedRow
      ? calcSellingRate(item.lbrUnitCost, item.lbrGpPct, item.lbrPricingMode, item.overrideLbrRate)
      : 0;
    const combinedUnitRate = matSellRate + lbrSellRate;
    const extendedMatSell = round2(qty * matSellRate);
    const extendedLbrSell = round2(qty * lbrSellRate);
    const extendedSelling = round2(qty * combinedUnitRate);
    const matCostUnit = item.matPricingMode === 'included' || item.matPricingMode === 'excluded' ? 0 : Number(item.matUnitCost || 0);
    const lbrCostUnit = item.lbrPricingMode === 'included' || item.lbrPricingMode === 'excluded' ? 0 : Number(item.lbrUnitCost || 0);
    const extendedMatCost = round2(qty * matCostUnit);
    const extendedLbrCost = round2(qty * lbrCostUnit);
    const extendedCost = round2(extendedMatCost + extendedLbrCost);
    const grossProfit = round2(extendedSelling - extendedCost);
    const grossProfitPct = extendedSelling > 0 ? round2((grossProfit / extendedSelling) * 100) : 0;

    const computed: ComputedQuotationItem = {
      ...item,
      qty,
      matSellRate,
      lbrSellRate,
      combinedUnitRate,
      extendedMatSell,
      extendedLbrSell,
      extendedSelling,
      extendedMatCost,
      extendedLbrCost,
      extendedCost,
      grossProfit,
      grossProfitPct,
    };
    const key = item.tempKey || (item.id ? `id:${item.id}` : `idx:${idx}`);
    computedMap.set(key, computed);
    return computed;
  });

  // Optional parent assembly rollup when explicitly requested on an assembly row
  for (const row of rawComputed) {
    if (row.rowType === 'item' && row.rollupChildren) {
      const parentId = row.id ? `id:${row.id}` : null;
      const parentTemp = row.tempKey || null;
      const children = rawComputed.filter(
        (c) =>
          c !== row &&
          ((parentId && c.parentItemId === row.id) ||
            (parentTemp && c.parentKey === parentTemp))
      );
      if (children.length > 0) {
        const sumMatCost = round2(children.reduce((s, c) => s + c.extendedMatCost, 0));
        const sumLbrCost = round2(children.reduce((s, c) => s + c.extendedLbrCost, 0));
        row.matUnitCost = row.qty > 0 ? round2(sumMatCost / row.qty) : sumMatCost;
        row.lbrUnitCost = row.qty > 0 ? round2(sumLbrCost / row.qty) : sumLbrCost;
        row.matSellRate = calcSellingRate(row.matUnitCost, row.matGpPct, row.matPricingMode, row.overrideMatRate);
        row.lbrSellRate = calcSellingRate(row.lbrUnitCost, row.lbrGpPct, row.lbrPricingMode, row.overrideLbrRate);
        row.combinedUnitRate = row.matSellRate + row.lbrSellRate;
        row.extendedMatSell = round2(row.qty * row.matSellRate);
        row.extendedLbrSell = round2(row.qty * row.lbrSellRate);
        row.extendedSelling = round2(row.qty * row.combinedUnitRate);
        row.extendedMatCost = round2(row.qty * (row.matPricingMode === 'included' || row.matPricingMode === 'excluded' ? 0 : row.matUnitCost));
        row.extendedLbrCost = round2(row.qty * (row.lbrPricingMode === 'included' || row.lbrPricingMode === 'excluded' ? 0 : row.lbrUnitCost));
        row.extendedCost = round2(row.extendedMatCost + row.extendedLbrCost);
        row.grossProfit = round2(row.extendedSelling - row.extendedCost);
        row.grossProfitPct = row.extendedSelling > 0 ? round2((row.grossProfit / row.extendedSelling) * 100) : 0;
      }
    }
  }

  // Section Subtotals: strictly sum ONLY visible, non-hidden item rows (never double-counting hidden subitems)
  const sectionSubtotals: SectionSubtotalSummary[] = params.sections.map((sec, idx) => {
    const secKey = sec.tempKey || (sec.id ? `id:${sec.id}` : `sec:${idx}`);
    const secItems = rawComputed.filter((it) => {
      if (sec.id && it.sectionId === sec.id) return true;
      if (sec.tempKey && it.sectionKey === sec.tempKey) return true;
      return false;
    });
    const visibleItems = secItems.filter(
      (it) => it.rowType === 'item' && it.visibilityMode === 'visible'
    );
    const hiddenItems = secItems.filter((it) => it.visibilityMode === 'hidden' || it.rowType === 'subitem');

    const matCostSubtotal = round2(visibleItems.reduce((s, it) => s + it.extendedMatCost, 0));
    const lbrCostSubtotal = round2(visibleItems.reduce((s, it) => s + it.extendedLbrCost, 0));
    const totalDirectCost = round2(matCostSubtotal + lbrCostSubtotal);
    const matSellSubtotal = round2(visibleItems.reduce((s, it) => s + it.extendedMatSell, 0));
    const lbrSellSubtotal = round2(visibleItems.reduce((s, it) => s + it.extendedLbrSell, 0));
    const totalSellingSubtotal = round2(visibleItems.reduce((s, it) => s + it.extendedSelling, 0));
    const grossProfitAmount = round2(totalSellingSubtotal - totalDirectCost);
    const grossProfitPct =
      totalSellingSubtotal > 0 ? round2((grossProfitAmount / totalSellingSubtotal) * 100) : 0;

    return {
      sectionKey: secKey,
      code: sec.code,
      title: sec.title,
      matCostSubtotal,
      lbrCostSubtotal,
      totalDirectCost,
      matSellSubtotal,
      lbrSellSubtotal,
      totalSellingSubtotal,
      grossProfitAmount,
      grossProfitPct,
      visibleItemCount: visibleItems.length,
      hiddenItemCount: hiddenItems.length,
    };
  });

  const subtotalMatCost = round2(sectionSubtotals.reduce((s, sc) => s + sc.matCostSubtotal, 0));
  const subtotalLbrCost = round2(sectionSubtotals.reduce((s, sc) => s + sc.lbrCostSubtotal, 0));
  const totalDirectCost = round2(subtotalMatCost + subtotalLbrCost);
  const subtotalMatSell = round2(sectionSubtotals.reduce((s, sc) => s + sc.matSellSubtotal, 0));
  const subtotalLbrSell = round2(sectionSubtotals.reduce((s, sc) => s + sc.lbrSellSubtotal, 0));
  const totalSellingPreVat = round2(sectionSubtotals.reduce((s, sc) => s + sc.totalSellingSubtotal, 0));

  const vatAmount = round2(totalSellingPreVat * (vatRate / 100));
  const totalSellingVatInc = round2(totalSellingPreVat + vatAmount);
  const discountAmount = round2(totalSellingVatInc * (discountPct / 100));
  const finalAmount = round2(totalSellingVatInc - discountAmount);

  // Gross Profit is calculated on pre-VAT selling revenue minus direct cost (discount reduces pre-VAT realization proportionally)
  const netPreVatRevenue = vatRate > 0 ? round2(finalAmount / (1 + vatRate / 100)) : finalAmount;
  const grossProfitAmount = round2(netPreVatRevenue - totalDirectCost);
  const grossProfitPct = netPreVatRevenue > 0 ? round2((grossProfitAmount / netPreVatRevenue) * 100) : 0;

  const days = Math.max(0, Number(params.estimatedDurationDays || 0));

  return {
    items: rawComputed,
    sectionSubtotals,
    subtotalMatCost,
    subtotalLbrCost,
    totalDirectCost,
    subtotalMatSell,
    subtotalLbrSell,
    totalSellingPreVat,
    vatRate,
    vatAmount,
    totalSellingVatInc,
    discountPct,
    discountAmount,
    finalAmount,
    grossProfitAmount,
    grossProfitPct,
    manpowerTeamUnits: calcManpowerTeamUnits(params.estimatedManpower),
    durationWeeks: round2(days / 7),
    durationMonths: round2(days / 30),
  };
}

/**
 * STRICT CONFIDENTIALITY SANITIZER:
 * Never trust frontend column hiding. Strip internal unit costs, supplier refs, GP%,
 * direct cost subtotals, and profit figures unless user explicitly holds view_internal_costing.
 */
export function sanitizeRevisionForUser(revision: any, user: AuthUser): any {
  const canViewCosting =
    user.role_slug === 'system_admin' || hasPermission(user, 'quotations', 'view_internal_costing');

  if (canViewCosting) {
    return {
      ...revision,
      canViewInternalCosting: true,
    };
  }

  const sanitizedSections = (revision.sections || []).map((sec: any) => ({
    id: sec.id,
    code: sec.code,
    title: sec.title,
    sort_order: sec.sort_order,
    is_collapsed: sec.is_collapsed,
    mat_sell_subtotal: sec.mat_sell_subtotal,
    lbr_sell_subtotal: sec.lbr_sell_subtotal,
    total_selling_subtotal: sec.total_selling_subtotal,
  }));

  // Exclude hidden internal BOM breakdown rows completely for non-costing users
  const sanitizedItems = (revision.items || [])
    .filter((it: any) => it.visibility_mode !== 'hidden' && it.row_type !== 'subitem')
    .map((it: any) => ({
      id: it.id,
      section_id: it.section_id,
      row_type: it.row_type,
      line_no: it.line_no,
      item_code: it.item_code,
      description: it.description,
      specification: it.specification,
      qty: it.qty,
      unit: it.unit,
      mat_pricing_mode: it.mat_pricing_mode,
      lbr_pricing_mode: it.lbr_pricing_mode,
      visibility_mode: it.visibility_mode,
      mat_sell_rate: it.mat_sell_rate,
      lbr_sell_rate: it.lbr_sell_rate,
      combined_unit_rate: it.combined_unit_rate,
      extended_selling: it.extended_selling,
      sort_order: it.sort_order,
    }));

  return {
    id: revision.id,
    quotation_id: revision.quotation_id,
    revision_code: revision.revision_code,
    status: revision.status,
    subject: revision.subject,
    site_location: revision.site_location,
    province: revision.province,
    municipality: revision.municipality,
    barangay: revision.barangay,
    attention_to: revision.attention_to,
    attention_title: revision.attention_title,
    thru_person: revision.thru_person,
    thru_title: revision.thru_title,
    estimated_manpower: revision.estimated_manpower,
    estimated_duration_days: revision.estimated_duration_days,
    vat_rate: revision.vat_rate,
    discount_pct: revision.discount_pct,
    scope_options: revision.scope_options,
    terms: revision.terms,
    notes: revision.notes,
    subtotal_mat_sell: revision.subtotal_mat_sell,
    subtotal_lbr_sell: revision.subtotal_lbr_sell,
    total_selling_pre_vat: revision.total_selling_pre_vat,
    vat_amount: revision.vat_amount,
    total_selling_vat_inc: revision.total_selling_vat_inc,
    discount_amount: revision.discount_amount,
    final_amount: revision.final_amount,
    revision_reason: revision.revision_reason,
    prepared_by: revision.prepared_by,
    prepared_by_name: revision.prepared_by_name,
    prepared_by_title: revision.prepared_by_title,
    reviewed_by: revision.reviewed_by,
    approved_by: revision.approved_by,
    approved_by_name: revision.approved_by_name,
    approved_by_title: revision.approved_by_title,
    created_at: revision.created_at,
    sections: sanitizedSections,
    items: sanitizedItems,
    canViewInternalCosting: false,
  };
}

/**
 * Controlled Reference Reconciliation Dataset matching:
 * RCC26-1998067-CONSrev01 (Likha ni Inay Cebu ground floor)
 */
export interface ReconciliationCheck {
  id: string;
  label: string;
  formula: string;
  expected: number;
  actual: number;
  diff: number;
  status: 'MATCH' | 'DIFF';
}

export function getReferenceLikhaDataset(): {
  sections: QuotationSectionInput[];
  items: QuotationItemInput[];
  vatRate: number;
  discountPct: number;
  estimatedManpower: number;
  estimatedDurationDays: number;
} {
  const sections: QuotationSectionInput[] = [
    { tempKey: 'A', code: 'A', title: 'GENERAL REQUIREMENTS', sortOrder: 1 },
    { tempKey: 'B', code: 'B', title: 'GENERAL ITEMS', sortOrder: 2 },
    { tempKey: 'C', code: 'C', title: 'COMMERCIAL FIXTURES', sortOrder: 3 },
  ];

  const items: QuotationItemInput[] = [
    // Section A: General Requirements
    {
      tempKey: 'A-1',
      sectionKey: 'A',
      rowType: 'item',
      lineNo: '1',
      itemCode: 'GR-01',
      description: 'Site Management & Temporary Facilities',
      specification: 'Includes Mobilization, Site Visit, Manpower Transport, PPE, Tools, Accommodation, Utilities, Supervision, Permits, Testing & Commissioning',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'included',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 0,
      lbrUnitCost: 132400,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 1,
    },
    {
      tempKey: 'A-1a',
      sectionKey: 'A',
      parentKey: 'A-1',
      rowType: 'subitem',
      lineNo: '',
      itemCode: 'GR-MOB',
      description: 'Mobilization/Demobilization',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'included',
      lbrPricingMode: 'computed',
      visibilityMode: 'hidden',
      matUnitCost: 0,
      lbrUnitCost: 61500,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 2,
    },
    {
      tempKey: 'A-1b',
      sectionKey: 'A',
      parentKey: 'A-1',
      rowType: 'subitem',
      lineNo: '',
      itemCode: 'GR-ACCOM',
      description: 'Accommodation',
      qty: 2,
      unit: 'set/s',
      matPricingMode: 'included',
      lbrPricingMode: 'computed',
      visibilityMode: 'hidden',
      matUnitCost: 0,
      lbrUnitCost: 9500,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 3,
    },
    {
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
      lbrUnitCost: 30000,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 4,
    },

    // Section B: General Items (exact CSV costs -> exact Section B totals 2,408,433.00 / cost 1,685,890.32)
    {
      tempKey: 'B-hdr-arch',
      sectionKey: 'B',
      rowType: 'subsection',
      lineNo: '3',
      itemCode: '',
      description: 'ARCHITECTURAL WORKS — MASONRY, TILING, PAINTING & CARPENTRY',
      qty: 0,
      unit: '',
      matPricingMode: 'excluded',
      lbrPricingMode: 'excluded',
      visibilityMode: 'visible',
      matUnitCost: 0,
      lbrUnitCost: 0,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 10,
    },
    {
      tempKey: 'B-1',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '3.1',
      itemCode: 'MAS-01',
      description: 'Interior walls (Masonry Works)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 63703,
      lbrUnitCost: 25481.2,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 11,
    },
    {
      tempKey: 'B-1-sub1',
      sectionKey: 'B',
      parentKey: 'B-1',
      rowType: 'subitem',
      lineNo: '',
      itemCode: 'RBR-10',
      description: 'rebar, 10 mm',
      qty: 28,
      unit: 'pcs',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'hidden',
      matUnitCost: 189,
      lbrUnitCost: 75.6,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 12,
    },
    {
      tempKey: 'B-1-sub2',
      sectionKey: 'B',
      parentKey: 'B-1',
      rowType: 'subitem',
      lineNo: '',
      itemCode: 'CHB-4',
      description: "CHB 4'' thk",
      qty: 624,
      unit: 'pcs',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'hidden',
      matUnitCost: 21,
      lbrUnitCost: 8.4,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 13,
    },
    {
      tempKey: 'B-2',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '3.2',
      itemCode: 'MAS-02',
      description: 'Pantry counter (Masonry)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 3401,
      lbrUnitCost: 1360.4,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 14,
    },
    {
      tempKey: 'B-3',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '3.3',
      itemCode: 'TIL-01',
      description: 'Interior floor tiles (60x60 Polished Porcelain White)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 112460,
      lbrUnitCost: 44984,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 15,
    },
    {
      tempKey: 'B-4',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '3.4',
      itemCode: 'TIL-02',
      description: 'Toilet floor tiles (30x30 Ceramic Non-Skid)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 8210,
      lbrUnitCost: 3284,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 16,
    },
    {
      tempKey: 'B-5',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '3.5',
      itemCode: 'TIL-03',
      description: 'Toilet wall tiles (30x60 Polished Porcelain White)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 21360,
      lbrUnitCost: 8544,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 17,
    },
    {
      tempKey: 'B-6',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '3.6',
      itemCode: 'TIL-04',
      description: 'Pantry counter & Backsplash (Granite Slab Black Galaxy)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 9010,
      lbrUnitCost: 3604,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 18,
    },
    {
      tempKey: 'B-7',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '3.7',
      itemCode: 'PNT-01',
      description: 'Interior walls painting (Skim coat, primer & Davies Megacryl semi-gloss)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 32640,
      lbrUnitCost: 18656,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 19,
    },
    {
      tempKey: 'B-7b',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '3.7b',
      itemCode: 'PNT-02',
      description: 'Ceiling paint (Hidden option in reference workbook)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'hidden',
      matUnitCost: 24760,
      lbrUnitCost: 16404,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 20,
    },
    {
      tempKey: 'B-8',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '3.8',
      itemCode: 'CAR-01',
      description: 'Ceiling works (Acoustic ceiling & slat panels with marine plywood backing)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 270944,
      lbrUnitCost: 108377.6,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 21,
    },
    {
      tempKey: 'B-hdr-mill',
      sectionKey: 'B',
      rowType: 'subsection',
      lineNo: '4',
      itemCode: '',
      description: 'CUSTOM MILLWORK & DOORS',
      qty: 0,
      unit: '',
      matPricingMode: 'excluded',
      lbrPricingMode: 'excluded',
      visibilityMode: 'visible',
      matUnitCost: 0,
      lbrUnitCost: 0,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 22,
    },
    {
      tempKey: 'B-9',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '4.1',
      itemCode: 'MWK-01',
      description: 'Cashier Counter',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 77000,
      lbrUnitCost: 30800,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 23,
    },
    {
      tempKey: 'B-10',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '4.2',
      itemCode: 'MWK-02',
      description: 'Candy Display Counter',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 97750,
      lbrUnitCost: 39100,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 24,
    },
    {
      tempKey: 'B-11',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '4.3',
      itemCode: 'MWK-03',
      description: 'Rear Display Cabinet',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 97150,
      lbrUnitCost: 38860,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 25,
    },
    {
      tempKey: 'B-12',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '4.4',
      itemCode: 'MWK-04',
      description: 'Island Counter',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 60000,
      lbrUnitCost: 24000,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 26,
    },
    {
      tempKey: 'B-13',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '4.5',
      itemCode: 'MWK-05',
      description: 'Dining Table',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 21000,
      lbrUnitCost: 8400,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 27,
    },
    {
      tempKey: 'B-14',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '4.6',
      itemCode: 'MWK-06',
      description: 'Dining Bench',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 31200,
      lbrUnitCost: 12480,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 28,
    },
    {
      tempKey: 'B-15',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '4.7',
      itemCode: 'DRW-01',
      description: 'Doors & Glass Partitions (Flush doors, Fire exit, Glass door & wall)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 127000,
      lbrUnitCost: 19050,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 29,
    },
    {
      tempKey: 'B-hdr-plm',
      sectionKey: 'B',
      rowType: 'subsection',
      lineNo: '5',
      itemCode: '',
      description: 'PLUMBING & ELECTRICAL WORKS',
      qty: 0,
      unit: '',
      matPricingMode: 'excluded',
      lbrPricingMode: 'excluded',
      visibilityMode: 'visible',
      matUnitCost: 0,
      lbrUnitCost: 0,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 30,
    },
    {
      tempKey: 'B-16',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '5.1',
      itemCode: 'PLM-01',
      description: 'TOILET FIXTURES (Water closet, bidet, lavatory, kitchen sink, drains)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 31921,
      lbrUnitCost: 7980.25,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 31,
    },
    {
      tempKey: 'B-17',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '5.2',
      itemCode: 'PLM-02',
      description: 'Sewer line System (PVC 4", 3", 2" & fittings)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 11753.28,
      lbrUnitCost: 4701.31,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 32,
    },
    {
      tempKey: 'B-18',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '5.3',
      itemCode: 'PLM-03',
      description: 'Water Supply line (PPR PN20 pipes, valves & grease trap)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 30335,
      lbrUnitCost: 12134,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 33,
    },
    {
      tempKey: 'B-19',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '6.1',
      itemCode: 'ELC-01',
      description: 'Lighting fixtures (Fluorescent, Emergency & Exit lights)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 35350,
      lbrUnitCost: 8837.5,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 34,
    },
    {
      tempKey: 'B-20',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '6.2',
      itemCode: 'ELC-02',
      description: 'Outlet & switches (Switches, universal, aircon, freezer & GFCI outlets)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 28308,
      lbrUnitCost: 7077,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 35,
    },
    {
      tempKey: 'B-21',
      sectionKey: 'B',
      rowType: 'item',
      lineNo: '6.3',
      itemCode: 'ELC-03',
      description: 'Roughing-Ins & wirings (THHN wires, PVC conduits, hangers & supports)',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 58455.85,
      lbrUnitCost: 29227.93,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 36,
    },

    // Section C: Commercial Fixtures
    {
      tempKey: 'C-1',
      sectionKey: 'C',
      rowType: 'item',
      lineNo: '7',
      itemCode: 'CFX-01',
      description: 'Fabricated Double-Sided Gondola Shelves',
      qty: 14,
      unit: 'pcs',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 8500,
      lbrUnitCost: 850,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 40,
    },
    {
      tempKey: 'C-2',
      sectionKey: 'C',
      rowType: 'item',
      lineNo: '8',
      itemCode: 'CFX-02',
      description: 'Fabricated Wall Gondola Shelves',
      qty: 18,
      unit: 'pcs',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 6500,
      lbrUnitCost: 650,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 41,
    },
    {
      tempKey: 'C-3',
      sectionKey: 'C',
      rowType: 'item',
      lineNo: '9',
      itemCode: 'CFX-03',
      description: 'Gondola End Cap',
      qty: 8,
      unit: 'pcs',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 6200,
      lbrUnitCost: 620,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 42,
    },
    {
      tempKey: 'C-4',
      sectionKey: 'C',
      rowType: 'item',
      lineNo: '10',
      itemCode: 'CFX-04',
      description: 'Heavy-duty stockroom racks',
      qty: 1,
      unit: 'lot',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      matUnitCost: 32650,
      lbrUnitCost: 9795,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 43,
    },
    {
      tempKey: 'C-4-sub1',
      sectionKey: 'C',
      parentKey: 'C-4',
      rowType: 'subitem',
      lineNo: '',
      itemCode: 'CFX-RACK',
      description: 'Heavy-Duty Steel Storage Rack (5 Layers)',
      qty: 5,
      unit: 'unit',
      matPricingMode: 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'hidden',
      matUnitCost: 5200,
      lbrUnitCost: 1300,
      matGpPct: 0.3,
      lbrGpPct: 0.3,
      sortOrder: 44,
    },
  ];

  return {
    sections,
    items,
    vatRate: 12,
    discountPct: 0,
    estimatedManpower: 15,
    estimatedDurationDays: 90,
  };
}

export function runReferenceReconciliation(): {
  passed: boolean;
  checks: ReconciliationCheck[];
  summary: RevisionCalculationSummary;
} {
  const dataset = getReferenceLikhaDataset();
  const summary = recalculateRevision(dataset);

  const secA = summary.sectionSubtotals.find((s) => s.code === 'A')!;
  const secB = summary.sectionSubtotals.find((s) => s.code === 'B')!;
  const secC = summary.sectionSubtotals.find((s) => s.code === 'C')!;
  const rebarItem = summary.items.find((i) => i.itemCode === 'RBR-10')!;
  const siteMgmtItem = summary.items.find((i) => i.itemCode === 'GR-01')!;

  const pairs: Array<{ id: string; label: string; formula: string; expected: number; actual: number }> = [
    {
      id: 'R1',
      label: 'Site Mgmt Labor Selling (included material)',
      formula: 'ROUNDUP(132400 / (1 - 0.30), 0)',
      expected: 189143,
      actual: siteMgmtItem.lbrSellRate,
    },
    {
      id: 'R2',
      label: 'Rebar 10mm Labor Selling (float boundary 75.60 / 0.7)',
      formula: 'ROUNDUP(75.60 / (1 - 0.30), 0)',
      expected: 108,
      actual: rebarItem.lbrSellRate,
    },
    {
      id: 'R3',
      label: 'Section A (General Requirements) Selling Subtotal',
      formula: '189,143 + 42,858 (hidden subitems excluded)',
      expected: 232001,
      actual: secA.totalSellingSubtotal,
    },
    {
      id: 'R4',
      label: 'Section A Direct Cost',
      formula: '132,400 + 30,000',
      expected: 162400,
      actual: secA.totalDirectCost,
    },
    {
      id: 'R5',
      label: 'Section B (General Items) Selling Subtotal',
      formula: 'SUM(Visible B items, excluding hidden Ceiling paint 58,807)',
      expected: 2408433,
      actual: secB.totalSellingSubtotal,
    },
    {
      id: 'R6',
      label: 'Section B Direct Cost',
      formula: '1,228,951.13 + 456,939.19',
      expected: 1685890.32,
      actual: secB.totalDirectCost,
    },
    {
      id: 'R7',
      label: 'Section C (Commercial Fixtures) Selling Subtotal',
      formula: '187,012 + 183,870 + 77,952 + 60,636',
      expected: 509470,
      actual: secC.totalSellingSubtotal,
    },
    {
      id: 'R8',
      label: 'Section C Direct Cost',
      formula: '318,250.00 + 38,355.00',
      expected: 356605,
      actual: secC.totalDirectCost,
    },
    {
      id: 'R9',
      label: 'Total Selling Price Before VAT (TOTAL AMOUNT)',
      formula: '232,001 + 2,408,433 + 509,470',
      expected: 3149904,
      actual: summary.totalSellingPreVat,
    },
    {
      id: 'R10',
      label: 'Total Direct Cost (REV1 Cost)',
      formula: '162,400 + 1,685,890.32 + 356,605',
      expected: 2204895.32,
      actual: summary.totalDirectCost,
    },
    {
      id: 'R11',
      label: '12% VAT',
      formula: 'ROUND(3,149,904 × 12%, 2)',
      expected: 377988.48,
      actual: summary.vatAmount,
    },
    {
      id: 'R12',
      label: 'TOTAL SELLING PRICE (VAT INC)',
      formula: '3,149,904.00 + 377,988.48',
      expected: 3527892.48,
      actual: summary.totalSellingVatInc,
    },
    {
      id: 'R13',
      label: 'Manpower Team Formula (Manpower = 15)',
      formula: 'ROUNDUP(15/10, 0) + 1 + QUOTIENT(15, 25) + 3*QUOTIENT(15, 100)',
      expected: 3,
      actual: summary.manpowerTeamUnits,
    },
  ];

  // Also validate 5% discount on VAT-inclusive price in an isolated check
  const with5PctDiscount = recalculateRevision({
    ...dataset,
    discountPct: 5,
  });
  pairs.push({
    id: 'R14',
    label: '5% Special Discount on VAT-Inclusive Selling Price',
    formula: '3,527,892.48 - ROUND(3,527,892.48 × 5%, 2)',
    expected: 3351497.86,
    actual: with5PctDiscount.finalAmount,
  });

  const checks: ReconciliationCheck[] = pairs.map((p) => {
    const diff = round2(p.actual - p.expected);
    return {
      ...p,
      diff,
      status: Math.abs(diff) < 0.005 ? 'MATCH' : 'DIFF',
    };
  });

  return {
    passed: checks.every((c) => c.status === 'MATCH'),
    checks,
    summary,
  };
}
