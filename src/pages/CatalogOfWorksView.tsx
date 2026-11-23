import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  Edit3,
  Layers,
  MessageSquarePlus,
  Package,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest, formatDate, formatMoney } from '../lib/api';
import { useSync } from '../context/SyncContext';
import {
  AssemblySummary,
  CatalogItemSummary,
  CatalogMetaResponse,
  downloadProtectedEndpoint,
} from '../components/catalog/CatalogTypes';
import { ItemDetailsDrawer } from '../components/catalog/ItemDetailsDrawer';
import { VisualAssemblyEditor } from '../components/catalog/VisualAssemblyEditor';

type CatalogTab = 'items' | 'assemblies' | 'suppliers' | 'categories' | 'requests';

export const CatalogOfWorksView: React.FC = () => {
  const { syncVersion } = useSync();

  const [activeTab, setActiveTab] = useState<CatalogTab>('items');
  const [meta, setMeta] = useState<CatalogMetaResponse | null>(null);
  const [items, setItems] = useState<CatalogItemSummary[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblySummary[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [suppliersList, setSuppliersList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  // Items filters
  const [itemSearch, setItemSearch] = useState('');
  const [itemCatFilter, setItemCatFilter] = useState('all');
  const [itemTypeFilter, setItemTypeFilter] = useState('all');
  const [itemStatusFilter, setItemStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [itemSupplierFilter, setItemSupplierFilter] = useState('all');

  // Assemblies filters + Visual Editor selection
  const [asmSearch, setAsmSearch] = useState('');
  const [asmCatFilter, setAsmCatFilter] = useState('all');
  const [asmStatusFilter, setAsmStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [editorMode, setEditorMode] = useState<'list' | 'edit' | 'create'>('list');
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<number | null>(null);

  // Item Drawer & Create/Edit Item Modal
  const [drawerItemId, setDrawerItemId] = useState<number | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('Material');
  const [formCategory, setFormCategory] = useState('');
  const [formUnit, setFormUnit] = useState('pcs');
  const [formSpec, setFormSpec] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formMatCost, setFormMatCost] = useState('0');
  const [formLbrCost, setFormLbrCost] = useState('0');
  const [formMatGp, setFormMatGp] = useState('30');
  const [formLbrGp, setFormLbrGp] = useState('30');
  const [formSupplierId, setFormSupplierId] = useState('');
  const [formRemarks, setFormRemarks] = useState('');
  const [dupWarning, setDupWarning] = useState<{
    hasExactCodeConflict: boolean;
    similarMatches: any[];
  } | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  // Request Missing Item Modal
  const [reqModalOpen, setReqModalOpen] = useState(false);
  const [reqName, setReqName] = useState('');
  const [reqCategory, setReqCategory] = useState('Custom Works');
  const [reqType, setReqType] = useState('Material');
  const [reqSpec, setReqSpec] = useState('');
  const [reqUnit, setReqUnit] = useState('pcs');
  const [reqSupplier, setReqSupplier] = useState('');
  const [reqPrice, setReqPrice] = useState('');
  const [reqNotes, setReqNotes] = useState('');
  const [savingReq, setSavingReq] = useState(false);

  // CSV Import Modal
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvRawText, setCsvRawText] = useState('');
  const [importingCsv, setImportingCsv] = useState(false);

  // Categories & Units forms
  const [newCatName, setNewCatName] = useState('');
  const [newCatSection, setNewCatSection] = useState('B');
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [newUnitCode, setNewUnitCode] = useState('');
  const [newUnitLabel, setNewUnitLabel] = useState('');

  // Supplier Modal
  const [supModalOpen, setSupModalOpen] = useState(false);
  const [editingSup, setEditingSup] = useState<any | null>(null);
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supTags, setSupTags] = useState('');
  const [supTerms, setSupTerms] = useState('30 Days');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [metaRes, itemsRes, asmRes, reqRes, supRes] = await Promise.all([
        apiRequest<CatalogMetaResponse>('/api/catalog/meta'),
        apiRequest(
          `/api/catalog/items?status=${itemStatusFilter}&category=${encodeURIComponent(
            itemCatFilter
          )}&itemType=${encodeURIComponent(itemTypeFilter)}&supplierId=${encodeURIComponent(
            itemSupplierFilter
          )}&search=${encodeURIComponent(itemSearch)}`
        ),
        apiRequest(
          `/api/catalog/assemblies?status=${asmStatusFilter}&category=${encodeURIComponent(
            asmCatFilter
          )}&search=${encodeURIComponent(asmSearch)}`
        ),
        apiRequest('/api/catalog/requests'),
        apiRequest('/api/catalog/suppliers'),
      ]);
      setMeta(metaRes);
      setItems(itemsRes.items || []);
      setAssemblies(asmRes.assemblies || []);
      setRequests(reqRes.requests || []);
      setSuppliersList(supRes.suppliers || []);
    } catch (e: any) {
      setErr(e?.message || 'Unable to load Catalog of Works data');
    } finally {
      setLoading(false);
    }
  }, [
    itemStatusFilter,
    itemCatFilter,
    itemTypeFilter,
    itemSupplierFilter,
    itemSearch,
    asmStatusFilter,
    asmCatFilter,
    asmSearch,
  ]);

  useEffect(() => {
    loadAll();
  }, [loadAll, syncVersion]);

  // Live duplicate check when adding/editing an item
  useEffect(() => {
    if (!itemModalOpen || (!formCode.trim() && !formName.trim())) {
      setDupWarning(null);
      return;
    }
    const timer = setTimeout(() => {
      apiRequest(
        `/api/catalog/items/check-duplicate?itemCode=${encodeURIComponent(
          formCode
        )}&name=${encodeURIComponent(formName)}&specification=${encodeURIComponent(
          formSpec
        )}${editingItem ? `&excludeId=${editingItem.id}` : ''}`
      )
        .then((res) => setDupWarning(res))
        .catch(() => setDupWarning(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [itemModalOpen, formCode, formName, formSpec, editingItem]);

  const perms = meta?.permissions;
  const showCost = Boolean(perms?.viewInternalCosting);

  const openNewItemModal = () => {
    setEditingItem(null);
    setFormCode('');
    setFormName('');
    setFormType('Material');
    setFormCategory(meta?.categories[0]?.name || 'Custom Works');
    setFormUnit('pcs');
    setFormSpec('');
    setFormDesc('');
    setFormMatCost('0');
    setFormLbrCost('0');
    setFormMatGp('30');
    setFormLbrGp('30');
    setFormSupplierId('');
    setFormRemarks('');
    setItemModalOpen(true);
  };

  const openEditItemModal = (item: any) => {
    setEditingItem(item);
    setFormCode(item.item_code || '');
    setFormName(item.name || '');
    setFormType(item.item_type || 'Material');
    setFormCategory(item.category || meta?.categories[0]?.name || 'Custom Works');
    setFormUnit(item.default_unit || 'pcs');
    setFormSpec(item.specification || '');
    setFormDesc(item.description || '');
    setFormMatCost(String(item.mat_unit_cost ?? 0));
    setFormLbrCost(String(item.lbr_unit_cost ?? 0));
    setFormMatGp(String(Math.round(Number(item.default_mat_gp_pct ?? 0.3) * 100)));
    setFormLbrGp(String(Math.round(Number(item.default_lbr_gp_pct ?? 0.3) * 100)));
    setFormSupplierId('');
    setFormRemarks(item.remarks || '');
    setItemModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setSavingItem(true);
    try {
      if (editingItem) {
        await apiRequest(`/api/catalog/items/${editingItem.id}`, {
          method: 'PUT',
          body: {
            itemCode: formCode,
            name: formName,
            itemType: formType,
            category: formCategory,
            defaultUnit: formUnit,
            specification: formSpec,
            description: formDesc,
            ...(showCost && (perms?.overrideCost || perms?.manageSupplierPrices)
              ? {
                  matUnitCost: Number(formMatCost || 0),
                  lbrUnitCost: Number(formLbrCost || 0),
                  defaultMatGpPct: Number(formMatGp || 30) / 100,
                  defaultLbrGpPct: Number(formLbrGp || 30) / 100,
                }
              : {}),
            remarks: formRemarks,
          },
        });
        setNotice(`Updated catalog item "${formCode}".`);
      } else {
        await apiRequest('/api/catalog/items', {
          method: 'POST',
          body: {
            itemCode: formCode,
            name: formName,
            itemType: formType,
            category: formCategory,
            defaultUnit: formUnit,
            specification: formSpec,
            description: formDesc,
            matUnitCost: showCost ? Number(formMatCost || 0) : 0,
            lbrUnitCost: showCost ? Number(formLbrCost || 0) : 0,
            defaultMatGpPct: Number(formMatGp || 30) / 100,
            defaultLbrGpPct: Number(formLbrGp || 30) / 100,
            supplierId: formSupplierId ? Number(formSupplierId) : undefined,
            remarks: formRemarks,
            confirmNotDuplicate: true,
          },
        });
        setNotice(`Added "${formCode}" to catalog.`);
      }
      setItemModalOpen(false);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || 'Unable to save catalog item');
    } finally {
      setSavingItem(false);
    }
  };

  const handleItemAction = async (id: number, action: 'duplicate' | 'archive' | 'restore') => {
    setErr('');
    try {
      await apiRequest(`/api/catalog/items/${id}/${action}`, { method: 'POST' });
      setNotice(`Item ${action}d successfully.`);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || `Unable to ${action} item`);
    }
  };

  const handleAssemblyAction = async (id: number, action: 'duplicate' | 'archive' | 'restore') => {
    setErr('');
    try {
      await apiRequest(`/api/catalog/assemblies/${id}/${action}`, { method: 'POST' });
      setNotice(`Set of Works ${action}d successfully.`);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || `Unable to ${action} Set of Works`);
    }
  };

  const handleCsvImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = csvRawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      setErr('Provide a header row plus at least one data row.');
      return;
    }
    const rows = lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      return {
        itemCode: cols[0] || '',
        name: cols[1] || '',
        itemType: cols[2] || 'Material',
        category: cols[3] || 'Custom Works',
        defaultUnit: cols[4] || 'pcs',
        specification: cols[5] || '',
        matUnitCost: Number(cols[6] || 0),
        lbrUnitCost: Number(cols[7] || 0),
      };
    });
    setImportingCsv(true);
    setErr('');
    try {
      const res = await apiRequest('/api/catalog/items/import-csv', {
        method: 'POST',
        body: { rows },
      });
      setCsvModalOpen(false);
      setCsvRawText('');
      setNotice(`CSV Import complete: ${res.inserted} inserted, ${res.skipped} skipped.`);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || 'CSV import failed');
    } finally {
      setImportingCsv(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await apiRequest('/api/catalog/categories', {
        method: 'POST',
        body: { name: newCatName, sectionDefault: newCatSection },
      });
      setNewCatName('');
      setNotice('Work category created.');
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || 'Failed to add category');
    }
  };

  const handleReorderCategory = async (idx: number, dir: -1 | 1) => {
    if (!meta?.categories) return;
    const list = [...meta.categories];
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const [moved] = list.splice(idx, 1);
    list.splice(target, 0, moved);
    try {
      await apiRequest('/api/catalog/categories/reorder', {
        method: 'POST',
        body: { orderedIds: list.map((c) => c.id) },
      });
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || 'Reorder failed');
    }
  };

  const handleUpdateCategory = async (id: number, patch: Record<string, any>) => {
    setErr('');
    try {
      await apiRequest(`/api/catalog/categories/${id}`, { method: 'PUT', body: patch });
      setEditingCatId(null);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || 'Failed to update category');
    }
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await apiRequest('/api/catalog/units', {
        method: 'POST',
        body: { code: newUnitCode, label: newUnitLabel || newUnitCode },
      });
      setNewUnitCode('');
      setNewUnitLabel('');
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || 'Failed to add unit');
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingReq(true);
    setErr('');
    try {
      await apiRequest('/api/catalog/requests', {
        method: 'POST',
        body: {
          requestedName: reqName,
          category: reqCategory,
          itemType: reqType,
          specification: reqSpec,
          suggestedUnit: reqUnit,
          suggestedSupplier: reqSupplier,
          estimatedPrice: Number(reqPrice || 0),
          notes: reqNotes,
        },
      });
      setReqModalOpen(false);
      setReqName('');
      setReqSpec('');
      setReqNotes('');
      setNotice('Catalog addition request sent to authorized managers.');
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || 'Failed to submit request');
    } finally {
      setSavingReq(false);
    }
  };

  const handleDecideRequest = async (id: number, decision: 'approved' | 'rejected') => {
    setErr('');
    try {
      await apiRequest(`/api/catalog/requests/${id}/decide`, {
        method: 'PATCH',
        body: { decision },
      });
      setNotice(
        decision === 'approved'
          ? 'Request approved and item added to master catalog.'
          : 'Request marked rejected.'
      );
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || 'Decision failed');
    }
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const payload = {
        name: supName,
        contactPerson: supContact,
        email: supEmail,
        phone: supPhone,
        address: supAddress,
        categoryTags: supTags,
        paymentTerms: supTerms,
      };
      if (editingSup) {
        await apiRequest(`/api/catalog/suppliers/${editingSup.id}`, { method: 'PUT', body: payload });
        setNotice(`Updated supplier ${editingSup.name}.`);
      } else {
        await apiRequest('/api/catalog/suppliers', { method: 'POST', body: payload });
        setNotice(`Registered supplier "${supName}".`);
      }
      setSupModalOpen(false);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save supplier');
    }
  };

  const summaryCounts = useMemo(
    () => ({
      activeItems: items.filter((i) => i.is_active).length,
      assemblies: assemblies.filter((a) => a.is_active).length,
      suppliers: suppliersList.filter((s) => s.is_active).length,
      categories: meta?.categories.filter((c) => c.is_active).length || 0,
    }),
    [items, assemblies, suppliersList, meta]
  );

  // If editing or creating a Set of Works in the dedicated Visual Assembly Editor
  if (activeTab === 'assemblies' && editorMode !== 'list') {
    return (
      <VisualAssemblyEditor
        assemblyId={editorMode === 'edit' ? selectedAssemblyId : null}
        categories={meta?.categories || []}
        units={meta?.units || []}
        catalogItems={items}
        permissions={
          perms || {
            view: true,
            createItem: false,
            editItem: false,
            manageCategories: false,
            createAssembly: false,
            editAssembly: false,
            duplicateAssembly: false,
            archiveRecord: false,
            restoreRecord: false,
            manageSuppliers: false,
            manageSupplierPrices: false,
            overrideCost: false,
            viewInternalCosting: false,
            requestItem: false,
          }
        }
        onBack={() => {
          setEditorMode('list');
          setSelectedAssemblyId(null);
          loadAll();
        }}
        onSaved={(savedId) => {
          setSelectedAssemblyId(savedId);
          setEditorMode('edit');
          loadAll();
        }}
        onCatalogItemsChanged={loadAll}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Page Header + Single Dominant Action */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Catalog of Works Management
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Central master database of individual materials, labor rates, reusable Sets of Works assemblies, and supplier price records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(perms?.requestItem || perms?.createItem) && (
            <button
              type="button"
              onClick={() => setReqModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Request Missing Item
            </button>
          )}
          {activeTab === 'items' && perms?.createItem && (
            <button
              type="button"
              onClick={openNewItemModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add New Item
            </button>
          )}
          {activeTab === 'assemblies' && perms?.createAssembly && (
            <button
              type="button"
              onClick={() => {
                setSelectedAssemblyId(null);
                setEditorMode('create');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              New Set of Works
            </button>
          )}
          {activeTab === 'suppliers' && perms?.manageSuppliers && (
            <button
              type="button"
              onClick={() => {
                setEditingSup(null);
                setSupName('');
                setSupContact('');
                setSupEmail('');
                setSupPhone('');
                setSupAddress('');
                setSupTags('');
                setSupTerms('30 Days');
                setSupModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Supplier
            </button>
          )}
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Catalog Items
          </div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {summaryCounts.activeItems}
          </div>
          <div className="text-[11px] text-slate-500">Materials, Labor &amp; Equipment</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Sets of Works
          </div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {summaryCounts.assemblies}
          </div>
          <div className="text-[11px] text-slate-500">Version-controlled assemblies</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Active Suppliers
          </div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {summaryCounts.suppliers}
          </div>
          <div className="text-[11px] text-slate-500">Multi-supplier price registry</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Work Categories
          </div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {summaryCounts.categories}
          </div>
          <div className="text-[11px] text-slate-500">Configurable trade trades &amp; units</div>
        </div>
      </div>

      {/* Clean Segmented Tab Navigation */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('items')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'items' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          Individual Items Catalog
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('assemblies');
            setEditorMode('list');
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'assemblies' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Sets of Works
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('suppliers')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'suppliers' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Truck className="h-3.5 w-3.5" />
          Suppliers Registry
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'categories' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Categories &amp; Units
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'requests' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Catalog Requests
          {meta && meta.pendingRequestCount > 0 ? ` (${meta.pendingRequestCount})` : ''}
        </button>
      </div>

      {err && (
        <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          <span>{err}</span>
          <button type="button" onClick={() => setErr('')} className="text-rose-600 hover:underline">
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="text-emerald-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: INDIVIDUAL ITEMS CATALOG */}
      {activeTab === 'items' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 text-xs">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative min-w-[220px] flex-1 max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Search SKU, name, spec, supplier..."
                  className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5"
                />
              </div>
              <select
                value={itemCatFilter}
                onChange={(e) => setItemCatFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="all">All Categories</option>
                {meta?.categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={itemTypeFilter}
                onChange={(e) => setItemTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="all">All Types</option>
                <option value="Material">Material</option>
                <option value="Labor">Labor</option>
                <option value="Equipment">Equipment</option>
                <option value="Service">Service</option>
                <option value="Other">Other</option>
              </select>
              <select
                value={itemSupplierFilter}
                onChange={(e) => setItemSupplierFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="all">All Suppliers</option>
                {suppliersList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                value={itemStatusFilter}
                onChange={(e) => setItemStatusFilter(e.target.value as any)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="active">Active Only</option>
                <option value="archived">Archived Only</option>
                <option value="all">All Statuses</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadProtectedEndpoint('/api/catalog/items/export-csv', 'CBMS_Catalog_Items.csv').catch(
                    (e) => setErr(e.message)
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
              {perms?.createItem && (
                <button
                  type="button"
                  onClick={() => setCsvModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import CSV
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Code &amp; Item Name</th>
                  <th className="px-4 py-2.5">Category · Type</th>
                  <th className="px-4 py-2.5">Unit</th>
                  {showCost && <th className="px-4 py-2.5 text-right">Mat Cost</th>}
                  {showCost && <th className="px-4 py-2.5 text-right">Lbr Cost</th>}
                  <th className="px-4 py-2.5 text-right">Client Selling</th>
                  <th className="px-4 py-2.5">Suppliers</th>
                  <th className="px-4 py-2.5">State</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                      Loading catalog items...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                      No catalog items found matching these filters.
                    </td>
                  </tr>
                ) : (
                  items.map((it) => (
                    <tr
                      key={it.id}
                      onClick={() => setDrawerItemId(it.id)}
                      className={`cursor-pointer hover:bg-slate-50 ${
                        !it.is_active ? 'bg-slate-50/50 text-slate-500' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">
                          <span className="font-mono text-slate-600">{it.item_code}</span> · {it.name}
                        </div>
                        {it.specification && (
                          <div className="text-[11px] text-slate-500 truncate max-w-xs">
                            {it.specification}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {it.category} · {it.item_type}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">{it.default_unit}</td>
                      {showCost && (
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                          {formatMoney(it.mat_unit_cost || 0)}
                        </td>
                      )}
                      {showCost && (
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                          {formatMoney(it.lbr_unit_cost || 0)}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                        {formatMoney(it.combined_sell_rate)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {it.suppliers && it.suppliers.length > 0 ? (
                          <span className="truncate block max-w-[180px]">
                            {it.suppliers[0].supplier_name}
                            {it.suppliers.length > 1 ? ` (+${it.suppliers.length - 1})` : ''}
                          </span>
                        ) : (
                          <span className="text-slate-400">{it.supplier_ref || '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={it.is_active ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                          {it.is_active ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      <td
                        className="px-4 py-2.5 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          {perms?.editItem && (
                            <button
                              type="button"
                              onClick={() => openEditItemModal(it)}
                              className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
                              title="Edit Item"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {perms?.createItem && (
                            <button
                              type="button"
                              onClick={() => handleItemAction(it.id, 'duplicate')}
                              className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
                              title="Duplicate"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {it.is_active
                            ? perms?.archiveRecord && (
                                <button
                                  type="button"
                                  onClick={() => handleItemAction(it.id, 'archive')}
                                  className="rounded border border-slate-200 p-1 text-amber-700 hover:bg-amber-50"
                                  title="Archive"
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                </button>
                              )
                            : perms?.restoreRecord && (
                                <button
                                  type="button"
                                  onClick={() => handleItemAction(it.id, 'restore')}
                                  className="rounded border border-slate-200 p-1 text-emerald-700 hover:bg-emerald-50"
                                  title="Restore"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: SETS OF WORKS */}
      {activeTab === 'assemblies' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3.5 text-xs">
            <div className="relative min-w-[220px] flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={asmSearch}
                onChange={(e) => setAsmSearch(e.target.value)}
                placeholder="Search Sets of Works..."
                className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5"
              />
            </div>
            <select
              value={asmCatFilter}
              onChange={(e) => setAsmCatFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
            >
              <option value="all">All Work Categories</option>
              {meta?.categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={asmStatusFilter}
              onChange={(e) => setAsmStatusFilter(e.target.value as any)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
            >
              <option value="active">Active Templates</option>
              <option value="archived">Archived Only</option>
              <option value="all">All Statuses</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Code &amp; Set of Works</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Unit · Calc</th>
                  <th className="px-4 py-2.5">Components</th>
                  <th className="px-4 py-2.5">Version</th>
                  <th className="px-4 py-2.5">State</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assemblies.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      No Sets of Works match this filter.
                    </td>
                  </tr>
                ) : (
                  assemblies.map((asm) => (
                    <tr key={asm.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">
                          <span className="font-mono text-slate-600">{asm.assembly_code}</span> · {asm.name}
                        </div>
                        {asm.description && (
                          <div className="text-[11px] text-slate-500 truncate max-w-md">
                            {asm.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{asm.category_name}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="font-mono">{asm.unit}</span> · {asm.default_calc_method}
                      </td>
                      <td className="px-4 py-3 text-slate-600 tabular-nums">
                        {asm.material_count} Mat · {asm.labor_count} Lbr
                        {asm.other_count > 0 ? ` · ${asm.other_count} Other` : ''}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-medium text-slate-800">
                        v{asm.current_version}
                      </td>
                      <td className="px-4 py-3">
                        <span className={asm.is_active ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                          {asm.is_active ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAssemblyId(asm.id);
                              setEditorMode('edit');
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-100"
                          >
                            Open Visual Editor
                          </button>
                          {perms?.duplicateAssembly && (
                            <button
                              type="button"
                              onClick={() => handleAssemblyAction(asm.id, 'duplicate')}
                              className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              title="Duplicate Set of Works"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {asm.is_active
                            ? perms?.archiveRecord && (
                                <button
                                  type="button"
                                  onClick={() => handleAssemblyAction(asm.id, 'archive')}
                                  className="rounded border border-slate-200 p-1.5 text-amber-700 hover:bg-amber-50"
                                  title="Archive"
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                </button>
                              )
                            : perms?.restoreRecord && (
                                <button
                                  type="button"
                                  onClick={() => handleAssemblyAction(asm.id, 'restore')}
                                  className="rounded border border-slate-200 p-1.5 text-emerald-700 hover:bg-emerald-50"
                                  title="Restore"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: SUPPLIERS REGISTRY */}
      {activeTab === 'suppliers' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Supplier Code &amp; Name</th>
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5">Trades / Categories</th>
                  <th className="px-4 py-2.5">Payment Terms</th>
                  <th className="px-4 py-2.5 text-right">Active Price Records</th>
                  {perms?.manageSuppliers && <th className="px-4 py-2.5 text-right">Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliersList.map((sup) => (
                  <tr key={sup.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-900">
                        <span className="font-mono text-slate-500">{sup.supplier_code}</span> · {sup.name}
                      </div>
                      <div className="text-[11px] text-slate-500">{sup.address}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <div>{sup.contact_person || '—'}</div>
                      <div className="text-[11px] text-slate-400">
                        {[sup.phone, sup.email].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{sup.category_tags || 'General'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{sup.payment_terms}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-800">
                      {sup.active_price_count || 0}
                    </td>
                    {perms?.manageSuppliers && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSup(sup);
                            setSupName(sup.name || '');
                            setSupContact(sup.contact_person || '');
                            setSupEmail(sup.email || '');
                            setSupPhone(sup.phone || '');
                            setSupAddress(sup.address || '');
                            setSupTags(sup.category_tags || '');
                            setSupTerms(sup.payment_terms || '30 Days');
                            setSupModalOpen(true);
                          }}
                          className="rounded border border-slate-200 px-2.5 py-1 text-slate-700 hover:bg-slate-100"
                        >
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: WORK CATEGORIES & UNITS */}
      {activeTab === 'categories' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Configurable Work Categories
              </h3>
              <p className="text-[11px] text-slate-500">
                Categories structure both Individual Catalog Items and Sets of Works.
              </p>
            </div>

            {perms?.manageCategories && (
              <form onSubmit={handleCreateCategory} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  required
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="New work category name (e.g. Solar & Auxiliary)"
                  className="flex-1 min-w-[200px] rounded-lg border border-slate-300 px-3 py-1.5"
                />
                <select
                  value={newCatSection}
                  onChange={(e) => setNewCatSection(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  <option value="A">Section A (General Req)</option>
                  <option value="B">Section B (Trade Works)</option>
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-1.5 font-medium text-white hover:bg-slate-800"
                >
                  Add Category
                </button>
              </form>
            )}

            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {meta?.categories.map((cat, idx) => (
                <div key={cat.id} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {perms?.manageCategories && (
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleReorderCategory(idx, -1)}
                          className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === meta.categories.length - 1}
                          onClick={() => handleReorderCategory(idx, 1)}
                          className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    {editingCatId === cat.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingCatName}
                          onChange={(e) => setEditingCatName(e.target.value)}
                          className="rounded border border-slate-300 px-2 py-1"
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateCategory(cat.id, { name: editingCatName })}
                          className="rounded bg-emerald-600 px-2 py-1 text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCatId(null)}
                          className="rounded border border-slate-200 px-2 py-1"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className={`font-medium ${cat.is_active ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                        {cat.name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[11px]">
                    <span className="text-slate-400">Sec {cat.section_default}</span>
                    {perms?.manageCategories && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCatId(cat.id);
                            setEditingCatName(cat.name);
                          }}
                          className="text-slate-600 hover:underline"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateCategory(cat.id, { isActive: !cat.is_active })}
                          className={cat.is_active ? 'text-amber-700 hover:underline' : 'text-emerald-700 hover:underline'}
                        >
                          {cat.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">Units of Measurement</h3>
              <p className="text-[11px] text-slate-500">
                Standard physical &amp; assembly units available across catalog items and quotations.
              </p>
            </div>
            {perms?.manageCategories && (
              <form onSubmit={handleCreateUnit} className="flex gap-2">
                <input
                  type="text"
                  required
                  value={newUnitCode}
                  onChange={(e) => setNewUnitCode(e.target.value)}
                  placeholder="Code (e.g. box)"
                  className="w-28 rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
                <input
                  type="text"
                  value={newUnitLabel}
                  onChange={(e) => setNewUnitLabel(e.target.value)}
                  placeholder="Label (e.g. Box)"
                  className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-3.5 py-1.5 font-medium text-white hover:bg-slate-800"
                >
                  Add
                </button>
              </form>
            )}
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {meta?.units.map((u) => (
                <div key={u.id} className="flex items-center justify-between px-3.5 py-2">
                  <div>
                    <span className="font-mono font-semibold text-slate-900">{u.code}</span>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span className="text-slate-600">{u.label}</span>
                  </div>
                  <span className={u.is_active ? 'text-emerald-700' : 'text-slate-400'}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: CATALOG REQUESTS */}
      {activeTab === 'requests' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Requested Item</th>
                  <th className="px-4 py-2.5">Category · Unit</th>
                  <th className="px-4 py-2.5">Suggested Supplier</th>
                  <th className="px-4 py-2.5">Requested By</th>
                  <th className="px-4 py-2.5">Status</th>
                  {perms?.createItem && <th className="px-4 py-2.5 text-right">Review Decision</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      No missing-item or catalog modification requests submitted.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{r.requested_name}</div>
                        <div className="text-[11px] text-slate-500">{r.specification || r.notes}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {r.category} · {r.item_type} · {r.suggested_unit}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.suggested_supplier || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{r.requested_by_name}</div>
                        <div className="text-[11px] text-slate-400">{formatDate(r.created_at)}</div>
                      </td>
                      <td className="px-4 py-3 capitalize font-medium">
                        <span
                          className={
                            r.status === 'approved'
                              ? 'text-emerald-700'
                              : r.status === 'rejected'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                      {perms?.createItem && (
                        <td className="px-4 py-3 text-right">
                          {r.status === 'pending' ? (
                            <div className="inline-flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleDecideRequest(r.id, 'approved')}
                                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-700"
                              >
                                <Check className="h-3 w-3" />
                                Approve &amp; Add
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDecideRequest(r.id, 'rejected')}
                                className="rounded border border-rose-300 px-2.5 py-1 font-medium text-rose-700 hover:bg-rose-50"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">
                              Reviewed by {r.reviewed_by_name || 'Admin'}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Item Details Drawer */}
      <ItemDetailsDrawer
        itemId={drawerItemId}
        categories={meta?.categories || []}
        units={meta?.units || []}
        suppliers={suppliersList}
        permissions={
          perms || {
            view: true,
            createItem: false,
            editItem: false,
            manageCategories: false,
            createAssembly: false,
            editAssembly: false,
            duplicateAssembly: false,
            archiveRecord: false,
            restoreRecord: false,
            manageSuppliers: false,
            manageSupplierPrices: false,
            overrideCost: false,
            viewInternalCosting: false,
            requestItem: false,
          }
        }
        onClose={() => setDrawerItemId(null)}
        onMutated={loadAll}
        onOpenEditModal={(item) => {
          setDrawerItemId(null);
          openEditItemModal(item);
        }}
        onSuppliersUpdated={loadAll}
      />

      {/* Add / Edit Catalog Item Modal */}
      {itemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingItem ? `Edit Item: ${editingItem.item_code}` : 'Add Individual Catalog Item'}
              </h3>
              <button
                type="button"
                onClick={() => setItemModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {dupWarning && (dupWarning.hasExactCodeConflict || dupWarning.similarMatches.length > 0) && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                {dupWarning.hasExactCodeConflict ? (
                  <div className="font-semibold">
                    Item Code "{formCode}" already exists in the catalog. Please enter a unique code.
                  </div>
                ) : (
                  <div>
                    Similar existing items found:{' '}
                    {dupWarning.similarMatches.map((m) => `[${m.item_code}] ${m.name}`).join(', ')}. Verify
                    before saving to avoid duplicates.
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleSaveItem} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Item Code / SKU *</label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="e.g. CHB-4"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono uppercase"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Item Name *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Resource Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="Material">Material</option>
                    <option value="Labor">Labor</option>
                    <option value="Equipment">Equipment</option>
                    <option value="Service">Service</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Work Category *</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {meta?.categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Default Unit *</label>
                  <select
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {meta?.units.map((u) => (
                      <option key={u.id} value={u.code}>
                        {u.code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Technical Specification</label>
                <input
                  type="text"
                  value={formSpec}
                  onChange={(e) => setFormSpec(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>

              {showCost && (!editingItem || perms?.overrideCost || perms?.manageSupplierPrices) && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Mat Cost</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formMatCost}
                      onChange={(e) => setFormMatCost(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Lbr Cost</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formLbrCost}
                      onChange={(e) => setFormLbrCost(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Mat GP %</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="90"
                      value={formMatGp}
                      onChange={(e) => setFormMatGp(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Lbr GP %</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="90"
                      value={formLbrGp}
                      onChange={(e) => setFormLbrGp(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 tabular-nums"
                    />
                  </div>
                </div>
              )}

              {!editingItem && showCost && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Initial Supplier (Optional)
                  </label>
                  <select
                    value={formSupplierId}
                    onChange={(e) => setFormSupplierId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="">No initial supplier link</option>
                    {suppliersList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.supplier_code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">Notes / Remarks</label>
                <input
                  type="text"
                  value={formRemarks}
                  onChange={(e) => setFormRemarks(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setItemModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-1.5 font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingItem || Boolean(dupWarning?.hasExactCodeConflict)}
                  className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingItem ? 'Saving...' : editingItem ? 'Save Changes' : 'Create Catalog Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Request Missing Item Modal */}
      {reqModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                Request Missing Catalog Item
              </h3>
              <button
                type="button"
                onClick={() => setReqModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSubmitRequest} className="mt-4 space-y-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Requested Item Name *</label>
                <input
                  type="text"
                  required
                  value={reqName}
                  onChange={(e) => setReqName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={reqCategory}
                    onChange={(e) => setReqCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {meta?.categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit</label>
                  <select
                    value={reqUnit}
                    onChange={(e) => setReqUnit(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {meta?.units.map((u) => (
                      <option key={u.id} value={u.code}>
                        {u.code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Type</label>
                  <select
                    value={reqType}
                    onChange={(e) => setReqType(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="Material">Material</option>
                    <option value="Labor">Labor</option>
                    <option value="Equipment">Equipment</option>
                    <option value="Service">Service</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Est. Reference Price</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={reqPrice}
                    onChange={(e) => setReqPrice(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Suggested Supplier</label>
                <input
                  type="text"
                  value={reqSupplier}
                  onChange={(e) => setReqSupplier(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Specification / Notes</label>
                <textarea
                  rows={2}
                  value={reqSpec}
                  onChange={(e) => setReqSpec(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReqModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingReq}
                  className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingReq ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {csvModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">Import Catalog Items (CSV)</h3>
              <button
                type="button"
                onClick={() => setCsvModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCsvImport} className="mt-4 space-y-3">
              <p className="text-slate-600">
                Paste CSV rows with columns:{' '}
                <code className="font-mono">
                  item_code,name,item_type,category,unit,specification,mat_unit_cost,lbr_unit_cost
                </code>
              </p>
              <textarea
                rows={7}
                required
                value={csvRawText}
                onChange={(e) => setCsvRawText(e.target.value)}
                placeholder="item_code,name,item_type,category,unit,specification,mat_unit_cost,lbr_unit_cost&#10;CHB-6,6-inch Concrete Hollow Block,Material,Masonry Works,pcs,150x200x400mm,24.5,0"
                className="w-full rounded-lg border border-slate-300 p-3 font-mono text-[11px]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCsvModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importingCsv}
                  className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {importingCsv ? 'Importing...' : 'Run Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Add/Edit Modal */}
      {supModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingSup ? `Edit Supplier: ${editingSup.supplier_code}` : 'Register Master Supplier'}
              </h3>
              <button
                type="button"
                onClick={() => setSupModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveSupplier} className="mt-4 space-y-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Company Name *</label>
                <input
                  type="text"
                  required
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={supContact}
                    onChange={(e) => setSupContact(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={supEmail}
                    onChange={(e) => setSupEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Terms</label>
                  <input
                    type="text"
                    value={supTerms}
                    onChange={(e) => setSupTerms(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Trades / Category Tags</label>
                <input
                  type="text"
                  value={supTags}
                  onChange={(e) => setSupTags(e.target.value)}
                  placeholder="e.g. Masonry, Concrete, Rebar"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSupModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800"
                >
                  {editingSup ? 'Update Supplier' : 'Register Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
