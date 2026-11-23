import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  ChevronDown,
  ChevronRight,
  Layers,
  Package,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, formatMoney } from '../../lib/api';
import {
  calcSellRate,
  computeComponentQtyAndFormula,
  round2,
  type CatalogItemRecord,
  type EditorItem,
  type EditorSection,
  type WorkAssemblyComponent,
  type WorkAssemblyRecord,
} from './quotationCatalogTypes';

interface DraftComponentRow {
  rowKey: string;
  included: boolean;
  catalogItemId: number | null;
  componentType: string;
  itemCode: string;
  itemName: string;
  specification: string;
  unit: string;
  calcBasis: string;
  consumptionRate: number;
  wastagePct: number;
  qtyOverride: number | null;
  calculatedQty: number;
  formulaText: string;
  selectedSupplierPriceId: number | null;
  selectedSupplierId: number | null;
  selectedSupplierName: string;
  matUnitCost: number;
  lbrUnitCost: number;
  matGpPct: number;
  lbrGpPct: number;
  matSellRate: number;
  lbrSellRate: number;
  supplierPrices: NonNullable<WorkAssemblyComponent['supplier_prices']>;
  missingPriceWarning: boolean;
}

interface CatalogAndPackagePickerModalProps {
  initialMode: 'items' | 'packages';
  initialAssemblyId?: number | null;
  targetSectionKey: string;
  sections: EditorSection[];
  categories: any[];
  units: any[];
  catalogItems: CatalogItemRecord[];
  assemblies: WorkAssemblyRecord[];
  canViewCosting: boolean;
  canCreateMasterAssembly: boolean;
  defaultMatGpPct: number;
  defaultLbrGpPct: number;
  existingItemsInSectionCount: number;
  onClose: () => void;
  onInsertItems: (sectionKey: string, newRows: EditorItem[]) => void;
  onRefreshCatalog: () => Promise<void> | void;
}

export const CatalogAndPackagePickerModal: React.FC<CatalogAndPackagePickerModalProps> = ({
  initialMode,
  initialAssemblyId = null,
  targetSectionKey,
  sections,
  categories,
  units,
  catalogItems,
  assemblies,
  canViewCosting,
  canCreateMasterAssembly,
  defaultMatGpPct,
  defaultLbrGpPct,
  existingItemsInSectionCount,
  onClose,
  onInsertItems,
  onRefreshCatalog,
}) => {
  const [mode, setMode] = useState<'items' | 'packages'>(initialMode);
  const [sectionKey, setSectionKey] = useState<string>(targetSectionKey);

  // Filter state
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [itemTypeFilter, setItemTypeFilter] = useState('all');

  // Individual items quick selection state
  const [itemQtys, setItemQtys] = useState<Record<number, number>>({});
  const [itemSelectedSupPrice, setItemSelectedSupPrice] = useState<Record<number, number>>({});

  // Request missing catalog item mini-drawer
  const [showMissingForm, setShowMissingForm] = useState(false);
  const [missingName, setMissingName] = useState('');
  const [missingCategory, setMissingCategory] = useState(categories[0]?.name || 'General Items');
  const [missingUnit, setMissingUnit] = useState('pcs');
  const [missingSpec, setMissingSpec] = useState('');
  const [missingSupplier, setMissingSupplier] = useState('');
  const [missingStatusMsg, setMissingStatusMsg] = useState('');

  // Work Packages (Sets of Works) selection & configurator state
  const [expandedListIds, setExpandedListIds] = useState<Record<number, boolean>>({});
  const [selectedAssembly, setSelectedAssembly] = useState<WorkAssemblyRecord | null>(() =>
    initialAssemblyId ? assemblies.find((a) => a.id === initialAssemblyId) || null : null
  );
  const [workQty, setWorkQty] = useState<number>(() =>
    selectedAssembly ? Number(selectedAssembly.default_qty || 1) : 10
  );
  const [insertionStyle, setInsertionStyle] = useState<'itemized' | 'grouped'>('itemized');
  const [draftComponents, setDraftComponents] = useState<DraftComponentRow[]>([]);
  const [showAddCompPicker, setShowAddCompPicker] = useState(false);
  const [addCompSearch, setAddCompSearch] = useState('');

  // Custom package save state
  const [showSaveCustomPanel, setShowSaveCustomPanel] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState(categories[0]?.name || 'General Items');
  const [customUnit, setCustomUnit] = useState('sq.m');
  const [savingMaster, setSavingMaster] = useState(false);
  const [modalError, setModalError] = useState('');

  const buildDraftRowsForAssembly = (asm: WorkAssemblyRecord, qtyInput: number): DraftComponentRow[] => {
    return (asm.components || []).map((c, idx) => {
      const supPrices = c.supplier_prices || [];
      const chosenSup =
        supPrices.find((sp) => c.preferred_supplier_price_id && sp.id === c.preferred_supplier_price_id) ||
        supPrices.find((sp) => c.preferred_supplier_id && sp.supplier_id === c.preferred_supplier_id) ||
        supPrices.find((sp) => sp.is_preferred) ||
        supPrices[0] ||
        null;

      const matCost = chosenSup ? Number(chosenSup.unit_price) : Number(c.mat_unit_cost ?? 0);
      const lbrCost = Number(c.lbr_unit_cost ?? 0);
      const matGp = Number(c.default_mat_gp_pct ?? defaultMatGpPct ?? 0.3);
      const lbrGp = Number(c.default_lbr_gp_pct ?? defaultLbrGpPct ?? 0.3);

      const { calculatedQty, formulaText } = computeComponentQtyAndFormula({
        workQty: qtyInput,
        workUnit: asm.unit || 'sq.m',
        calcBasis: c.calc_basis || 'per_unit',
        consumptionRate: Number(c.consumption_rate || 0),
        wastagePct: Number(c.wastage_pct || 0),
        componentUnit: c.unit || 'pcs',
      });

      const matSell = canViewCosting ? calcSellRate(matCost, matGp, 'computed') : Number(c.mat_sell_rate || 0);
      const lbrSell = canViewCosting ? calcSellRate(lbrCost, lbrGp, 'computed') : Number(c.lbr_sell_rate || 0);

      return {
        rowKey: `comp-${c.id}-${idx}`,
        included: true,
        catalogItemId: c.catalog_item_id,
        componentType: c.component_type || 'Material',
        itemCode: c.item_code || '',
        itemName: c.item_name,
        specification: c.specification || '',
        unit: c.unit || 'pcs',
        calcBasis: c.calc_basis || 'per_unit',
        consumptionRate: Number(c.consumption_rate || 1),
        wastagePct: Number(c.wastage_pct || 0),
        qtyOverride: null,
        calculatedQty,
        formulaText,
        selectedSupplierPriceId: chosenSup?.id ?? null,
        selectedSupplierId: chosenSup?.supplier_id ?? c.preferred_supplier_id ?? null,
        selectedSupplierName: chosenSup?.supplier_name ?? c.preferred_supplier_name ?? '',
        matUnitCost: matCost,
        lbrUnitCost: lbrCost,
        matGpPct: matGp,
        lbrGpPct: lbrGp,
        matSellRate: matSell,
        lbrSellRate: lbrSell,
        supplierPrices: supPrices,
        missingPriceWarning: Boolean(c.missing_price_warning),
      };
    });
  };

  useEffect(() => {
    if (initialAssemblyId) {
      const found = assemblies.find((a) => a.id === initialAssemblyId);
      if (found) {
        setSelectedAssembly(found);
        const startQty = Math.max(1, Number(found.default_qty || 1));
        setWorkQty(startQty);
        setDraftComponents(buildDraftRowsForAssembly(found, startQty));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAssemblyId]);

  const handleSelectAssembly = (asm: WorkAssemblyRecord) => {
    setSelectedAssembly(asm);
    const startQty = Number(asm.default_qty || 1) > 1 ? Number(asm.default_qty) : 10;
    setWorkQty(startQty);
    setDraftComponents(buildDraftRowsForAssembly(asm, startQty));
    setCustomCode(`${asm.assembly_code}-CUSTOM`);
    setCustomName(`${asm.name} (Custom)`);
    setCustomCategory(asm.category_name);
    setCustomUnit(asm.unit);
    setShowSaveCustomPanel(false);
    setModalError('');
  };

  const handleWorkQtyChange = (nextQty: number) => {
    const cleanQty = Math.max(0, Number(nextQty || 0));
    setWorkQty(cleanQty);
    if (!selectedAssembly) return;
    setDraftComponents((prev) =>
      prev.map((row) => {
        const { calculatedQty, formulaText } = computeComponentQtyAndFormula({
          workQty: cleanQty,
          workUnit: selectedAssembly.unit || 'sq.m',
          calcBasis: row.calcBasis,
          consumptionRate: row.consumptionRate,
          wastagePct: row.wastagePct,
          componentUnit: row.unit,
        });
        return {
          ...row,
          calculatedQty,
          formulaText,
        };
      })
    );
  };

  const handleComponentSupplierChange = (rowKey: string, supPriceIdStr: string) => {
    const supPriceId = Number(supPriceIdStr);
    setDraftComponents((prev) =>
      prev.map((row) => {
        if (row.rowKey !== rowKey) return row;
        const sup = row.supplierPrices.find((sp) => sp.id === supPriceId);
        if (!sup) {
          return {
            ...row,
            selectedSupplierPriceId: null,
            selectedSupplierId: null,
            selectedSupplierName: '',
          };
        }
        const nextMatCost = Number(sup.unit_price);
        return {
          ...row,
          selectedSupplierPriceId: sup.id,
          selectedSupplierId: sup.supplier_id,
          selectedSupplierName: sup.supplier_name,
          matUnitCost: nextMatCost,
          matSellRate: calcSellRate(nextMatCost, row.matGpPct, 'computed'),
          missingPriceWarning: false,
        };
      })
    );
  };

  const handleAddExtraComponentFromCatalog = (cat: CatalogItemRecord) => {
    const supPrices = cat.supplier_prices || [];
    const chosenSup = supPrices.find((sp) => sp.is_preferred) || supPrices[0] || null;
    const matCost = chosenSup ? Number(chosenSup.unit_price) : Number(cat.mat_unit_cost ?? 0);
    const lbrCost = Number(cat.lbr_unit_cost ?? 0);
    const matGp = Number(cat.default_mat_gp_pct ?? defaultMatGpPct ?? 0.3);
    const lbrGp = Number(cat.default_lbr_gp_pct ?? defaultLbrGpPct ?? 0.3);

    const { calculatedQty, formulaText } = computeComponentQtyAndFormula({
      workQty,
      workUnit: selectedAssembly?.unit || 'sq.m',
      calcBasis: 'per_unit',
      consumptionRate: 1,
      wastagePct: 0,
      componentUnit: cat.default_unit || 'pcs',
    });

    setDraftComponents((prev) => [
      ...prev,
      {
        rowKey: `extra-${cat.id}-${Date.now()}`,
        included: true,
        catalogItemId: cat.id,
        componentType: cat.item_type || 'Material',
        itemCode: cat.item_code,
        itemName: cat.name,
        specification: cat.specification || cat.description || '',
        unit: cat.default_unit || 'pcs',
        calcBasis: 'per_unit',
        consumptionRate: 1,
        wastagePct: 0,
        qtyOverride: null,
        calculatedQty,
        formulaText,
        selectedSupplierPriceId: chosenSup?.id ?? null,
        selectedSupplierId: chosenSup?.supplier_id ?? null,
        selectedSupplierName: chosenSup?.supplier_name ?? cat.supplier_ref ?? '',
        matUnitCost: matCost,
        lbrUnitCost: lbrCost,
        matGpPct: matGp,
        lbrGpPct: lbrGp,
        matSellRate: canViewCosting ? calcSellRate(matCost, matGp, 'computed') : cat.mat_sell_rate,
        lbrSellRate: canViewCosting ? calcSellRate(lbrCost, lbrGp, 'computed') : cat.lbr_sell_rate,
        supplierPrices: supPrices,
        missingPriceWarning: cat.item_type === 'Material' && supPrices.length === 0 && matCost <= 0,
      },
    ]);
    setShowAddCompPicker(false);
    setAddCompSearch('');
  };

  const handleInsertWorkPackage = async (saveToMasterToo: boolean) => {
    if (!selectedAssembly) return;
    const activeRows = draftComponents.filter((r) => r.included);
    if (activeRows.length === 0) {
      setModalError('Select at least one component item to insert.');
      return;
    }

    let assemblyIdToLink: number | null = selectedAssembly.id;
    let assemblyCodeToLink = selectedAssembly.assembly_code;
    let assemblyVerToLink = selectedAssembly.current_version;

    if (saveToMasterToo) {
      if (!customCode.trim() || !customName.trim()) {
        setModalError('Custom package code and name are required when saving to master catalog.');
        return;
      }
      setSavingMaster(true);
      setModalError('');
      try {
        const res = await apiRequest('/api/quotations/catalog/custom-assembly', {
          method: 'POST',
          body: {
            assemblyCode: customCode.trim().toUpperCase(),
            name: customName.trim(),
            categoryName: customCategory,
            unit: customUnit,
            defaultCalcMethod: selectedAssembly.default_calc_method || 'per_sqm',
            defaultQty: workQty || 1,
            description: selectedAssembly.description,
            specifications: selectedAssembly.specifications,
            components: activeRows.map((r) => ({
              catalogItemId: r.catalogItemId,
              componentType: r.componentType,
              itemCode: r.itemCode,
              itemName: r.itemName,
              specification: r.specification,
              unit: r.unit,
              calcBasis: r.calcBasis,
              consumptionRate: r.consumptionRate,
              wastagePct: r.wastagePct,
              preferredSupplierId: r.selectedSupplierId,
            })),
          },
        });
        assemblyIdToLink = res.id;
        assemblyCodeToLink = res.assemblyCode;
        assemblyVerToLink = 1;
        await onRefreshCatalog();
      } catch (err: any) {
        setModalError(err.message || 'Failed to save custom Set of Works');
        setSavingMaster(false);
        return;
      } finally {
        setSavingMaster(false);
      }
    }

    const baseKey = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let sortCursor = existingItemsInSectionCount + 1;
    let lineCursor = existingItemsInSectionCount + 1;
    const rowsToInsert: EditorItem[] = [];

    if (insertionStyle === 'itemized') {
      // Insert subheader banner + visible itemized component rows (every item clearly displayed for quotation)
      rowsToInsert.push({
        tempKey: `${baseKey}-hdr`,
        sectionKey,
        parentKey: null,
        rowType: 'subsection',
        lineNo: '',
        itemCode: assemblyCodeToLink,
        description: `${selectedAssembly.name} — ${workQty} ${selectedAssembly.unit}`,
        specification: selectedAssembly.specifications || selectedAssembly.description || '',
        qty: 0,
        unit: '',
        matPricingMode: 'excluded',
        lbrPricingMode: 'excluded',
        visibilityMode: 'visible',
        rollupChildren: false,
        matUnitCost: 0,
        lbrUnitCost: 0,
        matGpPct: defaultMatGpPct,
        lbrGpPct: defaultLbrGpPct,
        overrideMatRate: null,
        overrideLbrRate: null,
        overrideReason: '',
        sourceAssemblyId: assemblyIdToLink,
        sourceAssemblyCode: assemblyCodeToLink,
        sourceAssemblyVersion: assemblyVerToLink,
        measurementQty: workQty,
        sortOrder: sortCursor++,
        matSellRate: 0,
        lbrSellRate: 0,
        combinedUnitRate: 0,
        extendedSelling: 0,
        extendedCost: 0,
        grossProfit: 0,
      });

      for (const comp of activeRows) {
        const finalQty = comp.qtyOverride !== null ? comp.qtyOverride : comp.calculatedQty;
        const matSell = canViewCosting
          ? calcSellRate(comp.matUnitCost, comp.matGpPct, 'computed')
          : comp.matSellRate;
        const lbrSell = canViewCosting
          ? calcSellRate(comp.lbrUnitCost, comp.lbrGpPct, 'computed')
          : comp.lbrSellRate;
        const combined = matSell + lbrSell;
        const extSell = round2(finalQty * combined);
        const extCost = round2(finalQty * (comp.matUnitCost + comp.lbrUnitCost));

        rowsToInsert.push({
          tempKey: `${baseKey}-${comp.rowKey}`,
          sectionKey,
          parentKey: null,
          rowType: 'item',
          lineNo: String(lineCursor++),
          itemCode: comp.itemCode,
          description: comp.itemName,
          specification: comp.specification,
          qty: finalQty,
          unit: comp.unit,
          matPricingMode: comp.matUnitCost > 0 || comp.componentType === 'Material' ? 'computed' : 'included',
          lbrPricingMode: 'computed',
          visibilityMode: 'visible',
          rollupChildren: false,
          matUnitCost: comp.matUnitCost,
          lbrUnitCost: comp.lbrUnitCost,
          matGpPct: comp.matGpPct,
          lbrGpPct: comp.lbrGpPct,
          overrideMatRate: null,
          overrideLbrRate: null,
          overrideReason: '',
          catalogItemId: comp.catalogItemId,
          supplierRef: comp.selectedSupplierName,
          sourceAssemblyId: assemblyIdToLink,
          sourceAssemblyCode: assemblyCodeToLink,
          sourceAssemblyVersion: assemblyVerToLink,
          supplierId: comp.selectedSupplierId,
          supplierPriceId: comp.selectedSupplierPriceId,
          componentType: comp.componentType,
          calcBasis: comp.calcBasis,
          consumptionRate: comp.consumptionRate,
          wastagePct: comp.wastagePct,
          measurementQty: workQty,
          formulaText:
            comp.qtyOverride !== null
              ? `Manual override (${comp.qtyOverride} ${comp.unit}; calc was ${comp.calculatedQty})`
              : comp.formulaText,
          sortOrder: sortCursor++,
          matSellRate: matSell,
          lbrSellRate: lbrSell,
          combinedUnitRate: combined,
          extendedSelling: extSell,
          extendedCost: extCost,
          grossProfit: round2(extSell - extCost),
        });
      }
    } else {
      // Grouped parent line item with rolled-up hidden subitems
      const parentKey = `${baseKey}-parent`;
      const sumMatCost = round2(
        activeRows.reduce((s, r) => s + (r.qtyOverride ?? r.calculatedQty) * r.matUnitCost, 0)
      );
      const sumLbrCost = round2(
        activeRows.reduce((s, r) => s + (r.qtyOverride ?? r.calculatedQty) * r.lbrUnitCost, 0)
      );
      const unitMatCost = workQty > 0 ? round2(sumMatCost / workQty) : sumMatCost;
      const unitLbrCost = workQty > 0 ? round2(sumLbrCost / workQty) : sumLbrCost;
      const matSell = calcSellRate(unitMatCost, defaultMatGpPct, 'computed');
      const lbrSell = calcSellRate(unitLbrCost, defaultLbrGpPct, 'computed');
      const combined = matSell + lbrSell;
      const extSell = round2(workQty * combined);
      const extCost = round2(sumMatCost + sumLbrCost);

      rowsToInsert.push({
        tempKey: parentKey,
        sectionKey,
        parentKey: null,
        rowType: 'item',
        lineNo: String(lineCursor++),
        itemCode: assemblyCodeToLink,
        description: selectedAssembly.name,
        specification: selectedAssembly.specifications || selectedAssembly.description || '',
        qty: workQty,
        unit: selectedAssembly.unit || 'sq.m',
        matPricingMode: 'computed',
        lbrPricingMode: 'computed',
        visibilityMode: 'visible',
        rollupChildren: true,
        matUnitCost: unitMatCost,
        lbrUnitCost: unitLbrCost,
        matGpPct: defaultMatGpPct,
        lbrGpPct: defaultLbrGpPct,
        overrideMatRate: null,
        overrideLbrRate: null,
        overrideReason: '',
        sourceAssemblyId: assemblyIdToLink,
        sourceAssemblyCode: assemblyCodeToLink,
        sourceAssemblyVersion: assemblyVerToLink,
        componentType: 'Work Package',
        measurementQty: workQty,
        formulaText: `Rolled up from ${activeRows.length} components`,
        sortOrder: sortCursor++,
        matSellRate: matSell,
        lbrSellRate: lbrSell,
        combinedUnitRate: combined,
        extendedSelling: extSell,
        extendedCost: extCost,
        grossProfit: round2(extSell - extCost),
      });

      for (const comp of activeRows) {
        const finalQty = comp.qtyOverride !== null ? comp.qtyOverride : comp.calculatedQty;
        const cMatSell = calcSellRate(comp.matUnitCost, comp.matGpPct, 'computed');
        const cLbrSell = calcSellRate(comp.lbrUnitCost, comp.lbrGpPct, 'computed');
        const cCombined = cMatSell + cLbrSell;
        const cExtSell = round2(finalQty * cCombined);
        const cExtCost = round2(finalQty * (comp.matUnitCost + comp.lbrUnitCost));

        rowsToInsert.push({
          tempKey: `${baseKey}-${comp.rowKey}`,
          sectionKey,
          parentKey,
          rowType: 'subitem',
          lineNo: '',
          itemCode: comp.itemCode,
          description: comp.itemName,
          specification: comp.specification,
          qty: finalQty,
          unit: comp.unit,
          matPricingMode: comp.matUnitCost > 0 ? 'computed' : 'included',
          lbrPricingMode: 'computed',
          visibilityMode: 'hidden',
          rollupChildren: false,
          matUnitCost: comp.matUnitCost,
          lbrUnitCost: comp.lbrUnitCost,
          matGpPct: comp.matGpPct,
          lbrGpPct: comp.lbrGpPct,
          overrideMatRate: null,
          overrideLbrRate: null,
          overrideReason: '',
          catalogItemId: comp.catalogItemId,
          supplierRef: comp.selectedSupplierName,
          sourceAssemblyId: assemblyIdToLink,
          sourceAssemblyCode: assemblyCodeToLink,
          sourceAssemblyVersion: assemblyVerToLink,
          supplierId: comp.selectedSupplierId,
          supplierPriceId: comp.selectedSupplierPriceId,
          componentType: comp.componentType,
          calcBasis: comp.calcBasis,
          consumptionRate: comp.consumptionRate,
          wastagePct: comp.wastagePct,
          measurementQty: workQty,
          formulaText: comp.formulaText,
          sortOrder: sortCursor++,
          matSellRate: cMatSell,
          lbrSellRate: cLbrSell,
          combinedUnitRate: cCombined,
          extendedSelling: cExtSell,
          extendedCost: cExtCost,
          grossProfit: round2(cExtSell - cExtCost),
        });
      }
    }

    onInsertItems(sectionKey, rowsToInsert);
  };

  const handleInsertSingleCatalogItem = (cat: CatalogItemRecord) => {
    const qty = Math.max(0.01, Number(itemQtys[cat.id] ?? 1));
    const supPrices = cat.supplier_prices || [];
    const selectedSupId = itemSelectedSupPrice[cat.id];
    const chosenSup =
      (selectedSupId ? supPrices.find((sp) => sp.id === selectedSupId) : null) ||
      supPrices.find((sp) => sp.is_preferred) ||
      supPrices[0] ||
      null;

    const matUnitCost = chosenSup ? Number(chosenSup.unit_price) : Number(cat.mat_unit_cost ?? 0);
    const lbrUnitCost = Number(cat.lbr_unit_cost ?? 0);
    const matGp = Number(cat.default_mat_gp_pct ?? defaultMatGpPct ?? 0.3);
    const lbrGp = Number(cat.default_lbr_gp_pct ?? defaultLbrGpPct ?? 0.3);

    const matPricingMode = matUnitCost === 0 && cat.is_general_requirement ? 'included' : 'computed';
    const matSell = canViewCosting
      ? calcSellRate(matUnitCost, matGp, matPricingMode)
      : Number(cat.mat_sell_rate || 0);
    const lbrSell = canViewCosting
      ? calcSellRate(lbrUnitCost, lbrGp, 'computed')
      : Number(cat.lbr_sell_rate || 0);
    const combined = matSell + lbrSell;
    const extSell = round2(qty * combined);
    const extCost = round2(qty * (matUnitCost + lbrUnitCost));

    const newRow: EditorItem = {
      tempKey: `cat-${cat.id}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      sectionKey,
      parentKey: null,
      rowType: 'item',
      lineNo: String(existingItemsInSectionCount + 1),
      itemCode: cat.item_code,
      description: cat.name || cat.description,
      specification: cat.specification || '',
      qty,
      unit: cat.default_unit || 'lot',
      matPricingMode,
      lbrPricingMode: 'computed',
      visibilityMode: 'visible',
      rollupChildren: false,
      matUnitCost,
      lbrUnitCost,
      matGpPct: matGp,
      lbrGpPct: lbrGp,
      overrideMatRate: null,
      overrideLbrRate: null,
      overrideReason: '',
      catalogItemId: cat.id,
      supplierRef: chosenSup?.supplier_name ?? cat.supplier_ref ?? '',
      supplierId: chosenSup?.supplier_id ?? null,
      supplierPriceId: chosenSup?.id ?? null,
      componentType: cat.item_type || 'Material',
      sortOrder: existingItemsInSectionCount + 1,
      matSellRate: matSell,
      lbrSellRate: lbrSell,
      combinedUnitRate: combined,
      extendedSelling: extSell,
      extendedCost: extCost,
      grossProfit: round2(extSell - extCost),
    };

    onInsertItems(sectionKey, [newRow]);
  };

  const handleRequestMissingItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!missingName.trim()) return;
    setMissingStatusMsg('');
    try {
      await apiRequest('/api/quotations/catalog/request-missing', {
        method: 'POST',
        body: {
          requestedName: missingName.trim(),
          category: missingCategory,
          suggestedUnit: missingUnit,
          specification: missingSpec,
          suggestedSupplier: missingSupplier,
        },
      });
      setMissingStatusMsg(`Request submitted for "${missingName.trim()}". Catalog team notified.`);
      setMissingName('');
      setMissingSpec('');
      setMissingSupplier('');
    } catch (err: any) {
      setModalError(err.message || 'Failed to submit missing item request');
    }
  };

  const filteredAssemblies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assemblies.filter((asm) => {
      if (categoryFilter !== 'all' && asm.category_name !== categoryFilter) return false;
      if (!q) return true;
      const compText = (asm.components || [])
        .map((c) => `${c.item_code} ${c.item_name} ${c.specification}`)
        .join(' ');
      return `${asm.assembly_code} ${asm.name} ${asm.category_name} ${asm.description} ${asm.specifications} ${compText}`
        .toLowerCase()
        .includes(q);
    });
  }, [assemblies, categoryFilter, search]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogItems.filter((it) => {
      if (categoryFilter !== 'all' && it.category !== categoryFilter) return false;
      if (itemTypeFilter !== 'all' && (it.item_type || 'Material') !== itemTypeFilter) return false;
      if (!q) return true;
      const supText = (it.supplier_prices || [])
        .map((sp) => `${sp.supplier_name} ${sp.brand} ${sp.supplier_item_ref}`)
        .join(' ');
      return `${it.item_code} ${it.name} ${it.description} ${it.specification} ${it.category} ${supText}`
        .toLowerCase()
        .includes(q);
    });
  }, [catalogItems, categoryFilter, itemTypeFilter, search]);

  const packageSummary = useMemo(() => {
    let totalSelling = 0;
    let totalCost = 0;
    let includedCount = 0;
    let missingPrices = 0;
    for (const row of draftComponents) {
      if (!row.included) continue;
      includedCount += 1;
      if (row.missingPriceWarning && row.matUnitCost <= 0) missingPrices += 1;
      const qty = row.qtyOverride !== null ? row.qtyOverride : row.calculatedQty;
      const combinedSell = row.matSellRate + row.lbrSellRate;
      totalSelling += qty * combinedSell;
      totalCost += qty * (row.matUnitCost + row.lbrUnitCost);
    }
    return {
      includedCount,
      missingPrices,
      totalSelling: round2(totalSelling),
      totalCost: round2(totalCost),
      grossProfit: round2(totalSelling - totalCost),
    };
  }, [draftComponents]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-bold text-slate-900 whitespace-nowrap shrink-0">
              Quotation Catalog Picker
            </h3>
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => setMode('packages')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'packages'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Work Packages ({assemblies.length})
              </button>
              <button
                type="button"
                onClick={() => setMode('items')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'items'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Package className="h-3.5 w-3.5" />
                Single Items ({catalogItems.length})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 whitespace-nowrap">Insert into Section:</span>
              <select
                value={sectionKey}
                onChange={(e) => setSectionKey(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
              >
                {sections.map((s) => (
                  <option key={s.tempKey} value={s.tempKey}>
                    {s.code} · {s.title}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative min-w-[260px] flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  mode === 'packages'
                    ? 'Search work packages by code, title, spec, or included item...'
                    : 'Search single items by SKU, name, supplier, brand, or spec...'
                }
                className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="all">All Work Categories</option>
              {categories.map((c: any) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>

            {mode === 'items' && (
              <select
                value={itemTypeFilter}
                onChange={(e) => setItemTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="all">All Types</option>
                <option value="Material">Material</option>
                <option value="Labor">Labor</option>
                <option value="Equipment">Equipment</option>
                <option value="Subcontract">Subcontract</option>
                <option value="Consumable">Consumable</option>
              </select>
            )}
          </div>

          {mode === 'items' && (
            <button
              type="button"
              onClick={() => setShowMissingForm((p) => !p)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Request Missing Item
            </button>
          )}
        </div>

        {modalError && (
          <div className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-xs text-rose-800 flex items-center justify-between">
            <span>{modalError}</span>
            <button type="button" onClick={() => setModalError('')} className="underline text-[11px]">
              Dismiss
            </button>
          </div>
        )}

        {missingStatusMsg && (
          <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-2 text-xs text-emerald-800 flex items-center justify-between">
            <span>{missingStatusMsg}</span>
            <button type="button" onClick={() => setMissingStatusMsg('')} className="underline text-[11px]">
              Dismiss
            </button>
          </div>
        )}

        {/* Request Missing Item Drawer */}
        {showMissingForm && mode === 'items' && (
          <form
            onSubmit={handleRequestMissingItem}
            className="border-b border-slate-200 bg-slate-50 px-5 py-3 grid grid-cols-1 md:grid-cols-6 gap-2 text-xs items-end"
          >
            <div className="md:col-span-2">
              <label className="block text-[11px] font-medium text-slate-600">Requested Material / Item Name *</label>
              <input
                required
                value={missingName}
                onChange={(e) => setMissingName(e.target.value)}
                placeholder="e.g., Acoustic Wall Panel 1200x600"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600">Category</label>
              <select
                value={missingCategory}
                onChange={(e) => setMissingCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
              >
                {categories.map((c: any) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600">Unit</label>
              <select
                value={missingUnit}
                onChange={(e) => setMissingUnit(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
              >
                {units.map((u: any) => (
                  <option key={u.code} value={u.code}>
                    {u.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600">Suggested Supplier / Spec</label>
              <input
                value={missingSupplier}
                onChange={(e) => setMissingSupplier(e.target.value)}
                placeholder="Optional supplier / spec"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              />
            </div>
            <div className="flex gap-1.5">
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <Send className="h-3 w-3" />
                Submit
              </button>
              <button
                type="button"
                onClick={() => setShowMissingForm(false)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-600"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto">
          {mode === 'items' ? (
            <div className="divide-y divide-slate-200">
              {filteredItems.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500">
                  No catalog items match your filter. Try clearing your search or submit a missing-item request above.
                </div>
              ) : (
                filteredItems.map((cat) => {
                  const supPrices = cat.supplier_prices || [];
                  const currentSupId =
                    itemSelectedSupPrice[cat.id] ??
                    cat.preferred_supplier_price_id ??
                    supPrices[0]?.id ??
                    0;
                  const activeSup = supPrices.find((sp) => sp.id === currentSupId) || null;
                  const effectiveMatCost = activeSup ? Number(activeSup.unit_price) : Number(cat.mat_unit_cost ?? 0);
                  const matSell = canViewCosting
                    ? calcSellRate(effectiveMatCost, Number(cat.default_mat_gp_pct ?? 0.3), 'computed')
                    : cat.mat_sell_rate;
                  const combinedSell = matSell + (cat.lbr_sell_rate || 0);
                  const missingSupplierPrice =
                    (cat.item_type || 'Material') === 'Material' && supPrices.length === 0 && effectiveMatCost <= 0;

                  return (
                    <div
                      key={cat.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 text-xs"
                    >
                      <div className="min-w-[260px] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold text-amber-700">{cat.item_code}</span>
                          <span className="font-semibold text-slate-900">{cat.name}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-600">{cat.category}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-600">{cat.item_type || 'Material'}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-slate-700">Unit: {cat.default_unit}</span>
                        </div>
                        {(cat.specification || cat.description) && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {cat.specification || cat.description}
                          </div>
                        )}
                        {missingSupplierPrice && (
                          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle className="h-3 w-3" />
                            No supplier price registered — manual cost or RFQ required
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {canViewCosting && supPrices.length > 0 && (
                          <div className="min-w-[210px]">
                            <select
                              value={currentSupId}
                              onChange={(e) =>
                                setItemSelectedSupPrice((p) => ({
                                  ...p,
                                  [cat.id]: Number(e.target.value),
                                }))
                              }
                              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px]"
                              title="Compare and select supplier purchase price"
                            >
                              {supPrices.map((sp) => (
                                <option key={sp.id} value={sp.id}>
                                  {sp.supplier_name} — {formatMoney(sp.unit_price, 'PHP')}/{sp.unit}
                                  {sp.brand ? ` (${sp.brand})` : ''}
                                  {sp.is_preferred ? ' ★' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="text-right min-w-[95px]">
                          <div className="font-mono font-semibold tabular-nums text-slate-900">
                            {formatMoney(combinedSell, 'PHP')}
                          </div>
                          <div className="text-[10px] text-slate-500">Sell / {cat.default_unit}</div>
                        </div>

                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            value={itemQtys[cat.id] ?? 1}
                            onChange={(e) =>
                              setItemQtys((p) => ({ ...p, [cat.id]: Number(e.target.value) }))
                            }
                            className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                            title="Quantity to insert"
                          />
                          <button
                            type="button"
                            onClick={() => handleInsertSingleCatalogItem(cat)}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            Insert
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* WORK PACKAGES (SETS OF WORKS) */
            <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[460px]">
              {/* Left: Work Packages Directory */}
              <div className="lg:col-span-5 border-r border-slate-200 divide-y divide-slate-200 max-h-[65vh] overflow-y-auto">
                {filteredAssemblies.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    No Work Packages match your search or category filter.
                  </div>
                ) : (
                  filteredAssemblies.map((asm) => {
                    const isSelected = selectedAssembly?.id === asm.id;
                    const isExpanded = Boolean(expandedListIds[asm.id]);
                    return (
                      <div
                        key={asm.id}
                        className={`p-3.5 text-xs transition-colors ${
                          isSelected ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectAssembly(asm)}
                            className="text-left flex-1 min-w-0"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono font-bold text-amber-800">{asm.assembly_code}</span>
                              <span className="text-slate-400">·</span>
                              <span className="font-semibold text-slate-900">{asm.name}</span>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500">
                              {asm.category_name} · Unit: <span className="font-mono">{asm.unit}</span> · v{asm.current_version} · {asm.component_count} items
                            </div>
                          </button>
                          <div className="text-right shrink-0">
                            <div className="font-mono font-semibold tabular-nums text-slate-900">
                              {formatMoney(asm.estimated_unit_selling, 'PHP')}
                            </div>
                            <div className="text-[10px] text-slate-500">est / {asm.unit}</div>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedListIds((p) => ({ ...p, [asm.id]: !p[asm.id] }))
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            {isExpanded ? 'Hide included items' : `View ${asm.component_count} included items`}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectAssembly(asm)}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${
                              isSelected
                                ? 'bg-amber-600 text-white'
                                : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                            }`}
                          >
                            {isSelected ? 'Selected' : 'Configure & Quote'}
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2 space-y-1">
                            {asm.components.map((c) => (
                              <div
                                key={c.id}
                                className="flex items-center justify-between gap-2 text-[11px] text-slate-700"
                              >
                                <span className="truncate">
                                  <span className="font-mono text-slate-500">{c.item_code || c.component_type}</span>{' '}
                                  {c.item_name}
                                </span>
                                <span className="font-mono tabular-nums text-slate-500 shrink-0">
                                  {c.consumption_rate} {c.unit}/{asm.unit}
                                  {c.wastage_pct > 0 ? ` (+${c.wastage_pct}%)` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Right: Interactive Work Package Configurator */}
              <div className="lg:col-span-7 flex flex-col max-h-[65vh] overflow-y-auto bg-white">
                {!selectedAssembly ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-10 text-center text-xs text-slate-500">
                    <Layers className="h-8 w-8 text-slate-300 mb-2" />
                    <div className="font-semibold text-slate-800">Select a Work Package on the left</div>
                    <p className="mt-1 max-w-sm">
                      Preview all included materials, labor, and equipment, enter your work quantity (e.g. sq.m or lm),
                      choose supplier prices, and insert into your quotation.
                    </p>
                  </div>
                ) : (
                  <div className="p-5 space-y-4 text-xs">
                    {/* Selected Assembly Summary & Measurement Input */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-amber-800">{selectedAssembly.assembly_code}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-sm font-bold text-slate-900">{selectedAssembly.name}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-500">v{selectedAssembly.current_version}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-600">
                          {selectedAssembly.category_name}
                          {selectedAssembly.specifications ? ` · ${selectedAssembly.specifications}` : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                          Work Measurement Qty:
                        </label>
                        <input
                          type="number"
                          min={0.01}
                          step="any"
                          value={workQty}
                          onChange={(e) => handleWorkQtyChange(Number(e.target.value))}
                          className="w-24 rounded-lg border border-amber-400 bg-amber-50/40 px-2.5 py-1.5 text-right font-mono font-bold tabular-nums text-slate-900"
                        />
                        <span className="font-mono font-semibold text-slate-700">{selectedAssembly.unit}</span>
                      </div>
                    </div>

                    {/* Insertion Style & Action Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="insertionStyle"
                          checked={insertionStyle === 'itemized'}
                          onChange={() => setInsertionStyle('itemized')}
                          className="mt-0.5"
                        />
                        <div>
                          <div className="font-semibold text-slate-900">Itemized Quotation Lines (Recommended)</div>
                          <div className="text-[11px] text-slate-500">
                            Inserts a Work Package subheader plus every component row below it so all items display cleanly for quotation.
                          </div>
                        </div>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="insertionStyle"
                          checked={insertionStyle === 'grouped'}
                          onChange={() => setInsertionStyle('grouped')}
                          className="mt-0.5"
                        />
                        <div>
                          <div className="font-semibold text-slate-900">Grouped Package + Sub-items</div>
                          <div className="text-[11px] text-slate-500">
                            Shows 1 combined package line to the client with hidden internal sub-item breakdown rolled into its price.
                          </div>
                        </div>
                      </label>
                    </div>

                    {packageSummary.missingPrices > 0 && canViewCosting && (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                        <span>
                          {packageSummary.missingPrices} material component(s) have no registered supplier price — enter unit cost manually or request a supplier quote.
                        </span>
                      </div>
                    )}

                    {/* Included Components Table */}
                    <div className="rounded-lg border border-slate-200 overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-2 py-2 w-7">Use</th>
                            <th className="px-2 py-2">Component &amp; Calculation Formula</th>
                            <th className="px-2 py-2 w-24 text-right">Final Qty</th>
                            {canViewCosting && (
                              <>
                                <th className="px-2 py-2 min-w-[175px]">Supplier Selection</th>
                                <th className="px-2 py-2 w-20 text-right">Mat Cost</th>
                                <th className="px-2 py-2 w-20 text-right">Lbr Cost</th>
                              </>
                            )}
                            <th className="px-2 py-2 w-24 text-right">Ext. Selling</th>
                            <th className="px-2 py-2 w-7"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {draftComponents.map((row) => {
                            const finalQty = row.qtyOverride !== null ? row.qtyOverride : row.calculatedQty;
                            const combinedSell = row.matSellRate + row.lbrSellRate;
                            const extSell = round2(finalQty * combinedSell);

                            return (
                              <tr key={row.rowKey} className={row.included ? '' : 'opacity-45 bg-slate-50'}>
                                <td className="px-2 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={row.included}
                                    onChange={(e) =>
                                      setDraftComponents((prev) =>
                                        prev.map((r) =>
                                          r.rowKey === row.rowKey ? { ...r, included: e.target.checked } : r
                                        )
                                      )
                                    }
                                  />
                                </td>
                                <td className="px-2 py-2">
                                  <div className="font-semibold text-slate-900">
                                    {row.itemCode && <span className="font-mono text-amber-800 mr-1">{row.itemCode}</span>}
                                    {row.itemName}
                                  </div>
                                  <div className="text-[10px] text-slate-500">
                                    {row.componentType} · {row.specification || 'Standard spec'}
                                  </div>
                                  <div className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-sky-800">
                                    <Calculator className="h-3 w-3 shrink-0" />
                                    {row.formulaText}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      value={finalQty}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        setDraftComponents((prev) =>
                                          prev.map((r) =>
                                            r.rowKey === row.rowKey ? { ...r, qtyOverride: val } : r
                                          )
                                        );
                                      }}
                                      className={`w-16 rounded border px-1.5 py-0.5 text-right font-mono tabular-nums ${
                                        row.qtyOverride !== null ? 'border-amber-400 bg-amber-50' : 'border-slate-300'
                                      }`}
                                      title="Override calculated quantity for this quotation"
                                    />
                                    <span className="font-mono text-slate-500">{row.unit}</span>
                                  </div>
                                </td>

                                {canViewCosting && (
                                  <>
                                    <td className="px-2 py-2">
                                      {row.supplierPrices.length > 0 ? (
                                        <select
                                          value={row.selectedSupplierPriceId ?? ''}
                                          onChange={(e) => handleComponentSupplierChange(row.rowKey, e.target.value)}
                                          className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                                        >
                                          {row.supplierPrices.map((sp) => (
                                            <option key={sp.id} value={sp.id}>
                                              {sp.supplier_name} ({formatMoney(sp.unit_price, 'PHP')})
                                            </option>
                                          ))}
                                        </select>
                                      ) : row.componentType === 'Material' ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
                                          <AlertTriangle className="h-3 w-3" />
                                          No supplier price
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-slate-400">Internal rate</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                      <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={row.matUnitCost}
                                        onChange={(e) => {
                                          const c = Math.max(0, Number(e.target.value));
                                          setDraftComponents((prev) =>
                                            prev.map((r) =>
                                              r.rowKey === row.rowKey
                                                ? {
                                                    ...r,
                                                    matUnitCost: c,
                                                    matSellRate: calcSellRate(c, r.matGpPct, 'computed'),
                                                  }
                                                : r
                                            )
                                          );
                                        }}
                                        className="w-18 rounded border border-slate-300 px-1.5 py-0.5 text-right font-mono tabular-nums"
                                      />
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                      <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={row.lbrUnitCost}
                                        onChange={(e) => {
                                          const c = Math.max(0, Number(e.target.value));
                                          setDraftComponents((prev) =>
                                            prev.map((r) =>
                                              r.rowKey === row.rowKey
                                                ? {
                                                    ...r,
                                                    lbrUnitCost: c,
                                                    lbrSellRate: calcSellRate(c, r.lbrGpPct, 'computed'),
                                                  }
                                                : r
                                            )
                                          );
                                        }}
                                        className="w-18 rounded border border-slate-300 px-1.5 py-0.5 text-right font-mono tabular-nums"
                                      />
                                    </td>
                                  </>
                                )}

                                <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums text-slate-900">
                                  {formatMoney(extSell, 'PHP')}
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraftComponents((prev) => prev.filter((r) => r.rowKey !== row.rowKey))
                                    }
                                    className="text-slate-400 hover:text-rose-600"
                                    title="Remove component from this insertion"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Add Extra Component to Package before Inserting */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddCompPicker((p) => !p)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Custom / Extra Item to This Package
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowSaveCustomPanel((p) => !p)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {showSaveCustomPanel ? 'Hide Master Catalog Save Option' : 'Save Customized Set to Master Catalog'}
                      </button>
                    </div>

                    {showAddCompPicker && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                        <input
                          value={addCompSearch}
                          onChange={(e) => setAddCompSearch(e.target.value)}
                          placeholder="Search catalog item to add to this work package..."
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                        />
                        <div className="max-h-36 overflow-y-auto divide-y divide-slate-200 bg-white rounded-lg border border-slate-200">
                          {catalogItems
                            .filter((ci) =>
                              `${ci.item_code} ${ci.name} ${ci.category}`
                                .toLowerCase()
                                .includes(addCompSearch.toLowerCase())
                            )
                            .slice(0, 12)
                            .map((ci) => (
                              <div
                                key={ci.id}
                                className="flex items-center justify-between px-3 py-1.5 text-[11px] hover:bg-slate-50"
                              >
                                <span>
                                  <span className="font-mono text-amber-800 mr-1.5">{ci.item_code}</span>
                                  {ci.name} ({ci.default_unit})
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleAddExtraComponentFromCatalog(ci)}
                                  className="rounded bg-slate-900 px-2 py-0.5 text-white hover:bg-slate-800"
                                >
                                  Add
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {showSaveCustomPanel && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                        <div className="text-[11px] font-semibold text-slate-800">
                          Save Customized Assembly as a Reusable Set of Works in Master Catalog
                        </div>
                        {!canCreateMasterAssembly ? (
                          <div className="text-[11px] text-amber-800">
                            Your role does not have `catalog:create_assembly` permission to save master templates, but you can still insert this customized package for this quotation only.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <input
                              value={customCode}
                              onChange={(e) => setCustomCode(e.target.value)}
                              placeholder="New Code (e.g. SOW-CUSTOM-01)"
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono"
                            />
                            <input
                              value={customName}
                              onChange={(e) => setCustomName(e.target.value)}
                              placeholder="New Set of Works Name"
                              className="sm:col-span-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                            />
                            <select
                              value={customCategory}
                              onChange={(e) => setCustomCategory(e.target.value)}
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                            >
                              {categories.map((c: any) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Package Summary Footer */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                      <div className="space-y-0.5">
                        <div className="text-slate-600">
                          Included items: <strong className="font-mono text-slate-900">{packageSummary.includedCount}</strong>
                          {' · '}
                          Estimated Selling Total:{' '}
                          <strong className="font-mono text-slate-900">
                            {formatMoney(packageSummary.totalSelling, 'PHP')}
                          </strong>
                        </div>
                        {canViewCosting && (
                          <div className="text-[11px] text-slate-500">
                            Internal Direct Cost:{' '}
                            <span className="font-mono">{formatMoney(packageSummary.totalCost, 'PHP')}</span>
                            {' · '}
                            Estimated GP:{' '}
                            <span className="font-mono text-emerald-700 font-semibold">
                              {formatMoney(packageSummary.grossProfit, 'PHP')}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {showSaveCustomPanel && canCreateMasterAssembly && (
                          <button
                            type="button"
                            disabled={savingMaster}
                            onClick={() => handleInsertWorkPackage(true)}
                            className="rounded-lg border border-slate-900 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                          >
                            {savingMaster ? 'Saving...' : 'Save to Master & Insert'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleInsertWorkPackage(false)}
                          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                        >
                          Insert into Quotation Only
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
