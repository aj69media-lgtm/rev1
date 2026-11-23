import { getApiToken } from '../../lib/api';

export interface CatalogCategory {
  id: number;
  name: string;
  section_default: string;
  sort_order: number;
  is_active: number;
}

export interface CatalogUnit {
  id: number;
  code: string;
  label: string;
  is_active: number;
}

export interface CatalogSupplier {
  id: number;
  supplier_code: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  category_tags: string;
  payment_terms: string;
  is_active: number;
  notes?: string;
  active_price_count?: number;
}

export interface CatalogPermissions {
  view: boolean;
  createItem: boolean;
  editItem: boolean;
  manageCategories: boolean;
  createAssembly: boolean;
  editAssembly: boolean;
  duplicateAssembly: boolean;
  archiveRecord: boolean;
  restoreRecord: boolean;
  manageSuppliers: boolean;
  manageSupplierPrices: boolean;
  overrideCost: boolean;
  viewInternalCosting: boolean;
  requestItem: boolean;
}

export interface CatalogMetaResponse {
  categories: CatalogCategory[];
  units: CatalogUnit[];
  suppliers: CatalogSupplier[];
  pendingRequestCount: number;
  permissions: CatalogPermissions;
}

export interface CatalogItemSummary {
  id: number;
  item_code: string;
  name: string;
  description: string;
  specification: string;
  category: string;
  subcategory: string;
  default_unit: string;
  item_type: string;
  mat_unit_cost?: number;
  lbr_unit_cost?: number;
  default_mat_gp_pct?: number;
  default_lbr_gp_pct?: number;
  supplier_ref?: string;
  mat_sell_rate: number;
  lbr_sell_rate: number;
  combined_sell_rate: number;
  is_general_requirement: number;
  is_active: number;
  remarks: string;
  supplier_count: number;
  attachment_count: number;
  suppliers: Array<{
    id?: number;
    supplier_id: number;
    supplier_name: string;
    brand: string;
    unit?: string;
    unit_price?: number;
    is_preferred: number;
  }>;
  archived_at?: string | null;
  updated_at?: string | null;
}

export interface AssemblySummary {
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
  updated_at: string;
  updated_by_name?: string;
  total_components: number;
  material_count: number;
  labor_count: number;
  other_count: number;
}

export interface AssemblyComponentDraft {
  tempKey: string;
  id?: number;
  catalogItemId: number | null;
  componentType: 'Material' | 'Labor' | 'Equipment' | 'Service' | 'Other';
  itemCode: string;
  itemName: string;
  specification: string;
  unit: string;
  calcBasis: 'per_unit' | 'fixed';
  consumptionRate: number;
  wastagePct: number;
  preferredSupplierId: number | null;
  preferredSupplierName?: string;
  notes: string;
  matSellRate?: number;
  lbrSellRate?: number;
  matUnitCost?: number;
  lbrUnitCost?: number;
}

export async function downloadProtectedEndpoint(url: string, fallbackFileName: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getApiToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fallbackFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
