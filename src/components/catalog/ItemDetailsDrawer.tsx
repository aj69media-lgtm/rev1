import React, { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
  FileText,
  Layers,
  Paperclip,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest, formatDate, formatMoney } from '../../lib/api';
import {
  CatalogCategory,
  CatalogPermissions,
  CatalogSupplier,
  CatalogUnit,
  downloadProtectedEndpoint,
  formatBytes,
} from './CatalogTypes';

interface ItemDetailsDrawerProps {
  itemId: number | null;
  categories: CatalogCategory[];
  units: CatalogUnit[];
  suppliers: CatalogSupplier[];
  permissions: CatalogPermissions;
  onClose: () => void;
  onMutated: () => void;
  onOpenEditModal: (item: any) => void;
  onSuppliersUpdated: () => void;
}

export const ItemDetailsDrawer: React.FC<ItemDetailsDrawerProps> = ({
  itemId,
  units,
  suppliers,
  permissions,
  onClose,
  onMutated,
  onOpenEditModal,
  onSuppliersUpdated,
}) => {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<{
    item: any;
    supplierPrices: any[];
    priceHistory: any[];
    attachments: any[];
    usedInAssemblies: any[];
    canViewInternalCosting: boolean;
  } | null>(null);

  // Add Supplier Price form
  const [showPriceForm, setShowPriceForm] = useState(false);
  const [spSupplierId, setSpSupplierId] = useState<string>('');
  const [spBrand, setSpBrand] = useState('');
  const [spRef, setSpRef] = useState('');
  const [spUnit, setSpUnit] = useState('');
  const [spPrice, setSpPrice] = useState('');
  const [spEffective, setSpEffective] = useState(() => new Date().toISOString().slice(0, 10));
  const [spValidUntil, setSpValidUntil] = useState('');
  const [spPreferred, setSpPreferred] = useState(false);
  const [spSyncDefault, setSpSyncDefault] = useState(false);
  const [spRemarks, setSpRemarks] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  // Quick New Supplier form
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupName, setNewSupName] = useState('');
  const [newSupContact, setNewSupContact] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupTerms, setNewSupTerms] = useState('30 Days');
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Attachment upload
  const [uploading, setUploading] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    setErr('');
    try {
      const data = await apiRequest(`/api/catalog/items/${itemId}`);
      setDetail(data);
      setSpUnit(data.item?.default_unit || 'pcs');
    } catch (e: any) {
      setErr(e?.message || 'Unable to load item details');
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    if (itemId) {
      loadDetail();
      setNotice('');
      setShowPriceForm(false);
    } else {
      setDetail(null);
    }
  }, [itemId, loadDetail]);

  if (!itemId) return null;

  const item = detail?.item;
  const showCost = Boolean(detail?.canViewInternalCosting && permissions.viewInternalCosting);

  const handleDuplicate = async () => {
    if (!item) return;
    setErr('');
    try {
      const res = await apiRequest(`/api/catalog/items/${item.id}/duplicate`, { method: 'POST' });
      setNotice(`Duplicated as ${res.itemCode}.`);
      onMutated();
    } catch (e: any) {
      setErr(e?.message || 'Duplicate failed');
    }
  };

  const handleArchiveToggle = async () => {
    if (!item) return;
    setErr('');
    try {
      const action = item.is_active ? 'archive' : 'restore';
      await apiRequest(`/api/catalog/items/${item.id}/${action}`, { method: 'POST' });
      setNotice(item.is_active ? 'Item archived (historical quotations preserved).' : 'Item restored to active catalog.');
      await loadDetail();
      onMutated();
    } catch (e: any) {
      setErr(e?.message || 'Status change failed');
    }
  };

  const handleAddSupplierPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setErr('');
    setSavingPrice(true);
    try {
      await apiRequest(`/api/catalog/items/${item.id}/supplier-prices`, {
        method: 'POST',
        body: {
          supplierId: Number(spSupplierId),
          brand: spBrand,
          supplierItemRef: spRef,
          unit: spUnit || item.default_unit,
          unitPrice: Number(spPrice),
          effectiveDate: spEffective,
          validUntil: spValidUntil || null,
          isPreferred: spPreferred,
          syncDefaultItemCost: spSyncDefault,
          remarks: spRemarks,
        },
      });
      setShowPriceForm(false);
      setSpPrice('');
      setSpBrand('');
      setSpRef('');
      setSpRemarks('');
      setNotice('New supplier price recorded. Previous prices remain preserved in history.');
      await loadDetail();
      onMutated();
    } catch (e: any) {
      setErr(e?.message || 'Failed to record supplier price');
    } finally {
      setSavingPrice(false);
    }
  };

  const handleSetPreferredPrice = async (priceId: number) => {
    setErr('');
    try {
      await apiRequest(`/api/catalog/supplier-prices/${priceId}/toggle`, {
        method: 'PATCH',
        body: { isPreferred: true },
      });
      setNotice('Preferred supplier updated.');
      await loadDetail();
      onMutated();
    } catch (e: any) {
      setErr(e?.message || 'Failed to update preferred supplier');
    }
  };

  const handleCreateQuickSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setSavingSupplier(true);
    try {
      const created = await apiRequest('/api/catalog/suppliers', {
        method: 'POST',
        body: {
          name: newSupName,
          contactPerson: newSupContact,
          phone: newSupPhone,
          paymentTerms: newSupTerms,
        },
      });
      setShowNewSupplier(false);
      setNewSupName('');
      setNewSupContact('');
      setNewSupPhone('');
      setSpSupplierId(String(created.id));
      onSuppliersUpdated();
      setNotice(`Supplier ${created.supplierCode} added.`);
    } catch (e: any) {
      setErr(e?.message || 'Failed to add supplier');
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !item) return;
    setUploading(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiRequest(`/api/catalog/attachments/catalog_item/${item.id}`, {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      setNotice(`Uploaded "${file.name}" into protected storage.`);
      await loadDetail();
      onMutated();
    } catch (e: any) {
      setErr(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAttachment = async (attId: number) => {
    setErr('');
    try {
      await apiRequest(`/api/catalog/attachments/${attId}`, { method: 'DELETE' });
      await loadDetail();
      onMutated();
    } catch (e: any) {
      setErr(e?.message || 'Delete failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl border-l border-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
              <span className="font-mono font-medium text-slate-700">{item?.item_code || '...'}</span>
              <span>·</span>
              <span>{item?.category}</span>
              <span>·</span>
              <span>{item?.item_type}</span>
              <span>·</span>
              <span className={item?.is_active ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                {item?.is_active ? 'Active' : 'Archived'}
              </span>
            </div>
            <h2 className="mt-1 font-display text-lg font-bold text-slate-900 truncate">
              {item?.name || 'Loading catalog item...'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            aria-label="Close details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Action Bar */}
        {item && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-2.5 text-xs">
            {permissions.editItem && (
              <button
                type="button"
                onClick={() => onOpenEditModal(item)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100"
              >
                Edit Item
              </button>
            )}
            {permissions.createItem && (
              <button
                type="button"
                onClick={handleDuplicate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                <Copy className="h-3.5 w-3.5" />
                Duplicate
              </button>
            )}
            {item.is_active ? (
              permissions.archiveRecord && (
                <button
                  type="button"
                  onClick={handleArchiveToggle}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-800 hover:bg-amber-50"
                >
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </button>
              )
            ) : (
              permissions.restoreRecord && (
                <button
                  type="button"
                  onClick={handleArchiveToggle}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 font-medium text-emerald-800 hover:bg-emerald-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore
                </button>
              )
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-xs">
          {err && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-rose-800">
              {err}
            </div>
          )}
          {notice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-emerald-800">
              {notice}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-slate-500">Loading item record...</div>
          ) : item ? (
            <>
              {/* Specifications & Pricing Overview */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Unit &amp; Specification
                  </div>
                  <div className="mt-1.5 text-slate-800 font-medium">
                    Default Unit: <span className="font-mono">{item.default_unit}</span>
                  </div>
                  <div className="mt-1 text-slate-600">
                    {item.specification || 'No standard specification recorded.'}
                  </div>
                  {item.description && item.description !== item.name && (
                    <div className="mt-2 text-slate-500">{item.description}</div>
                  )}
                  {item.remarks && (
                    <div className="mt-2 text-slate-500">Remarks: {item.remarks}</div>
                  )}
                </div>

                <div className="space-y-1.5 tabular-nums">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {showCost ? 'Internal Cost & Client Rates' : 'Client Selling Rates'}
                  </div>
                  {showCost ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Material Unit Cost:</span>
                        <span className="font-semibold text-slate-900">
                          {formatMoney(item.mat_unit_cost || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Labor Unit Cost:</span>
                        <span className="font-semibold text-slate-900">
                          {formatMoney(item.lbr_unit_cost || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Default GP (Mat / Lbr):</span>
                        <span className="text-slate-700">
                          {Math.round(Number(item.default_mat_gp_pct || 0) * 100)}% /{' '}
                          {Math.round(Number(item.default_lbr_gp_pct || 0) * 100)}%
                        </span>
                      </div>
                    </>
                  ) : null}
                  <div className="flex justify-between border-t border-slate-100 pt-1.5">
                    <span className="text-slate-600">Mat Selling Rate:</span>
                    <span className="font-medium text-slate-900">{formatMoney(item.mat_sell_rate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Lbr Selling Rate:</span>
                    <span className="font-medium text-slate-900">{formatMoney(item.lbr_sell_rate)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-1.5">
                    <span className="font-semibold text-slate-800">Combined Selling Rate:</span>
                    <span className="font-bold text-slate-900">{formatMoney(item.combined_sell_rate)}</span>
                  </div>
                </div>
              </div>

              {/* Suppliers & Historical Purchase Prices */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Supplier Associations &amp; Price Records
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {showCost
                        ? 'Historical prices are never overwritten; updating a supplier records a dated entry.'
                        : 'Approved supplier references for this item.'}
                    </p>
                  </div>
                  {showCost && permissions.manageSupplierPrices && (
                    <button
                      type="button"
                      onClick={() => setShowPriceForm((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Record Supplier Price
                    </button>
                  )}
                </div>

                {showCost && showPriceForm && (
                  <form
                    onSubmit={handleAddSupplierPrice}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">New Supplier Price Entry</span>
                      {permissions.manageSuppliers && (
                        <button
                          type="button"
                          onClick={() => setShowNewSupplier((v) => !v)}
                          className="text-amber-700 hover:underline font-medium"
                        >
                          + Quick Add Supplier
                        </button>
                      )}
                    </div>

                    {showNewSupplier && (
                      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                        <div className="font-semibold text-slate-800">Quick Add Master Supplier</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            placeholder="Supplier Name *"
                            value={newSupName}
                            onChange={(e) => setNewSupName(e.target.value)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5"
                          />
                          <input
                            type="text"
                            placeholder="Contact Person"
                            value={newSupContact}
                            onChange={(e) => setNewSupContact(e.target.value)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5"
                          />
                          <input
                            type="text"
                            placeholder="Phone"
                            value={newSupPhone}
                            onChange={(e) => setNewSupPhone(e.target.value)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5"
                          />
                          <input
                            type="text"
                            placeholder="Payment Terms (e.g. 30 Days)"
                            value={newSupTerms}
                            onChange={(e) => setNewSupTerms(e.target.value)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowNewSupplier(false)}
                            className="rounded border border-slate-300 px-2.5 py-1 text-slate-600"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={!newSupName.trim() || savingSupplier}
                            onClick={handleCreateQuickSupplier}
                            className="rounded bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                          >
                            {savingSupplier ? 'Saving...' : 'Save Supplier'}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Supplier *</label>
                        <select
                          required
                          value={spSupplierId}
                          onChange={(e) => setSpSupplierId(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                        >
                          <option value="">Select supplier...</option>
                          {suppliers
                            .filter((s) => s.is_active)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.supplier_code})
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Unit Purchase Price *</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={spPrice}
                          onChange={(e) => setSpPrice(e.target.value)}
                          placeholder="0.00"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Brand / Grade</label>
                        <input
                          type="text"
                          value={spBrand}
                          onChange={(e) => setSpBrand(e.target.value)}
                          placeholder="e.g. Holcim, Eagle"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block font-medium text-slate-700 mb-1">Unit</label>
                          <select
                            value={spUnit}
                            onChange={(e) => setSpUnit(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                          >
                            {units.map((u) => (
                              <option key={u.id} value={u.code}>
                                {u.code}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block font-medium text-slate-700 mb-1">Supplier SKU</label>
                          <input
                            type="text"
                            value={spRef}
                            onChange={(e) => setSpRef(e.target.value)}
                            placeholder="Ref #"
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Effective Date</label>
                        <input
                          type="date"
                          value={spEffective}
                          onChange={(e) => setSpEffective(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Valid Until (Optional)</label>
                        <input
                          type="date"
                          value={spValidUntil}
                          onChange={(e) => setSpValidUntil(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Remarks / Quote Ref</label>
                      <input
                        type="text"
                        value={spRemarks}
                        onChange={(e) => setSpRemarks(e.target.value)}
                        placeholder="Supplier quote # or delivery terms"
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      <label className="inline-flex items-center gap-2 text-slate-700">
                        <input
                          type="checkbox"
                          checked={spPreferred}
                          onChange={(e) => setSpPreferred(e.target.checked)}
                        />
                        Mark as Preferred Supplier
                      </label>
                      <label className="inline-flex items-center gap-2 text-slate-700">
                        <input
                          type="checkbox"
                          checked={spSyncDefault}
                          onChange={(e) => setSpSyncDefault(e.target.checked)}
                        />
                        Sync default catalog material cost to this price
                      </label>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowPriceForm(false)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingPrice}
                        className="rounded-lg bg-slate-900 px-4 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {savingPrice ? 'Recording...' : 'Save Supplier Price'}
                      </button>
                    </div>
                  </form>
                )}

                <div className="overflow-hidden rounded-xl border border-slate-200">
                  {detail?.supplierPrices.length === 0 ? (
                    <div className="p-4 text-center text-slate-500">
                      No supplier price records linked to this catalog item yet.
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Supplier</th>
                          <th className="px-3 py-2">Brand / Spec</th>
                          {showCost && <th className="px-3 py-2 text-right">Purchase Price</th>}
                          <th className="px-3 py-2">Effective</th>
                          <th className="px-3 py-2">State</th>
                          {showCost && permissions.manageSupplierPrices && <th className="px-3 py-2 text-right">Action</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detail?.supplierPrices.map((sp) => (
                          <tr key={sp.id} className={sp.is_active ? 'bg-white' : 'bg-slate-50/60 text-slate-400'}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-900">{sp.supplier_name}</div>
                              <div className="text-[11px] text-slate-500">{sp.supplier_code}</div>
                            </td>
                            <td className="px-3 py-2">
                              <div>{sp.brand || 'Standard'}</div>
                              {sp.remarks && <div className="text-[11px] text-slate-400">{sp.remarks}</div>}
                            </td>
                            {showCost && (
                              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                                {formatMoney(sp.unit_price)} / {sp.unit}
                              </td>
                            )}
                            <td className="px-3 py-2 tabular-nums">
                              {formatDate(sp.effective_date)}
                            </td>
                            <td className="px-3 py-2">
                              {sp.is_preferred ? (
                                <span className="font-semibold text-emerald-700">Preferred</span>
                              ) : sp.is_active ? (
                                <span className="text-slate-600">Current</span>
                              ) : (
                                <span className="text-slate-400">Historical</span>
                              )}
                            </td>
                            {showCost && permissions.manageSupplierPrices && (
                              <td className="px-3 py-2 text-right">
                                {sp.is_active && !sp.is_preferred ? (
                                  <button
                                    type="button"
                                    onClick={() => handleSetPreferredPrice(sp.id)}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline"
                                  >
                                    <Check className="h-3 w-3" />
                                    Set Preferred
                                  </button>
                                ) : null}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Used In Sets of Works */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-slate-500" />
                  Referenced in Sets of Works ({detail?.usedInAssemblies.length || 0})
                </h3>
                {detail?.usedInAssemblies.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 p-3 text-slate-500">
                    Not yet linked to any Set of Works template.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {detail?.usedInAssemblies.map((asm) => (
                      <div key={asm.id} className="flex items-center justify-between px-3.5 py-2.5">
                        <div>
                          <span className="font-mono font-medium text-slate-700">{asm.assembly_code}</span>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span className="font-medium text-slate-900">{asm.name}</span>
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {asm.category_name} · v{asm.current_version}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Protected Attachments */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <Paperclip className="h-4 w-4 text-slate-500" />
                    Protected Technical Sheets &amp; Files
                  </h3>
                  {(permissions.editItem || permissions.createItem) && (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
                      <Upload className="h-3.5 w-3.5" />
                      {uploading ? 'Uploading...' : 'Attach File'}
                      <input
                        type="file"
                        className="hidden"
                        disabled={uploading}
                        onChange={handleFileUpload}
                        accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.csv,.docx"
                      />
                    </label>
                  )}
                </div>
                {detail?.attachments.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 p-3 text-slate-500">
                    No files attached. Stored privately outside public web directories.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {detail?.attachments.map((att) => (
                      <div key={att.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <div className="min-w-0 flex items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-800">{att.file_name}</div>
                            <div className="text-[11px] text-slate-400">
                              {formatBytes(att.file_size)} · Uploaded by {att.uploaded_by_name || 'Staff'} ·{' '}
                              {formatDate(att.created_at)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              downloadProtectedEndpoint(
                                `/api/catalog/attachments/${att.id}/download`,
                                att.file_name
                              ).catch((e) => setErr(e.message))
                            }
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-slate-700 hover:bg-slate-50"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </button>
                          {permissions.editItem && !att.is_locked && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAttachment(att.id)}
                              className="rounded border border-slate-200 p-1 text-slate-400 hover:border-rose-200 hover:text-rose-600"
                              title="Remove attachment"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Price Audit History (Internal Costing Only) */}
              {showCost && detail?.priceHistory.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-900">Cost Audit Log</h3>
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {detail.priceHistory.map((ph) => (
                      <div key={ph.id} className="flex items-center justify-between px-3.5 py-2 tabular-nums">
                        <div>
                          <div className="font-medium text-slate-800 capitalize">
                            {ph.cost_type}: {formatMoney(ph.previous_cost)} → {formatMoney(ph.new_cost)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {ph.remarks} {ph.supplier_ref ? `· ${ph.supplier_ref}` : ''}
                          </div>
                        </div>
                        <div className="text-right text-[11px] text-slate-400">
                          <div>{formatDate(ph.effective_date)}</div>
                          <div>{ph.updated_by_name || 'System'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
