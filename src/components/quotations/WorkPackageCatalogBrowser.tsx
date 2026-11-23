import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers, Package, Plus, Search } from 'lucide-react';
import { formatMoney } from '../../lib/api';
import { type CatalogItemRecord, type WorkAssemblyRecord } from './quotationCatalogTypes';

interface WorkPackageCatalogBrowserProps {
  catalogItems: CatalogItemRecord[];
  assemblies: WorkAssemblyRecord[];
  categories: any[];
  canViewCosting: boolean;
  canCreateCatalogItem: boolean;
  hasActiveEditableQuotation: boolean;
  activeQuoteNumber?: string;
  onOpenNewCatalogModal: () => void;
  onInsertSingleItemToQuote?: (item: CatalogItemRecord) => void;
  onOpenWorkPackageInQuote?: (assemblyId: number) => void;
}

export const WorkPackageCatalogBrowser: React.FC<WorkPackageCatalogBrowserProps> = ({
  catalogItems,
  assemblies,
  categories,
  canViewCosting,
  canCreateCatalogItem,
  hasActiveEditableQuotation,
  activeQuoteNumber,
  onOpenNewCatalogModal,
  onInsertSingleItemToQuote,
  onOpenWorkPackageInQuote,
}) => {
  const [subTab, setSubTab] = useState<'packages' | 'items'>('packages');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedAssemblies, setExpandedAssemblies] = useState<Record<number, boolean>>({});
  const [expandedSuppliers, setExpandedSuppliers] = useState<Record<number, boolean>>({});

  const filteredAssemblies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assemblies.filter((asm) => {
      if (categoryFilter !== 'all' && asm.category_name !== categoryFilter) return false;
      if (!q) return true;
      const compText = (asm.components || [])
        .map((c) => `${c.item_code} ${c.item_name} ${c.specification}`)
        .join(' ');
      return `${asm.assembly_code} ${asm.name} ${asm.category_name} ${asm.description} ${compText}`
        .toLowerCase()
        .includes(q);
    });
  }, [assemblies, categoryFilter, search]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogItems.filter((it) => {
      if (categoryFilter !== 'all' && it.category !== categoryFilter) return false;
      if (!q) return true;
      const supText = (it.supplier_prices || [])
        .map((sp) => `${sp.supplier_name} ${sp.brand}`)
        .join(' ');
      return `${it.item_code} ${it.name} ${it.description} ${it.specification} ${it.category} ${supText}`
        .toLowerCase()
        .includes(q);
    });
  }, [catalogItems, categoryFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setSubTab('packages')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'packages'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Work Packages ({assemblies.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('items')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'items'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Package className="h-3.5 w-3.5" />
              Single Items ({catalogItems.length})
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                subTab === 'packages'
                  ? 'Search work packages or included items...'
                  : 'Search code, item, supplier, or brand...'
              }
              className="rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs min-w-[230px]"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="all">All Categories</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {hasActiveEditableQuotation && (
            <span className="text-[11px] text-slate-500">
              Active draft: <strong className="font-mono text-slate-800">{activeQuoteNumber}</strong>
            </span>
          )}
          {canCreateCatalogItem && (
            <button
              type="button"
              onClick={onOpenNewCatalogModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Catalog Item
            </button>
          )}
        </div>
      </div>

      {subTab === 'packages' ? (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-200">
          {filteredAssemblies.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No work packages match your current filter.
            </div>
          ) : (
            filteredAssemblies.map((asm) => {
              const isOpen = Boolean(expandedAssemblies[asm.id]);
              return (
                <div key={asm.id} className="p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[260px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedAssemblies((p) => ({ ...p, [asm.id]: !p[asm.id] }))
                          }
                          className="inline-flex items-center gap-1 font-mono font-bold text-amber-800 hover:underline"
                        >
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {asm.assembly_code}
                        </button>
                        <span className="font-semibold text-slate-900">{asm.name}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-600">{asm.category_name}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-slate-600">Unit: {asm.unit}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500">v{asm.current_version} · {asm.component_count} items</span>
                      </div>
                      {(asm.description || asm.specifications) && (
                        <div className="mt-1 pl-5 text-[11px] text-slate-500">
                          {asm.specifications || asm.description}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      {canViewCosting && asm.estimated_unit_cost !== undefined && (
                        <div className="text-right">
                          <div className="font-mono tabular-nums text-slate-700">
                            {formatMoney(asm.estimated_unit_cost, 'PHP')}
                          </div>
                          <div className="text-[10px] text-slate-400">Est. Cost / {asm.unit}</div>
                        </div>
                      )}
                      <div className="text-right">
                        <div className="font-mono font-semibold tabular-nums text-slate-900">
                          {formatMoney(asm.estimated_unit_selling, 'PHP')}
                        </div>
                        <div className="text-[10px] text-slate-400">Ref. Sell / {asm.unit}</div>
                      </div>
                      {hasActiveEditableQuotation && onOpenWorkPackageInQuote && (
                        <button
                          type="button"
                          onClick={() => onOpenWorkPackageInQuote(asm.id)}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          Use in Quote
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 ml-5 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-left text-[11px]">
                        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2">Code</th>
                            <th className="px-3 py-2">Component Item &amp; Specification</th>
                            <th className="px-3 py-2 text-right">Rate / {asm.unit}</th>
                            <th className="px-3 py-2 text-right">Waste %</th>
                            {canViewCosting && (
                              <>
                                <th className="px-3 py-2">Preferred Supplier</th>
                                <th className="px-3 py-2 text-right">Mat Cost</th>
                                <th className="px-3 py-2 text-right">Lbr Cost</th>
                              </>
                            )}
                            <th className="px-3 py-2 text-right">Ref. Selling</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {asm.components.map((c) => (
                            <tr key={c.id} className="hover:bg-slate-50">
                              <td className="px-3 py-1.5 text-slate-600">{c.component_type}</td>
                              <td className="px-3 py-1.5 font-mono text-slate-700">{c.item_code || '—'}</td>
                              <td className="px-3 py-1.5">
                                <div className="font-medium text-slate-900">{c.item_name}</div>
                                {c.specification && (
                                  <div className="text-[10px] text-slate-500">{c.specification}</div>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                {c.consumption_rate} {c.unit}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                {c.wastage_pct}%
                              </td>
                              {canViewCosting && (
                                <>
                                  <td className="px-3 py-1.5 text-slate-600">
                                    {c.preferred_supplier_name || '—'}
                                    {(c.supplier_prices?.length || 0) > 1 && (
                                      <span className="ml-1 text-[10px] text-sky-700">
                                        ({c.supplier_prices!.length} suppliers)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                    {formatMoney(c.mat_unit_cost || 0, 'PHP')}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                    {formatMoney(c.lbr_unit_cost || 0, 'PHP')}
                                  </td>
                                </>
                              )}
                              <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                                {formatMoney(c.combined_sell_rate, 'PHP')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Item Name &amp; Specification</th>
                <th className="px-4 py-2.5">Category / Type</th>
                <th className="px-4 py-2.5">Unit</th>
                {canViewCosting && (
                  <>
                    <th className="px-4 py-2.5 text-right">Mat Cost</th>
                    <th className="px-4 py-2.5 text-right">Lbr Cost</th>
                    <th className="px-4 py-2.5">Suppliers</th>
                  </>
                )}
                <th className="px-4 py-2.5 text-right">Ref. Selling Rate</th>
                {hasActiveEditableQuotation && <th className="px-4 py-2.5 text-right">Quote Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredItems.map((it) => {
                const sups = it.supplier_prices || [];
                const showSups = Boolean(expandedSuppliers[it.id]);
                return (
                  <React.Fragment key={it.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{it.item_code}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900">{it.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {it.specification || it.description}
                          {it.is_general_requirement ? ' · General Requirement' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {it.category} · {it.item_type || 'Material'}
                      </td>
                      <td className="px-4 py-2.5 font-mono">{it.default_unit}</td>
                      {canViewCosting && (
                        <>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {formatMoney(it.mat_unit_cost || 0, 'PHP')}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {formatMoney(it.lbr_unit_cost || 0, 'PHP')}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {sups.length > 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedSuppliers((p) => ({ ...p, [it.id]: !p[it.id] }))
                                }
                                className="text-left text-sky-700 hover:underline font-medium"
                              >
                                {it.preferred_supplier_name || sups[0].supplier_name}
                                {sups.length > 1 ? ` (+${sups.length - 1} more)` : ''}
                              </button>
                            ) : (
                              <span>{it.supplier_ref || '—'}</span>
                            )}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {formatMoney(it.combined_sell_rate, 'PHP')}
                      </td>
                      {hasActiveEditableQuotation && (
                        <td className="px-4 py-2.5 text-right">
                          {onInsertSingleItemToQuote && (
                            <button
                              type="button"
                              onClick={() => onInsertSingleItemToQuote(it)}
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                            >
                              Insert
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {canViewCosting && showSups && sups.length > 0 && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={hasActiveEditableQuotation ? 9 : 8} className="px-6 py-2">
                          <div className="text-[11px] font-semibold text-slate-700 mb-1">
                            Registered Supplier Prices for {it.item_code}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {sups.map((sp) => (
                              <div
                                key={sp.id}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px]"
                              >
                                <div className="font-semibold text-slate-900">
                                  {sp.supplier_name} {sp.is_preferred ? '★' : ''}
                                </div>
                                <div className="font-mono text-slate-700 tabular-nums">
                                  {formatMoney(sp.unit_price, 'PHP')} / {sp.unit}
                                  {sp.brand ? ` · ${sp.brand}` : ''}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
