import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderPlus,
  GitCompare,
  Layers,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { QuotationDocumentPrint } from '../components/QuotationDocumentPrint';
import { apiRequest, formatDate, formatMoney } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';

type WorkspaceTab = 'dashboard' | 'editor' | 'catalog' | 'settings';
type PricingMode = 'computed' | 'included' | 'excluded' | 'override';

interface EditorSection {
  tempKey: string;
  id?: number;
  code: string;
  title: string;
  sortOrder: number;
  isCollapsed: boolean;
}

interface EditorItem {
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
  sortOrder: number;
  // Server-provided or client-previewed rates:
  matSellRate: number;
  lbrSellRate: number;
  combinedUnitRate: number;
  extendedSelling: number;
  extendedCost: number;
  grossProfit: number;
}

function round2(n: number): number {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function calcSellRate(cost: number, gp: number, mode: PricingMode, overrideRate?: number | null): number {
  if (mode === 'included' || mode === 'excluded') return 0;
  if (mode === 'override') return Math.max(0, round2(Number(overrideRate ?? 0)));
  const c = Number(cost || 0);
  if (c <= 0) return 0;
  const g = Math.min(0.95, Math.max(0, Number(gp || 0)));
  return Math.ceil(Number((c / (1 - g)).toFixed(10)));
}

function calcManpowerTeams(m: number): number {
  const n = Math.max(0, Math.floor(Number(m || 0)));
  if (n === 0) return 0;
  return Math.ceil(n / 10) + 1 + Math.floor(n / 25) + 3 * Math.floor(n / 100);
}

const STATUS_LABEL_STYLE: Record<string, string> = {
  draft: 'text-slate-600',
  for_review: 'text-sky-700',
  for_approval: 'text-amber-700',
  rejected: 'text-rose-700',
  approved: 'text-emerald-700',
  sent_to_client: 'text-indigo-700',
  accepted: 'text-emerald-800 font-semibold',
  declined: 'text-rose-700',
  expired: 'text-slate-500',
  cancelled: 'text-slate-500',
};

export const QuotationsModuleView: React.FC<{ onOpenProject?: (projectId: number) => void }> = ({
  onOpenProject,
}) => {
  const { hasPerm } = useAuth();
  const { syncVersion } = useSync();

  const [tab, setTab] = useState<WorkspaceTab>('dashboard');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [clientFilter, setClientFilter] = useState('');

  // Dashboard state
  const [quotations, setQuotations] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>({});
  const [monthlySeries, setMonthlySeries] = useState<any[]>([]);
  const [canViewCosting, setCanViewCosting] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  // Meta & Catalog state
  const [meta, setMeta] = useState<{
    units: any[];
    categories: any[];
    locations: any[];
    clients: any[];
    settings: any;
  }>({ units: [], categories: [], locations: [], clients: [], settings: {} });
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [reconciliation, setReconciliation] = useState<any>(null);

  // Active Quotation Editor state
  const [activeQuoteId, setActiveQuoteId] = useState<number | null>(null);
  const [quoteBundle, setQuoteBundle] = useState<any>(null);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveBanner, setSaveBanner] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string>('');

  // Editable draft fields
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftSiteLocation, setDraftSiteLocation] = useState('');
  const [draftProvince, setDraftProvince] = useState('');
  const [draftMunicipality, setDraftMunicipality] = useState('');
  const [draftBarangay, setDraftBarangay] = useState('');
  const [draftZipCode, setDraftZipCode] = useState('');
  const [draftAttentionTo, setDraftAttentionTo] = useState('');
  const [draftAttentionTitle, setDraftAttentionTitle] = useState('');
  const [draftThruPerson, setDraftThruPerson] = useState('');
  const [draftThruTitle, setDraftThruTitle] = useState('');
  const [draftValidityDate, setDraftValidityDate] = useState('');
  const [draftVatRate, setDraftVatRate] = useState(12);
  const [draftDiscountPct, setDraftDiscountPct] = useState(0);
  const [draftManpower, setDraftManpower] = useState(15);
  const [draftDurationDays, setDraftDurationDays] = useState(90);
  const [draftScopeOptions, setDraftScopeOptions] = useState<any>({
    chkSupply: true,
    chkInstall: true,
    chkDelivery: true,
    chkDesign: false,
    chkTC: true,
    tradeType: 'optCons',
  });
  const [draftTerms, setDraftTerms] = useState<any>({});
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const [sections, setSections] = useState<EditorSection[]>([]);
  const [items, setItems] = useState<EditorItem[]>([]);

  // Inspector & Modals
  const [inspectedRowKey, setInspectedRowKey] = useState<string | null>(null);
  const [showHeaderPanel, setShowHeaderPanel] = useState(true);
  const [showTermsPanel, setShowTermsPanel] = useState(false);
  const [showCatalogPickerForSection, setShowCatalogPickerForSection] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [printMode, setPrintMode] = useState<'client' | 'internal' | null>(null);
  const [showNewWizard, setShowNewWizard] = useState(false);
  const [showRevModal, setShowRevModal] = useState(false);
  const [newRevReason, setNewRevReason] = useState('');
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareRevA, setCompareRevA] = useState<number>(0);
  const [compareRevB, setCompareRevB] = useState<number>(0);
  const [compareResult, setCompareResult] = useState<any>(null);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertInitBudget, setConvertInitBudget] = useState(true);
  const [convertOverrideReason, setConvertOverrideReason] = useState('');
  const [commentText, setCommentText] = useState('');
  const [showNewCatalogModal, setShowNewCatalogModal] = useState(false);

  // Wizard state
  const [wizStep, setWizStep] = useState<1 | 2 | 3>(1);
  const [wizClientId, setWizClientId] = useState<string>('');
  const [wizTitle, setWizTitle] = useState('');
  const [wizProvince, setWizProvince] = useState('');
  const [wizMunicipality, setWizMunicipality] = useState('');
  const [wizSiteLocation, setWizSiteLocation] = useState('');
  const [wizManpower, setWizManpower] = useState(12);
  const [wizDurationDays, setWizDurationDays] = useState(60);
  const [wizMobilizationCost, setWizMobilizationCost] = useState(30000);
  const [wizScope, setWizScope] = useState({
    chkSupply: true,
    chkInstall: true,
    chkDelivery: true,
    chkDesign: false,
    chkTC: true,
    tradeType: 'optCons',
  });

  // New Catalog Item state
  const [catForm, setCatForm] = useState({
    itemCode: '',
    name: '',
    description: '',
    specification: '',
    category: 'General Items',
    subcategory: '',
    defaultUnit: 'lot',
    matUnitCost: 0,
    lbrUnitCost: 0,
    defaultMatGpPct: 0.3,
    defaultLbrGpPct: 0.3,
    supplierRef: '',
    isGeneralRequirement: false,
  });

  // Settings form state
  const [settingsForm, setSettingsForm] = useState<any>(null);

  const loadDashboard = useCallback(async () => {
    setLoadingList(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (searchTerm.trim()) qs.set('search', searchTerm.trim());
      if (clientFilter) qs.set('clientId', clientFilter);
      const data = await apiRequest(`/api/quotations/dashboard?${qs.toString()}`);
      setQuotations(data.quotations || []);
      setKpis(data.kpis || {});
      setMonthlySeries(data.monthlySeries || []);
      setCanViewCosting(Boolean(data.canViewInternalCosting));
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to load quotations');
    } finally {
      setLoadingList(false);
    }
  }, [statusFilter, searchTerm, clientFilter]);

  const loadMetaAndCatalog = useCallback(async () => {
    try {
      const [metaRes, catRes] = await Promise.all([
        apiRequest('/api/quotations/catalog/meta'),
        apiRequest('/api/quotations/catalog/items'),
      ]);
      setMeta(metaRes);
      setSettingsForm(metaRes.settings);
      setCatalogItems(catRes.items || []);
      if (!wizClientId && metaRes.clients?.length > 0) {
        setWizClientId(String(metaRes.clients[0].id));
      }
    } catch {
      // Ignore silent preload error
    }
  }, [wizClientId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard, syncVersion]);

  useEffect(() => {
    loadMetaAndCatalog();
  }, [loadMetaAndCatalog]);

  const openQuotation = useCallback(async (quoteId: number, revisionId?: number) => {
    setLoadingEditor(true);
    setErrorBanner('');
    setSaveBanner('');
    try {
      const qs = revisionId ? `?revisionId=${revisionId}` : '';
      const bundle = await apiRequest(`/api/quotations/${quoteId}${qs}`);
      setQuoteBundle(bundle);
      setActiveQuoteId(quoteId);
      setCanViewCosting(Boolean(bundle.canViewInternalCosting));

      const q = bundle.quotation;
      const r = bundle.revision;

      setDraftTitle(q.title || '');
      setDraftSubject(r.subject || q.subject || '');
      setDraftSiteLocation(r.site_location || q.site_location || '');
      setDraftProvince(r.province || '');
      setDraftMunicipality(r.municipality || '');
      setDraftBarangay(r.barangay || '');
      setDraftZipCode(r.zip_code || '');
      setDraftAttentionTo(r.attention_to || '');
      setDraftAttentionTitle(r.attention_title || '');
      setDraftThruPerson(r.thru_person || '');
      setDraftThruTitle(r.thru_title || '');
      setDraftValidityDate(q.validity_date || '');
      setDraftVatRate(Number(r.vat_rate ?? 12));
      setDraftDiscountPct(Number(r.discount_pct ?? 0));
      setDraftManpower(Number(r.estimated_manpower ?? 0));
      setDraftDurationDays(Number(r.estimated_duration_days ?? 0));
      setDraftScopeOptions(r.scope_options || {});
      setDraftTerms(r.terms || {});
      setDraftNotes(Array.isArray(r.notes) ? r.notes : []);

      const mappedSections: EditorSection[] = (r.sections || []).map((s: any, idx: number) => ({
        tempKey: String(s.id),
        id: s.id,
        code: s.code,
        title: s.title,
        sortOrder: s.sort_order ?? idx + 1,
        isCollapsed: Boolean(s.is_collapsed),
      }));
      setSections(mappedSections);

      const mappedItems: EditorItem[] = (r.items || []).map((it: any, idx: number) => ({
        tempKey: String(it.id),
        id: it.id,
        sectionKey: String(it.section_id),
        parentKey: it.parent_item_id ? String(it.parent_item_id) : null,
        rowType: it.row_type || 'item',
        lineNo: it.line_no || '',
        itemCode: it.item_code || '',
        description: it.description || '',
        specification: it.specification || '',
        qty: Number(it.qty ?? 1),
        unit: it.unit || 'lot',
        matPricingMode: it.mat_pricing_mode || 'computed',
        lbrPricingMode: it.lbr_pricing_mode || 'computed',
        visibilityMode: it.visibility_mode || 'visible',
        rollupChildren: Boolean(it.rollup_children),
        matUnitCost: Number(it.mat_unit_cost ?? 0),
        lbrUnitCost: Number(it.lbr_unit_cost ?? 0),
        matGpPct: Number(it.mat_gp_pct ?? 0.3),
        lbrGpPct: Number(it.lbr_gp_pct ?? 0.3),
        overrideMatRate: it.override_mat_rate ?? null,
        overrideLbrRate: it.override_lbr_rate ?? null,
        overrideReason: it.override_reason || '',
        catalogItemId: it.catalog_item_id ?? null,
        supplierRef: it.supplier_ref || '',
        sortOrder: it.sort_order ?? idx + 1,
        matSellRate: Number(it.mat_sell_rate ?? 0),
        lbrSellRate: Number(it.lbr_sell_rate ?? 0),
        combinedUnitRate: Number(it.combined_unit_rate ?? 0),
        extendedSelling: Number(it.extended_selling ?? 0),
        extendedCost: Number(it.extended_cost ?? 0),
        grossProfit: Number(it.gross_profit ?? 0),
      }));
      setItems(mappedItems);
      setDirty(false);
      setInspectedRowKey(null);
      setTab('editor');
    } catch (err: any) {
      setErrorBanner(err.message || 'Unable to open quotation');
    } finally {
      setLoadingEditor(false);
    }
  }, []);

  // Live recalculated view matching REV1 backend formulas
  const liveCalc = useMemo(() => {
    const computedItems = items.map((it) => {
      const isPriced = it.rowType === 'item' || it.rowType === 'subitem';
      const matSell = canViewCosting && isPriced
        ? calcSellRate(it.matUnitCost, it.matGpPct, it.matPricingMode, it.overrideMatRate)
        : it.matSellRate;
      const lbrSell = canViewCosting && isPriced
        ? calcSellRate(it.lbrUnitCost, it.lbrGpPct, it.lbrPricingMode, it.overrideLbrRate)
        : it.lbrSellRate;
      const combined = isPriced ? matSell + lbrSell : 0;
      const extSell = isPriced ? round2(it.qty * combined) : 0;
      const matC = it.matPricingMode === 'included' || it.matPricingMode === 'excluded' ? 0 : Number(it.matUnitCost || 0);
      const lbrC = it.lbrPricingMode === 'included' || it.lbrPricingMode === 'excluded' ? 0 : Number(it.lbrUnitCost || 0);
      const extCost = isPriced ? round2(it.qty * (matC + lbrC)) : 0;
      const gp = round2(extSell - extCost);
      return {
        ...it,
        matSellRate: matSell,
        lbrSellRate: lbrSell,
        combinedUnitRate: combined,
        extendedSelling: extSell,
        extendedCost: extCost,
        grossProfit: gp,
      };
    });

    const sectionTotals: Record<string, { selling: number; cost: number; gp: number }> = {};
    for (const sec of sections) {
      const visible = computedItems.filter(
        (it) => it.sectionKey === sec.tempKey && it.rowType === 'item' && it.visibilityMode === 'visible'
      );
      const selling = round2(visible.reduce((s, i) => s + i.extendedSelling, 0));
      const cost = round2(visible.reduce((s, i) => s + i.extendedCost, 0));
      sectionTotals[sec.tempKey] = { selling, cost, gp: round2(selling - cost) };
    }

    const totalSellingPreVat = round2(Object.values(sectionTotals).reduce((s, t) => s + t.selling, 0));
    const totalDirectCost = round2(Object.values(sectionTotals).reduce((s, t) => s + t.cost, 0));
    const vatAmount = round2(totalSellingPreVat * (Number(draftVatRate || 0) / 100));
    const totalSellingVatInc = round2(totalSellingPreVat + vatAmount);
    const discountAmount = round2(totalSellingVatInc * (Number(draftDiscountPct || 0) / 100));
    const finalAmount = round2(totalSellingVatInc - discountAmount);
    const netPreVat = draftVatRate > 0 ? round2(finalAmount / (1 + draftVatRate / 100)) : finalAmount;
    const grossProfitAmount = round2(netPreVat - totalDirectCost);
    const grossProfitPct = netPreVat > 0 ? round2((grossProfitAmount / netPreVat) * 100) : 0;

    return {
      items: computedItems,
      sectionTotals,
      totalSellingPreVat,
      totalDirectCost,
      vatAmount,
      totalSellingVatInc,
      discountAmount,
      finalAmount,
      grossProfitAmount,
      grossProfitPct,
      manpowerTeams: calcManpowerTeams(draftManpower),
    };
  }, [items, sections, draftVatRate, draftDiscountPct, draftManpower, canViewCosting]);

  const isLocked = Boolean(
    quoteBundle?.revision?.is_locked ||
      !['draft', 'rejected', 'revised'].includes(quoteBundle?.revision?.status || 'draft')
  );
  const canEdit = Boolean(quoteBundle?.permissions?.canEdit && !isLocked);

  const handleSaveDraft = useCallback(async () => {
    if (!activeQuoteId || !quoteBundle?.revision?.id || !canEdit) return;
    setSaving(true);
    setErrorBanner('');
    try {
      await apiRequest(`/api/quotations/${activeQuoteId}/draft`, {
        method: 'PUT',
        body: {
          revisionId: quoteBundle.revision.id,
          title: draftTitle,
          subject: draftSubject,
          siteLocation: draftSiteLocation,
          province: draftProvince,
          municipality: draftMunicipality,
          barangay: draftBarangay,
          zipCode: draftZipCode,
          attentionTo: draftAttentionTo,
          attentionTitle: draftAttentionTitle,
          thruPerson: draftThruPerson,
          thruTitle: draftThruTitle,
          validityDate: draftValidityDate,
          vatRate: draftVatRate,
          discountPct: draftDiscountPct,
          estimatedManpower: draftManpower,
          estimatedDurationDays: draftDurationDays,
          scopeOptions: draftScopeOptions,
          terms: draftTerms,
          notes: draftNotes,
          sections,
          items,
        },
      });
      setDirty(false);
      setSaveBanner(`Saved & recalculated at ${new Date().toLocaleTimeString()}`);
      loadDashboard();
    } catch (err: any) {
      setErrorBanner(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [
    activeQuoteId, quoteBundle, canEdit, draftTitle, draftSubject, draftSiteLocation,
    draftProvince, draftMunicipality, draftBarangay, draftZipCode, draftAttentionTo,
    draftAttentionTitle, draftThruPerson, draftThruTitle, draftValidityDate, draftVatRate,
    draftDiscountPct, draftManpower, draftDurationDays, draftScopeOptions, draftTerms,
    draftNotes, sections, items, loadDashboard,
  ]);

  // Subtle autosave after 2.2s idle when dirty
  useEffect(() => {
    if (!dirty || !canEdit || saving) return;
    const timer = window.setTimeout(() => {
      handleSaveDraft();
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [dirty, canEdit, saving, handleSaveDraft]);

  const updateItem = (tempKey: string, patch: Partial<EditorItem>) => {
    setItems((prev) => prev.map((it) => (it.tempKey === tempKey ? { ...it, ...patch } : it)));
    setDirty(true);
  };

  const addBlankRow = (sectionKey: string, rowType: 'item' | 'subitem' | 'subsection' = 'item', parentKey: string | null = null) => {
    const newKey = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const secItems = items.filter((i) => i.sectionKey === sectionKey);
    const nextOrder = (secItems[secItems.length - 1]?.sortOrder || 0) + 1;
    const defaultGp = Number(meta.settings?.default_mat_gp_pct ?? 0.3);
    const newRow: EditorItem = {
      tempKey: newKey,
      sectionKey,
      parentKey,
      rowType,
      lineNo: rowType === 'item' ? String(secItems.filter((x) => x.rowType === 'item').length + 1) : '',
      itemCode: '',
      description: rowType === 'subsection' ? 'NEW WORK SUBSECTION' : rowType === 'subitem' ? 'Sub-component item' : 'New Quotation Line Item',
      specification: '',
      qty: rowType === 'subsection' ? 0 : 1,
      unit: rowType === 'subsection' ? '' : 'lot',
      matPricingMode: rowType === 'subsection' ? 'excluded' : 'computed',
      lbrPricingMode: rowType === 'subsection' ? 'excluded' : 'computed',
      visibilityMode: rowType === 'subitem' ? 'hidden' : 'visible',
      rollupChildren: false,
      matUnitCost: 0,
      lbrUnitCost: 0,
      matGpPct: defaultGp,
      lbrGpPct: defaultGp,
      overrideMatRate: null,
      overrideLbrRate: null,
      overrideReason: '',
      sortOrder: nextOrder,
      matSellRate: 0,
      lbrSellRate: 0,
      combinedUnitRate: 0,
      extendedSelling: 0,
      extendedCost: 0,
      grossProfit: 0,
    };
    setItems((prev) => [...prev, newRow]);
    setDirty(true);
  };

  const addCatalogItemToSection = (sectionKey: string, catItem: any) => {
    const newKey = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const secItems = items.filter((i) => i.sectionKey === sectionKey);
    const nextOrder = (secItems[secItems.length - 1]?.sortOrder || 0) + 1;
    const newRow: EditorItem = {
      tempKey: newKey,
      sectionKey,
      parentKey: null,
      rowType: 'item',
      lineNo: String(secItems.filter((x) => x.rowType === 'item').length + 1),
      itemCode: catItem.item_code || '',
      description: catItem.name || catItem.description,
      specification: catItem.specification || '',
      qty: 1,
      unit: catItem.default_unit || 'lot',
      matPricingMode: Number(catItem.mat_unit_cost || 0) === 0 && catItem.is_general_requirement ? 'included' : 'computed',
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      rollupChildren: false,
      matUnitCost: Number(catItem.mat_unit_cost ?? 0),
      lbrUnitCost: Number(catItem.lbr_unit_cost ?? 0),
      matGpPct: Number(catItem.default_mat_gp_pct ?? 0.3),
      lbrGpPct: Number(catItem.default_lbr_gp_pct ?? 0.3),
      overrideMatRate: null,
      overrideLbrRate: null,
      overrideReason: '',
      catalogItemId: catItem.id,
      supplierRef: catItem.supplier_ref || '',
      sortOrder: nextOrder,
      matSellRate: Number(catItem.mat_sell_rate ?? 0),
      lbrSellRate: Number(catItem.lbr_sell_rate ?? 0),
      combinedUnitRate: Number(catItem.combined_sell_rate ?? 0),
      extendedSelling: Number(catItem.combined_sell_rate ?? 0),
      extendedCost: Number(catItem.mat_unit_cost ?? 0) + Number(catItem.lbr_unit_cost ?? 0),
      grossProfit: 0,
    };
    setItems((prev) => [...prev, newRow]);
    setDirty(true);
    setShowCatalogPickerForSection(null);
  };

  const duplicateRow = (row: EditorItem) => {
    const idx = items.findIndex((i) => i.tempKey === row.tempKey);
    const copy: EditorItem = {
      ...row,
      id: undefined,
      tempKey: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description: `${row.description} (Copy)`,
      sortOrder: row.sortOrder + 0.5,
    };
    const next = [...items];
    next.splice(idx + 1, 0, copy);
    setItems(next.map((it, i) => ({ ...it, sortOrder: i + 1 })));
    setDirty(true);
  };

  const moveRow = (tempKey: string, dir: -1 | 1) => {
    const idx = items.findIndex((i) => i.tempKey === tempKey);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const next = [...items];
    const tmp = next[idx];
    next[idx] = next[swapIdx];
    next[swapIdx] = tmp;
    setItems(next.map((it, i) => ({ ...it, sortOrder: i + 1 })));
    setDirty(true);
  };

  const removeRow = (tempKey: string) => {
    setItems((prev) => prev.filter((i) => i.tempKey !== tempKey && i.parentKey !== tempKey));
    if (inspectedRowKey === tempKey) setInspectedRowKey(null);
    setDirty(true);
  };

  const addSection = () => {
    const nextCode = String.fromCharCode(65 + sections.length);
    const newSec: EditorSection = {
      tempKey: `sec-${Date.now()}`,
      code: nextCode,
      title: `CUSTOM WORK SECTION ${nextCode}`,
      sortOrder: sections.length + 1,
      isCollapsed: false,
    };
    setSections((prev) => [...prev, newSec]);
    setDirty(true);
  };

  const handleWorkflow = async (action: string, remarks = '') => {
    if (!activeQuoteId) return;
    if (dirty && canEdit) {
      await handleSaveDraft();
    }
    setErrorBanner('');
    try {
      await apiRequest(`/api/quotations/${activeQuoteId}/workflow`, {
        method: 'POST',
        body: { action, remarks },
      });
      await openQuotation(activeQuoteId);
      loadDashboard();
    } catch (err: any) {
      setErrorBanner(err.message || 'Workflow action failed');
    }
  };

  const handleCreateRevision = async () => {
    if (!activeQuoteId) return;
    try {
      const res = await apiRequest(`/api/quotations/${activeQuoteId}/revisions`, {
        method: 'POST',
        body: { reason: newRevReason || 'Updated scope / commercial revision' },
      });
      setShowRevModal(false);
      setNewRevReason('');
      await openQuotation(activeQuoteId, res.revisionId);
      loadDashboard();
    } catch (err: any) {
      setErrorBanner(err.message || 'Could not create revision');
    }
  };

  const handleConvertProject = async () => {
    if (!activeQuoteId) return;
    try {
      const res = await apiRequest(`/api/quotations/${activeQuoteId}/convert-to-project`, {
        method: 'POST',
        body: {
          initializeBudget: convertInitBudget,
          overrideReason: convertOverrideReason,
        },
      });
      setShowConvertModal(false);
      setConvertOverrideReason('');
      await openQuotation(activeQuoteId);
      loadDashboard();
      if (onOpenProject && res.projectId) {
        onOpenProject(res.projectId);
      }
    } catch (err: any) {
      setErrorBanner(err.message || 'Project conversion failed');
    }
  };

  const handleCreateWizardQuote = async () => {
    if (!wizClientId || !wizTitle.trim()) {
      setErrorBanner('Please choose a client and enter a project name');
      return;
    }
    try {
      const res = await apiRequest('/api/quotations', {
        method: 'POST',
        body: {
          clientId: Number(wizClientId),
          title: wizTitle.trim(),
          province: wizProvince,
          municipality: wizMunicipality,
          siteLocation: wizSiteLocation || [wizMunicipality, wizProvince].filter(Boolean).join(', '),
          estimatedManpower: wizManpower,
          estimatedDurationDays: wizDurationDays,
          mobilizationCostOverride: wizMobilizationCost,
          scopeOptions: wizScope,
        },
      });
      setShowNewWizard(false);
      setWizStep(1);
      setWizTitle('');
      await loadDashboard();
      await openQuotation(res.quotationId);
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to create quotation');
    }
  };

  const loadPriceHistory = async () => {
    if (!canViewCosting) return;
    try {
      const res = await apiRequest('/api/quotations/catalog/price-history');
      setPriceHistory(res.history || []);
    } catch {
      /* ignore */
    }
  };

  const loadReconciliation = async () => {
    try {
      const res = await apiRequest('/api/quotations/reference/reconciliation');
      setReconciliation(res);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (tab === 'catalog' && canViewCosting) loadPriceHistory();
    if (tab === 'settings') loadReconciliation();
  }, [tab, canViewCosting]);

  const inspectedItem = useMemo(
    () => liveCalc.items.find((i) => i.tempKey === inspectedRowKey) || null,
    [liveCalc.items, inspectedRowKey]
  );

  return (
    <div className="space-y-5">
      {/* Top Workspace Header & Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            REV1 Quotation &amp; Estimating
          </h1>
          <p className="text-xs text-slate-500">
            Gross-profit estimating engine, revision control, confidential cost separation, and project conversion.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {[
              { id: 'dashboard', label: 'Dashboard & Pipeline', icon: <Layers className="h-3.5 w-3.5" /> },
              { id: 'editor', label: 'Quotation Editor', icon: <Calculator className="h-3.5 w-3.5" />, disabled: !activeQuoteId },
              { id: 'catalog', label: 'Item & Cost Catalog', icon: <BookOpen className="h-3.5 w-3.5" /> },
              { id: 'settings', label: 'Settings & Workbook Check', icon: <Settings className="h-3.5 w-3.5" /> },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={t.disabled}
                onClick={() => setTab(t.id as WorkspaceTab)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  tab === t.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 disabled:opacity-40'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {hasPerm('quotations', 'create') && (
            <button
              type="button"
              onClick={() => setShowNewWizard(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              New Quotation
            </button>
          )}
        </div>
      </div>

      {errorBanner && (
        <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          <span>{errorBanner}</span>
          <button type="button" onClick={() => setErrorBanner('')} className="text-rose-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: DASHBOARD & PIPELINE */}
      {tab === 'dashboard' && (
        <div className="space-y-5">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Total Quotations</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {kpis.totalQuotations ?? 0}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Draft: {kpis.draft ?? 0} · In Review: {(kpis.forReview ?? 0) + (kpis.forApproval ?? 0)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Pipeline Value (VAT Inc.)</div>
              <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                {formatMoney(kpis.totalQuotationValue, 'PHP', 0)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Avg: {formatMoney(kpis.averageQuotationValue, 'PHP', 0)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Accepted Value</div>
              <div className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">
                {formatMoney(kpis.acceptedValue, 'PHP', 0)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {kpis.accepted ?? 0} Accepted · {kpis.convertedCount ?? 0} Converted
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Win / Conversion Rate</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {kpis.conversionRate ?? 0}%
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Approved: {kpis.approved ?? 0} · Sent: {kpis.sentToClient ?? 0}
              </div>
            </div>
            {canViewCosting ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">Estimated Gross Profit</div>
                <div className="mt-1 font-mono text-xl font-bold text-amber-700 tabular-nums">
                  {formatMoney(kpis.estimatedGrossProfit, 'PHP', 0)}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Direct Cost: {formatMoney(kpis.totalDirectCost, 'PHP', 0)}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">Client Status View</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">Selling Prices Only</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Internal costs restricted by role policy
                </div>
              </div>
            )}
          </div>

          {/* Search & Status Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="flex flex-wrap items-center gap-1">
              {[
                { id: 'all', label: 'All' },
                { id: 'draft', label: 'Draft' },
                { id: 'for_review', label: 'For Review' },
                { id: 'for_approval', label: 'For Approval' },
                { id: 'approved', label: 'Approved' },
                { id: 'sent_to_client', label: 'Sent' },
                { id: 'accepted', label: 'Accepted' },
                { id: 'declined', label: 'Declined' },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusFilter(st.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                    statusFilter === st.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search quote #, client, site..."
                  className="rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-slate-400"
                />
              </div>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">All Clients</option>
                {meta.clients.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quotations Directory Table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Rev</th>
                  <th className="px-4 py-3">Project &amp; Client</th>
                  <th className="px-4 py-3">Site Location</th>
                  <th className="px-4 py-3">Status</th>
                  {canViewCosting && <th className="px-4 py-3 text-right">Direct Cost</th>}
                  <th className="px-4 py-3 text-right">Final Price (VAT Inc.)</th>
                  {canViewCosting && <th className="px-4 py-3 text-right">Est. GP</th>}
                  <th className="px-4 py-3">Validity</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loadingList ? (
                  <tr>
                    <td colSpan={canViewCosting ? 10 : 8} className="px-4 py-8 text-center text-slate-500">
                      Loading quotations...
                    </td>
                  </tr>
                ) : quotations.length === 0 ? (
                  <tr>
                    <td colSpan={canViewCosting ? 10 : 8} className="px-4 py-8 text-center text-slate-500">
                      No quotations match the current filters.
                    </td>
                  </tr>
                ) : (
                  quotations.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {q.quote_number}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">
                        {q.current_revision_code || 'REV00'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{q.title}</div>
                        <div className="text-[11px] text-slate-500">
                          {q.client_name} · Prep: {q.prepared_by_name || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{q.site_location || q.location || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`capitalize ${STATUS_LABEL_STYLE[q.status] || 'text-slate-700'}`}>
                          {String(q.status || '').replace(/_/g, ' ')}
                        </span>
                        {q.converted_project_ref && (
                          <div className="text-[11px] font-mono text-emerald-700">
                            → {q.converted_project_ref}
                          </div>
                        )}
                      </td>
                      {canViewCosting && (
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                          {formatMoney(q.direct_cost, q.currency || 'PHP')}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {formatMoney(q.final_amount || q.total_amount, q.currency || 'PHP')}
                      </td>
                      {canViewCosting && (
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700">
                          {q.gross_profit_pct !== null && q.gross_profit_pct !== undefined
                            ? `${q.gross_profit_pct}%`
                            : '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                        {formatDate(q.validity_date)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openQuotation(q.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                        >
                          Open Editor
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {monthlySeries.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 text-xs font-semibold text-slate-700">Monthly Quotation Value</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {monthlySeries.map((m) => (
                  <div key={m.month} className="border-t border-slate-200 pt-2 text-xs">
                    <div className="font-mono text-slate-500">{m.month}</div>
                    <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                      {formatMoney(m.totalValue, 'PHP', 0)}
                    </div>
                    <div className="text-[11px] text-slate-500">{m.count} quote(s)</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: INTERACTIVE SPREADSHEET-LIKE QUOTATION EDITOR */}
      {tab === 'editor' && quoteBundle && (
        <div className="space-y-4">
          {loadingEditor ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              Loading quotation workspace...
            </div>
          ) : (
            <>
              {/* Action & Workflow Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-bold text-slate-900">
                        {quoteBundle.quotation.quote_number}
                      </span>
                      <span aria-hidden="true">·</span>
                      <select
                        value={quoteBundle.revision.id}
                        onChange={(e) => openQuotation(activeQuoteId!, Number(e.target.value))}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-800"
                      >
                        {(quoteBundle.revisions || []).map((rv: any) => (
                          <option key={rv.id} value={rv.id}>
                            {rv.revision_code} ({rv.status})
                          </option>
                        ))}
                      </select>
                      <span aria-hidden="true">·</span>
                      <span className={`capitalize ${STATUS_LABEL_STYLE[quoteBundle.revision.status] || ''}`}>
                        {String(quoteBundle.revision.status).replace(/_/g, ' ')}
                      </span>
                      {isLocked && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                            <Lock className="h-3 w-3" /> Locked Snapshot
                          </span>
                        </>
                      )}
                    </div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900">
                      {draftTitle} — {quoteBundle.quotation.client_name}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {saveBanner && <span className="text-[11px] text-emerald-700">{saveBanner}</span>}
                  {dirty && canEdit && (
                    <span className="text-[11px] text-amber-700">Unsaved edits (autosaving...)</span>
                  )}

                  {canEdit && (
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {saving ? 'Saving...' : 'Save Draft'}
                    </button>
                  )}

                  {['draft', 'rejected'].includes(quoteBundle.revision.status) && quoteBundle.permissions?.canSubmit && (
                    <button
                      type="button"
                      onClick={() => handleWorkflow('submit')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 whitespace-nowrap"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Submit for Review
                    </button>
                  )}

                  {quoteBundle.revision.status === 'for_review' && quoteBundle.permissions?.canReview && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleWorkflow('review')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 whitespace-nowrap"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Forward for Approval
                      </button>
                      <button
                        type="button"
                        onClick={() => handleWorkflow('return_for_revision', 'Returned by reviewer')}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        Return to Draft
                      </button>
                    </>
                  )}

                  {quoteBundle.revision.status === 'for_approval' && quoteBundle.permissions?.canApprove && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleWorkflow('approve')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve Quotation
                      </button>
                      <button
                        type="button"
                        onClick={() => handleWorkflow('reject', 'Rejected during approval')}
                        className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 whitespace-nowrap"
                      >
                        Reject
                      </button>
                    </>
                  )}

                  {quoteBundle.revision.status === 'approved' && (
                    <button
                      type="button"
                      onClick={() => handleWorkflow('send_to_client')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 whitespace-nowrap"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Mark Sent to Client
                    </button>
                  )}

                  {['approved', 'sent_to_client'].includes(quoteBundle.revision.status) && (
                    <button
                      type="button"
                      onClick={() => handleWorkflow('accept')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Client Accepted
                    </button>
                  )}

                  {!quoteBundle.quotation.project_id &&
                    quoteBundle.permissions?.canConvertProject &&
                    ['approved', 'accepted'].includes(quoteBundle.revision.status) && (
                      <button
                        type="button"
                        onClick={() => setShowConvertModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap"
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                        Convert to Project
                      </button>
                    )}

                  <button
                    type="button"
                    onClick={() => setShowRevModal(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    New Revision
                  </button>

                  {(quoteBundle.revisions?.length || 0) > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCompareRevA(quoteBundle.revisions[1].id);
                        setCompareRevB(quoteBundle.revisions[0].id);
                        setCompareResult(null);
                        setShowCompareModal(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <GitCompare className="h-3.5 w-3.5" />
                      Compare
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setPrintMode('client')}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Client Quote PDF
                  </button>

                  {canViewCosting && (
                    <button
                      type="button"
                      onClick={() => setPrintMode('internal')}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 whitespace-nowrap"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Internal Costing PDF
                    </button>
                  )}

                  {quoteBundle.permissions?.canExport && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await fetch(
                            `/api/quotations/${activeQuoteId}/export-csv?revisionId=${quoteBundle.revision.id}&type=client`,
                            { headers: { Authorization: `Bearer ${(await import('../lib/api')).getApiToken()}` } }
                          );
                          if (!res.ok) return;
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${quoteBundle.quotation.quote_number}_${quoteBundle.revision.revision_code}_CLIENT.csv`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Client CSV
                      </button>
                      {canViewCosting && (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await fetch(
                              `/api/quotations/${activeQuoteId}/export-csv?revisionId=${quoteBundle.revision.id}&type=internal`,
                              { headers: { Authorization: `Bearer ${(await import('../lib/api')).getApiToken()}` } }
                            );
                            if (!res.ok) return;
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${quoteBundle.quotation.quote_number}_${quoteBundle.revision.revision_code}_INTERNAL_COSTING.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 whitespace-nowrap"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Internal CSV
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Project / Client / Scope / Manpower / Duration Header Panel */}
              <div className="rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setShowHeaderPanel((p) => !p)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold text-slate-800"
                >
                  <span>Project Information, Site Location, Scope Options &amp; Manpower / Duration</span>
                  {showHeaderPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showHeaderPanel && (
                  <div className="border-t border-slate-200 p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500">Project / Quotation Title</label>
                        <input
                          disabled={!canEdit}
                          value={draftTitle}
                          onChange={(e) => { setDraftTitle(e.target.value); setDirty(true); }}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500">Quotation Subject</label>
                        <input
                          disabled={!canEdit}
                          value={draftSubject}
                          onChange={(e) => { setDraftSubject(e.target.value); setDirty(true); }}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">ATT&apos;N (Contact)</label>
                          <input
                            disabled={!canEdit}
                            value={draftAttentionTo}
                            onChange={(e) => { setDraftAttentionTo(e.target.value); setDirty(true); }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">Title / Position</label>
                          <input
                            disabled={!canEdit}
                            value={draftAttentionTitle}
                            onChange={(e) => { setDraftAttentionTitle(e.target.value); setDirty(true); }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500">
                          PH Location Lookup (Distance &amp; Mobilization Reference)
                        </label>
                        <select
                          disabled={!canEdit}
                          value=""
                          onChange={(e) => {
                            const loc = meta.locations.find((l) => String(l.id) === e.target.value);
                            if (loc) {
                              setDraftProvince(loc.province);
                              setDraftMunicipality(loc.municipality);
                              setDraftBarangay(loc.barangay || '');
                              setDraftZipCode(loc.zip_code || '');
                              setDraftSiteLocation(`${loc.municipality}, ${loc.province}`);
                              setDirty(true);
                            }
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                        >
                          <option value="">Select PH City / Province preset...</option>
                          {meta.locations.map((l: any) => (
                            <option key={l.id} value={l.id}>
                              {l.municipality}, {l.province} ({l.distance_km} km · {l.mobilization_tier})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500">Site Address / Location</label>
                        <input
                          disabled={!canEdit}
                          value={draftSiteLocation}
                          onChange={(e) => { setDraftSiteLocation(e.target.value); setDirty(true); }}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">THRU Person</label>
                          <input
                            disabled={!canEdit}
                            value={draftThruPerson}
                            onChange={(e) => { setDraftThruPerson(e.target.value); setDirty(true); }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">Validity Date</label>
                          <input
                            type="date"
                            disabled={!canEdit}
                            value={draftValidityDate}
                            onChange={(e) => { setDraftValidityDate(e.target.value); setDirty(true); }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500">Optional Quotation Scope</label>
                        <div className="mt-1.5 flex flex-wrap gap-3">
                          {[
                            ['chkSupply', 'Supply'],
                            ['chkInstall', 'Install'],
                            ['chkDelivery', 'Delivery'],
                            ['chkDesign', 'Design'],
                            ['chkTC', 'T&C'],
                          ].map(([key, label]) => (
                            <label key={key} className="inline-flex items-center gap-1 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                disabled={!canEdit}
                                checked={Boolean(draftScopeOptions[key])}
                                onChange={(e) => {
                                  setDraftScopeOptions((prev: any) => ({ ...prev, [key]: e.target.checked }));
                                  setDirty(true);
                                }}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">Est. Manpower</label>
                          <input
                            type="number"
                            min={0}
                            disabled={!canEdit}
                            value={draftManpower}
                            onChange={(e) => { setDraftManpower(Number(e.target.value)); setDirty(true); }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs disabled:bg-slate-50"
                          />
                          <div className="mt-0.5 text-[10px] text-slate-500">
                            Derived Team Units: <strong className="font-mono">{liveCalc.manpowerTeams}</strong>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">Duration (Days)</label>
                          <input
                            type="number"
                            min={1}
                            disabled={!canEdit}
                            value={draftDurationDays}
                            onChange={(e) => { setDraftDurationDays(Number(e.target.value)); setDirty(true); }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs disabled:bg-slate-50"
                          />
                          <div className="mt-0.5 text-[10px] text-slate-500">
                            ~{round2(draftDurationDays / 7)} wks · ~{round2(draftDurationDays / 30)} mos
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Interactive Spreadsheet Grid */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <div className="text-xs font-semibold text-slate-800">
                    Bill of Quantities &amp; Pricing Sheet
                    <span className="ml-2 font-normal text-slate-500">
                      (Selling Rate = ROUNDUP(Cost / (1 - GP%), 0) · Click formula icon on any row to inspect calculation)
                    </span>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={addSection}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      <Plus className="h-3 w-3" />
                      Add Section
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="border-b border-slate-200 bg-slate-100/80 text-[11px] text-slate-600">
                      <tr>
                        <th className="px-2 py-2 w-14">Line</th>
                        <th className="px-2 py-2 w-24">Code</th>
                        <th className="px-2 py-2 min-w-[230px]">Description</th>
                        <th className="px-2 py-2 w-16 text-right">Qty</th>
                        <th className="px-2 py-2 w-20">Unit</th>
                        <th className="px-2 py-2 w-24">Mode</th>
                        {canViewCosting && (
                          <>
                            <th className="px-2 py-2 w-24 text-right">Mat Cost</th>
                            <th className="px-2 py-2 w-24 text-right">Lbr Cost</th>
                            <th className="px-2 py-2 w-16 text-right">Mat GP%</th>
                            <th className="px-2 py-2 w-16 text-right">Lbr GP%</th>
                          </>
                        )}
                        <th className="px-2 py-2 w-24 text-right">Mat Sell</th>
                        <th className="px-2 py-2 w-24 text-right">Lbr Sell</th>
                        <th className="px-2 py-2 w-24 text-right">Unit Rate</th>
                        <th className="px-2 py-2 w-28 text-right">Extended</th>
                        {canViewCosting && <th className="px-2 py-2 w-24 text-right">GP (₱)</th>}
                        <th className="px-2 py-2 w-28 text-right">Row Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((sec) => {
                        const secRows = liveCalc.items.filter((i) => i.sectionKey === sec.tempKey);
                        const secTotal = liveCalc.sectionTotals[sec.tempKey] || { selling: 0, cost: 0, gp: 0 };

                        return (
                          <React.Fragment key={sec.tempKey}>
                            {/* Section Banner Row */}
                            <tr className="border-y border-slate-300 bg-slate-100 font-semibold text-slate-900">
                              <td className="px-2 py-2 font-mono">{sec.code}</td>
                              <td className="px-2 py-2" colSpan={canViewCosting ? 12 : 8}>
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    disabled={!canEdit}
                                    value={sec.title}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setSections((prev) =>
                                        prev.map((s) => (s.tempKey === sec.tempKey ? { ...s, title: val } : s))
                                      );
                                      setDirty(true);
                                    }}
                                    className="bg-transparent font-bold uppercase tracking-wide text-slate-900 focus:bg-white focus:outline-none px-1 rounded"
                                  />
                                  {canEdit && (
                                    <div className="flex items-center gap-1 ml-2 font-normal">
                                      <button
                                        type="button"
                                        onClick={() => addBlankRow(sec.tempKey, 'item')}
                                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] hover:bg-slate-50"
                                      >
                                        + Item
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setShowCatalogPickerForSection(sec.tempKey)}
                                        className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 hover:bg-amber-100"
                                      >
                                        + From Catalog
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => addBlankRow(sec.tempKey, 'subsection')}
                                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] hover:bg-slate-50"
                                      >
                                        + Subheader
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums">
                                {formatMoney(secTotal.selling, 'PHP')}
                              </td>
                              {canViewCosting && (
                                <td className="px-2 py-2 text-right font-mono tabular-nums text-emerald-700">
                                  {formatMoney(secTotal.gp, 'PHP')}
                                </td>
                              )}
                              <td className="px-2 py-2 text-right text-[11px] text-slate-500">
                                {secRows.length} rows
                              </td>
                            </tr>

                            {/* Section Rows */}
                            {secRows.map((row) => {
                              const isSubheader = row.rowType === 'subsection' || row.rowType === 'note';
                              const isHidden = row.visibilityMode === 'hidden' || row.rowType === 'subitem';

                              if (isSubheader) {
                                return (
                                  <tr key={row.tempKey} className="border-b border-slate-200 bg-slate-50/70 font-semibold text-slate-700">
                                    <td className="px-2 py-1.5">
                                      <input
                                        disabled={!canEdit}
                                        value={row.lineNo}
                                        onChange={(e) => updateItem(row.tempKey, { lineNo: e.target.value })}
                                        className="w-12 rounded border border-transparent hover:border-slate-300 px-1 py-0.5 font-mono text-xs bg-transparent"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5" colSpan={canViewCosting ? 13 : 8}>
                                      <input
                                        disabled={!canEdit}
                                        value={row.description}
                                        onChange={(e) => updateItem(row.tempKey, { description: e.target.value })}
                                        className="w-full rounded border border-transparent hover:border-slate-300 px-1 py-0.5 bg-transparent font-semibold"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5 text-right">
                                      {canEdit && (
                                        <button
                                          type="button"
                                          onClick={() => removeRow(row.tempKey)}
                                          className="p-1 text-slate-400 hover:text-rose-600"
                                          title="Delete subheader"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              }

                              return (
                                <tr
                                  key={row.tempKey}
                                  className={`border-b border-slate-200 hover:bg-slate-50 ${
                                    isHidden ? 'bg-amber-50/30 text-slate-500' : ''
                                  } ${inspectedRowKey === row.tempKey ? 'bg-sky-50/60' : ''}`}
                                >
                                  <td className="px-2 py-1.5">
                                    <input
                                      disabled={!canEdit}
                                      value={row.lineNo}
                                      onChange={(e) => updateItem(row.tempKey, { lineNo: e.target.value })}
                                      className="w-12 rounded border border-transparent focus:border-slate-300 px-1 py-0.5 font-mono text-xs bg-transparent"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <input
                                      disabled={!canEdit}
                                      value={row.itemCode}
                                      onChange={(e) => updateItem(row.tempKey, { itemCode: e.target.value })}
                                      placeholder="Code"
                                      className="w-20 rounded border border-transparent focus:border-slate-300 px-1 py-0.5 font-mono text-[11px] bg-transparent"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <div className={isHidden ? 'pl-4' : ''}>
                                      <input
                                        disabled={!canEdit}
                                        value={row.description}
                                        onChange={(e) => updateItem(row.tempKey, { description: e.target.value })}
                                        className={`w-full rounded border border-transparent focus:border-slate-300 px-1 py-0.5 bg-transparent ${
                                          isHidden ? 'italic text-slate-600' : 'font-medium text-slate-900'
                                        }`}
                                      />
                                      {isHidden && (
                                        <span className="px-1 text-[10px] text-amber-700">
                                          Hidden internal breakdown (excluded from section total)
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    <input
                                      type="number"
                                      step="any"
                                      min={0}
                                      disabled={!canEdit}
                                      value={row.qty}
                                      onChange={(e) => updateItem(row.tempKey, { qty: Number(e.target.value) })}
                                      className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-right font-mono tabular-nums bg-white disabled:bg-transparent"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <select
                                      disabled={!canEdit}
                                      value={row.unit}
                                      onChange={(e) => updateItem(row.tempKey, { unit: e.target.value })}
                                      className="w-20 rounded border border-slate-200 bg-white px-1 py-0.5 text-xs disabled:bg-transparent"
                                    >
                                      <option value={row.unit}>{row.unit}</option>
                                      {meta.units
                                        .filter((u: any) => u.code !== row.unit)
                                        .map((u: any) => (
                                          <option key={u.code} value={u.code}>
                                            {u.code}
                                          </option>
                                        ))}
                                    </select>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <div className="flex flex-col gap-1">
                                      <select
                                        disabled={!canEdit}
                                        value={row.matPricingMode}
                                        onChange={(e) =>
                                          updateItem(row.tempKey, { matPricingMode: e.target.value as PricingMode })
                                        }
                                        className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px]"
                                        title="Material Pricing Mode"
                                      >
                                        <option value="computed">Mat: Auto</option>
                                        <option value="included">Mat: Included</option>
                                        <option value="excluded">Mat: Excl</option>
                                        {quoteBundle.permissions?.canOverridePricing && (
                                          <option value="override">Mat: Override</option>
                                        )}
                                      </select>
                                      <select
                                        disabled={!canEdit}
                                        value={row.visibilityMode}
                                        onChange={(e) =>
                                          updateItem(row.tempKey, {
                                            visibilityMode: e.target.value as 'visible' | 'hidden',
                                          })
                                        }
                                        className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px]"
                                        title="Visibility in Totals"
                                      >
                                        <option value="visible">Visible</option>
                                        <option value="hidden">Hidden Sub</option>
                                      </select>
                                    </div>
                                  </td>

                                  {canViewCosting && (
                                    <>
                                      <td className="px-2 py-1.5 text-right">
                                        <input
                                          type="number"
                                          step="0.01"
                                          min={0}
                                          disabled={!canEdit || row.matPricingMode === 'included'}
                                          value={row.matUnitCost}
                                          onChange={(e) =>
                                            updateItem(row.tempKey, { matUnitCost: Number(e.target.value) })
                                          }
                                          className="w-22 rounded border border-slate-200 px-1.5 py-0.5 text-right font-mono tabular-nums bg-white disabled:bg-slate-100"
                                        />
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        <input
                                          type="number"
                                          step="0.01"
                                          min={0}
                                          disabled={!canEdit}
                                          value={row.lbrUnitCost}
                                          onChange={(e) =>
                                            updateItem(row.tempKey, { lbrUnitCost: Number(e.target.value) })
                                          }
                                          className="w-22 rounded border border-slate-200 px-1.5 py-0.5 text-right font-mono tabular-nums bg-white disabled:bg-slate-100"
                                        />
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        <input
                                          type="number"
                                          step="1"
                                          min={0}
                                          max={90}
                                          disabled={!canEdit}
                                          value={Math.round(row.matGpPct * 100)}
                                          onChange={(e) =>
                                            updateItem(row.tempKey, { matGpPct: Number(e.target.value) / 100 })
                                          }
                                          className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right font-mono tabular-nums bg-white disabled:bg-slate-100"
                                        />
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        <input
                                          type="number"
                                          step="1"
                                          min={0}
                                          max={90}
                                          disabled={!canEdit}
                                          value={Math.round(row.lbrGpPct * 100)}
                                          onChange={(e) =>
                                            updateItem(row.tempKey, { lbrGpPct: Number(e.target.value) / 100 })
                                          }
                                          className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right font-mono tabular-nums bg-white disabled:bg-slate-100"
                                        />
                                      </td>
                                    </>
                                  )}

                                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                                    {row.matPricingMode === 'included' ? (
                                      <span className="italic text-slate-500">included</span>
                                    ) : row.matPricingMode === 'override' && canEdit ? (
                                      <input
                                        type="number"
                                        value={row.overrideMatRate ?? row.matSellRate}
                                        onChange={(e) =>
                                          updateItem(row.tempKey, { overrideMatRate: Number(e.target.value) })
                                        }
                                        className="w-20 rounded border border-amber-300 px-1 py-0.5 text-right font-mono"
                                      />
                                    ) : (
                                      formatMoney(row.matSellRate, 'PHP')
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                                    {row.lbrPricingMode === 'included'
                                      ? 'included'
                                      : formatMoney(row.lbrSellRate, 'PHP')}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                                    {formatMoney(row.combinedUnitRate, 'PHP')}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                                    {isHidden ? (
                                      <span className="text-amber-700 italic">hidden</span>
                                    ) : (
                                      formatMoney(row.extendedSelling, 'PHP')
                                    )}
                                  </td>
                                  {canViewCosting && (
                                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-emerald-700">
                                      {isHidden ? '—' : formatMoney(row.grossProfit, 'PHP')}
                                    </td>
                                  )}

                                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                    <div className="inline-flex items-center gap-0.5">
                                      {canViewCosting && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setInspectedRowKey(
                                              inspectedRowKey === row.tempKey ? null : row.tempKey
                                            )
                                          }
                                          className="p-1 text-slate-500 hover:text-sky-700"
                                          title="Inspect Formula & GP Breakdown"
                                        >
                                          <Calculator className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                      {canEdit && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateItem(row.tempKey, {
                                                visibilityMode:
                                                  row.visibilityMode === 'visible' ? 'hidden' : 'visible',
                                              })
                                            }
                                            className="p-1 text-slate-400 hover:text-amber-700"
                                            title={isHidden ? 'Include in totals' : 'Hide from totals'}
                                          >
                                            {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => moveRow(row.tempKey, -1)}
                                            className="p-1 text-slate-400 hover:text-slate-800"
                                            title="Move Up"
                                          >
                                            <ArrowUp className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => moveRow(row.tempKey, 1)}
                                            className="p-1 text-slate-400 hover:text-slate-800"
                                            title="Move Down"
                                          >
                                            <ArrowDown className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => duplicateRow(row)}
                                            className="p-1 text-slate-400 hover:text-slate-800"
                                            title="Duplicate Row"
                                          >
                                            <Copy className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => removeRow(row.tempKey)}
                                            className="p-1 text-slate-400 hover:text-rose-600"
                                            title="Delete Row"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Calculation Transparency Inspector (When Row Selected) */}
              {inspectedItem && canViewCosting && (
                <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-slate-900">
                      Calculation Inspector: {inspectedItem.description} ({inspectedItem.qty} {inspectedItem.unit})
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectedRowKey(null)}
                      className="text-slate-500 hover:text-slate-900"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="border-t border-sky-200 pt-2">
                      <div className="text-[11px] font-medium text-slate-500">Material Selling Formula</div>
                      <div className="mt-1 font-mono text-slate-800">
                        {inspectedItem.matPricingMode === 'included'
                          ? 'Mode = included -> ₱0.00'
                          : `ROUNDUP(${inspectedItem.matUnitCost} / (1 - ${inspectedItem.matGpPct}), 0) = ${formatMoney(
                              inspectedItem.matSellRate,
                              'PHP'
                            )}`}
                      </div>
                    </div>
                    <div className="border-t border-sky-200 pt-2">
                      <div className="text-[11px] font-medium text-slate-500">Labor Selling Formula</div>
                      <div className="mt-1 font-mono text-slate-800">
                        {`ROUNDUP(${inspectedItem.lbrUnitCost} / (1 - ${inspectedItem.lbrGpPct}), 0) = ${formatMoney(
                          inspectedItem.lbrSellRate,
                          'PHP'
                        )}`}
                      </div>
                    </div>
                    <div className="border-t border-sky-200 pt-2">
                      <div className="text-[11px] font-medium text-slate-500">Extended &amp; Gross Profit</div>
                      <div className="mt-1 font-mono text-slate-800">
                        Rate {formatMoney(inspectedItem.combinedUnitRate, 'PHP')} × {inspectedItem.qty} ={' '}
                        <strong>{formatMoney(inspectedItem.extendedSelling, 'PHP')}</strong> · Cost{' '}
                        {formatMoney(inspectedItem.extendedCost, 'PHP')} · GP{' '}
                        <strong className="text-emerald-700">{formatMoney(inspectedItem.grossProfit, 'PHP')}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom Grid: Terms/Approvals + Financial Summary */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 space-y-4">
                  {/* Terms & Conditions Collapsible */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setShowTermsPanel((p) => !p)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold text-slate-800"
                    >
                      <span>Quotation Conditions, Payment Terms, Warranty &amp; Notes</span>
                      {showTermsPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    {showTermsPanel && (
                      <div className="border-t border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">Payment Terms</label>
                          <input
                            disabled={!canEdit}
                            value={draftTerms.paymentTerms || ''}
                            onChange={(e) => {
                              setDraftTerms((p: any) => ({ ...p, paymentTerms: e.target.value }));
                              setDirty(true);
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">Warranty Period</label>
                          <input
                            disabled={!canEdit}
                            value={draftTerms.warranty || ''}
                            onChange={(e) => {
                              setDraftTerms((p: any) => ({ ...p, warranty: e.target.value }));
                              setDirty(true);
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">Payee Name</label>
                          <input
                            disabled={!canEdit}
                            value={draftTerms.payeeName || ''}
                            onChange={(e) => {
                              setDraftTerms((p: any) => ({ ...p, payeeName: e.target.value }));
                              setDirty(true);
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">Validity Wording</label>
                          <input
                            disabled={!canEdit}
                            value={draftTerms.validity || ''}
                            onChange={(e) => {
                              setDraftTerms((p: any) => ({ ...p, validity: e.target.value }));
                              setDirty(true);
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-slate-500">Exclusions</label>
                          <input
                            disabled={!canEdit}
                            value={draftTerms.exclusions || ''}
                            onChange={(e) => {
                              setDraftTerms((p: any) => ({ ...p, exclusions: e.target.value }));
                              setDirty(true);
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Approval Trail & Review Comments */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
                    <div className="font-semibold text-slate-800">Approval History &amp; Review Remarks</div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {(quoteBundle.approvals || []).length === 0 ? (
                        <div className="text-slate-500">No workflow decisions recorded yet.</div>
                      ) : (
                        quoteBundle.approvals.map((a: any) => (
                          <div key={a.id} className="flex items-center justify-between border-b border-slate-100 pb-1">
                            <div>
                              <span className="font-semibold text-slate-800">{a.actor_name}</span> ({a.actor_role}) ·{' '}
                              <span className="capitalize">{a.stage}</span>
                              {a.remarks && <span className="text-slate-500"> — {a.remarks}</span>}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">{formatDate(a.created_at)}</div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flex gap-2 pt-1">
                      <input
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Add review note or commercial remark..."
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!commentText.trim()) return;
                          await apiRequest(`/api/quotations/${activeQuoteId}/comments`, {
                            method: 'POST',
                            body: { comment: commentText, isInternal: canViewCosting },
                          });
                          setCommentText('');
                          openQuotation(activeQuoteId!, quoteBundle.revision.id);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        Post Note
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column: Commercial Financial Reconciliation Summary */}
                <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-2.5 text-xs">
                  <div className="font-semibold text-sm text-slate-900 border-b border-slate-200 pb-2">
                    Commercial Summary &amp; Tax Reconciliation
                  </div>

                  {canViewCosting && (
                    <div className="flex justify-between text-slate-600">
                      <span>Total Direct Cost (Materials + Labor)</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatMoney(liveCalc.totalDirectCost, 'PHP')}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between text-slate-800 font-semibold">
                    <span>TOTAL AMOUNT (Pre-VAT Selling)</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(liveCalc.totalSellingPreVat, 'PHP')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-700">
                    <span className="inline-flex items-center gap-2">
                      VAT Rate (%)
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        disabled={!canEdit || !hasPerm('quotations', 'manage_settings')}
                        value={draftVatRate}
                        onChange={(e) => {
                          setDraftVatRate(Number(e.target.value));
                          setDirty(true);
                        }}
                        className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right font-mono text-xs disabled:bg-slate-100"
                      />
                    </span>
                    <span className="font-mono tabular-nums">{formatMoney(liveCalc.vatAmount, 'PHP')}</span>
                  </div>

                  <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
                    <span>TOTAL SELLING PRICE (VAT INC)</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(liveCalc.totalSellingVatInc, 'PHP')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-rose-700">
                    <span className="inline-flex items-center gap-2">
                      Less Special Discount (%)
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        max={50}
                        disabled={!canEdit || !quoteBundle.permissions?.canApplyDiscount}
                        value={draftDiscountPct}
                        onChange={(e) => {
                          setDraftDiscountPct(Number(e.target.value));
                          setDirty(true);
                        }}
                        className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right font-mono text-xs text-slate-900 disabled:bg-slate-100"
                      />
                    </span>
                    <span className="font-mono tabular-nums">
                      -{formatMoney(liveCalc.discountAmount, 'PHP')}
                    </span>
                  </div>

                  <div className="flex justify-between rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm font-bold text-white">
                    <span>TOTAL DISCOUNTED PRICE</span>
                    <span className="font-mono tabular-nums">{formatMoney(liveCalc.finalAmount, 'PHP')}</span>
                  </div>

                  {canViewCosting && (
                    <div className="flex justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 font-semibold text-emerald-800">
                      <span>Estimated Gross Profit Margin</span>
                      <span className="font-mono tabular-nums">
                        {formatMoney(liveCalc.grossProfitAmount, 'PHP')} ({liveCalc.grossProfitPct}%)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: ITEM & COST CATALOG + GENERAL REQUIREMENTS + PRICE HISTORY */}
      {tab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search code or item..."
                  className="rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs"
                />
              </div>
              <select
                value={catalogCategoryFilter}
                onChange={(e) => setCatalogCategoryFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="all">All Categories</option>
                {meta.categories.map((c: any) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {hasPerm('quotations', 'edit') && (
              <button
                type="button"
                onClick={() => setShowNewCatalogModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Catalog Item
              </button>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Code</th>
                  <th className="px-4 py-2.5">Item Name &amp; Specification</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Unit</th>
                  {canViewCosting && (
                    <>
                      <th className="px-4 py-2.5 text-right">Mat Cost</th>
                      <th className="px-4 py-2.5 text-right">Lbr Cost</th>
                      <th className="px-4 py-2.5">Supplier</th>
                    </>
                  )}
                  <th className="px-4 py-2.5 text-right">Ref. Selling Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {catalogItems
                  .filter((it) => {
                    if (catalogCategoryFilter !== 'all' && it.category !== catalogCategoryFilter) return false;
                    if (
                      catalogSearch &&
                      !`${it.item_code} ${it.name} ${it.description}`.toLowerCase().includes(catalogSearch.toLowerCase())
                    ) {
                      return false;
                    }
                    return true;
                  })
                  .map((it) => (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{it.item_code}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900">{it.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {it.specification || it.description}
                          {it.is_general_requirement ? ' · General Requirement' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{it.category}</td>
                      <td className="px-4 py-2.5 font-mono">{it.default_unit}</td>
                      {canViewCosting && (
                        <>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {formatMoney(it.mat_unit_cost, 'PHP')}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {formatMoney(it.lbr_unit_cost, 'PHP')}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{it.supplier_ref || '—'}</td>
                        </>
                      )}
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {formatMoney(it.combined_sell_rate, 'PHP')}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {canViewCosting && priceHistory.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 text-xs font-semibold text-slate-800">
                Material &amp; Labor Price Change History (Historical Quotes Remain Snapshot-Protected)
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2 text-right">Previous</th>
                      <th className="px-3 py-2 text-right">New</th>
                      <th className="px-3 py-2">Supplier / Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {priceHistory.map((ph) => (
                      <tr key={ph.id}>
                        <td className="px-3 py-1.5 font-mono text-slate-500">{formatDate(ph.effective_date)}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-800">
                          {ph.item_code} · {ph.item_name}
                        </td>
                        <td className="px-3 py-1.5 capitalize">{ph.cost_type}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                          {formatMoney(ph.previous_cost, 'PHP')}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                          {formatMoney(ph.new_cost, 'PHP')}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">
                          {ph.supplier_ref} · {ph.remarks}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SETTINGS & LIVE WORKBOOK RECONCILIATION */}
      {tab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Numbering, VAT & Approval Threshold Settings */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
            <div className="font-semibold text-sm text-slate-900 border-b border-slate-200 pb-2">
              Quotation Numbering &amp; Commercial Policy
            </div>
            {settingsForm && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500">Prefix</label>
                    <input
                      value={settingsForm.prefix || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, prefix: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500">Year Code</label>
                    <input
                      value={settingsForm.year_code || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, year_code: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500">Next Sequence #</label>
                    <input
                      type="number"
                      value={settingsForm.next_seq || 1998068}
                      onChange={(e) => setSettingsForm({ ...settingsForm, next_seq: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500">Document Type</label>
                    <input
                      value={settingsForm.doc_type || 'CONS'}
                      onChange={(e) => setSettingsForm({ ...settingsForm, doc_type: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  Preview next ID:{' '}
                  <strong className="font-mono text-slate-900">
                    {settingsForm.prefix}
                    {settingsForm.year_code}-{settingsForm.next_seq}-{settingsForm.doc_type}
                  </strong>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500">Default VAT %</label>
                    <input
                      type="number"
                      value={settingsForm.default_vat_rate ?? 12}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, default_vat_rate: Number(e.target.value) })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500">Default Mat GP</label>
                    <input
                      type="number"
                      step="0.01"
                      value={settingsForm.default_mat_gp_pct ?? 0.3}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, default_mat_gp_pct: Number(e.target.value) })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500">PM Max Discount %</label>
                    <input
                      type="number"
                      value={settingsForm.max_pm_discount_pct ?? 5}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, max_pm_discount_pct: Number(e.target.value) })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono"
                    />
                  </div>
                </div>

                {hasPerm('quotations', 'manage_settings') && (
                  <button
                    type="button"
                    onClick={async () => {
                      await apiRequest('/api/quotations/settings', {
                        method: 'PUT',
                        body: {
                          prefix: settingsForm.prefix,
                          yearCode: settingsForm.year_code,
                          nextSeq: settingsForm.next_seq,
                          docType: settingsForm.doc_type,
                          defaultVatRate: settingsForm.default_vat_rate,
                          defaultMatGpPct: settingsForm.default_mat_gp_pct,
                          maxPmDiscountPct: settingsForm.max_pm_discount_pct,
                        },
                      });
                      setSaveBanner('Quotation settings updated');
                      loadMetaAndCatalog();
                    }}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Save Settings
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Live Workbook Reconciliation Report */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div>
                <div className="font-semibold text-sm text-slate-900">
                  Reference Workbook Calculation Reconciliation (RCC26-1998067-CONS REV01)
                </div>
                <div className="text-[11px] text-slate-500">
                  Executes live backend GP-margin, rounding, hidden sub-item exclusion, VAT, and discount checks against the attached CSV workbook.
                </div>
              </div>
              <button
                type="button"
                onClick={loadReconciliation}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Re-run Suite
              </button>
            </div>

            {reconciliation && (
              <>
                <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                  <span className="font-semibold">
                    {reconciliation.passed
                      ? `All ${reconciliation.checks.length} Reference Workbook Checks Passed (Zero Variance)`
                      : 'Discrepancy detected — inspect checks below'}
                  </span>
                  <span className="font-mono font-bold">
                    {reconciliation.passed ? 'VERIFIED MATCH' : 'REVIEW NEEDED'}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Check</th>
                        <th className="px-3 py-2 text-right">CSV Expected</th>
                        <th className="px-3 py-2 text-right">CBMS Engine</th>
                        <th className="px-3 py-2 text-right">Diff</th>
                        <th className="px-3 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reconciliation.checks.map((c: any) => (
                        <tr key={c.id}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">{c.label}</div>
                            <div className="font-mono text-[10px] text-slate-500">{c.formula}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {c.id === 'R13' ? c.expected : formatMoney(c.expected, 'PHP')}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                            {c.id === 'R13' ? c.actual : formatMoney(c.actual, 'PHP')}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{c.diff}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">
                            {c.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* GUIDED NEW QUOTATION WIZARD MODAL */}
      {showNewWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Create New Quotation (Step {wizStep} of 3)
                </h3>
                <p className="text-xs text-slate-500">
                  Guided setup — generates unique reference number and initial REV00 sections.
                </p>
              </div>
              <button type="button" onClick={() => setShowNewWizard(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            {wizStep === 1 && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700">Select Client *</label>
                  <select
                    value={wizClientId}
                    onChange={(e) => setWizClientId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    {meta.clients.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.company_name} ({c.primary_contact})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Project / Quotation Title *</label>
                  <input
                    value={wizTitle}
                    onChange={(e) => setWizTitle(e.target.value)}
                    placeholder="e.g., Retail Store Fit-Out — Ayala Center Cebu"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>
            )}

            {wizStep === 2 && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700">PH Location Reference</label>
                  <select
                    onChange={(e) => {
                      const loc = meta.locations.find((l) => String(l.id) === e.target.value);
                      if (loc) {
                        setWizProvince(loc.province);
                        setWizMunicipality(loc.municipality);
                        setWizSiteLocation(`${loc.municipality}, ${loc.province}`);
                        setWizMobilizationCost(Number(loc.base_mobilization_cost || 30000));
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="">Choose location preset (optional)...</option>
                    {meta.locations.map((l: any) => (
                      <option key={l.id} value={l.id}>
                        {l.municipality}, {l.province} — {l.mobilization_tier} ({formatMoney(l.base_mobilization_cost, 'PHP', 0)} base)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Site Location Address</label>
                  <input
                    value={wizSiteLocation}
                    onChange={(e) => setWizSiteLocation(e.target.value)}
                    placeholder="City / Province or full site address"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>
            )}

            {wizStep === 3 && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Included Scope Options</label>
                  <div className="flex flex-wrap gap-3">
                    {[
                      ['chkSupply', 'Supply'],
                      ['chkInstall', 'Installation'],
                      ['chkDelivery', 'Delivery'],
                      ['chkDesign', 'Design'],
                      ['chkTC', 'Testing & Commissioning'],
                    ].map(([k, lbl]) => (
                      <label key={k} className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean((wizScope as any)[k])}
                          onChange={(e) => setWizScope((p) => ({ ...p, [k]: e.target.checked }))}
                        />
                        {lbl}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700">Estimated Manpower</label>
                    <input
                      type="number"
                      min={1}
                      value={wizManpower}
                      onChange={(e) => setWizManpower(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Duration (Days)</label>
                    <input
                      type="number"
                      min={1}
                      value={wizDurationDays}
                      onChange={(e) => setWizDurationDays(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => (wizStep > 1 ? setWizStep((wizStep - 1) as 1 | 2) : setShowNewWizard(false))}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {wizStep === 1 ? 'Cancel' : 'Back'}
              </button>
              {wizStep < 3 ? (
                <button
                  type="button"
                  onClick={() => setWizStep((wizStep + 1) as 2 | 3)}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Next Step
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateWizardQuote}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Create Quotation
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CATALOG PICKER MODAL */}
      {showCatalogPickerForSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Insert Item from Construction &amp; General Requirements Catalog
              </h3>
              <button
                type="button"
                onClick={() => setShowCatalogPickerForSection(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder="Filter catalog by code, name, or category..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {catalogItems
                .filter((c) =>
                  `${c.item_code} ${c.name} ${c.category}`.toLowerCase().includes(pickerSearch.toLowerCase())
                )
                .map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-2.5 px-2 hover:bg-slate-50 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">
                        <span className="font-mono text-amber-700 mr-2">{c.item_code}</span>
                        {c.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {c.category} · Unit: {c.default_unit} · Rate: {formatMoney(c.combined_sell_rate, 'PHP')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addCatalogItemToSection(showCatalogPickerForSection, c)}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      Insert
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* NEW REVISION MODAL */}
      {showRevModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-3 text-xs">
            <h3 className="font-display text-sm font-bold text-slate-900">Create New Quotation Revision</h3>
            <p className="text-slate-600">
              Prior revision stays permanently locked and downloadable. Enter the reason for creating the next revision:
            </p>
            <textarea
              rows={3}
              value={newRevReason}
              onChange={(e) => setNewRevReason(e.target.value)}
              placeholder="e.g., Client requested revised commercial fixture quantities..."
              className="w-full rounded-lg border border-slate-300 p-2.5"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRevModal(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateRevision}
                className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white"
              >
                Create Revision
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMPARE REVISIONS MODAL */}
      {showCompareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display text-sm font-bold text-slate-900">Side-by-Side Revision Comparison</h3>
              <button type="button" onClick={() => setShowCompareModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={compareRevA}
                onChange={(e) => setCompareRevA(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                {(quoteBundle?.revisions || []).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.revision_code}</option>
                ))}
              </select>
              <span>vs</span>
              <select
                value={compareRevB}
                onChange={(e) => setCompareRevB(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                {(quoteBundle?.revisions || []).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.revision_code}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={async () => {
                  const res = await apiRequest(
                    `/api/quotations/${activeQuoteId}/compare?revA=${compareRevA}&revB=${compareRevB}`
                  );
                  setCompareResult(res);
                }}
                className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white"
              >
                Run Comparison
              </button>
            </div>

            {compareResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <div className="text-slate-500">{compareResult.revA.code}</div>
                    <div className="font-mono font-bold text-slate-900">
                      {formatMoney(compareResult.revA.finalAmount, 'PHP')}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">{compareResult.revB.code}</div>
                    <div className="font-mono font-bold text-slate-900">
                      {formatMoney(compareResult.revB.finalAmount, 'PHP')}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Net Difference</div>
                    <div className="font-mono font-bold text-amber-700">
                      {formatMoney(compareResult.deltaAmount, 'PHP')}
                    </div>
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {compareResult.itemDiffs.length === 0 ? (
                    <div className="text-slate-500 py-4 text-center">No line-item selling price differences between revisions.</div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="py-1.5">Change</th>
                          <th className="py-1.5">Item</th>
                          <th className="py-1.5 text-right">Old</th>
                          <th className="py-1.5 text-right">New</th>
                          <th className="py-1.5 text-right">Delta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {compareResult.itemDiffs.map((d: any) => (
                          <tr key={d.key}>
                            <td className="py-1.5 capitalize font-semibold">{d.change}</td>
                            <td className="py-1.5">{d.description}</td>
                            <td className="py-1.5 text-right font-mono">{formatMoney(d.oldAmount, 'PHP')}</td>
                            <td className="py-1.5 text-right font-mono">{formatMoney(d.newAmount, 'PHP')}</td>
                            <td className="py-1.5 text-right font-mono">{formatMoney(d.delta, 'PHP')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONVERT TO PROJECT MODAL */}
      {showConvertModal && quoteBundle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-3 text-xs">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Convert Quotation to CBMS Project
            </h3>
            <p className="text-slate-600">
              Transfers client, site location, scope, duration ({draftDurationDays} days), contract value (
              <strong>{formatMoney(liveCalc.finalAmount, 'PHP')}</strong>), and maintains a permanent link to{' '}
              <strong className="font-mono">
                {quoteBundle.quotation.quote_number} {quoteBundle.revision.revision_code}
              </strong>
              . Estimated costs are never recorded as actual expenses or automatic purchase requests.
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={convertInitBudget}
                onChange={(e) => setConvertInitBudget(e.target.checked)}
              />
              <span>Initialize categorized Materials &amp; Manpower budget allocations from approved direct costs</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConvertModal(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConvertProject}
                className="rounded-lg bg-amber-600 px-4 py-1.5 font-semibold text-white hover:bg-amber-700"
              >
                Confirm Project Conversion
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD CATALOG ITEM MODAL */}
      {showNewCatalogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="font-display text-sm font-bold text-slate-900">Add Construction / GR Catalog Item</h3>
              <button type="button" onClick={() => setShowNewCatalogModal(false)}><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-600">Item Code *</label>
                <input
                  value={catForm.itemCode}
                  onChange={(e) => setCatForm({ ...catForm, itemCode: e.target.value })}
                  placeholder="e.g. TIL-4545"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Category *</label>
                <select
                  value={catForm.category}
                  onChange={(e) => setCatForm({ ...catForm, category: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  {meta.categories.map((c: any) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-600">Item Name *</label>
                <input
                  value={catForm.name}
                  onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Unit</label>
                <select
                  value={catForm.defaultUnit}
                  onChange={(e) => setCatForm({ ...catForm, defaultUnit: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  {meta.units.map((u: any) => (
                    <option key={u.code} value={u.code}>{u.code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-600">Supplier Ref</label>
                <input
                  value={catForm.supplierRef}
                  onChange={(e) => setCatForm({ ...catForm, supplierRef: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Material Unit Cost</label>
                <input
                  type="number"
                  value={catForm.matUnitCost}
                  onChange={(e) => setCatForm({ ...catForm, matUnitCost: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Labor Unit Cost</label>
                <input
                  type="number"
                  value={catForm.lbrUnitCost}
                  onChange={(e) => setCatForm({ ...catForm, lbrUnitCost: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewCatalogModal(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await apiRequest('/api/quotations/catalog/items', { method: 'POST', body: catForm });
                  setShowNewCatalogModal(false);
                  loadMetaAndCatalog();
                }}
                className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white"
              >
                Save Catalog Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DUAL PDF PRINT MODAL */}
      {printMode && quoteBundle && (
        <QuotationDocumentPrint
          mode={printMode}
          quotation={quoteBundle.quotation}
          revision={quoteBundle.revision}
          companyHeader={quoteBundle.companyHeader}
          canViewInternalCosting={canViewCosting}
          onClose={() => setPrintMode(null)}
        />
      )}
    </div>
  );
};
