export type PricingMode = 'computed' | 'included' | 'excluded' | 'override';

export interface EditorSection {
  tempKey: string;
  id?: number;
  code: string;
  title: string;
  sortOrder: number;
  isCollapsed: boolean;
}

export interface EditorItem {
  tempKey: string;
  id?: number;
  sectionKey: string;
  parentKey?: string | null;
  rowType: 'subsection' | 'item' | 'subitem' | 'note';
  lineNo: string;
  itemCode: string;
  description: string;
  specification: string;
  qty: number;
  unit: string;
  matPricingMode: PricingMode;
  lbrPricingMode: PricingMode;
  visibilityMode: 'visible' | 'hidden';
  rollupChildren: boolean;
  matUnitCost: number;
  lbrUnitCost: number;
  matGpPct: number;
  lbrGpPct: number;
  overrideMatRate: number | null;
  overrideLbrRate: number | null;
  overrideReason: string;
  catalogItemId?: number | null;
  supplierRef?: string;
  sourceAssemblyId?: number | null;
  sourceAssemblyCode?: string;
  sourceAssemblyVersion?: number | null;
  supplierId?: number | null;
  supplierPriceId?: number | null;
  componentType?: string;
  calcBasis?: string;
  consumptionRate?: number | null;
  wastagePct?: number | null;
  measurementQty?: number | null;
  formulaText?: string;
  sortOrder: number;
  matSellRate: number;
  lbrSellRate: number;
  combinedUnitRate: number;
  extendedSelling: number;
  extendedCost: number;
  grossProfit: number;
}

export interface SupplierPriceOption {
  id: number;
  catalog_item_id: number;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  supplier_item_ref: string;
  brand: string;
  specifications: string;
  unit: string;
  unit_price: number;
  effective_date: string;
  valid_until?: string | null;
  remarks?: string;
  is_preferred: number;
}

export interface CatalogItemRecord {
  id: number;
  item_code: string;
  name: string;
  description: string;
  specification: string;
  category: string;
  subcategory: string;
  item_type: string;
  default_unit: string;
  mat_unit_cost?: number;
  lbr_unit_cost?: number;
  default_mat_gp_pct?: number;
  default_lbr_gp_pct?: number;
  supplier_ref?: string;
  is_general_requirement: number;
  is_active: number;
  mat_sell_rate: number;
  lbr_sell_rate: number;
  combined_sell_rate: number;
  has_supplier_price?: boolean;
  supplier_count?: number;
  preferred_supplier_id?: number | null;
  preferred_supplier_price_id?: number | null;
  preferred_supplier_name?: string;
  preferred_supplier_unit_price?: number | null;
  supplier_prices?: SupplierPriceOption[];
}

export interface WorkAssemblyComponent {
  id: number;
  assembly_id: number;
  catalog_item_id: number | null;
  component_type: string;
  item_code: string;
  item_name: string;
  specification: string;
  unit: string;
  calc_basis: string;
  consumption_rate: number;
  wastage_pct: number;
  preferred_supplier_id?: number | null;
  preferred_supplier_price_id?: number | null;
  preferred_supplier_name?: string;
  mat_unit_cost?: number;
  lbr_unit_cost?: number;
  default_mat_gp_pct?: number;
  default_lbr_gp_pct?: number;
  mat_sell_rate: number;
  lbr_sell_rate: number;
  combined_sell_rate: number;
  has_supplier_price?: boolean;
  missing_price_warning?: boolean;
  supplier_prices?: SupplierPriceOption[];
  notes?: string;
  sort_order: number;
}

export interface WorkAssemblyRecord {
  id: number;
  assembly_code: string;
  name: string;
  category_id: number | null;
  category_name: string;
  description: string;
  specifications: string;
  unit: string;
  default_calc_method: string;
  default_qty: number;
  labor_requirements: string;
  installation_instructions: string;
  notes: string;
  current_version: number;
  is_active: number;
  component_count: number;
  estimated_unit_selling: number;
  estimated_unit_cost?: number;
  components: WorkAssemblyComponent[];
}

export function round2(n: number): number {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

export function calcSellRate(cost: number, gp: number, mode: PricingMode, overrideRate?: number | null): number {
  if (mode === 'included' || mode === 'excluded') return 0;
  if (mode === 'override') return Math.max(0, round2(Number(overrideRate ?? 0)));
  const c = Number(cost || 0);
  if (c <= 0) return 0;
  const g = Math.min(0.95, Math.max(0, Number(gp || 0)));
  return Math.ceil(Number((c / (1 - g)).toFixed(10)));
}

export function computeComponentQtyAndFormula(params: {
  workQty: number;
  workUnit: string;
  calcBasis: string;
  consumptionRate: number;
  wastagePct: number;
  componentUnit: string;
}): { calculatedQty: number; formulaText: string } {
  const workQty = Math.max(0, Number(params.workQty || 0));
  const rate = Math.max(0, Number(params.consumptionRate || 0));
  const waste = Math.max(0, Number(params.wastagePct || 0));
  const compUnit = params.componentUnit || 'pcs';
  const workUnit = params.workUnit || 'sq.m';

  if (params.calcBasis === 'fixed') {
    const qty = Number(rate.toFixed(4));
    return {
      calculatedQty: qty,
      formulaText: `Fixed: ${qty} ${compUnit}`,
    };
  }

  const raw = workQty * rate * (1 + waste / 100);
  const qty = Number(raw.toFixed(2));
  const wasteText = waste > 0 ? ` × (1 + ${waste}% waste)` : '';
  return {
    calculatedQty: qty,
    formulaText: `${workQty} ${workUnit} × ${rate} ${compUnit}/${workUnit}${wasteText} = ${qty} ${compUnit}`,
  };
}
