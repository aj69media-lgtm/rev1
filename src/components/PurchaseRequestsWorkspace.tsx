import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Eye,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { apiRequest, formatCurrencyExact } from '../lib/api';
import { StatusLabel } from './Charts';
import {
  EvidenceFilePicker,
  PendingAttachmentDraft,
  ProtectedAttachmentGallery,
} from './ProtectedAttachmentGallery';

interface PrLineDraft {
  key: string;
  catalogItemId: number | null;
  inventoryItemId: number | null;
  itemCode: string;
  itemDescription: string;
  specifications: string;
  category: string;
  requestedQty: string;
  unit: string;
  estimatedUnitPrice: string;
  preferredSupplierId: string;
  preferredSupplierName: string;
  remarks: string;
}

function emptyLine(defaultCategory = 'Materials'): PrLineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    catalogItemId: null,
    inventoryItemId: null,
    itemCode: '',
    itemDescription: '',
    specifications: '',
    category: defaultCategory,
    requestedQty: '1',
    unit: 'pcs',
    estimatedUnitPrice: '0',
    preferredSupplierId: '',
    preferredSupplierName: '',
    remarks: '',
  };
}

interface PurchaseRequestsWorkspaceProps {
  projectId?: number;
  defaultSiteLocation?: string;
  onRefreshParent?: () => void;
  onNotify?: (msg: string) => void;
}

export const PurchaseRequestsWorkspace: React.FC<PurchaseRequestsWorkspaceProps> = ({
  projectId,
  defaultSiteLocation = '',
  onRefreshParent,
  onNotify,
}) => {
  const { hasPerm } = useAuth();
  const { syncVersion } = useSync();

  const [prs, setPrs] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [banner, setBanner] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Create / Edit Multi-Item PR Drawer
  const [showPrModal, setShowPrModal] = useState(false);
  const [editingPrId, setEditingPrId] = useState<number | null>(null);
  const [prHeader, setPrHeader] = useState({
    projectId: projectId ? String(projectId) : '',
    requestDate: new Date().toISOString().slice(0, 10),
    requiredDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    requestingDepartment: 'Construction Operations',
    siteLocation: defaultSiteLocation,
    preferredSupplierId: '',
    preferredSupplierName: '',
    reason: '',
    remarks: '',
  });
  const [prLines, setPrLines] = useState<PrLineDraft[]>([emptyLine()]);
  const [prAttachments, setPrAttachments] = useState<PendingAttachmentDraft[]>([]);
  const [catalogPickerRowKey, setCatalogPickerRowKey] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [savingPr, setSavingPr] = useState(false);

  // Detail / Approval / PO / Receiving Modals
  const [inspectPr, setInspectPr] = useState<any | null>(null);
  const [approvalPr, setApprovalPr] = useState<any | null>(null);
  const [approvalRemarks, setApprovalRemarks] = useState('');
  const [itemDecisions, setItemDecisions] = useState<
    Record<number, { status: 'approved' | 'partially_approved' | 'rejected' | 'returned'; approvedQty: string; remarks: string }>
  >({});
  const [submittingApproval, setSubmittingApproval] = useState(false);

  const [poModalPr, setPoModalPr] = useState<any | null>(null);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poSupplierName, setPoSupplierName] = useState('');
  const [poRemarks, setPoRemarks] = useState('');
  const [poLines, setPoLines] = useState<Array<{ prItemId: number; itemDescription: string; unit: string; approvedQty: number; orderedQty: string; actualUnitPrice: string; supplierId: string; supplierName: string }>>([]);
  const [submittingPo, setSubmittingPo] = useState(false);

  const [receivePr, setReceivePr] = useState<any | null>(null);
  const [receiveMeta, setReceiveMeta] = useState({
    deliveryDate: new Date().toISOString().slice(0, 10),
    drNumber: '',
    invoiceNumber: '',
    remarks: '',
    recordExpense: false,
  });
  const [receiveLines, setReceiveLines] = useState<
    Array<{
      prItemId: number;
      itemCode: string;
      itemDescription: string;
      unit: string;
      approvedQty: number;
      previouslyDelivered: number;
      deliveredQty: string;
      acceptedQty: string;
      actualUnitCost: string;
      inventoryItemId: string;
      addToWarehouse: boolean;
      discrepancyNotes: string;
    }>
  >([]);
  const [receiveDocs, setReceiveDocs] = useState<PendingAttachmentDraft[]>([]);
  const [submittingReceive, setSubmittingReceive] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const qs = projectId ? `?projectId=${projectId}` : '';
      const calls: Promise<any>[] = [
        apiRequest(`/api/purchase-requests${qs}`).then((r) => {
          setPrs(r.purchaseRequests || []);
          setPos(r.purchaseOrders || []);
        }),
      ];
      if (!projectId) {
        calls.push(
          apiRequest('/api/projects').then((r) => setProjects(r.projects || [])).catch(() => {})
        );
      }
      if (hasPerm('catalog', 'view')) {
        calls.push(
          apiRequest('/api/catalog/suppliers').then((r) => setSuppliers(r.suppliers || [])).catch(() => {}),
          apiRequest('/api/catalog/items?status=active').then((r) => setCatalogItems(r.items || [])).catch(() => {})
        );
      }
      if (hasPerm('equipment', 'view')) {
        calls.push(
          apiRequest('/api/inventory').then((r) => setInventoryItems(r.items || [])).catch(() => {})
        );
      }
      await Promise.all(calls);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [projectId, syncVersion]);

  const notify = (msg: string) => {
    setBanner(msg);
    onNotify?.(msg);
  };

  const grandEstimatedTotal = useMemo(
    () =>
      prLines.reduce((sum, l) => {
        const q = Number(l.requestedQty || 0);
        const p = Number(l.estimatedUnitPrice || 0);
        return sum + (Number.isFinite(q * p) ? q * p : 0);
      }, 0),
    [prLines]
  );

  const openNewPrModal = () => {
    setEditingPrId(null);
    setErrorMsg('');
    setPrHeader({
      projectId: projectId ? String(projectId) : projects[0]?.id ? String(projects[0].id) : '',
      requestDate: new Date().toISOString().slice(0, 10),
      requiredDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      requestingDepartment: 'Construction Operations',
      siteLocation: defaultSiteLocation || projects[0]?.location || '',
      preferredSupplierId: '',
      preferredSupplierName: '',
      reason: '',
      remarks: '',
    });
    setPrLines([emptyLine()]);
    setPrAttachments([]);
    setShowPrModal(true);
  };

  const openEditPrModal = (pr: any) => {
    setEditingPrId(pr.id);
    setErrorMsg('');
    setPrHeader({
      projectId: String(pr.project_id),
      requestDate: pr.request_date || new Date().toISOString().slice(0, 10),
      requiredDate: pr.required_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      requestingDepartment: pr.requesting_department || 'Construction Operations',
      siteLocation: pr.site_location || pr.project_location || defaultSiteLocation,
      preferredSupplierId: pr.preferred_supplier_id ? String(pr.preferred_supplier_id) : '',
      preferredSupplierName: pr.preferred_supplier_name || pr.suggested_supplier || '',
      reason: pr.reason || '',
      remarks: pr.remarks || '',
    });
    const existingLines: any[] = pr.items || [];
    setPrLines(
      existingLines.length > 0
        ? existingLines.map((it) => ({
            key: `item-${it.id}`,
            catalogItemId: it.catalog_item_id || null,
            inventoryItemId: it.inventory_item_id || null,
            itemCode: it.item_code || '',
            itemDescription: it.item_description || '',
            specifications: it.specifications || '',
            category: it.category || 'Materials',
            requestedQty: String(it.requested_qty ?? 1),
            unit: it.unit || 'pcs',
            estimatedUnitPrice: String(it.estimated_unit_price ?? 0),
            preferredSupplierId: it.preferred_supplier_id ? String(it.preferred_supplier_id) : '',
            preferredSupplierName: it.preferred_supplier_name || '',
            remarks: it.remarks || '',
          }))
        : [emptyLine()]
    );
    setPrAttachments([]);
    setShowPrModal(true);
  };

  const handleSavePr = async (saveAsDraft: boolean) => {
    setErrorMsg('');
    const targetProjectId = projectId || Number(prHeader.projectId);
    if (!targetProjectId) {
      setErrorMsg('Please select a project.');
      return;
    }
    if (!prHeader.requiredDate) {
      setErrorMsg('Required delivery date is required.');
      return;
    }
    if (prLines.length === 0) {
      setErrorMsg('Add at least one line item.');
      return;
    }
    for (let i = 0; i < prLines.length; i++) {
      const l = prLines[i];
      if (!l.itemDescription.trim() || Number(l.requestedQty) <= 0 || Number(l.estimatedUnitPrice) < 0) {
        setErrorMsg(`Line item ${i + 1}: Description, positive quantity, and non-negative price are required.`);
        return;
      }
    }

    setSavingPr(true);
    try {
      const payload = {
        requestDate: prHeader.requestDate,
        requiredDate: prHeader.requiredDate,
        requestingDepartment: prHeader.requestingDepartment,
        siteLocation: prHeader.siteLocation,
        preferredSupplierId: prHeader.preferredSupplierId ? Number(prHeader.preferredSupplierId) : null,
        preferredSupplierName: prHeader.preferredSupplierName,
        suggestedSupplier: prHeader.preferredSupplierName,
        reason: prHeader.reason,
        remarks: prHeader.remarks,
        saveAsDraft,
        submitNow: !saveAsDraft,
        items: prLines.map((l) => ({
          catalogItemId: l.catalogItemId,
          inventoryItemId: l.inventoryItemId,
          itemCode: l.itemCode,
          itemDescription: l.itemDescription.trim(),
          specifications: l.specifications.trim(),
          category: l.category,
          requestedQty: Number(l.requestedQty),
          unit: l.unit.trim() || 'pcs',
          estimatedUnitPrice: Number(l.estimatedUnitPrice || 0),
          preferredSupplierId: l.preferredSupplierId ? Number(l.preferredSupplierId) : null,
          preferredSupplierName: l.preferredSupplierName.trim(),
          remarks: l.remarks.trim(),
        })),
        attachmentsBase64: prAttachments.map((a) => ({
          dataUrl: a.dataUrl,
          fileName: a.fileName,
          caption: a.caption,
          category: a.category,
        })),
      };

      if (editingPrId) {
        await apiRequest(`/api/purchase-requests/${editingPrId}`, { method: 'PUT', body: payload });
        notify(saveAsDraft ? 'Purchase Request draft updated.' : 'Purchase Request submitted for approval.');
      } else {
        await apiRequest(`/api/projects/${targetProjectId}/purchase-requests`, { method: 'POST', body: payload });
        notify(saveAsDraft ? 'Purchase Request saved as draft.' : 'Multi-item Purchase Request submitted for approval.');
      }
      setShowPrModal(false);
      await loadData();
      onRefreshParent?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to save Purchase Request');
    } finally {
      setSavingPr(false);
    }
  };

  const applyCatalogSelection = (
    rowKey: string,
    item: {
      catalogItemId?: number | null;
      inventoryItemId?: number | null;
      itemCode: string;
      itemDescription: string;
      specifications?: string;
      category?: string;
      unit: string;
      unitPrice: number;
      supplierId?: number | null;
      supplierName?: string;
    }
  ) => {
    setPrLines((prev) =>
      prev.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              catalogItemId: item.catalogItemId ?? null,
              inventoryItemId: item.inventoryItemId ?? null,
              itemCode: item.itemCode || row.itemCode,
              itemDescription: item.itemDescription,
              specifications: item.specifications || row.specifications,
              category: item.category || row.category,
              unit: item.unit || row.unit,
              estimatedUnitPrice: String(item.unitPrice ?? 0),
              preferredSupplierId: item.supplierId ? String(item.supplierId) : row.preferredSupplierId,
              preferredSupplierName: item.supplierName || row.preferredSupplierName,
            }
          : row
      )
    );
    setCatalogPickerRowKey(null);
    setCatalogSearch('');
  };

  const openApprovalModal = (pr: any) => {
    setApprovalPr(pr);
    setApprovalRemarks('');
    const init: Record<number, any> = {};
    for (const it of pr.items || []) {
      init[it.id] = {
        status: 'approved',
        approvedQty: String(it.requested_qty),
        remarks: '',
      };
    }
    setItemDecisions(init);
    setErrorMsg('');
  };

  const handleSubmitApproval = async (mode: 'per_item' | 'approve_all' | 'reject_all' | 'return') => {
    if (!approvalPr) return;
    setErrorMsg('');
    if ((mode === 'reject_all' || mode === 'return') && !approvalRemarks.trim()) {
      setErrorMsg('Remarks/reason are required when rejecting or returning a purchase request.');
      return;
    }
    setSubmittingApproval(true);
    try {
      if (mode === 'approve_all') {
        await apiRequest(`/api/purchase-requests/${approvalPr.id}/workflow`, {
          method: 'PATCH',
          body: { status: 'approved', remarks: approvalRemarks.trim() || 'All line items approved' },
        });
      } else if (mode === 'reject_all') {
        await apiRequest(`/api/purchase-requests/${approvalPr.id}/workflow`, {
          method: 'PATCH',
          body: { status: 'rejected', remarks: approvalRemarks.trim() },
        });
      } else if (mode === 'return') {
        await apiRequest(`/api/purchase-requests/${approvalPr.id}/workflow`, {
          method: 'PATCH',
          body: { status: 'returned_for_correction', remarks: approvalRemarks.trim() },
        });
      } else {
        const itemsPayload = (approvalPr.items || []).map((it: any) => {
          const dec = itemDecisions[it.id] || { status: 'approved', approvedQty: String(it.requested_qty), remarks: '' };
          return {
            itemId: it.id,
            itemStatus: dec.status,
            approvedQty: Number(dec.approvedQty || 0),
            remarks: dec.remarks || '',
          };
        });
        await apiRequest(`/api/purchase-requests/${approvalPr.id}/workflow`, {
          method: 'PATCH',
          body: { status: 'partially_approved', remarks: approvalRemarks.trim(), itemDecisions: itemsPayload },
        });
      }
      setApprovalPr(null);
      notify(`Approval decision recorded for ${approvalPr.ref_number}.`);
      await loadData();
      onRefreshParent?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Approval update failed');
    } finally {
      setSubmittingApproval(false);
    }
  };

  const openPoModal = (pr: any) => {
    setPoModalPr(pr);
    setPoSupplierId(pr.preferred_supplier_id ? String(pr.preferred_supplier_id) : '');
    setPoSupplierName(pr.preferred_supplier_name || pr.suggested_supplier || '');
    setPoRemarks('');
    const approvedItems = (pr.items || []).filter(
      (it: any) => Number(it.approved_qty) > 0 && ['approved', 'partially_approved'].includes(it.item_status)
    );
    setPoLines(
      approvedItems.map((it: any) => ({
        prItemId: it.id,
        itemDescription: it.item_description,
        unit: it.unit,
        approvedQty: Number(it.approved_qty),
        orderedQty: String(it.approved_qty),
        actualUnitPrice: String(it.estimated_unit_price ?? 0),
        supplierId: it.preferred_supplier_id ? String(it.preferred_supplier_id) : '',
        supplierName: it.preferred_supplier_name || pr.preferred_supplier_name || pr.suggested_supplier || '',
      }))
    );
    setErrorMsg('');
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poModalPr) return;
    setSubmittingPo(true);
    setErrorMsg('');
    try {
      const res = await apiRequest(`/api/purchase-requests/${poModalPr.id}/create-po`, {
        method: 'POST',
        body: {
          supplierId: poSupplierId ? Number(poSupplierId) : null,
          supplierName: poSupplierName.trim() || undefined,
          remarks: poRemarks.trim(),
          items: poLines.map((l) => ({
            prItemId: l.prItemId,
            orderedQty: Number(l.orderedQty),
            actualUnitPrice: Number(l.actualUnitPrice),
            supplierId: l.supplierId ? Number(l.supplierId) : poSupplierId ? Number(poSupplierId) : null,
            supplierName: l.supplierName.trim() || poSupplierName.trim(),
          })),
        },
      });
      setPoModalPr(null);
      notify(`Purchase Order ${res.poNumber} issued.`);
      await loadData();
      onRefreshParent?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to create Purchase Order');
    } finally {
      setSubmittingPo(false);
    }
  };

  const openReceiveModal = (pr: any) => {
    setReceivePr(pr);
    setReceiveMeta({
      deliveryDate: new Date().toISOString().slice(0, 10),
      drNumber: '',
      invoiceNumber: '',
      remarks: '',
      recordExpense: false,
    });
    const receivableItems = (pr.items || []).filter(
      (it: any) => Number(it.approved_qty || it.requested_qty) > Number(it.delivered_qty || 0) && it.item_status !== 'rejected'
    );
    setReceiveLines(
      receivableItems.map((it: any) => {
        const remaining = Math.max(0, Number(it.approved_qty || it.requested_qty) - Number(it.delivered_qty || 0));
        const matchedInv =
          it.inventory_item_id ||
          inventoryItems.find((inv) => it.item_code && inv.sku === it.item_code)?.id ||
          '';
        return {
          prItemId: it.id,
          itemCode: it.item_code || '',
          itemDescription: it.item_description,
          unit: it.unit || 'pcs',
          approvedQty: Number(it.approved_qty || it.requested_qty),
          previouslyDelivered: Number(it.delivered_qty || 0),
          deliveredQty: String(remaining),
          acceptedQty: String(remaining),
          actualUnitCost: String(it.estimated_unit_price ?? 0),
          inventoryItemId: matchedInv ? String(matchedInv) : '',
          addToWarehouse: Boolean(matchedInv),
          discrepancyNotes: '',
        };
      })
    );
    setReceiveDocs([]);
    setErrorMsg('');
  };

  const handleConfirmReceiving = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivePr) return;
    const validLines = receiveLines.filter((l) => Number(l.deliveredQty) > 0);
    if (validLines.length === 0) {
      setErrorMsg('Enter at least one positive delivered quantity.');
      return;
    }
    setSubmittingReceive(true);
    setErrorMsg('');
    try {
      const res = await apiRequest(`/api/purchase-requests/${receivePr.id}/receive`, {
        method: 'POST',
        body: {
          deliveryDate: receiveMeta.deliveryDate,
          drNumber: receiveMeta.drNumber,
          invoiceNumber: receiveMeta.invoiceNumber,
          remarks: receiveMeta.remarks,
          recordExpense: receiveMeta.recordExpense,
          items: validLines.map((l) => ({
            prItemId: l.prItemId,
            deliveredQty: Number(l.deliveredQty),
            acceptedQty: Number(l.acceptedQty),
            actualUnitCost: Number(l.actualUnitCost || 0),
            inventoryItemId: l.inventoryItemId ? Number(l.inventoryItemId) : null,
            addToWarehouse: l.addToWarehouse,
            discrepancyNotes: l.discrepancyNotes.trim(),
          })),
          attachmentsBase64: receiveDocs.map((d) => ({
            dataUrl: d.dataUrl,
            fileName: d.fileName,
            caption: d.caption,
            category: 'Delivery Receipt / Invoice',
          })),
        },
      });
      setReceivePr(null);
      notify(
        `Delivery recorded (${res.status.replace(/_/g, ' ')}). Warehouse items updated: ${res.warehouseUpdatedCount}.`
      );
      await loadData();
      onRefreshParent?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to record delivery receipt');
    } finally {
      setSubmittingReceive(false);
    }
  };

  const filteredPrs = useMemo(() => {
    const q = search.toLowerCase().trim();
    return prs.filter((pr) => {
      if (statusFilter !== 'all' && pr.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(pr.ref_number || '').toLowerCase().includes(q) ||
        String(pr.project_name || '').toLowerCase().includes(q) ||
        String(pr.item_description || '').toLowerCase().includes(q) ||
        (pr.items || []).some((it: any) =>
          String(it.item_description || '').toLowerCase().includes(q) ||
          String(it.item_code || '').toLowerCase().includes(q)
        )
      );
    });
  }, [prs, search, statusFilter]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.toLowerCase().trim();
    if (!q) return catalogItems.slice(0, 30);
    return catalogItems
      .filter(
        (c) =>
          String(c.name || '').toLowerCase().includes(q) ||
          String(c.item_code || '').toLowerCase().includes(q) ||
          String(c.category || '').toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [catalogItems, catalogSearch]);

  const filteredInventory = useMemo(() => {
    const q = catalogSearch.toLowerCase().trim();
    if (!q) return inventoryItems.slice(0, 20);
    return inventoryItems
      .filter(
        (inv) =>
          String(inv.name || '').toLowerCase().includes(q) ||
          String(inv.sku || '').toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [inventoryItems, catalogSearch]);

  return (
    <div className="space-y-5">
      {banner && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner('')} className="text-emerald-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Action & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search PR ref, item, SKU..."
              className="w-56 rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="partially_approved">Partially Approved</option>
            <option value="returned_for_correction">Returned for Correction</option>
            <option value="ordered">Ordered (PO Issued)</option>
            <option value="partially_delivered">Partially Delivered</option>
            <option value="delivered">Delivered</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {hasPerm('procurement', 'create') && (
          <button
            type="button"
            onClick={openNewPrModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            New Multi-Item Purchase Request
          </button>
        )}
      </div>

      {/* Purchase Requests List */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2.5 font-semibold">PR Ref &amp; Dates</th>
              {!projectId && <th className="px-4 py-2.5 font-semibold">Project</th>}
              <th className="px-4 py-2.5 font-semibold">Items &amp; Scope</th>
              <th className="px-4 py-2.5 font-semibold text-right">Est. Total</th>
              <th className="px-4 py-2.5 font-semibold text-right">Approved Comm.</th>
              <th className="px-4 py-2.5 font-semibold text-right">Settled</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr>
                <td colSpan={projectId ? 7 : 8} className="px-4 py-8 text-center text-slate-500">
                  Loading purchase requests...
                </td>
              </tr>
            ) : filteredPrs.length === 0 ? (
              <tr>
                <td colSpan={projectId ? 7 : 8} className="px-4 py-10 text-center text-slate-500">
                  No purchase requests found.
                </td>
              </tr>
            ) : (
              filteredPrs.map((pr) => {
                const lineCount = pr.items?.length || pr.item_count || 1;
                return (
                  <tr key={pr.id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-mono font-semibold text-slate-900">{pr.ref_number}</div>
                      <div className="font-mono text-[11px] text-slate-500">Req: {pr.required_date}</div>
                      <div className="text-[11px] text-slate-500">By {pr.requested_by_name}</div>
                    </td>
                    {!projectId && (
                      <td className="px-4 py-3 text-slate-700">
                        <div className="font-medium text-slate-900">{pr.project_name}</div>
                        <div className="text-[11px] text-slate-500">{pr.site_location || pr.project_location}</div>
                      </td>
                    )}
                    <td className="px-4 py-3 max-w-sm">
                      <div className="font-medium text-slate-900">{pr.item_description}</div>
                      <div className="text-[11px] text-slate-500">
                        {lineCount} line item{lineCount > 1 ? 's' : ''} · {pr.requesting_department || 'Operations'}
                        {pr.preferred_supplier_name || pr.suggested_supplier
                          ? ` · Supplier: ${pr.preferred_supplier_name || pr.suggested_supplier}`
                          : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                      {formatCurrencyExact(pr.estimated_total_cost)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-amber-800 tabular-nums whitespace-nowrap">
                      {formatCurrencyExact(pr.commitment_amount)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                      {formatCurrencyExact(pr.settled_amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusLabel status={pr.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setInspectPr(pr)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <Eye className="h-3 w-3" /> Details
                        </button>
                        {['draft', 'returned_for_correction'].includes(pr.status) && hasPerm('procurement', 'create') && (
                          <button
                            type="button"
                            onClick={() => openEditPrModal(pr)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                          >
                            <Pencil className="h-3 w-3" /> Edit / Submit
                          </button>
                        )}
                        {['submitted', 'under_review', 'endorsed'].includes(pr.status) && hasPerm('procurement', 'approve') && (
                          <button
                            type="button"
                            onClick={() => openApprovalModal(pr)}
                            className="rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-800"
                          >
                            Review &amp; Approve
                          </button>
                        )}
                        {['approved', 'partially_approved', 'for_procurement'].includes(pr.status) &&
                          hasPerm('procurement', 'edit') && (
                            <button
                              type="button"
                              onClick={() => openPoModal(pr)}
                              className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800"
                            >
                              <ShoppingCart className="h-3 w-3" /> Create PO
                            </button>
                          )}
                        {['ordered', 'partially_delivered'].includes(pr.status) && hasPerm('procurement', 'edit') && (
                          <button
                            type="button"
                            onClick={() => openReceiveModal(pr)}
                            className="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
                          >
                            <Truck className="h-3 w-3" /> Receive Delivery
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Purchase Orders & Physical Deliveries Table */}
      {pos.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <div className="border-b border-slate-200 px-4 py-3 font-display text-sm font-semibold text-slate-900">
            Issued Purchase Orders &amp; Physical Receiving Status ({pos.length})
          </div>
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5">PO #</th>
                <th className="px-4 py-2.5">Supplier</th>
                <th className="px-4 py-2.5">Line Items</th>
                <th className="px-4 py-2.5 text-right">Ordered / Delivered Qty</th>
                <th className="px-4 py-2.5 text-right">Actual PO Total</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pos.map((po) => (
                <tr key={po.id}>
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{po.po_number}</td>
                  <td className="px-4 py-2.5 text-slate-700">{po.supplier_name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{po.items?.length || 1} line item(s)</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {po.ordered_qty} / {po.delivered_qty}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                    {formatCurrencyExact(po.actual_total_cost)}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusLabel status={po.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE / EDIT MULTI-ITEM PR MODAL */}
      {showPrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  {editingPrId ? 'Edit Multi-Item Purchase Request' : 'New Multi-Item Purchase Request'}
                </h2>
                <p className="text-xs text-slate-500">
                  Add multiple materials, supplies, or catalog items under one purchase request with automated totals.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPrModal(false)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {errorMsg && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-700">{errorMsg}</div>
              )}

              {/* Header Details */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                {!projectId && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Project *</label>
                    <select
                      value={prHeader.projectId}
                      onChange={(e) => {
                        const sel = projects.find((p) => String(p.id) === e.target.value);
                        setPrHeader({
                          ...prHeader,
                          projectId: e.target.value,
                          siteLocation: sel?.location || prHeader.siteLocation,
                        });
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                    >
                      <option value="">Select project...</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.ref_number} · {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Request Date</label>
                  <input
                    type="date"
                    value={prHeader.requestDate}
                    onChange={(e) => setPrHeader({ ...prHeader, requestDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Required Delivery Date *</label>
                  <input
                    type="date"
                    required
                    value={prHeader.requiredDate}
                    onChange={(e) => setPrHeader({ ...prHeader, requiredDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Requesting Department</label>
                  <input
                    value={prHeader.requestingDepartment}
                    onChange={(e) => setPrHeader({ ...prHeader, requestingDepartment: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Site Delivery Location</label>
                  <input
                    value={prHeader.siteLocation}
                    onChange={(e) => setPrHeader({ ...prHeader, siteLocation: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Preferred Supplier</label>
                  <select
                    value={prHeader.preferredSupplierId}
                    onChange={(e) => {
                      const s = suppliers.find((sup) => String(sup.id) === e.target.value);
                      setPrHeader({
                        ...prHeader,
                        preferredSupplierId: e.target.value,
                        preferredSupplierName: s ? s.name : prHeader.preferredSupplierName,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="">Custom / Multiple Suppliers</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Purpose / Justification</label>
                  <input
                    value={prHeader.reason}
                    onChange={(e) => setPrHeader({ ...prHeader, reason: e.target.value })}
                    placeholder="e.g., Phase 2 structural concrete & finishing batch..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  />
                </div>
              </div>

              {/* Dynamic Line Items Table */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    Line Items ({prLines.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPrLines((prev) => [...prev, emptyLine()])}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Line Item
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-2.5 py-2 w-8">#</th>
                        <th className="px-2.5 py-2 min-w-[200px]">Item Description &amp; Specs *</th>
                        <th className="px-2.5 py-2 w-24">Code / SKU</th>
                        <th className="px-2.5 py-2 w-28">Category</th>
                        <th className="px-2.5 py-2 w-20 text-right">Qty *</th>
                        <th className="px-2.5 py-2 w-20">Unit</th>
                        <th className="px-2.5 py-2 w-28 text-right">Est. Unit Price</th>
                        <th className="px-2.5 py-2 w-28 text-right">Est. Total</th>
                        <th className="px-2.5 py-2 min-w-[140px]">Pref. Supplier</th>
                        <th className="px-2.5 py-2 w-10 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {prLines.map((line, idx) => {
                        const rowTotal =
                          Number(line.requestedQty || 0) * Number(line.estimatedUnitPrice || 0);
                        return (
                          <tr key={line.key} className="align-top">
                            <td className="px-2.5 py-2 font-mono text-slate-500">{idx + 1}</td>
                            <td className="px-2.5 py-2 space-y-1">
                              <div className="flex gap-1">
                                <input
                                  required
                                  placeholder="Item description..."
                                  value={line.itemDescription}
                                  onChange={(e) =>
                                    setPrLines((prev) =>
                                      prev.map((r) => (r.key === line.key ? { ...r, itemDescription: e.target.value } : r))
                                    )
                                  }
                                  className="flex-1 rounded border border-slate-300 px-2 py-1"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCatalogPickerRowKey(line.key);
                                    setCatalogSearch('');
                                  }}
                                  className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                                  title="Pick from Catalog of Works or Warehouse Inventory"
                                >
                                  Catalog
                                </button>
                              </div>
                              <input
                                placeholder="Specifications / brand / grade..."
                                value={line.specifications}
                                onChange={(e) =>
                                  setPrLines((prev) =>
                                    prev.map((r) => (r.key === line.key ? { ...r, specifications: e.target.value } : r))
                                  )
                                }
                                className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
                              />
                            </td>
                            <td className="px-2.5 py-2">
                              <input
                                placeholder="SKU/Code"
                                value={line.itemCode}
                                onChange={(e) =>
                                  setPrLines((prev) =>
                                    prev.map((r) => (r.key === line.key ? { ...r, itemCode: e.target.value } : r))
                                  )
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                              />
                            </td>
                            <td className="px-2.5 py-2">
                              <select
                                value={line.category}
                                onChange={(e) =>
                                  setPrLines((prev) =>
                                    prev.map((r) => (r.key === line.key ? { ...r, category: e.target.value } : r))
                                  )
                                }
                                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1"
                              >
                                <option value="Materials">Materials</option>
                                <option value="Tools">Tools</option>
                                <option value="Equipment">Equipment</option>
                                <option value="Subcon">Subcon</option>
                                <option value="Consumables">Consumables</option>
                              </select>
                            </td>
                            <td className="px-2.5 py-2">
                              <input
                                type="number"
                                step="any"
                                min="0.001"
                                required
                                value={line.requestedQty}
                                onChange={(e) =>
                                  setPrLines((prev) =>
                                    prev.map((r) => (r.key === line.key ? { ...r, requestedQty: e.target.value } : r))
                                  )
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                              />
                            </td>
                            <td className="px-2.5 py-2">
                              <input
                                value={line.unit}
                                onChange={(e) =>
                                  setPrLines((prev) =>
                                    prev.map((r) => (r.key === line.key ? { ...r, unit: e.target.value } : r))
                                  )
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1"
                              />
                            </td>
                            <td className="px-2.5 py-2">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.estimatedUnitPrice}
                                onChange={(e) =>
                                  setPrLines((prev) =>
                                    prev.map((r) =>
                                      r.key === line.key ? { ...r, estimatedUnitPrice: e.target.value } : r
                                    )
                                  )
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                              />
                            </td>
                            <td className="px-2.5 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                              {formatCurrencyExact(Number.isFinite(rowTotal) ? rowTotal : 0)}
                            </td>
                            <td className="px-2.5 py-2 space-y-1">
                              <input
                                placeholder="Preferred supplier..."
                                value={line.preferredSupplierName}
                                onChange={(e) =>
                                  setPrLines((prev) =>
                                    prev.map((r) =>
                                      r.key === line.key ? { ...r, preferredSupplierName: e.target.value } : r
                                    )
                                  )
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1"
                              />
                              <input
                                placeholder="Line remarks..."
                                value={line.remarks}
                                onChange={(e) =>
                                  setPrLines((prev) =>
                                    prev.map((r) => (r.key === line.key ? { ...r, remarks: e.target.value } : r))
                                  )
                                }
                                className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
                              />
                            </td>
                            <td className="px-2.5 py-2 text-right">
                              {prLines.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setPrLines((prev) => prev.filter((r) => r.key !== line.key))}
                                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                  title="Remove line item"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                      <tr>
                        <td colSpan={7} className="px-3 py-2.5 text-right text-slate-700">
                          Estimated Grand Total ({prLines.length} line item{prLines.length > 1 ? 's' : ''}):
                        </td>
                        <td className="px-2.5 py-2.5 text-right font-mono text-sm font-bold text-slate-900 tabular-nums">
                          {formatCurrencyExact(grandEstimatedTotal)}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">General Request Remarks</label>
                  <textarea
                    rows={3}
                    value={prHeader.remarks}
                    onChange={(e) => setPrHeader({ ...prHeader, remarks: e.target.value })}
                    placeholder="Delivery instructions, site receiver contact, staging instructions..."
                    className="w-full rounded-lg border border-slate-300 p-2.5"
                  />
                </div>
                <EvidenceFilePicker
                  label="PR Specifications / Supporting Documents"
                  items={prAttachments}
                  onChange={setPrAttachments}
                  defaultCategory="PR Specification / Attachment"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5 text-xs">
              <div className="text-slate-600">
                Submitting a PR does <strong>not</strong> modify warehouse stock until physical goods are received.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPrModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingPr}
                  onClick={() => handleSavePr(true)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  disabled={savingPr}
                  onClick={() => handleSavePr(false)}
                  className="rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingPr ? 'Saving...' : 'Submit Purchase Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CATALOG / WAREHOUSE ITEM PICKER POPOVER MODAL */}
      {catalogPickerRowKey && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Select Item from Catalog of Works or Warehouse Master
              </h3>
              <button
                type="button"
                onClick={() => setCatalogPickerRowKey(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-slate-100 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  autoFocus
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search catalog name, SKU, or warehouse stock item..."
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {filteredInventory.length > 0 && (
                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-700">Warehouse Inventory Items (Auto-syncs Stock on Receipt)</div>
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {filteredInventory.map((inv) => (
                      <div key={`inv-${inv.id}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50">
                        <div>
                          <div className="font-medium text-slate-900">
                            <span className="font-mono text-slate-500 mr-1.5">{inv.sku}</span>
                            {inv.name}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {inv.category} · On Hand: {inv.current_qty} {inv.unit} · Cost:{' '}
                            {formatCurrencyExact(inv.unit_cost)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            applyCatalogSelection(catalogPickerRowKey, {
                              inventoryItemId: inv.id,
                              itemCode: inv.sku,
                              itemDescription: inv.name,
                              category: inv.category || 'Materials',
                              unit: inv.unit || 'pcs',
                              unitPrice: Number(inv.unit_cost || 0),
                              supplierName: inv.preferred_supplier || '',
                            })
                          }
                          className="rounded bg-slate-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                        >
                          Select
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700">Catalog of Works &amp; Supplier Price Comparison</div>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {filteredCatalog.length === 0 ? (
                    <div className="p-4 text-center text-slate-500">No catalog items matched.</div>
                  ) : (
                    filteredCatalog.map((ci) => (
                      <div key={`cat-${ci.id}`} className="px-3 py-2.5 space-y-1.5 hover:bg-slate-50">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-slate-900">
                              <span className="font-mono text-slate-500 mr-1.5">{ci.item_code}</span>
                              {ci.name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {ci.category} · {ci.unit} · Base Cost:{' '}
                              {formatCurrencyExact(ci.mat_unit_cost || ci.effective_mat_rate || 0)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              applyCatalogSelection(catalogPickerRowKey, {
                                catalogItemId: ci.id,
                                itemCode: ci.item_code,
                                itemDescription: ci.name,
                                specifications: ci.specification || ci.description || '',
                                category: ci.category || 'Materials',
                                unit: ci.unit || 'pcs',
                                unitPrice: Number(ci.mat_unit_cost || ci.lbr_unit_cost || 0),
                              })
                            }
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-900 hover:text-white whitespace-nowrap"
                          >
                            Use Base Cost
                          </button>
                        </div>
                        {Array.isArray(ci.supplier_prices) && ci.supplier_prices.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {ci.supplier_prices.map((sp: any) => (
                              <button
                                key={sp.id}
                                type="button"
                                onClick={() =>
                                  applyCatalogSelection(catalogPickerRowKey, {
                                    catalogItemId: ci.id,
                                    itemCode: ci.item_code,
                                    itemDescription: ci.name,
                                    specifications: [ci.specification, sp.brand].filter(Boolean).join(' · '),
                                    category: ci.category || 'Materials',
                                    unit: sp.unit || ci.unit || 'pcs',
                                    unitPrice: Number(sp.unit_price || 0),
                                    supplierId: sp.supplier_id,
                                    supplierName: sp.supplier_name,
                                  })
                                }
                                className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-950 hover:bg-amber-100"
                              >
                                {sp.supplier_name}:{' '}
                                <strong className="font-mono">{formatCurrencyExact(sp.unit_price)}</strong>
                                {sp.is_preferred ? ' (Pref)' : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PR DETAILS & FULL TRACEABILITY MODAL */}
      {inspectPr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-900">{inspectPr.ref_number}</span>
                  <span>·</span>
                  <span>{inspectPr.project_name}</span>
                  <span>·</span>
                  <StatusLabel status={inspectPr.status} />
                </div>
                <h2 className="mt-0.5 font-display text-base font-bold text-slate-900">{inspectPr.item_description}</h2>
              </div>
              <button
                type="button"
                onClick={() => setInspectPr(null)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
                <div>
                  <div className="text-[11px] text-slate-500">Estimated Total</div>
                  <div className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                    {formatCurrencyExact(inspectPr.estimated_total_cost)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Approved Commitment</div>
                  <div className="font-mono text-sm font-bold text-amber-800 tabular-nums">
                    {formatCurrencyExact(inspectPr.commitment_amount)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Settled Expenditure</div>
                  <div className="font-mono text-sm font-bold text-emerald-700 tabular-nums">
                    {formatCurrencyExact(inspectPr.settled_amount)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Delivery Location &amp; Date</div>
                  <div className="font-medium text-slate-900">{inspectPr.site_location || inspectPr.project_location}</div>
                  <div className="font-mono text-[11px] text-slate-500">Required: {inspectPr.required_date}</div>
                </div>
              </div>

              {/* Line Items Breakdown */}
              <div className="space-y-2">
                <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <ClipboardList className="h-4 w-4 text-slate-500" />
                  PR Line Items ({inspectPr.items?.length || 0})
                </h3>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Code / Item</th>
                        <th className="px-3 py-2 text-right">Requested Qty</th>
                        <th className="px-3 py-2 text-right">Approved Qty</th>
                        <th className="px-3 py-2 text-right">Ordered / Delivered</th>
                        <th className="px-3 py-2 text-right">Est. Unit Price</th>
                        <th className="px-3 py-2 text-right">Est. Total</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(inspectPr.items || []).map((it: any) => (
                        <tr key={it.id}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-900">
                              {it.item_code ? <span className="font-mono text-slate-500 mr-1">{it.item_code}</span> : null}
                              {it.item_description}
                            </div>
                            {it.specifications && <div className="text-[11px] text-slate-500">{it.specifications}</div>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {it.requested_qty} {it.unit}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                            {it.approved_qty} {it.unit}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {it.ordered_qty} / {it.delivered_qty}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatCurrencyExact(it.estimated_unit_price)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                            {formatCurrencyExact(it.estimated_total)}
                          </td>
                          <td className="px-3 py-2">
                            <StatusLabel status={it.item_status || 'pending'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Warehouse Receiving Traceability */}
              {(inspectPr.receipts || []).length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <PackageCheck className="h-4 w-4 text-emerald-700" />
                    Physical Deliveries &amp; Warehouse Stock Updates ({inspectPr.receipts.length})
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">DR / Invoice</th>
                          <th className="px-3 py-2 text-right">Delivered / Accepted</th>
                          <th className="px-3 py-2 text-right">Actual Cost</th>
                          <th className="px-3 py-2">Warehouse Item</th>
                          <th className="px-3 py-2">Received By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {inspectPr.receipts.map((rec: any) => (
                          <tr key={rec.id}>
                            <td className="px-3 py-2 font-mono">{rec.delivery_date}</td>
                            <td className="px-3 py-2 font-mono">
                              {rec.dr_number || '—'} {rec.invoice_number ? `/ INV:${rec.invoice_number}` : ''}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {rec.delivered_qty} / <strong>{rec.accepted_qty}</strong>
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {formatCurrencyExact(rec.actual_total_cost)}
                            </td>
                            <td className="px-3 py-2">
                              {rec.added_to_warehouse ? (
                                <span className="text-emerald-700 font-medium">
                                  Added to Stock ({rec.warehouse_sku || rec.warehouse_item_name})
                                </span>
                              ) : (
                                <span className="text-slate-500">Direct site delivery</span>
                              )}
                            </td>
                            <td className="px-3 py-2">{rec.received_by_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Protected Attachments */}
              {(inspectPr.attachments || []).length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    Supporting Documents &amp; Delivery Receipts ({inspectPr.attachments.length})
                  </h3>
                  <ProtectedAttachmentGallery attachments={inspectPr.attachments} />
                </div>
              )}

              {/* Approval Audit Trail */}
              {(inspectPr.approvals || []).length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900">Workflow Audit Log</h3>
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {inspectPr.approvals.map((ap: any) => (
                      <div key={ap.id} className="flex items-center justify-between px-3.5 py-2">
                        <div>
                          <span className="font-semibold text-slate-900">{ap.approver_name}</span>{' '}
                          <span className="text-slate-500">({ap.stage})</span>
                          {ap.remarks ? ` · ${ap.remarks}` : ''}
                        </div>
                        <div className="text-right">
                          <StatusLabel status={ap.decision} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PR PARTIAL / FULL APPROVAL MODAL */}
      {approvalPr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="font-mono text-xs text-slate-500">
                  {approvalPr.ref_number} · Requested by {approvalPr.requested_by_name}
                </div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Approve, Partially Approve, or Return Purchase Request
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setApprovalPr(null)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {errorMsg && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-red-700">{errorMsg}</div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Requested Qty (Preserved)</th>
                      <th className="px-3 py-2">Line Decision</th>
                      <th className="px-3 py-2 text-right">Approved Qty</th>
                      <th className="px-3 py-2 text-right">Approved Total</th>
                      <th className="px-3 py-2">Item Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(approvalPr.items || []).map((it: any) => {
                      const dec = itemDecisions[it.id] || {
                        status: 'approved',
                        approvedQty: String(it.requested_qty),
                        remarks: '',
                      };
                      const appTotal =
                        dec.status === 'rejected' || dec.status === 'returned'
                          ? 0
                          : Number(dec.approvedQty || 0) * Number(it.estimated_unit_price || 0);
                      return (
                        <tr key={it.id}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-900">{it.item_description}</div>
                            <div className="text-[11px] text-slate-500">
                              Unit Est: {formatCurrencyExact(it.estimated_unit_price)} / {it.unit}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-700 tabular-nums">
                            {it.requested_qty} {it.unit}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={dec.status}
                              onChange={(e) => {
                                const st = e.target.value as any;
                                setItemDecisions((prev) => ({
                                  ...prev,
                                  [it.id]: {
                                    ...dec,
                                    status: st,
                                    approvedQty:
                                      st === 'rejected' || st === 'returned'
                                        ? '0'
                                        : st === 'approved'
                                        ? String(it.requested_qty)
                                        : dec.approvedQty,
                                  },
                                }));
                              }}
                              className="rounded border border-slate-300 bg-white px-2 py-1"
                            >
                              <option value="approved">Approve Full</option>
                              <option value="partially_approved">Partial Qty</option>
                              <option value="rejected">Reject Line</option>
                              <option value="returned">Return Line</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              max={it.requested_qty}
                              disabled={dec.status === 'rejected' || dec.status === 'returned'}
                              value={dec.approvedQty}
                              onChange={(e) =>
                                setItemDecisions((prev) => ({
                                  ...prev,
                                  [it.id]: { ...dec, approvedQty: e.target.value },
                                }))
                              }
                              className="w-20 rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums disabled:bg-slate-100"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums">
                            {formatCurrencyExact(appTotal)}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={dec.remarks}
                              onChange={(e) =>
                                setItemDecisions((prev) => ({
                                  ...prev,
                                  [it.id]: { ...dec, remarks: e.target.value },
                                }))
                              }
                              placeholder="Optional note..."
                              className="w-full rounded border border-slate-200 px-2 py-1"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Approver Remarks (required if rejecting or returning PR)
                </label>
                <textarea
                  rows={2}
                  value={approvalRemarks}
                  onChange={(e) => setApprovalRemarks(e.target.value)}
                  placeholder="Approval conditions, budget authorization note, or correction instructions..."
                  className="w-full rounded-lg border border-slate-300 p-2.5"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5 text-xs">
              <button
                type="button"
                disabled={submittingApproval}
                onClick={() => handleSubmitApproval('return')}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                Return for Correction
              </button>
              <button
                type="button"
                disabled={submittingApproval}
                onClick={() => handleSubmitApproval('reject_all')}
                className="rounded-lg border border-red-300 bg-white px-3.5 py-2 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Reject Entire PR
              </button>
              <button
                type="button"
                disabled={submittingApproval}
                onClick={() => handleSubmitApproval('per_item')}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
              >
                Save Per-Item Decisions
              </button>
              <button
                type="button"
                disabled={submittingApproval}
                onClick={() => handleSubmitApproval('approve_all')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve All Requested
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE PURCHASE ORDER MODAL */}
      {poModalPr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleCreatePo}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="font-mono text-xs text-slate-500">{poModalPr.ref_number}</div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Assign Supplier &amp; Issue Purchase Order
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPoModalPr(null)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {errorMsg && <div className="rounded-lg bg-red-50 p-2.5 text-red-700">{errorMsg}</div>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Primary Supplier (Master List)</label>
                  <select
                    value={poSupplierId}
                    onChange={(e) => {
                      const s = suppliers.find((sup) => String(sup.id) === e.target.value);
                      setPoSupplierId(e.target.value);
                      if (s) setPoSupplierName(s.name);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="">Custom Supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Supplier Name *</label>
                  <input
                    required
                    value={poSupplierName}
                    onChange={(e) => setPoSupplierName(e.target.value)}
                    placeholder="Supplier company name..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Approved Item</th>
                      <th className="px-3 py-2 text-right">Approved Qty</th>
                      <th className="px-3 py-2 text-right">Order Qty</th>
                      <th className="px-3 py-2 text-right">Actual PO Unit Price</th>
                      <th className="px-3 py-2 text-right">Line PO Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {poLines.map((l, idx) => (
                      <tr key={l.prItemId}>
                        <td className="px-3 py-2 font-medium text-slate-900">{l.itemDescription}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {l.approvedQty} {l.unit}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            step="any"
                            min="0.001"
                            max={l.approvedQty}
                            value={l.orderedQty}
                            onChange={(e) =>
                              setPoLines((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, orderedQty: e.target.value } : r))
                              )
                            }
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={l.actualUnitPrice}
                            onChange={(e) =>
                              setPoLines((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, actualUnitPrice: e.target.value } : r))
                              )
                            }
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {formatCurrencyExact(Number(l.orderedQty || 0) * Number(l.actualUnitPrice || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">PO Terms &amp; Remarks</label>
                <input
                  value={poRemarks}
                  onChange={(e) => setPoRemarks(e.target.value)}
                  placeholder="Delivery schedule, payment terms..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5 text-xs">
              <button
                type="button"
                onClick={() => setPoModalPr(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingPo}
                className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {submittingPo ? 'Issuing PO...' : 'Issue Purchase Order'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* RECEIVE DELIVERY & WAREHOUSE STOCK UPDATE MODAL */}
      {receivePr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleConfirmReceiving}
            className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="font-mono text-xs text-slate-500">{receivePr.ref_number}</div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Receive Delivery &amp; Update Warehouse Stock
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setReceivePr(null)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {errorMsg && <div className="rounded-lg bg-red-50 p-2.5 text-red-700">{errorMsg}</div>}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Delivery Date *</label>
                  <input
                    type="date"
                    required
                    value={receiveMeta.deliveryDate}
                    onChange={(e) => setReceiveMeta({ ...receiveMeta, deliveryDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">DR Number</label>
                  <input
                    value={receiveMeta.drNumber}
                    onChange={(e) => setReceiveMeta({ ...receiveMeta, drNumber: e.target.value })}
                    placeholder="DR-2026-..."
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Supplier Invoice #</label>
                  <input
                    value={receiveMeta.invoiceNumber}
                    onChange={(e) => setReceiveMeta({ ...receiveMeta, invoiceNumber: e.target.value })}
                    placeholder="INV-..."
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 cursor-pointer w-full">
                    <input
                      type="checkbox"
                      checked={receiveMeta.recordExpense}
                      onChange={(e) => setReceiveMeta({ ...receiveMeta, recordExpense: e.target.checked })}
                    />
                    <span>Settle Financial Expense Record</span>
                  </label>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Approved / Prev</th>
                      <th className="px-3 py-2 text-right">Delivered Qty</th>
                      <th className="px-3 py-2 text-right">Accepted Qty</th>
                      <th className="px-3 py-2 text-right">Actual Unit Cost</th>
                      <th className="px-3 py-2">Warehouse Stock Link</th>
                      <th className="px-3 py-2">Discrepancy Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receiveLines.map((l, idx) => (
                      <tr key={l.prItemId}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{l.itemDescription}</div>
                          {l.itemCode && <div className="font-mono text-[11px] text-slate-500">{l.itemCode}</div>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {l.approvedQty} / {l.previouslyDelivered} {l.unit}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={l.deliveredQty}
                            onChange={(e) =>
                              setReceiveLines((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, deliveredQty: e.target.value, acceptedQty: e.target.value } : r
                                )
                              )
                            }
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            max={l.deliveredQty}
                            value={l.acceptedQty}
                            onChange={(e) =>
                              setReceiveLines((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, acceptedQty: e.target.value } : r))
                              )
                            }
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={l.actualUnitCost}
                            onChange={(e) =>
                              setReceiveLines((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, actualUnitCost: e.target.value } : r))
                              )
                            }
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 space-y-1">
                          <select
                            value={l.inventoryItemId}
                            onChange={(e) =>
                              setReceiveLines((prev) =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? { ...r, inventoryItemId: e.target.value, addToWarehouse: Boolean(e.target.value) }
                                    : r
                                )
                              )
                            }
                            className="w-44 rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                          >
                            <option value="">Direct site (do not stock)</option>
                            {inventoryItems.map((inv) => (
                              <option key={inv.id} value={inv.id}>
                                {inv.sku} · {inv.name}
                              </option>
                            ))}
                          </select>
                          {l.inventoryItemId && (
                            <label className="flex items-center gap-1 text-[11px] text-emerald-700">
                              <input
                                type="checkbox"
                                checked={l.addToWarehouse}
                                onChange={(e) =>
                                  setReceiveLines((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, addToWarehouse: e.target.checked } : r))
                                  )
                                }
                              />
                              Add accepted qty to stock
                            </label>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={l.discrepancyNotes}
                            onChange={(e) =>
                              setReceiveLines((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, discrepancyNotes: e.target.value } : r))
                              )
                            }
                            placeholder="Shortage/damage note..."
                            className="w-full rounded border border-slate-200 px-2 py-1 text-[11px]"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <EvidenceFilePicker
                label="Delivery Receipt / Supplier Invoice Evidence"
                helperText="Upload DR scan, signed receiving slip, or supplier invoice."
                items={receiveDocs}
                onChange={setReceiveDocs}
                defaultCategory="Delivery Receipt / Invoice"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5 text-xs">
              <button
                type="button"
                onClick={() => setReceivePr(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingReceive}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                <PackageCheck className="h-4 w-4" />
                {submittingReceive ? 'Recording Receipt...' : 'Confirm Physical Receiving'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
