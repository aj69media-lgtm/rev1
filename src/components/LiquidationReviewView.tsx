import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  History,
  Lock,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
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
  ProtectedAttachmentRecord,
} from './ProtectedAttachmentGallery';

interface ExpenseReviewModalProps {
  expenseId: number;
  onClose: () => void;
  onUpdated: () => void;
}

export const ExpenseReviewModal: React.FC<ExpenseReviewModalProps> = ({ expenseId, onClose, onUpdated }) => {
  const { user, hasPerm } = useAuth();
  const [expense, setExpense] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Decision controls
  const [decisionNote, setDecisionNote] = useState('');
  const [approveExceptionInline, setApproveExceptionInline] = useState(false);
  const [overrideSelf, setOverrideSelf] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Exception controls
  const [exceptionRemarks, setExceptionRemarks] = useState('');
  const [submittingException, setSubmittingException] = useState(false);

  // Resubmission / draft edit controls (for submitter when draft or for_correction)
  const [newReceipts, setNewReceipts] = useState<PendingAttachmentDraft[]>([]);
  const [newSupports, setNewSupports] = useState<PendingAttachmentDraft[]>([]);
  const [resubmitRemarks, setResubmitRemarks] = useState('');
  const [submittingResubmit, setSubmittingResubmit] = useState(false);

  // Post-approval authorized amendment controls
  const [showAmendPanel, setShowAmendPanel] = useState(false);
  const [amendType, setAmendType] = useState<'evidence' | 'reversal'>('evidence');
  const [amendNote, setAmendNote] = useState('');
  const [amendAmount, setAmendAmount] = useState('');
  const [amendReceipts, setAmendReceipts] = useState<PendingAttachmentDraft[]>([]);
  const [amendSupports, setAmendSupports] = useState<PendingAttachmentDraft[]>([]);
  const [submittingAmend, setSubmittingAmend] = useState(false);

  const loadDetails = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest(`/api/expenses/${expenseId}/history`);
      setExpense(res.expense);
      setHistory(res.history || []);
      setAmendAmount(String(res.expense?.amount || ''));
    } catch (err: any) {
      setError(err?.message || 'Unable to load expense details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetails();
  }, [expenseId]);

  const attachments: ProtectedAttachmentRecord[] = expense?.attachments || [];
  const receiptAtts = attachments.filter((a) => a.entity_type === 'expense_receipt');
  const supportAtts = attachments.filter((a) => a.entity_type === 'expense_support');

  const isSubmitter = Boolean(user && expense && expense.submitted_by === user.id);
  const isMgmtOverrideEligible = Boolean(
    user && ['system_admin', 'executive', 'general_manager'].includes(user.role_slug)
  );
  const canApprove = hasPerm('financials', 'approve');
  const canApproveException = hasPerm('financials', 'approve_exception') || canApprove;
  const canAmend = hasPerm('financials', 'amend_approved') || canApprove;
  const canReviewDecision =
    canApprove &&
    expense &&
    ['pending', 'submitted', 'pending_review', 'resubmitted'].includes(expense.status);

  const handleExceptionDecision = async (decision: 'approved' | 'rejected') => {
    setError('');
    setNotice('');
    if (decision === 'rejected' && !exceptionRemarks.trim()) {
      setError('Remarks are required when rejecting a no-receipt exception request.');
      return;
    }
    setSubmittingException(true);
    try {
      await apiRequest(`/api/expenses/${expenseId}/exception-decision`, {
        method: 'PATCH',
        body: {
          decision,
          remarks: exceptionRemarks.trim(),
          overrideSelfApproval: overrideSelf,
        },
      });
      setNotice(`No-receipt exception marked ${decision}.`);
      setExceptionRemarks('');
      await loadDetails();
      onUpdated();
    } catch (err: any) {
      setError(err?.message || 'Unable to process exception decision');
    } finally {
      setSubmittingException(false);
    }
  };

  const handleDecision = async (decision: 'approved' | 'for_correction' | 'rejected') => {
    setError('');
    setNotice('');
    if ((decision === 'rejected' || decision === 'for_correction') && !decisionNote.trim()) {
      setError('A clear reason is required when returning for correction or rejecting.');
      return;
    }
    setSubmittingDecision(true);
    try {
      await apiRequest(`/api/expenses/${expenseId}/decision`, {
        method: 'PATCH',
        body: {
          decision,
          reason: decisionNote.trim(),
          remarks: decisionNote.trim(),
          approveException: approveExceptionInline,
          overrideSelfApproval: overrideSelf,
          overrideReason: overrideReason.trim(),
        },
      });
      setNotice(`Liquidation marked ${decision.replace(/_/g, ' ')}.`);
      setDecisionNote('');
      await loadDetails();
      onUpdated();
    } catch (err: any) {
      setError(err?.message || 'Unable to apply liquidation decision');
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleSubmitOrResubmit = async () => {
    setError('');
    setNotice('');
    setSubmittingResubmit(true);
    try {
      await apiRequest(`/api/expenses/${expenseId}/submit`, {
        method: 'POST',
        body: {
          remarks: resubmitRemarks.trim() || undefined,
          receiptsBase64: newReceipts.map((r) => ({
            dataUrl: r.dataUrl,
            fileName: r.fileName,
            caption: r.caption,
            category: r.category,
          })),
          supportDocsBase64: newSupports.map((s) => ({
            dataUrl: s.dataUrl,
            fileName: s.fileName,
            caption: s.caption,
            category: s.category,
          })),
        },
      });
      setNotice('Expense submitted for Finance / Supervisor review.');
      setNewReceipts([]);
      setNewSupports([]);
      setResubmitRemarks('');
      await loadDetails();
      onUpdated();
    } catch (err: any) {
      setError(err?.message || 'Unable to submit expense');
    } finally {
      setSubmittingResubmit(false);
    }
  };

  const handleAmendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!amendNote.trim()) {
      setError('An explicit amendment reason is required.');
      return;
    }
    setSubmittingAmend(true);
    try {
      await apiRequest(`/api/expenses/${expenseId}/amend`, {
        method: 'POST',
        body: {
          amendmentType: amendType,
          amendmentNote: amendNote.trim(),
          reversalAmount: amendType === 'reversal' ? Number(amendAmount || expense.amount) : undefined,
          receiptsBase64: amendReceipts.map((r) => ({
            dataUrl: r.dataUrl,
            fileName: r.fileName,
            caption: r.caption,
          })),
          supportDocsBase64: amendSupports.map((s) => ({
            dataUrl: s.dataUrl,
            fileName: s.fileName,
            caption: s.caption,
          })),
        },
      });
      setNotice(
        amendType === 'reversal'
          ? 'Authorized reversal entry posted; original record and evidence preserved.'
          : 'Amended evidence locked and recorded in audit trail.'
      );
      setShowAmendPanel(false);
      setAmendNote('');
      setAmendReceipts([]);
      setAmendSupports([]);
      await loadDetails();
      onUpdated();
    } catch (err: any) {
      setError(err?.message || 'Amendment failed');
    } finally {
      setSubmittingAmend(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 text-xs text-slate-500">
              <span className="font-mono font-semibold text-slate-800">{expense?.ref_number || `EXP-${expenseId}`}</span>
              {expense?.expense_date && (
                <>
                  <span>·</span>
                  <span className="font-mono">{expense.expense_date}</span>
                </>
              )}
              {expense?.status && (
                <>
                  <span>·</span>
                  <StatusLabel status={expense.status} />
                </>
              )}
            </div>
            <h2 className="mt-0.5 truncate font-display text-base font-bold text-slate-900">
              {expense?.description || 'Cash Liquidation & Receipt Inspection'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {loading ? (
            <div className="py-12 text-center text-slate-500">Loading liquidation details and receipts...</div>
          ) : (
            <>
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-700">{error}</div>
              )}
              {notice && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-emerald-700">
                  {notice}
                </div>
              )}

              {/* Financial Metadata Summary */}
              {expense && (
                <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-4">
                  <div>
                    <div className="text-[11px] text-slate-500">Liquidation Amount</div>
                    <div className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums">
                      {formatCurrencyExact(expense.amount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Category &amp; Method</div>
                    <div className="mt-0.5 font-medium text-slate-900">{expense.category}</div>
                    <div className="text-[11px] text-slate-500">{expense.payment_method || 'Cash'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Supplier / Payee</div>
                    <div className="mt-0.5 font-medium text-slate-900">{expense.supplier_recipient || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Employee / Custodian</div>
                    <div className="mt-0.5 font-medium text-slate-900">
                      {expense.employee_name || expense.custodian_name || '—'}
                    </div>
                  </div>
                  {(expense.cr_ref || expense.cash_request_id) && (
                    <div className="col-span-2 sm:col-span-4 border-t border-slate-200 pt-2.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-700">
                        Linked Cash Request:{' '}
                        <strong className="font-mono text-slate-900">{expense.cr_ref || `CR-${expense.cash_request_id}`}</strong>{' '}
                        {expense.cr_description ? `· ${expense.cr_description}` : ''}
                      </span>
                      {expense.cr_amount_requested !== undefined && (
                        <span className="font-mono text-slate-700 tabular-nums">
                          Advance Issued: <strong>{formatCurrencyExact(expense.cr_amount_requested)}</strong>
                        </span>
                      )}
                    </div>
                  )}
                  {expense.rejection_reason && (
                    <div className="col-span-2 sm:col-span-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                      <strong>Reviewer Return/Rejection Reason:</strong> {expense.rejection_reason}
                    </div>
                  )}
                </div>
              )}

              {/* Receipts & Supporting Evidence */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                      <Receipt className="h-4 w-4 text-amber-600" />
                      Receipt Photographs ({receiptAtts.length})
                    </h3>
                    {expense?.status === 'approved' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                        <Lock className="h-3.5 w-3.5" /> Evidence Locked on Approval
                      </span>
                    )}
                  </div>
                  <ProtectedAttachmentGallery
                    attachments={receiptAtts}
                    canDelete={expense?.status !== 'approved' && hasPerm('financials', 'create')}
                    onDeleted={() => {
                      loadDetails();
                      onUpdated();
                    }}
                    emptyText={
                      expense?.no_receipt_exception
                        ? 'No standard receipt attached (submitted under controlled No-Receipt Exception).'
                        : 'No receipt photographs uploaded yet.'
                    }
                  />
                </div>

                {(supportAtts.length > 0 || expense?.no_receipt_exception === 1) && (
                  <div className="space-y-2">
                    <h3 className="font-display text-sm font-semibold text-slate-900">
                      Alternative / Supporting Documents ({supportAtts.length})
                    </h3>
                    <ProtectedAttachmentGallery
                      attachments={supportAtts}
                      canDelete={expense?.status !== 'approved' && hasPerm('financials', 'create')}
                      onDeleted={() => {
                        loadDetails();
                        onUpdated();
                      }}
                      emptyText="No supporting documents attached."
                    />
                  </div>
                )}
              </div>

              {/* Controlled No-Receipt Exception Authorization Panel */}
              {expense?.no_receipt_exception === 1 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-amber-950">
                      <FileWarning className="h-4 w-4 text-amber-700" />
                      Controlled No-Receipt Exception Request
                    </div>
                    <StatusLabel status={expense.exception_status || 'pending'} />
                  </div>
                  <p className="text-slate-800">
                    <strong>Submitted Justification:</strong> {expense.exception_reason || '—'}
                  </p>
                  {expense.exception_approved_by_name && (
                    <p className="text-[11px] text-slate-600">
                      Reviewed by {expense.exception_approved_by_name}
                      {expense.exception_remarks ? ` · "${expense.exception_remarks}"` : ''}
                    </p>
                  )}

                  {canApproveException && expense.exception_status === 'pending' && (
                    <div className="border-t border-amber-200/80 pt-3 space-y-2.5">
                      <input
                        value={exceptionRemarks}
                        onChange={(e) => setExceptionRemarks(e.target.value)}
                        placeholder="Exception review remarks (required to reject)..."
                        className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={submittingException}
                          onClick={() => handleExceptionDecision('approved')}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          Authorize Exception
                        </button>
                        <button
                          type="button"
                          disabled={submittingException}
                          onClick={() => handleExceptionDecision('rejected')}
                          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject Exception
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Submitter Draft / Return-for-Correction Resubmission Panel */}
              {expense &&
                ['draft', 'for_correction', 'correction_needed', 'rejected'].includes(expense.status) &&
                hasPerm('financials', 'create') && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <h3 className="font-display text-sm font-semibold text-slate-900">
                      {expense.status === 'draft'
                        ? 'Complete & Submit Draft Expense'
                        : 'Attach Updated Proof & Resubmit Liquidation'}
                    </h3>
                    <EvidenceFilePicker
                      label="Add Receipt Photos"
                      helperText="Capture or upload receipt photos before submitting."
                      items={newReceipts}
                      onChange={setNewReceipts}
                      imagesOnly
                      defaultCategory="Official Receipt"
                    />
                    <EvidenceFilePicker
                      label="Add Supporting Documents (Optional)"
                      items={newSupports}
                      onChange={setNewSupports}
                      defaultCategory="Supporting Proof"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={resubmitRemarks}
                        onChange={(e) => setResubmitRemarks(e.target.value)}
                        placeholder="Resubmission / correction remarks..."
                        className="flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-1.5"
                      />
                      <button
                        type="button"
                        disabled={submittingResubmit}
                        onClick={handleSubmitOrResubmit}
                        className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        {submittingResubmit
                          ? 'Submitting...'
                          : expense.status === 'draft'
                          ? 'Submit Liquidation'
                          : 'Resubmit for Review'}
                      </button>
                    </div>
                  </div>
                )}

              {/* Supervisor / Finance Decision Panel */}
              {canReviewDecision && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-700" />
                    Supervisor Liquidation Verification &amp; Decision
                  </h3>

                  {isSubmitter && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 space-y-1.5">
                      <div>
                        <strong>Self-Approval Policy:</strong> You submitted this expense. By default, another
                        authorized supervisor or finance officer must approve it.
                      </div>
                      {isMgmtOverrideEligible && (
                        <div className="space-y-1.5 pt-1">
                          <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                            <input
                              type="checkbox"
                              checked={overrideSelf}
                              onChange={(e) => setOverrideSelf(e.target.checked)}
                            />
                            Apply logged Executive/Management Self-Approval Override
                          </label>
                          {overrideSelf && (
                            <input
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="Management override reason (recorded in audit log)..."
                              className="w-full rounded border border-amber-300 bg-white px-2.5 py-1 text-xs"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {expense.no_receipt_exception === 1 &&
                    expense.exception_status !== 'approved' &&
                    canApproveException && (
                      <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={approveExceptionInline}
                          onChange={(e) => setApproveExceptionInline(e.target.checked)}
                        />
                        Authorize No-Receipt Exception together with approval
                      </label>
                    )}

                  <textarea
                    rows={2}
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Enter verification notes (mandatory when returning for correction or rejecting)..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={submittingDecision}
                      onClick={() => handleDecision('approved')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve &amp; Lock Receipts
                    </button>
                    <button
                      type="button"
                      disabled={submittingDecision}
                      onClick={() => handleDecision('for_correction')}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap"
                    >
                      Return for Correction
                    </button>
                    <button
                      type="button"
                      disabled={submittingDecision}
                      onClick={() => handleDecision('rejected')}
                      className="rounded-lg border border-red-300 bg-white px-3.5 py-2 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {/* Post-Approval Amendment / Reversal Workflow */}
              {expense?.status === 'approved' && canAmend && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">Post-Approval Amendment / Reversal</div>
                      <div className="text-[11px] text-slate-500">
                        Approved records and original receipts are immutable. Only authorized reversals or supplemental
                        evidence additions are permitted.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAmendPanel((v) => !v)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                    >
                      {showAmendPanel ? 'Hide Amendment' : 'Record Amendment'}
                    </button>
                  </div>

                  {showAmendPanel && (
                    <form onSubmit={handleAmendSubmit} className="space-y-3 border-t border-slate-200 pt-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block font-medium text-slate-700 mb-1">Amendment Type</label>
                          <select
                            value={amendType}
                            onChange={(e) => setAmendType(e.target.value as 'evidence' | 'reversal')}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                          >
                            <option value="evidence">Attach Supplemental / Replacement Evidence</option>
                            <option value="reversal">Post Authorized Reversal Entry</option>
                          </select>
                        </div>
                        {amendType === 'reversal' && (
                          <div>
                            <label className="block font-medium text-slate-700 mb-1">Reversal Amount</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              required
                              value={amendAmount}
                              onChange={(e) => setAmendAmount(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Amendment Reason *</label>
                        <input
                          required
                          value={amendNote}
                          onChange={(e) => setAmendNote(e.target.value)}
                          placeholder="State clear accounting/audit reason for this amendment..."
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5"
                        />
                      </div>
                      {amendType === 'evidence' && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <EvidenceFilePicker
                            label="Amended Receipt Photos"
                            items={amendReceipts}
                            onChange={setAmendReceipts}
                            imagesOnly
                            defaultCategory="Amended Receipt"
                          />
                          <EvidenceFilePicker
                            label="Amended Supporting Files"
                            items={amendSupports}
                            onChange={setAmendSupports}
                            defaultCategory="Amended Support"
                          />
                        </div>
                      )}
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={submittingAmend}
                          className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {submittingAmend ? 'Recording...' : 'Confirm Authorized Amendment'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* Chronological Financial Audit Trail */}
              <div className="space-y-2">
                <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <History className="h-4 w-4 text-slate-500" />
                  Liquidation &amp; Approval Audit History ({history.length})
                </h3>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                  {history.length === 0 ? (
                    <div className="px-4 py-4 text-center text-slate-500">No history events recorded yet.</div>
                  ) : (
                    history.map((h) => (
                      <div key={h.id} className="px-4 py-2.5 flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">
                            {String(h.action || '').replace(/_/g, ' ')}
                            {h.actor_name ? ` · ${h.actor_name}` : ''}
                            {h.actor_role ? ` (${h.actor_role})` : ''}
                          </div>
                          {h.remarks && <div className="text-slate-600 mt-0.5">{h.remarks}</div>}
                        </div>
                        <div className="text-right font-mono text-[11px] text-slate-500 shrink-0">
                          {h.previous_status ? `${h.previous_status} → ` : ''}
                          <span className="font-semibold text-slate-700">{h.new_status}</span>
                          <div>{h.created_at ? new Date(h.created_at).toLocaleString() : ''}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface LiquidationReviewViewProps {
  projectId?: number;
  embedded?: boolean;
  onRefreshParent?: () => void;
}

export const LiquidationReviewView: React.FC<LiquidationReviewViewProps> = ({
  projectId,
  embedded = false,
  onRefreshParent,
}) => {
  const { syncVersion } = useSync();
  const [queue, setQueue] = useState<any[]>([]);
  const [summary, setSummary] = useState({
    pendingCount: 0,
    exceptionPendingCount: 0,
    forCorrectionCount: 0,
    approvedCount: 0,
  });
  const [statusFilter, setStatusFilter] = useState<string>('awaiting_review');
  const [exceptionOnly, setExceptionOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeExpenseId, setActiveExpenseId] = useState<number | null>(null);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (projectId) qs.set('projectId', String(projectId));
      if (statusFilter) qs.set('status', statusFilter);
      if (exceptionOnly) qs.set('exceptionOnly', '1');
      const res = await apiRequest(`/api/liquidations/review-queue?${qs.toString()}`);
      setQueue(res.queue || []);
      if (res.summary) setSummary(res.summary);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, [projectId, statusFilter, exceptionOnly, syncVersion]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return queue;
    return queue.filter(
      (item) =>
        String(item.ref_number || '').toLowerCase().includes(q) ||
        String(item.description || '').toLowerCase().includes(q) ||
        String(item.project_name || '').toLowerCase().includes(q) ||
        String(item.employee_name || item.submitted_by_name || '').toLowerCase().includes(q) ||
        String(item.supplier_recipient || '').toLowerCase().includes(q)
    );
  }, [queue, search]);

  return (
    <div className="space-y-5">
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">
              Cash Liquidation &amp; Receipt Review Queue
            </h1>
            <p className="text-xs text-slate-500">
              Inspect submitted receipt photographs, authorize controlled no-receipt exceptions, and verify custodian
              cash liquidations.
            </p>
          </div>
          <button
            type="button"
            onClick={loadQueue}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Queue
          </button>
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => {
            setStatusFilter('awaiting_review');
            setExceptionOnly(false);
          }}
          className="rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-amber-300 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Awaiting Review</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">{summary.pendingCount}</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter('all');
            setExceptionOnly(true);
          }}
          className="rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-amber-300 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>No-Receipt Exceptions</span>
            <AlertTriangle className="h-4 w-4 text-amber-700" />
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-700 tabular-nums">
            {summary.exceptionPendingCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter('for_correction');
            setExceptionOnly(false);
          }}
          className="rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-red-300 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>For Correction</span>
            <FileWarning className="h-4 w-4 text-red-600" />
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-red-700 tabular-nums">{summary.forCorrectionCount}</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter('approved');
            setExceptionOnly(false);
          }}
          className="rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-emerald-300 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Approved &amp; Locked</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">{summary.approvedCount}</div>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          {[
            { id: 'awaiting_review', label: 'Awaiting Review' },
            { id: 'for_correction', label: 'For Correction' },
            { id: 'approved', label: 'Approved' },
            { id: 'rejected', label: 'Rejected' },
            { id: 'all', label: 'All Submissions' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded-md px-2.5 py-1 font-medium whitespace-nowrap transition-colors ${
                statusFilter === tab.id ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={exceptionOnly}
              onChange={(e) => setExceptionOnly(e.target.checked)}
            />
            Exceptions Only
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref, employee, project..."
              className="w-56 rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Queue Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Ref &amp; Date</th>
              {!projectId && <th className="px-4 py-2.5 font-semibold">Project</th>}
              <th className="px-4 py-2.5 font-semibold">Expense &amp; Payee</th>
              <th className="px-4 py-2.5 font-semibold">Submitted By</th>
              <th className="px-4 py-2.5 font-semibold text-right">Amount</th>
              <th className="px-4 py-2.5 font-semibold">Receipt / Proof</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold text-right">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr>
                <td colSpan={projectId ? 7 : 8} className="px-4 py-8 text-center text-slate-500">
                  Loading liquidation review queue...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={projectId ? 7 : 8} className="px-4 py-10 text-center text-slate-500">
                  No liquidations match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="font-mono font-semibold text-slate-900">{item.ref_number}</div>
                    <div className="font-mono text-[11px] text-slate-500">{item.expense_date}</div>
                  </td>
                  {!projectId && (
                    <td className="px-4 py-3 text-slate-700">
                      <div className="font-medium text-slate-900">{item.project_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{item.project_ref}</div>
                    </td>
                  )}
                  <td className="px-4 py-3 max-w-xs">
                    <div className="font-medium text-slate-900 truncate" title={item.description}>
                      {item.description}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {item.category} · {item.supplier_recipient}
                      {item.cr_ref ? ` · ${item.cr_ref}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div>{item.employee_name || item.submitted_by_name}</div>
                    {item.resolved_custodian_name && (
                      <div className="text-[11px] text-slate-500">Custodian: {item.resolved_custodian_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                    {formatCurrencyExact(item.amount)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {item.receipt_count > 0 ? (
                      <span className="text-emerald-700 font-medium">
                        {item.receipt_count} receipt photo{item.receipt_count > 1 ? 's' : ''}
                        {item.support_count > 0 ? ` + ${item.support_count} doc` : ''}
                      </span>
                    ) : item.no_receipt_exception === 1 ? (
                      <span className="text-amber-700 font-medium">
                        No-Receipt Exception ({item.support_count} proof)
                      </span>
                    ) : (
                      <span className="text-red-600 font-medium">Missing Receipt</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusLabel status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setActiveExpenseId(item.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-900 hover:text-white transition-colors"
                    >
                      Inspect &amp; Review
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {activeExpenseId !== null && (
        <ExpenseReviewModal
          expenseId={activeExpenseId}
          onClose={() => setActiveExpenseId(null)}
          onUpdated={() => {
            loadQueue();
            onRefreshParent?.();
          }}
        />
      )}
    </div>
  );
};
