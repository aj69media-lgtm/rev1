import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calculator,
  GitCompare,
  History,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, formatDate, formatMoney } from '../../lib/api';
import {
  AssemblyComponentDraft,
  CatalogCategory,
  CatalogItemSummary,
  CatalogPermissions,
  CatalogUnit,
} from './CatalogTypes';

interface VisualAssemblyEditorProps {
  assemblyId: number | null; // null => creating a brand-new Set of Works
  categories: CatalogCategory[];
  units: CatalogUnit[];
  catalogItems: CatalogItemSummary[];
  permissions: CatalogPermissions;
  onBack: () => void;
  onSaved: (savedId: number) => void;
  onCatalogItemsChanged: () => void;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const VisualAssemblyEditor: React.FC<VisualAssemblyEditorProps> = ({
  assemblyId,
  categories,
  units,
  catalogItems,
  permissions,
  onBack,
  onSaved,
  onCatalogItemsChanged,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  // Form Metadata
  const [assemblyCode, setAssemblyCode] = useState('');
  const [name, setName] = useState('');
  const [categoryName, setCategoryName] = useState(categories[0]?.name || 'Masonry Works');
  const [unit, setUnit] = useState('sq.m');
  const [defaultCalcMethod, setDefaultCalcMethod] = useState('per_sqm');
  const [defaultQty, setDefaultQty] = useState<number>(1);
  const [description, setDescription] = useState('');
  const [specifications, setSpecifications] = useState('');
  const [laborRequirements, setLaborRequirements] = useState('');
  const [installationInstructions, setInstallationInstructions] = useState('');
  const [notes, setNotes] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [currentVersion, setCurrentVersion] = useState<number>(1);

  // Components & Supplier choices
  const [components, setComponents] = useState<AssemblyComponentDraft[]>([]);
  const [supplierChoicesByItem, setSupplierChoicesByItem] = useState<Record<number, any[]>>({});
  const [versions, setVersions] = useState<any[]>([]);

  // Live Measurement Preview
  const [previewQty, setPreviewQty] = useState<number>(25);

  // Catalog Picker Modal / Inline New Catalog Item Modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerType, setPickerType] = useState('all');
  const [inlineNewItemOpen, setInlineNewItemOpen] = useState(false);
  const [newItemCode, setNewItemCode] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<'Material' | 'Labor' | 'Equipment' | 'Service'>('Material');
  const [newItemCategory, setNewItemCategory] = useState(categories[0]?.name || 'Masonry Works');
  const [newItemUnit, setNewItemUnit] = useState('pcs');
  const [newItemSpec, setNewItemSpec] = useState('');
  const [newItemMatCost, setNewItemMatCost] = useState('0');
  const [newItemLbrCost, setNewItemLbrCost] = useState('0');
  const [creatingInlineItem, setCreatingInlineItem] = useState(false);

  // Version History & Compare Modal
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [compareVA, setCompareVA] = useState<number>(1);
  const [compareVB, setCompareVB] = useState<number>(1);
  const [compareResult, setCompareResult] = useState<any>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<any>(null);

  const canEdit = assemblyId ? permissions.editAssembly : permissions.createAssembly;
  const showCost = permissions.viewInternalCosting;

  const loadAssembly = useCallback(async () => {
    if (!assemblyId) return;
    setLoading(true);
    setErr('');
    try {
      const data = await apiRequest(`/api/catalog/assemblies/${assemblyId}`);
      const asm = data.assembly;
      setAssemblyCode(asm.assembly_code || '');
      setName(asm.name || '');
      setCategoryName(asm.category_name || categories[0]?.name || 'Custom Works');
      setUnit(asm.unit || 'sq.m');
      setDefaultCalcMethod(asm.default_calc_method || 'per_sqm');
      setDefaultQty(Number(asm.default_qty || 1));
      setDescription(asm.description || '');
      setSpecifications(asm.specifications || '');
      setLaborRequirements(asm.labor_requirements || '');
      setInstallationInstructions(asm.installation_instructions || '');
      setNotes(asm.notes || '');
      setCurrentVersion(Number(asm.current_version || 1));
      setChangeSummary('');

      const loadedComps: AssemblyComponentDraft[] = (asm.components || []).map((c: any) => ({
        tempKey: uid(),
        id: c.id,
        catalogItemId: c.catalog_item_id || null,
        componentType: c.component_type || 'Material',
        itemCode: c.item_code || '',
        itemName: c.item_name || '',
        specification: c.specification || '',
        unit: c.unit || 'pcs',
        calcBasis: c.calc_basis === 'fixed' ? 'fixed' : 'per_unit',
        consumptionRate: Number(c.consumption_rate || 0),
        wastagePct: Number(c.wastage_pct || 0),
        preferredSupplierId: c.preferred_supplier_id || null,
        preferredSupplierName: c.preferred_supplier_name || '',
        notes: c.notes || '',
        matSellRate: Number(c.mat_sell_rate || 0),
        lbrSellRate: Number(c.lbr_sell_rate || 0),
        matUnitCost: c.mat_unit_cost !== undefined ? Number(c.mat_unit_cost) : undefined,
        lbrUnitCost: c.lbr_unit_cost !== undefined ? Number(c.lbr_unit_cost) : undefined,
      }));
      setComponents(loadedComps);
      setSupplierChoicesByItem(data.supplierChoicesByItem || {});
      setVersions(data.versions || []);
      if ((data.versions || []).length >= 2) {
        setCompareVA(data.versions[1].version_number);
        setCompareVB(data.versions[0].version_number);
      } else if ((data.versions || []).length === 1) {
        setCompareVA(data.versions[0].version_number);
        setCompareVB(data.versions[0].version_number);
      }
    } catch (e: any) {
      setErr(e?.message || 'Unable to load Set of Works template');
    } finally {
      setLoading(false);
    }
  }, [assemblyId, categories]);

  useEffect(() => {
    if (assemblyId) {
      loadAssembly();
    } else {
      setAssemblyCode('');
      setName('');
      setCategoryName(categories[0]?.name || 'Masonry Works');
      setUnit('sq.m');
      setDefaultCalcMethod('per_sqm');
      setDefaultQty(1);
      setDescription('');
      setSpecifications('');
      setLaborRequirements('');
      setInstallationInstructions('');
      setNotes('');
      setComponents([]);
      setVersions([]);
      setCurrentVersion(1);
    }
  }, [assemblyId, categories, loadAssembly]);

  const filteredPickerItems = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return catalogItems.filter((it) => {
      if (!it.is_active) return false;
      if (pickerType !== 'all' && it.item_type !== pickerType) return false;
      if (!q) return true;
      return (
        it.item_code.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        (it.specification || '').toLowerCase().includes(q)
      );
    });
  }, [catalogItems, pickerSearch, pickerType]);

  const addCatalogItemToAssembly = (it: CatalogItemSummary) => {
    const prefSup = it.suppliers?.find((s) => s.is_preferred) || it.suppliers?.[0];
    if (it.suppliers && it.suppliers.length > 0 && !supplierChoicesByItem[it.id]) {
      setSupplierChoicesByItem((prev) => ({
        ...prev,
        [it.id]: it.suppliers.map((s) => ({
          catalog_item_id: it.id,
          supplier_id: s.supplier_id,
          supplier_name: s.supplier_name,
          unit: s.unit || it.default_unit,
          unit_price: s.unit_price,
          brand: s.brand,
          is_preferred: s.is_preferred,
        })),
      }));
    }

    setComponents((prev) => [
      ...prev,
      {
        tempKey: uid(),
        catalogItemId: it.id,
        componentType: (it.item_type as any) || 'Material',
        itemCode: it.item_code,
        itemName: it.name,
        specification: it.specification || '',
        unit: it.default_unit || 'pcs',
        calcBasis: 'per_unit',
        consumptionRate: 1,
        wastagePct: it.item_type === 'Material' ? 5 : 0,
        preferredSupplierId: prefSup?.supplier_id || null,
        preferredSupplierName: prefSup?.supplier_name || '',
        notes: '',
        matSellRate: Number(it.mat_sell_rate || 0),
        lbrSellRate: Number(it.lbr_sell_rate || 0),
        matUnitCost: it.mat_unit_cost !== undefined ? Number(it.mat_unit_cost) : undefined,
        lbrUnitCost: it.lbr_unit_cost !== undefined ? Number(it.lbr_unit_cost) : undefined,
      },
    ]);
    setPickerOpen(false);
  };

  const handleCreateInlineCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setCreatingInlineItem(true);
    try {
      const created = await apiRequest('/api/catalog/items', {
        method: 'POST',
        body: {
          itemCode: newItemCode,
          name: newItemName,
          category: newItemCategory,
          itemType: newItemType,
          defaultUnit: newItemUnit,
          specification: newItemSpec,
          matUnitCost: newItemType === 'Labor' ? 0 : Number(newItemMatCost || 0),
          lbrUnitCost: newItemType === 'Labor' ? Number(newItemLbrCost || 0) : Number(newItemLbrCost || 0),
          confirmNotDuplicate: true,
        },
      });
      onCatalogItemsChanged();
      const fresh = await apiRequest(`/api/catalog/items/${created.id}`);
      const it = fresh.item;
      addCatalogItemToAssembly({
        ...it,
        suppliers: [],
        supplier_count: 0,
        attachment_count: 0,
      });
      setInlineNewItemOpen(false);
      setNewItemCode('');
      setNewItemName('');
      setNewItemSpec('');
      setNewItemMatCost('0');
      setNewItemLbrCost('0');
      setNotice(`Created "${it.item_code} · ${it.name}" and added directly into this Set of Works.`);
    } catch (e: any) {
      setErr(e?.message || 'Failed to create catalog item');
    } finally {
      setCreatingInlineItem(false);
    }
  };

  const moveComponent = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= components.length) return;
    setComponents((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const updateComponent = (tempKey: string, patch: Partial<AssemblyComponentDraft>) => {
    setComponents((prev) => prev.map((c) => (c.tempKey === tempKey ? { ...c, ...patch } : c)));
  };

  const removeComponent = (tempKey: string) => {
    setComponents((prev) => prev.filter((c) => c.tempKey !== tempKey));
  };

  // Live Calculation Breakdown matching server formula:
  // qty = (calcBasis === 'fixed' ? rate : previewQty * rate) * (1 + wastage / 100)
  const previewRows = useMemo(() => {
    const mQty = Math.max(0, Number(previewQty || 0));
    return components.map((c) => {
      const rate = Number(c.consumptionRate || 0);
      const waste = Number(c.wastagePct || 0);
      const base = c.calcBasis === 'fixed' ? rate : mQty * rate;
      const calcQty = Math.round(base * (1 + waste / 100) * 10000) / 10000;
      const formula =
        c.calcBasis === 'fixed'
          ? `Fixed ${rate} ${c.unit}${waste > 0 ? ` × (1 + ${waste}% waste)` : ''}`
          : `${mQty} ${unit} × ${rate} ${c.unit}/${unit}${waste > 0 ? ` × (1 + ${waste}% waste)` : ''}`;

      const matchedCat = c.catalogItemId ? catalogItems.find((ci) => ci.id === c.catalogItemId) : null;
      const matSell = c.matSellRate ?? matchedCat?.mat_sell_rate ?? 0;
      const lbrSell = c.lbrSellRate ?? matchedCat?.lbr_sell_rate ?? 0;
      const sellRate = matSell + lbrSell;
      const extSell = Math.round(calcQty * sellRate * 100) / 100;

      const choices = c.catalogItemId ? supplierChoicesByItem[c.catalogItemId] || [] : [];
      const chosenSup = choices.find((s) => s.supplier_id === c.preferredSupplierId);
      const matCost =
        chosenSup?.unit_price !== undefined
          ? Number(chosenSup.unit_price)
          : c.matUnitCost ?? matchedCat?.mat_unit_cost ?? 0;
      const lbrCost = c.lbrUnitCost ?? matchedCat?.lbr_unit_cost ?? 0;
      const extCost = Math.round(calcQty * (matCost + lbrCost) * 100) / 100;

      return {
        ...c,
        calcQty,
        formula,
        extSell,
        extCost,
      };
    });
  }, [components, previewQty, unit, catalogItems, supplierChoicesByItem]);

  const previewTotalSelling = useMemo(
    () => previewRows.reduce((s, r) => s + r.extSell, 0),
    [previewRows]
  );
  const previewTotalCost = useMemo(
    () => previewRows.reduce((s, r) => s + r.extCost, 0),
    [previewRows]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr('Work package name is required');
      return;
    }
    setErr('');
    setNotice('');
    setSaving(true);
    try {
      const payload = {
        assemblyCode: assemblyCode.trim() || undefined,
        name: name.trim(),
        categoryName,
        unit,
        defaultCalcMethod,
        defaultQty: Number(defaultQty || 1),
        description,
        specifications,
        laborRequirements,
        installationInstructions,
        notes,
        changeSummary: changeSummary.trim() || undefined,
        components: components.map((c) => ({
          catalogItemId: c.catalogItemId,
          componentType: c.componentType,
          itemCode: c.itemCode,
          itemName: c.itemName,
          specification: c.specification,
          unit: c.unit,
          calcBasis: c.calcBasis,
          consumptionRate: Number(c.consumptionRate || 0),
          wastagePct: Number(c.wastagePct || 0),
          preferredSupplierId: c.preferredSupplierId,
          notes: c.notes,
        })),
      };

      if (assemblyId) {
        const res = await apiRequest(`/api/catalog/assemblies/${assemblyId}`, {
          method: 'PUT',
          body: payload,
        });
        setNotice(
          `Saved version v${res.version}. Historical quotations keep their immutable snapshots.`
        );
        await loadAssembly();
        onSaved(assemblyId);
      } else {
        const res = await apiRequest('/api/catalog/assemblies', {
          method: 'POST',
          body: payload,
        });
        onSaved(res.id);
      }
    } catch (e: any) {
      setErr(e?.message || 'Unable to save Set of Works');
    } finally {
      setSaving(false);
    }
  };

  const handleCompareVersions = async () => {
    if (!assemblyId) return;
    setErr('');
    try {
      const res = await apiRequest(
        `/api/catalog/assemblies/${assemblyId}/compare?vA=${compareVA}&vB=${compareVB}`
      );
      setCompareResult(res);
    } catch (e: any) {
      setErr(e?.message || 'Version comparison failed');
    }
  };

  const handleViewVersionSnapshot = async (vNum: number) => {
    if (!assemblyId) return;
    try {
      const res = await apiRequest(`/api/catalog/assemblies/${assemblyId}/versions/${vNum}`);
      setSelectedSnapshot(res);
    } catch (e: any) {
      setErr(e?.message || 'Unable to load snapshot');
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Sets of Works
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-semibold text-slate-800">
                {assemblyCode || 'Auto-Generated Code'}
              </span>
              <span>·</span>
              <span>{categoryName}</span>
              <span>·</span>
              <span className="font-medium text-slate-700">Template v{currentVersion}</span>
            </div>
            <h2 className="truncate font-display text-base font-bold text-slate-900">
              {assemblyId ? name || 'Edit Set of Works' : 'Create Reusable Set of Works'}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {assemblyId && versions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setVersionModalOpen(true);
                setCompareResult(null);
                setSelectedSnapshot(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <History className="h-3.5 w-3.5" />
              Versions ({versions.length})
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving
                ? 'Saving...'
                : assemblyId
                ? `Save as v${currentVersion + 1}`
                : 'Create Set of Works'}
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{err}</span>
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-500">
          Loading visual assembly workspace...
        </div>
      ) : (
        <form onSubmit={handleSave} className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left 8 columns: Assembly Definition & Interactive Components */}
          <div className="xl:col-span-8 space-y-5">
            {/* Work Package Header Specs */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 text-xs">
              <div className="border-b border-slate-100 pb-2.5">
                <h3 className="font-display text-sm font-bold text-slate-900">
                  1. Work Package Specification &amp; Measurement Basis
                </h3>
                <p className="text-[11px] text-slate-500">
                  Define how estimators measure and apply this reusable work package in quotations.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Assembly Code</label>
                  <input
                    type="text"
                    disabled={Boolean(assemblyId) || !canEdit}
                    value={assemblyCode}
                    onChange={(e) => setAssemblyCode(e.target.value)}
                    placeholder="Auto (e.g. SOW-MAS-001)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono uppercase disabled:bg-slate-50"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Set of Works Name *</label>
                  <input
                    type="text"
                    required
                    disabled={!canEdit}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Interior Wall Construction (100mm CHB)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Work Category *</label>
                  <select
                    disabled={!canEdit}
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Measurement Unit</label>
                  <select
                    disabled={!canEdit}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.code}>
                        {u.code} ({u.label})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Calculation Method</label>
                  <select
                    disabled={!canEdit}
                    value={defaultCalcMethod}
                    onChange={(e) => setDefaultCalcMethod(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="per_sqm">Per Square Meter (sq.m)</option>
                    <option value="per_lnm">Per Linear Meter (ln.m)</option>
                    <option value="per_cum">Per Cubic Meter (cu.m.)</option>
                    <option value="per_pc">Per Unit / Fixture (pcs/set)</option>
                    <option value="fixed">Fixed Lot / Package</option>
                    <option value="custom">Custom Formula</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Description / Scope</label>
                  <textarea
                    rows={2}
                    disabled={!canEdit}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Technical Specifications</label>
                  <textarea
                    rows={2}
                    disabled={!canEdit}
                    value={specifications}
                    onChange={(e) => setSpecifications(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Labor &amp; Crew Requirements</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={laborRequirements}
                    onChange={(e) => setLaborRequirements(e.target.value)}
                    placeholder="e.g. 1 Foreman + 2 Masons + 2 Helpers"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Installation Instructions</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={installationInstructions}
                    onChange={(e) => setInstallationInstructions(e.target.value)}
                    placeholder="Standard QA & execution sequence"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
              </div>

              {assemblyId && canEdit && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Version Change Summary (recorded on save as v{currentVersion + 1})
                  </label>
                  <input
                    type="text"
                    value={changeSummary}
                    onChange={(e) => setChangeSummary(e.target.value)}
                    placeholder="Describe what changed (e.g. Adjusted mortar sand factor and rebar wastage)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
              )}
            </div>

            {/* Interactive Component Rows */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    2. Materials, Labor &amp; Resource Components ({components.length})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Set consumption factor per {unit} (or Fixed qty) plus automatic wastage %.
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    {permissions.createItem && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewItemCategory(categoryName);
                          setInlineNewItemOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        New Catalog Item
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 font-semibold text-white hover:bg-amber-700"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      ADD ITEM
                    </button>
                  </div>
                )}
              </div>

              {components.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  No components in this Set of Works yet. Click <strong>ADD ITEM</strong> to attach
                  materials, labor crews, or equipment from the master catalog.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-2.5 py-2">Order</th>
                        <th className="px-2.5 py-2">Type &amp; Item</th>
                        <th className="px-2.5 py-2">Basis</th>
                        <th className="px-2.5 py-2 text-right">Factor / Rate</th>
                        <th className="px-2.5 py-2 text-right">Waste %</th>
                        <th className="px-2.5 py-2">Supplier Choice</th>
                        {canEdit && <th className="px-2.5 py-2 text-right">Remove</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {components.map((c, idx) => {
                        const supOpts = c.catalogItemId ? supplierChoicesByItem[c.catalogItemId] || [] : [];
                        return (
                          <tr key={c.tempKey} className="align-top">
                            <td className="px-2.5 py-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={!canEdit || idx === 0}
                                  onClick={() => moveComponent(idx, -1)}
                                  className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={!canEdit || idx === components.length - 1}
                                  onClick={() => moveComponent(idx, 1)}
                                  className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                            <td className="px-2.5 py-2.5 min-w-[200px]">
                              <div className="font-medium text-slate-900">{c.itemName}</div>
                              <div className="text-[11px] text-slate-500">
                                <span className="font-mono">{c.itemCode || 'Custom'}</span>
                                <span className="mx-1">·</span>
                                <span>{c.componentType}</span>
                                <span className="mx-1">·</span>
                                <span>{c.unit}</span>
                              </div>
                            </td>
                            <td className="px-2.5 py-2.5">
                              <select
                                disabled={!canEdit}
                                value={c.calcBasis}
                                onChange={(e) =>
                                  updateComponent(c.tempKey, {
                                    calcBasis: e.target.value === 'fixed' ? 'fixed' : 'per_unit',
                                  })
                                }
                                className="rounded border border-slate-300 bg-white px-2 py-1"
                              >
                                <option value="per_unit">Per {unit}</option>
                                <option value="fixed">Fixed Qty</option>
                              </select>
                            </td>
                            <td className="px-2.5 py-2.5 text-right">
                              <input
                                type="number"
                                step="0.0001"
                                min="0"
                                disabled={!canEdit}
                                value={c.consumptionRate}
                                onChange={(e) =>
                                  updateComponent(c.tempKey, { consumptionRate: Number(e.target.value) })
                                }
                                className="w-20 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
                              />
                            </td>
                            <td className="px-2.5 py-2.5 text-right">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                disabled={!canEdit}
                                value={c.wastagePct}
                                onChange={(e) =>
                                  updateComponent(c.tempKey, { wastagePct: Number(e.target.value) })
                                }
                                className="w-16 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
                              />
                            </td>
                            <td className="px-2.5 py-2.5 min-w-[160px]">
                              {supOpts.length > 0 ? (
                                <select
                                  disabled={!canEdit}
                                  value={c.preferredSupplierId ?? ''}
                                  onChange={(e) =>
                                    updateComponent(c.tempKey, {
                                      preferredSupplierId: e.target.value ? Number(e.target.value) : null,
                                    })
                                  }
                                  className="w-full rounded border border-slate-300 bg-white px-2 py-1"
                                >
                                  <option value="">Catalog Default</option>
                                  {supOpts.map((s) => (
                                    <option key={s.supplier_id} value={s.supplier_id}>
                                      {s.supplier_name}
                                      {showCost && s.unit_price ? ` (${formatMoney(s.unit_price)})` : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-slate-400">Catalog default</span>
                              )}
                            </td>
                            {canEdit && (
                              <td className="px-2.5 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => removeComponent(c.tempKey)}
                                  className="rounded border border-slate-200 p-1 text-slate-400 hover:border-rose-200 hover:text-rose-600"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right 4 columns: Live Measurement Preview Calculator */}
          <div className="xl:col-span-4 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-amber-600" />
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Live Quantity Calculator
                  </h3>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Test Measurement Quantity ({unit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={previewQty}
                  onChange={(e) => setPreviewQty(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold tabular-nums"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Simulate an estimator entering {previewQty || 0} {unit} in a quotation.
                </p>
              </div>

              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {previewRows.length === 0 ? (
                  <div className="p-4 text-center text-slate-400">Add components to preview output.</div>
                ) : (
                  previewRows.map((r) => (
                    <div key={r.tempKey} className="px-3 py-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900 truncate">{r.itemName}</span>
                        <span className="font-bold text-slate-900 tabular-nums shrink-0">
                          {r.calcQty} {r.unit}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                        <span className="truncate">{r.formula}</span>
                        <span className="shrink-0 font-medium text-slate-700">{formatMoney(r.extSell)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-lg bg-slate-50 p-3.5 space-y-1.5 tabular-nums">
                {showCost && (
                  <div className="flex justify-between text-slate-600">
                    <span>Estimated Direct Cost:</span>
                    <span className="font-semibold text-slate-900">{formatMoney(previewTotalCost)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-800">
                  <span className="font-semibold">Estimated Selling Total:</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {formatMoney(previewTotalSelling)}
                  </span>
                </div>
                {previewQty > 0 && (
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Unit Package Rate (per {unit}):</span>
                    <span>{formatMoney(previewTotalSelling / previewQty)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Catalog Item Picker Modal */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Add Material, Labor or Equipment Component
              </h3>
              <button type="button" onClick={() => setPickerOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 text-xs">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search catalog code, name, or spec..."
                  className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5"
                />
              </div>
              <select
                value={pickerType}
                onChange={(e) => setPickerType(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="all">All Resource Types</option>
                <option value="Material">Material</option>
                <option value="Labor">Labor</option>
                <option value="Equipment">Equipment</option>
                <option value="Service">Service</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 text-xs">
              {filteredPickerItems.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No active items match this search.</div>
              ) : (
                filteredPickerItems.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">
                        <span className="font-mono text-slate-600">{it.item_code}</span> · {it.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {it.item_type} · {it.category} · {it.default_unit}
                        {it.specification ? ` · ${it.specification}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addCatalogItemToAssembly(it)}
                      className="shrink-0 rounded-lg bg-slate-900 px-3 py-1 font-medium text-white hover:bg-slate-800"
                    >
                      Select
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Inline Create New Catalog Item Modal (preserves unsaved assembly state) */}
      {inlineNewItemOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Create New Catalog Item &amp; Add to Assembly
              </h3>
              <button
                type="button"
                onClick={() => setInlineNewItemOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateInlineCatalogItem} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Item Code *</label>
                  <input
                    type="text"
                    required
                    value={newItemCode}
                    onChange={(e) => setNewItemCode(e.target.value)}
                    placeholder="e.g. TIL-6060"
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Resource Type</label>
                  <select
                    value={newItemType}
                    onChange={(e) => setNewItemType(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="Material">Material</option>
                    <option value="Labor">Labor</option>
                    <option value="Equipment">Equipment</option>
                    <option value="Service">Service</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Item Name *</label>
                <input
                  type="text"
                  required
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Default Unit</label>
                  <select
                    value={newItemUnit}
                    onChange={(e) => setNewItemUnit(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.code}>
                        {u.code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Specification</label>
                <input
                  type="text"
                  value={newItemSpec}
                  onChange={(e) => setNewItemSpec(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              {showCost && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Material Cost</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newItemMatCost}
                      onChange={(e) => setNewItemMatCost(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Labor Cost</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newItemLbrCost}
                      onChange={(e) => setNewItemLbrCost(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                    />
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setInlineNewItemOpen(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingInlineItem}
                  className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {creatingInlineItem ? 'Creating...' : 'Create & Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Version History & Diff Modal */}
      {versionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Assembly Version History &amp; Comparison
              </h3>
              <button
                type="button"
                onClick={() => setVersionModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Compare Controls */}
              {versions.length >= 2 && (
                <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Version A</label>
                    <select
                      value={compareVA}
                      onChange={(e) => setCompareVA(Number(e.target.value))}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.version_number}>
                          v{v.version_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Version B</label>
                    <select
                      value={compareVB}
                      onChange={(e) => setCompareVB(Number(e.target.value))}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.version_number}>
                          v{v.version_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleCompareVersions}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 font-medium text-white hover:bg-slate-800"
                  >
                    <GitCompare className="h-3.5 w-3.5" />
                    Compare Versions
                  </button>
                </div>
              )}

              {compareResult && (
                <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="font-semibold text-slate-900">
                    Diff: v{compareResult.vA.version} vs v{compareResult.vB.version}
                  </div>
                  {compareResult.metadataDiffs.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold uppercase text-slate-500">Metadata Changes</div>
                      {compareResult.metadataDiffs.map((md: any) => (
                        <div key={md.field} className="text-slate-700">
                          <span className="font-medium">{md.field}:</span>{' '}
                          <span className="line-through text-rose-600">{String(md.before)}</span> →{' '}
                          <span className="text-emerald-700 font-medium">{String(md.after)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">Component Changes</div>
                    {compareResult.componentDiffs.map((cd: any) => (
                      <div
                        key={cd.key}
                        className="flex items-center justify-between border-b border-slate-100 py-1.5"
                      >
                        <div>
                          <span
                            className={`font-semibold uppercase mr-2 ${
                              cd.change === 'added'
                                ? 'text-emerald-700'
                                : cd.change === 'removed'
                                ? 'text-rose-700'
                                : cd.change === 'modified'
                                ? 'text-amber-700'
                                : 'text-slate-400'
                            }`}
                          >
                            {cd.change}
                          </span>
                          <span className="font-medium text-slate-900">{cd.itemName}</span>
                        </div>
                        <div className="tabular-nums text-slate-600">
                          Rate: {cd.oldRate} → {cd.newRate} {cd.unit} · Waste: {cd.oldWastage}% → {cd.newWastage}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedSnapshot && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">
                      Snapshot v{selectedSnapshot.versionNumber}: {selectedSnapshot.snapshot.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedSnapshot(null)}
                      className="text-slate-500 hover:text-slate-800"
                    >
                      Close snapshot
                    </button>
                  </div>
                  <div className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
                    {(selectedSnapshot.snapshot.components || []).map((c: any, idx: number) => (
                      <div key={idx} className="flex justify-between px-3 py-1.5 tabular-nums">
                        <span>
                          {c.item_code} · {c.item_name}
                        </span>
                        <span className="text-slate-600">
                          {c.consumption_rate} {c.unit} ({c.wastage_pct}% waste)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Versions Timeline */}
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="font-semibold text-slate-900">
                        v{v.version_number} — {v.change_summary}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        By {v.changed_by_name || 'System'} · {formatDate(v.created_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleViewVersionSnapshot(v.version_number)}
                      className="rounded border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                    >
                      View Snapshot
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
