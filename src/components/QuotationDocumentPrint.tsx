import React from 'react';
import { Printer, X } from 'lucide-react';
import { formatDate, formatMoney } from '../lib/api';

interface QuotationDocumentPrintProps {
  mode: 'client' | 'internal';
  quotation: any;
  revision: any;
  companyHeader: {
    companyName: string;
    companyAddress: string;
    companyEmail: string;
    companyPhone: string;
    payeeName: string;
  };
  canViewInternalCosting: boolean;
  onClose: () => void;
}

export const QuotationDocumentPrint: React.FC<QuotationDocumentPrintProps> = ({
  mode,
  quotation,
  revision,
  companyHeader,
  canViewInternalCosting,
  onClose,
}) => {
  const showInternal = mode === 'internal' && canViewInternalCosting;
  const currency = quotation?.currency || 'PHP';
  const sections = revision?.sections || [];
  const items = revision?.items || [];
  const terms = revision?.terms || {};
  const notes: string[] = Array.isArray(revision?.notes) ? revision.notes : [];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/75 backdrop-blur-xs overflow-y-auto print:static print:bg-white print:p-0">
      {/* Toolbar (hidden in print) */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-700 bg-slate-900 px-6 py-3 text-white">
        <div>
          <div className="text-sm font-semibold">
            {showInternal ? 'Internal Costing & Profitability Report (Confidential)' : 'Client-Facing Official Quotation'}
          </div>
          <div className="text-xs text-slate-400">
            {quotation.quote_number} · {revision.revision_code} · {showInternal ? 'Restricted Internal View' : 'Client-Safe Document (No Costs / GP Exposed)'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap"
          >
            <Printer className="h-3.5 w-3.5" />
            Print / Save PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        </div>
      </div>

      {/* Printable A4 Sheet */}
      <div className="mx-auto my-6 w-full max-w-[960px] bg-white p-8 shadow-xl text-slate-900 print:my-0 print:max-w-none print:shadow-none print:p-4">
        {/* Letterhead */}
        <div className="flex flex-wrap items-start justify-between border-b-2 border-slate-900 pb-4 gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              {companyHeader.companyName}
            </h1>
            <p className="mt-1 max-w-md text-[11px] leading-snug text-slate-600">
              {companyHeader.companyAddress}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-600">
              E: {companyHeader.companyEmail} · T: {companyHeader.companyPhone}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold tracking-wide text-slate-900">
              {showInternal ? 'INTERNAL COSTING SHEET' : 'QUOTATION'}
            </div>
            <div className="mt-1 font-mono text-xs font-semibold text-slate-800">
              REF: {quotation.quote_number} · {revision.revision_code}
            </div>
            <div className="text-[11px] text-slate-600">
              Date: {formatDate(revision.created_at || quotation.created_at)}
            </div>
            {showInternal && (
              <div className="mt-1 text-[10px] font-semibold text-rose-700">
                CONFIDENTIAL — INTERNAL USE ONLY
              </div>
            )}
          </div>
        </div>

        {/* Client & Project Block */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-slate-200 pb-4 text-xs">
          <div className="space-y-1">
            <div>
              <span className="font-semibold text-slate-500">FOR: </span>
              <span className="font-semibold text-slate-900">{quotation.client_name}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500">ATT&apos;N: </span>
              <span>{revision.attention_to || quotation.client_contact || '—'}</span>
              {(revision.attention_title || quotation.client_rep_title) && (
                <span className="text-slate-500"> ({revision.attention_title || quotation.client_rep_title})</span>
              )}
            </div>
            {revision.thru_person && (
              <div>
                <span className="font-semibold text-slate-500">THRU: </span>
                <span>{revision.thru_person}</span>
                {revision.thru_title && <span className="text-slate-500"> ({revision.thru_title})</span>}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div>
              <span className="font-semibold text-slate-500">SUBJECT: </span>
              <span className="font-semibold text-slate-900">{revision.subject || quotation.title}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500">SITE: </span>
              <span>{revision.site_location || quotation.location || '—'}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500">EST. MANPOWER / DURATION: </span>
              <span>
                {revision.estimated_manpower || 0} Personnel · {revision.estimated_duration_days || 0} Days
              </span>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y border-slate-900 bg-slate-100 text-left text-slate-800">
                <th className="py-2 px-2 w-10">No.</th>
                <th className="py-2 px-2 w-20">Code</th>
                <th className="py-2 px-2">Item Description</th>
                <th className="py-2 px-2 text-right w-14">Qty</th>
                <th className="py-2 px-2 w-14">Unit</th>
                {showInternal ? (
                  <>
                    <th className="py-2 px-2 text-right">Mat Cost</th>
                    <th className="py-2 px-2 text-right">Lbr Cost</th>
                    <th className="py-2 px-2 text-right">GP %</th>
                    <th className="py-2 px-2 text-right">Sell Rate</th>
                    <th className="py-2 px-2 text-right">Ext. Cost</th>
                    <th className="py-2 px-2 text-right">Ext. Selling</th>
                    <th className="py-2 px-2 text-right">Gross Profit</th>
                  </>
                ) : (
                  <>
                    <th className="py-2 px-2 text-right">Materials ({currency})</th>
                    <th className="py-2 px-2 text-right">Labor ({currency})</th>
                    <th className="py-2 px-2 text-right">Unit Rate ({currency})</th>
                    <th className="py-2 px-2 text-right">Total ({currency})</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sections.map((sec: any) => {
                const secItems = items.filter((it: any) => {
                  if (it.section_id !== sec.id) return false;
                  if (!showInternal && (it.visibility_mode === 'hidden' || it.row_type === 'subitem')) return false;
                  return true;
                });
                return (
                  <React.Fragment key={sec.id}>
                    <tr className="bg-slate-200/80 font-bold text-slate-900 border-b border-slate-300">
                      <td className="py-1.5 px-2">{sec.code}</td>
                      <td className="py-1.5 px-2" colSpan={showInternal ? 11 : 8}>
                        {sec.title}
                      </td>
                    </tr>
                    {secItems.map((it: any) => {
                      if (it.row_type === 'subsection' || it.row_type === 'note') {
                        return (
                          <tr key={it.id} className="bg-slate-50 font-semibold text-slate-700 border-b border-slate-200">
                            <td className="py-1 px-2">{it.line_no}</td>
                            <td className="py-1 px-2" colSpan={showInternal ? 11 : 8}>
                              {it.description}
                            </td>
                          </tr>
                        );
                      }
                      const isHidden = it.visibility_mode === 'hidden' || it.row_type === 'subitem';
                      const matRateLabel =
                        it.mat_pricing_mode === 'included'
                          ? 'included'
                          : it.mat_pricing_mode === 'excluded'
                          ? '—'
                          : formatMoney(it.mat_sell_rate, currency);
                      const lbrRateLabel =
                        it.lbr_pricing_mode === 'included'
                          ? 'included'
                          : it.lbr_pricing_mode === 'excluded'
                          ? '—'
                          : formatMoney(it.lbr_sell_rate, currency);

                      return (
                        <tr
                          key={it.id}
                          className={`border-b border-slate-200 ${isHidden ? 'bg-amber-50/40 text-slate-500' : ''}`}
                        >
                          <td className="py-1.5 px-2 font-mono">{it.line_no}</td>
                          <td className="py-1.5 px-2 font-mono text-[10px]">{it.item_code}</td>
                          <td className={`py-1.5 px-2 ${isHidden ? 'pl-6 italic' : 'font-medium text-slate-900'}`}>
                            {it.description}
                            {isHidden && <span className="ml-1.5 text-[10px] text-amber-700">[hidden sub-item]</span>}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">{it.qty}</td>
                          <td className="py-1.5 px-2">{it.unit}</td>
                          {showInternal ? (
                            <>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                                {formatMoney(it.mat_unit_cost, currency)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                                {formatMoney(it.lbr_unit_cost, currency)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                                {Math.round(Number(it.mat_gp_pct || 0) * 100)}% / {Math.round(Number(it.lbr_gp_pct || 0) * 100)}%
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                                {formatMoney(it.combined_unit_rate, currency)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                                {isHidden ? 'hidden' : formatMoney(it.extended_cost, currency)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                                {isHidden ? 'hidden' : formatMoney(it.extended_selling, currency)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-emerald-700">
                                {isHidden ? '—' : formatMoney(it.gross_profit, currency)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums">{matRateLabel}</td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums">{lbrRateLabel}</td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                                {formatMoney(it.combined_unit_rate, currency)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono font-semibold tabular-nums">
                                {formatMoney(it.extended_selling, currency)}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {/* Section Subtotal Row */}
                    <tr className="border-b-2 border-slate-400 bg-slate-50 font-bold text-slate-900">
                      <td className="py-1.5 px-2 text-right" colSpan={showInternal ? 9 : 8}>
                        SUB-TOTAL {sec.title}
                      </td>
                      {showInternal ? (
                        <>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatMoney(sec.total_direct_cost, currency)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatMoney(sec.total_selling_subtotal, currency)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums text-emerald-700">
                            {formatMoney(sec.gross_profit_amount, currency)} ({sec.gross_profit_pct}%)
                          </td>
                        </>
                      ) : (
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatMoney(sec.total_selling_subtotal, currency)}
                        </td>
                      )}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Summary Totals */}
        <div className="mt-5 flex justify-end">
          <div className="w-full max-w-md border border-slate-300 text-xs">
            {showInternal && (
              <div className="flex justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                <span className="font-medium text-slate-600">Total Internal Direct Cost (Mat + Labor)</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatMoney(revision.total_direct_cost, currency)}
                </span>
              </div>
            )}
            <div className="flex justify-between border-b border-slate-200 px-3 py-1.5">
              <span className="font-semibold">TOTAL AMOUNT (Pre-VAT)</span>
              <span className="font-mono font-semibold tabular-nums">
                {formatMoney(revision.total_selling_pre_vat, currency)}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-200 px-3 py-1.5">
              <span>{revision.vat_rate}% VAT</span>
              <span className="font-mono tabular-nums">{formatMoney(revision.vat_amount, currency)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold">
              <span>TOTAL SELLING PRICE (VAT INC)</span>
              <span className="font-mono tabular-nums">
                {formatMoney(revision.total_selling_vat_inc, currency)}
              </span>
            </div>
            {Number(revision.discount_pct || 0) > 0 && (
              <div className="flex justify-between border-b border-slate-200 px-3 py-1.5 text-rose-700">
                <span>LESS SPECIAL DISCOUNT ({revision.discount_pct}%)</span>
                <span className="font-mono tabular-nums">
                  -{formatMoney(revision.discount_amount, currency)}
                </span>
              </div>
            )}
            <div className="flex justify-between bg-slate-900 px-3 py-2 text-sm font-bold text-white">
              <span>TOTAL QUOTATION PRICE</span>
              <span className="font-mono tabular-nums">{formatMoney(revision.final_amount, currency)}</span>
            </div>
            {showInternal && (
              <div className="flex justify-between bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800">
                <span>Estimated Gross Profit</span>
                <span className="font-mono tabular-nums">
                  {formatMoney(revision.gross_profit_amount, currency)} ({revision.gross_profit_pct}%)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Notes & General Terms */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-slate-200 pt-4 text-[11px] leading-relaxed">
          <div>
            <h4 className="font-bold text-slate-900 uppercase tracking-wide mb-1.5">
              Note(s) / Scope of Work(s)
            </h4>
            <ul className="list-disc pl-4 space-y-1 text-slate-700">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
              {terms.inclusions && <li>{terms.inclusions}</li>}
              {terms.exclusions && <li>{terms.exclusions}</li>}
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-slate-900 uppercase tracking-wide mb-1.5">
              General Terms &amp; Conditions
            </h4>
            <ol className="list-decimal pl-4 space-y-1 text-slate-700">
              <li>Mobilization: {terms.mobilization || 'Subject for Approval.'}</li>
              <li>Delivery &amp; Implementation: {terms.delivery || 'Subject for Approval.'}</li>
              <li>Warranty Period: {terms.warranty || '12 months.'}</li>
              <li>Payment Terms: {terms.paymentTerms || '50% Down Payment, 50% Progress Billing.'}</li>
              <li>All Cheques Payable to: <strong>{terms.payeeName || companyHeader.payeeName}</strong></li>
              <li>Validity: {terms.validity || '1 month from date of issuance.'}</li>
            </ol>
          </div>
        </div>

        {/* Signatories */}
        <div className="mt-8 grid grid-cols-2 gap-12 border-t border-slate-200 pt-6 text-xs">
          <div>
            <div className="text-[11px] text-slate-500">Prepared by:</div>
            <div className="mt-6 border-t border-slate-400 pt-1 font-bold text-slate-900">
              {revision.prepared_by_name || quotation.prepared_by_name || 'Estimator / Project Engineer'}
            </div>
            <div className="text-[11px] text-slate-600">{revision.prepared_by_title || 'Estimating'}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Approved by:</div>
            <div className="mt-6 border-t border-slate-400 pt-1 font-bold text-slate-900">
              {revision.approved_by_name || 'Authorized Management Approver'}
            </div>
            <div className="text-[11px] text-slate-600">{revision.approved_by_title || 'Management'}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
