import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Camera,
  Eye,
  FileWarning,
  Pencil,
  PiggyBank,
  Plus,
  Receipt,
  Save,
  Search,
  StickyNote,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { DonutChart, StatusLabel } from './Charts';
import { ExpenseReviewModal, LiquidationReviewView } from './LiquidationReviewView';
import { EvidenceFilePicker, PendingAttachmentDraft } from './ProtectedAttachmentGallery';
import { apiRequest, formatCurrencyExact } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';

export const SPREADSHEET_EXPENSE_CATEGORIES = [
  'Permitting',
  'Sign, Seal & Print',
  'Manpower',
  'Materials',
  'Subcon',
  'CARI / Bonds',
  'Tools',
  'Lodging',
  'Transportation',
  'Transfer/Withdrawal Fee',
  'Utilities Expense',
  'Food',
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  Permitting: '#2563EB',
  'Sign, Seal & Print': '#F59E0B',
  Manpower: '#64748B',
  Materials: '#16A34A',
  Subcon: '#0F766E',
  'CARI / Bonds': '#DC2626',
  Tools: '#10B981',
  Lodging: '#D97706',
  Transportation: '#EA580C',
  'Transfer/Withdrawal Fee': '#6366F1',
  'Utilities Expense': '#06B6D4',
  Food: '#0284C7',
  'Other Expenses': '#7C3AED',
};

function formatAccountingParen(val: number | null | undefined): string {
  const n = Number(val || 0);
  if (n < 0) return `(${formatCurrencyExact(Math.abs(n))})`;
  return formatCurrencyExact(n);
}

interface ProjectFinancialWorkspaceProps {
  projectId: number;
  finData: any;
  summary: any;
  prs: any[];
  employeeOptions: Array<{ key: string; label: string; userId?: number | null; personnelId?: number | null }>;
  mode: 'overview' | 'full';
  onOpenFullFinancials?: () => void;
  onRefresh: () => void;
  onNotify: (msg: string) => void;
}

export const ProjectFinancialWorkspace: React.FC<ProjectFinancialWorkspaceProps> = ({
  projectId,
  finData,
  summary,
  prs,
  employeeOptions,
  mode,
  onOpenFullFinancials,
  onRefresh,
  onNotify,
}) => {
  const { hasPerm } = useAuth();
  const { mutateWithOfflineQueue } = useSync();

  const effectiveSummary = finData?.summary || summary || {};
  const categorizedBreakdown: Array<{ category: string; total: number; percentage: number }> =
    finData?.categorizedBreakdown ||
    SPREADSHEET_EXPENSE_CATEGORIES.map((c) => ({ category: c, total: 0, percentage: 0 }));

  const payments: any[] = finData?.payments || [];
  const cashRequests: any[] = finData?.cashRequests || [];
  const expenses: any[] = finData?.expenses || [];
  const custodianLedgers: any[] = finData?.custodianLedgers || [];

  // Financial Analysis Editor State
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [analysisForm, setAnalysisForm] = useState({
    contractAmount: '',
    revisedBudget: '',
    tpcRate: '',
    salesCommission: '',
    opexAmount: '',
  });
  const [savingAnalysis, setSavingAnalysis] = useState(false);

  // Note Box State
  const [noteText, setNoteText] = useState<string>(finData?.projectNotes || '');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    setNoteText(finData?.projectNotes || '');
  }, [finData?.projectNotes]);

  useEffect(() => {
    setAnalysisForm({
      contractAmount: String(effectiveSummary.contractAmount ?? 0),
      revisedBudget: String(effectiveSummary.revisedBudget ?? 0),
      tpcRate: String(effectiveSummary.tpcRate ?? 0),
      salesCommission: String(effectiveSummary.salesCommission ?? 0),
      opexAmount: String(effectiveSummary.opexAmount ?? 0),
    });
  }, [
    effectiveSummary.contractAmount,
    effectiveSummary.revisedBudget,
    effectiveSummary.tpcRate,
    effectiveSummary.salesCommission,
    effectiveSummary.opexAmount,
  ]);

  // Payment Received Form State
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: '',
    remarks: '',
    referenceNo: '',
  });

  // Expense Form + Cash Request Form State
  const [entryTab, setEntryTab] = useState<'expense' | 'cash_request' | 'review_queue'>('expense');
  const [expForm, setExpForm] = useState({
    expenseDate: new Date().toISOString().slice(0, 10),
    category: 'Materials',
    description: '',
    amount: '',
    supplierRecipient: '',
    paymentMethod: 'Cash',
    employeeName: '',
    prId: '',
    cashRequestId: '',
    custodianName: '',
    remarks: '',
    noReceiptException: false,
    exceptionReason: '',
  });
  const [expReceipts, setExpReceipts] = useState<PendingAttachmentDraft[]>([]);
  const [expSupports, setExpSupports] = useState<PendingAttachmentDraft[]>([]);
  const [expError, setExpError] = useState('');
  const [submittingExp, setSubmittingExp] = useState(false);
  const [reviewExpenseId, setReviewExpenseId] = useState<number | null>(null);

  const [crForm, setCrForm] = useState({
    requestDate: new Date().toISOString().slice(0, 10),
    custodianKey: '',
    custodianName: '',
    description: '',
    amountRequested: '',
    remarks: '',
  });

  // Ledger Filtering & Custodian Selection
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerCategory, setLedgerCategory] = useState('all');
  const [ledgerType, setLedgerType] = useState<'all' | 'direct' | 'cash_request'>('all');
  const [selectedCustodian, setSelectedCustodian] = useState<string>('');

  useEffect(() => {
    if (custodianLedgers.length > 0 && !custodianLedgers.some((c) => c.custodianName === selectedCustodian)) {
      setSelectedCustodian(custodianLedgers[0].custodianName);
    }
  }, [custodianLedgers, selectedCustodian]);

  const totalSpent = Number(effectiveSummary.actualExpenses || 0);
  const totalBudget = Number(effectiveSummary.revisedBudget || 0);
  const contractAmount = Number(effectiveSummary.contractAmount || 0);
  const projectSavings = Number(effectiveSummary.projectSavings ?? totalBudget - totalSpent);
  const projectProfit = Number(effectiveSummary.projectProfit ?? contractAmount - totalSpent);
  const projectGpPct = Number(
    effectiveSummary.projectGpPct ?? (contractAmount > 0 ? (projectProfit / contractAmount) * 100 : 0)
  );
  const budgetPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  const totalPayments = Number(
    effectiveSummary.totalPaymentsReceived ?? payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  );
  const paymentCollectionPct = contractAmount > 0 ? Math.round((totalPayments / contractAmount) * 100) : 0;

  const handleSaveAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAnalysis(true);
    try {
      await apiRequest(`/api/projects/${projectId}/financial-analysis`, {
        method: 'PATCH',
        body: {
          contractAmount: Number(analysisForm.contractAmount || 0),
          revisedBudget: Number(analysisForm.revisedBudget || 0),
          tpcRate: Number(analysisForm.tpcRate || 0),
          salesCommission: Number(analysisForm.salesCommission || 0),
          opexAmount: Number(analysisForm.opexAmount || 0),
        },
      });
      setEditingAnalysis(false);
      onNotify('Project Financial Analysis parameters updated.');
      onRefresh();
    } finally {
      setSavingAnalysis(false);
    }
  };

  const handleSaveNote = async () => {
    setSavingNote(true);
    try {
      await apiRequest(`/api/projects/${projectId}/financial-analysis`, {
        method: 'PATCH',
        body: { financialNotes: noteText },
      });
      onNotify('Project Note Box saved.');
      onRefresh();
    } finally {
      setSavingNote(false);
    }
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest(`/api/projects/${projectId}/payments`, {
      method: 'POST',
      body: {
        paymentDate: paymentForm.paymentDate,
        amount: Number(paymentForm.amount),
        remarks: paymentForm.remarks,
        referenceNo: paymentForm.referenceNo,
      },
    });
    setPaymentForm({
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: '',
      remarks: '',
      referenceNo: '',
    });
    setShowPaymentForm(false);
    onNotify('Payment received recorded.');
    onRefresh();
  };

  const submitExpenseEntry = async (saveAsDraft: boolean) => {
    setExpError('');
    if (!expForm.expenseDate || !expForm.description.trim() || !expForm.amount || Number(expForm.amount) <= 0 || !expForm.supplierRecipient.trim()) {
      setExpError('Date, description, positive amount, and supplier/payee are required.');
      return;
    }

    if (!saveAsDraft) {
      if (expReceipts.length === 0 && !expForm.noReceiptException) {
        setExpError(
          'Receipt photograph proof is mandatory to submit a cash liquidation. Upload or take a receipt photo, or enable the controlled No-Receipt Exception workflow.'
        );
        return;
      }
      if (expForm.noReceiptException && (expForm.exceptionReason.trim().length < 5 || expSupports.length === 0)) {
        setExpError(
          'Controlled No-Receipt Exception requires both a clear explanation (at least 5 characters) AND alternative supporting proof uploaded.'
        );
        return;
      }
    }

    setSubmittingExp(true);
    try {
      const payload = {
        expenseDate: expForm.expenseDate,
        category: expForm.category,
        description: expForm.description.trim(),
        amount: Number(expForm.amount),
        supplierRecipient: expForm.supplierRecipient.trim(),
        paymentMethod: expForm.paymentMethod,
        employeeName: expForm.employeeName.trim() || expForm.custodianName.trim(),
        prId: expForm.prId ? Number(expForm.prId) : null,
        cashRequestId: expForm.cashRequestId ? Number(expForm.cashRequestId) : null,
        custodianName: expForm.custodianName.trim(),
        remarks: expForm.remarks.trim(),
        saveAsDraft,
        noReceiptException: expForm.noReceiptException,
        exceptionReason: expForm.exceptionReason.trim(),
        receiptsBase64: expReceipts.map((r) => ({
          dataUrl: r.dataUrl,
          fileName: r.fileName,
          caption: r.caption,
          category: r.category,
        })),
        supportDocsBase64: expSupports.map((s) => ({
          dataUrl: s.dataUrl,
          fileName: s.fileName,
          caption: s.caption,
          category: s.category,
        })),
      };

      const res = await mutateWithOfflineQueue({
        method: 'POST',
        url: `/api/projects/${projectId}/expenses`,
        body: payload,
        label: `Expense: ${expForm.description}`,
      });
      onNotify(
        res.queued
          ? 'Offline: Expense queued for sync.'
          : saveAsDraft
          ? 'Expense saved as Draft.'
          : 'Expense liquidation & receipt submitted for Finance / Supervisor review.'
      );
      setExpForm((prev) => ({
        ...prev,
        description: '',
        amount: '',
        supplierRecipient: '',
        prId: '',
        cashRequestId: '',
        custodianName: '',
        remarks: '',
        noReceiptException: false,
        exceptionReason: '',
      }));
      setExpReceipts([]);
      setExpSupports([]);
      if (!res.queued) onRefresh();
    } catch (err: any) {
      setExpError(err?.message || 'Unable to submit expense liquidation.');
    } finally {
      setSubmittingExp(false);
    }
  };

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitExpenseEntry(false);
  };

  const handleCreateCashRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosen = employeeOptions.find((o) => o.key === crForm.custodianKey);
    const resolvedName =
      crForm.custodianName.trim() ||
      (chosen ? chosen.label.replace(/\s*\([^)]*\)$/, '').trim() : '');
    if (!resolvedName) return;

    await apiRequest(`/api/projects/${projectId}/cash-requests`, {
      method: 'POST',
      body: {
        requestDate: crForm.requestDate,
        custodianName: resolvedName,
        custodianPersonnelId: chosen?.personnelId || null,
        custodianUserId: chosen?.userId || null,
        description: crForm.description,
        amountRequested: Number(crForm.amountRequested),
        remarks: crForm.remarks,
      },
    });
    setCrForm({
      requestDate: new Date().toISOString().slice(0, 10),
      custodianKey: '',
      custodianName: '',
      description: '',
      amountRequested: '',
      remarks: '',
    });
    onNotify('Custodian Cash Request recorded.');
    onRefresh();
  };

  // Filtered categorized ledger ("What are my expenses?")
  const filteredDirectExpenses = useMemo(() => {
    const q = ledgerSearch.toLowerCase().trim();
    return expenses.filter((ex) => {
      if (ex.cash_request_id) return false;
      if (ledgerType === 'cash_request') return false;
      if (ledgerCategory !== 'all' && ex.category !== ledgerCategory) return false;
      if (
        q &&
        !String(ex.description || '').toLowerCase().includes(q) &&
        !String(ex.category || '').toLowerCase().includes(q) &&
        !String(ex.supplier_recipient || '').toLowerCase().includes(q) &&
        !String(ex.remarks || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [expenses, ledgerSearch, ledgerCategory, ledgerType]);

  const filteredCashRequestGroups = useMemo(() => {
    if (ledgerType === 'direct') return [];
    const q = ledgerSearch.toLowerCase().trim();
    return cashRequests
      .map((cr) => {
        const children = expenses.filter((ex) => {
          if (ex.cash_request_id !== cr.id) return false;
          if (ledgerCategory !== 'all' && ex.category !== ledgerCategory) return false;
          if (
            q &&
            !String(ex.description || '').toLowerCase().includes(q) &&
            !String(ex.category || '').toLowerCase().includes(q) &&
            !String(cr.description || '').toLowerCase().includes(q) &&
            !String(cr.custodian_name || '').toLowerCase().includes(q)
          ) {
            return false;
          }
          return true;
        });
        const crMatchesQuery =
          !q ||
          String(cr.description || '').toLowerCase().includes(q) ||
          String(cr.custodian_name || '').toLowerCase().includes(q);
        if (ledgerCategory !== 'all' && children.length === 0) return null;
        if (q && !crMatchesQuery && children.length === 0) return null;
        return { cr, children };
      })
      .filter(Boolean) as Array<{ cr: any; children: any[] }>;
  }, [cashRequests, expenses, ledgerSearch, ledgerCategory, ledgerType]);

  const activeCustodianLedger = useMemo(
    () => custodianLedgers.find((c) => c.custodianName === selectedCustodian) || custodianLedgers[0] || null,
    [custodianLedgers, selectedCustodian]
  );

  const donutSegments = categorizedBreakdown
    .filter((c) => c.total > 0)
    .map((c) => ({
      label: c.category,
      value: c.total,
      color: CATEGORY_COLORS[c.category] || '#64748B',
    }));

  return (
    <div className="space-y-5">
      {/* 1. MY BUDGET & EXPENSES — Top 5 Executive KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
            <Banknote className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Project Amount (PO/Contract)</div>
            <div className="mt-0.5 font-display text-lg font-bold text-slate-900 tabular-nums truncate">
              {formatCurrencyExact(contractAmount)}
            </div>
            <div className="mt-1 text-[11px] font-medium text-blue-600 truncate">Contract Value</div>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-xs">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Total Budget</div>
            <div className="mt-0.5 font-display text-lg font-bold text-slate-900 tabular-nums truncate">
              {formatCurrencyExact(totalBudget)}
            </div>
            <div className="mt-1 text-[11px] font-medium text-teal-600 truncate">Approved Cost Target</div>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
            <Receipt className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Total Expenses</div>
            <div className="mt-0.5 font-display text-lg font-bold text-slate-900 tabular-nums truncate">
              {formatCurrencyExact(totalSpent)}
            </div>
            <div className="mt-1 text-[11px] font-medium text-amber-600 truncate tabular-nums">
              {budgetPct}% of Total Budget
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-xs ${
              projectSavings >= 0 ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          >
            <PiggyBank className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Project Savings</div>
            <div
              className={`mt-0.5 font-display text-lg font-bold tabular-nums truncate ${
                projectSavings >= 0 ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {formatCurrencyExact(projectSavings)}
            </div>
            <div
              className={`mt-1 text-[11px] font-medium truncate ${
                projectSavings >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {projectSavings >= 0 ? 'Under Approved Budget' : 'Over Budget Variance'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-xs">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Project Profit</div>
            <div
              className={`mt-0.5 font-display text-lg font-bold tabular-nums truncate ${
                projectProfit >= 0 ? 'text-slate-900' : 'text-red-600'
              }`}
            >
              {formatCurrencyExact(projectProfit)}
            </div>
            <div className="mt-1 text-[11px] font-medium text-violet-600 truncate tabular-nums">
              % GP: {projectGpPct.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* 2. BREAKDOWN OF EXPENSES (7 cols) + FINANCIAL ANALYSIS (5 cols) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Breakdown of Expenses */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">Breakdown of Expenses</h2>
              <p className="text-[11px] text-slate-500">
                Categorized project expenditure across permitting, manpower, materials, subcon, and field operations.
              </p>
            </div>
            {mode === 'overview' && onOpenFullFinancials && (
              <button
                type="button"
                onClick={onOpenFullFinancials}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap"
              >
                Full Ledger &amp; Cash Requests <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-12 items-center">
            <div className="md:col-span-5 flex flex-col items-center justify-center py-2">
              <DonutChart
                segments={donutSegments}
                centerValue={formatCurrencyExact(totalSpent)}
                centerLabel="Total Expenses"
                centerSublabel={`${budgetPct}% of Budget`}
                size={196}
                strokeWidth={28}
              />
            </div>

            <div className="md:col-span-7 divide-y divide-slate-100 text-xs">
              {categorizedBreakdown.map((row) => {
                const color = CATEGORY_COLORS[row.category] || '#64748B';
                return (
                  <div key={row.category} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="inline-flex items-center gap-2 text-slate-700 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="truncate font-medium">{row.category}</span>
                    </span>
                    <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                      <span className="w-11 text-right text-[11px] font-semibold text-slate-500">
                        {row.percentage.toFixed(0)}%
                      </span>
                      <span className="w-28 text-right font-semibold text-slate-900">
                        {formatCurrencyExact(row.total)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Financial Analysis */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">Financial Analysis</h2>
                <p className="text-[11px] text-slate-500">Cost build-up, commercial deductions, and Final GP.</p>
              </div>
              {hasPerm('financials', 'edit') && (
                <button
                  type="button"
                  onClick={() => setEditingAnalysis((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Pencil className="h-3 w-3" />
                  {editingAnalysis ? 'Close' : 'Edit'}
                </button>
              )}
            </div>

            {editingAnalysis ? (
              <form onSubmit={handleSaveAnalysis} className="space-y-3 text-xs border-t border-slate-100 pt-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Project Amount (PO)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={analysisForm.contractAmount}
                      onChange={(e) => setAnalysisForm({ ...analysisForm, contractAmount: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Total Budget</label>
                    <input
                      type="number"
                      step="0.01"
                      value={analysisForm.revisedBudget}
                      onChange={(e) => setAnalysisForm({ ...analysisForm, revisedBudget: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">TPC Rate (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={analysisForm.tpcRate}
                      onChange={(e) => setAnalysisForm({ ...analysisForm, tpcRate: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Sales Commission</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={analysisForm.salesCommission}
                      onChange={(e) => setAnalysisForm({ ...analysisForm, salesCommission: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">OPEX Allocation</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={analysisForm.opexAmount}
                    onChange={(e) => setAnalysisForm({ ...analysisForm, opexAmount: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditingAnalysis(false)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingAnalysis}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Analysis
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 font-semibold">
                  <span className="text-slate-700">Project Amount</span>
                  <span className="font-mono text-slate-900 tabular-nums">{formatCurrencyExact(contractAmount)}</span>
                </div>

                <div className="divide-y divide-slate-100">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-600">Project Cost</span>
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      {formatCurrencyExact(effectiveSummary.actualExpenses)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-600">
                      TPC ({Number(effectiveSummary.tpcRate || 0).toFixed(1)}%)
                    </span>
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      {formatCurrencyExact(effectiveSummary.tpcAmount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-600">Sales Commission</span>
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      {formatCurrencyExact(effectiveSummary.salesCommission)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-600">Savings (Budget vs. Cost)</span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        projectSavings >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {formatCurrencyExact(projectSavings)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-600">OPEX</span>
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      {formatCurrencyExact(effectiveSummary.opexAmount)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-xs">
            <div className="flex items-center justify-between font-semibold">
              <span className="text-slate-800">TOTAL COST</span>
              <span className="font-mono text-sm text-slate-900 tabular-nums">
                {formatCurrencyExact(effectiveSummary.totalCost)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200/80 px-3 py-2.5">
              <span className="font-display text-xs font-bold text-slate-900">FINAL GP</span>
              <div className="flex items-center gap-3 font-mono tabular-nums">
                <span
                  className={`text-sm font-bold ${
                    Number(effectiveSummary.finalGp ?? 0) >= 0 ? 'text-slate-900' : 'text-red-700'
                  }`}
                >
                  {formatCurrencyExact(effectiveSummary.finalGp)}
                </span>
                <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">
                  {Number(effectiveSummary.finalGpPct ?? 0).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. PAYMENT RECEIVED + PROJECT NOTE BOX */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Payment Received */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">Payment Received</h2>
              <p className="text-[11px] text-slate-500">
                Client downpayments &amp; progress billings collected: {formatCurrencyExact(totalPayments)} (
                {paymentCollectionPct}% of contract)
              </p>
            </div>
            {hasPerm('financials', 'create') && (
              <button
                type="button"
                onClick={() => setShowPaymentForm((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" /> Record Payment
              </button>
            )}
          </div>

          {showPaymentForm && (
            <form
              onSubmit={handleAddPayment}
              className="mb-4 grid grid-cols-1 gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4"
            >
              <div>
                <label className="block font-medium text-slate-700 mb-1">Date *</label>
                <input
                  type="date"
                  required
                  value={paymentForm.paymentDate}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Remarks (e.g., 50% Downpayment) *</label>
                <div className="flex gap-2">
                  <input
                    required
                    placeholder="50% Downpayment / Progress Billing"
                    value={paymentForm.remarks}
                    onChange={(e) => setPaymentForm({ ...paymentForm, remarks: e.target.value })}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold">Remarks</th>
                  {hasPerm('financials', 'edit') && <th className="px-3 py-2 text-right font-semibold">Remove</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((pay) => (
                  <tr key={pay.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-mono text-slate-700">{pay.payment_date}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrencyExact(pay.amount)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{pay.remarks || 'Progress Payment'}</td>
                    {hasPerm('financials', 'edit') && (
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            await apiRequest(`/api/payments/${pay.id}`, { method: 'DELETE' });
                            onRefresh();
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Delete payment entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      No client payments recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
              {payments.length > 0 && (
                <tfoot className="border-t border-slate-200 bg-slate-50/70 font-semibold">
                  <tr>
                    <td className="px-3 py-2 text-slate-700">Total Received</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700 tabular-nums">
                      {formatCurrencyExact(totalPayments)}
                    </td>
                    <td colSpan={hasPerm('financials', 'edit') ? 2 : 1} className="px-3 py-2 text-slate-600">
                      Receivable Balance: {formatCurrencyExact(effectiveSummary.outstandingReceivable)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Note Box */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-amber-600" />
                <h2 className="font-display text-base font-semibold text-slate-900">Note Box</h2>
              </div>
              {hasPerm('financials', 'edit') && (
                <button
                  type="button"
                  onClick={handleSaveNote}
                  disabled={savingNote}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Save className="h-3 w-3" />
                  {savingNote ? 'Saving...' : 'Save Note'}
                </button>
              )}
            </div>
            <textarea
              rows={6}
              readOnly={!hasPerm('financials', 'edit')}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Record billing caveats, contract variations, retention terms, or custodian reconciliation reminders..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-800 leading-relaxed focus:border-slate-900 focus:bg-white focus:outline-none"
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Internal finance &amp; project management memo (never exposed to Client Portal).
          </p>
        </div>
      </div>

      {/* 4. FULL MODE: ENTRY FORMS + "WHAT ARE MY EXPENSES?" + CUSTODIAN CASH LIQUIDATION TRACKER */}
      {mode === 'full' && (
        <div className="space-y-5">
          {/* Entry Forms (Record Expense or Issue Cash Request) */}
          {hasPerm('financials', 'create') && (
            <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 mb-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Record Financial Entry
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Log direct/liquidated project expenses under the 12 spreadsheet categories or issue a custodian cash request.
                  </p>
                </div>
                <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setEntryTab('expense')}
                    className={`rounded-md px-3 py-1 font-medium transition-colors whitespace-nowrap ${
                      entryTab === 'expense' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Record Expense / Liquidation
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryTab('cash_request')}
                    className={`rounded-md px-3 py-1 font-medium transition-colors whitespace-nowrap ${
                      entryTab === 'cash_request' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Issue Cash Request
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryTab('review_queue')}
                    className={`rounded-md px-3 py-1 font-medium transition-colors whitespace-nowrap ${
                      entryTab === 'review_queue' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Liquidation Review Queue
                  </button>
                </div>
              </div>

              {entryTab === 'review_queue' ? (
                <LiquidationReviewView projectId={projectId} embedded onRefreshParent={onRefresh} />
              ) : entryTab === 'expense' ? (
                <form onSubmit={handleSubmitExpense} className="space-y-4 text-xs">
                  {expError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-red-700">
                      {expError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Date *</label>
                      <input
                        type="date"
                        required
                        value={expForm.expenseDate}
                        onChange={(e) => setExpForm({ ...expForm, expenseDate: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Category *</label>
                      <select
                        value={expForm.category}
                        onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                      >
                        {SPREADSHEET_EXPENSE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                        <option value="Equipment">Equipment</option>
                        <option value="Other Expenses">Other Expenses</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block font-medium text-slate-700 mb-1">Description *</label>
                      <input
                        required
                        placeholder="e.g., Payment for PO#2026-056 or Transportation liquidation"
                        value={expForm.description}
                        onChange={(e) => setExpForm({ ...expForm, description: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Amount *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={expForm.amount}
                        onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Supplier / Payee *</label>
                      <input
                        required
                        placeholder="Vendor or site payee"
                        value={expForm.supplierRecipient}
                        onChange={(e) => setExpForm({ ...expForm, supplierRecipient: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block font-medium text-slate-700 mb-1">Link to Cash Request (Optional)</label>
                      <select
                        value={expForm.cashRequestId}
                        onChange={(e) => {
                          const crId = e.target.value;
                          const matched = cashRequests.find((c) => String(c.id) === crId);
                          setExpForm({
                            ...expForm,
                            cashRequestId: crId,
                            custodianName: matched ? matched.custodian_name : expForm.custodianName,
                            employeeName: matched ? matched.custodian_name : expForm.employeeName,
                          });
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                      >
                        <option value="">— Direct Expense (Not a Cash Liquidation) —</option>
                        {cashRequests.map((cr) => (
                          <option key={cr.id} value={cr.id}>
                            {cr.request_date} · {cr.description} ({formatCurrencyExact(cr.amount_requested)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Employee / Custodian</label>
                      <input
                        placeholder="e.g., Tim Mabalot"
                        value={expForm.custodianName}
                        onChange={(e) =>
                          setExpForm({ ...expForm, custodianName: e.target.value, employeeName: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Payment Method</label>
                      <select
                        value={expForm.paymentMethod}
                        onChange={(e) => setExpForm({ ...expForm, paymentMethod: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                      >
                        <option value="Cash">Cash</option>
                        <option value="GCash / E-Wallet">GCash / E-Wallet</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Check">Check</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Settle PR (Optional)</label>
                      <select
                        value={expForm.prId}
                        onChange={(e) => setExpForm({ ...expForm, prId: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                      >
                        <option value="">— None —</option>
                        {prs
                          .filter((pr) => pr.commitment_amount > pr.settled_amount)
                          .map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.ref_number} ({formatCurrencyExact(pr.commitment_amount - pr.settled_amount)})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Remarks</label>
                      <input
                        placeholder="30% Downpayment / Full Payment"
                        value={expForm.remarks}
                        onChange={(e) => setExpForm({ ...expForm, remarks: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                      />
                    </div>
                  </div>

                  {/* Mandatory Receipt Proof & Controlled No-Receipt Exception */}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <EvidenceFilePicker
                      label="Receipt Photographs"
                      helperText="Mandatory for submission: capture a live receipt photo with your camera or upload official receipt photos (JPG/PNG/WEBP)."
                      items={expReceipts}
                      onChange={setExpReceipts}
                      imagesOnly
                      defaultCategory="Official Receipt"
                      requiredMark={!expForm.noReceiptException}
                    />
                    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                      <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={expForm.noReceiptException}
                          onChange={(e) => setExpForm({ ...expForm, noReceiptException: e.target.checked })}
                        />
                        <FileWarning className="h-4 w-4 text-amber-600" />
                        <span>Request Controlled No-Receipt Exception</span>
                      </label>
                      {expForm.noReceiptException ? (
                        <div className="space-y-2.5">
                          <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                            Requires supervisor/management authorization plus alternative proof (acknowledgment slip,
                            screenshot, or signed voucher).
                          </div>
                          <input
                            required={expForm.noReceiptException}
                            placeholder="Explain clearly why an official receipt is unavailable..."
                            value={expForm.exceptionReason}
                            onChange={(e) => setExpForm({ ...expForm, exceptionReason: e.target.value })}
                            className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5"
                          />
                          <EvidenceFilePicker
                            label="Alternative Supporting Proof"
                            items={expSupports}
                            onChange={setExpSupports}
                            defaultCategory="No-Receipt Alternative Proof"
                            requiredMark
                          />
                        </div>
                      ) : (
                        <EvidenceFilePicker
                          label="Additional Supporting Documents (Optional)"
                          helperText="Delivery slips, remittance screenshots, or voucher attachments."
                          items={expSupports}
                          onChange={setExpSupports}
                          defaultCategory="Supporting Document"
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={submittingExp}
                      onClick={() => submitExpenseEntry(true)}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Save as Draft
                    </button>
                    <button
                      type="submit"
                      disabled={submittingExp}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      {submittingExp ? 'Submitting...' : 'Submit Liquidation'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleCreateCashRequest} className="grid grid-cols-1 gap-3 text-xs md:grid-cols-6">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Request Date *</label>
                    <input
                      type="date"
                      required
                      value={crForm.requestDate}
                      onChange={(e) => setCrForm({ ...crForm, requestDate: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Select Staff / Custodian</label>
                    <select
                      value={crForm.custodianKey}
                      onChange={(e) => {
                        const chosen = employeeOptions.find((o) => o.key === e.target.value);
                        const name = chosen ? chosen.label.replace(/\s*\([^)]*\)$/, '').trim() : '';
                        setCrForm({
                          ...crForm,
                          custodianKey: e.target.value,
                          custodianName: name || crForm.custodianName,
                          description: name && !crForm.description ? `${name} Cash Request` : crForm.description,
                        });
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                    >
                      <option value="">Choose staff or type name...</option>
                      {employeeOptions.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Custodian Name *</label>
                    <input
                      required
                      placeholder="e.g., Allan Fadrigon"
                      value={crForm.custodianName}
                      onChange={(e) => setCrForm({ ...crForm, custodianName: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">Cash Request Title *</label>
                    <input
                      required
                      placeholder="e.g., Allan Fadrigon Cash Request 1"
                      value={crForm.description}
                      onChange={(e) => setCrForm({ ...crForm, description: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Cash Requested *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={crForm.amountRequested}
                      onChange={(e) => setCrForm({ ...crForm, amountRequested: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div className="md:col-span-5">
                    <label className="block font-medium text-slate-700 mb-1">Remarks</label>
                    <input
                      placeholder="Purpose or cash release notes..."
                      value={crForm.remarks}
                      onChange={(e) => setCrForm({ ...crForm, remarks: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-amber-600 py-2 font-semibold text-white hover:bg-amber-700"
                    >
                      Release Cash Request
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Bottom Split: "What are my expenses?" (7 cols) + Custodian Cash Liquidation Tracker (5 cols) */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* What are my expenses? */}
            <div className="lg:col-span-7 rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900">What are my expenses?</h2>
                  <p className="text-[11px] text-slate-500">
                    Detailed project ledger grouping cash request releases with itemized liquidations and direct expenses.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      value={ledgerSearch}
                      onChange={(e) => setLedgerSearch(e.target.value)}
                      placeholder="Search description..."
                      className="w-40 rounded-lg border border-slate-300 pl-8 pr-2.5 py-1 text-xs focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                  <select
                    value={ledgerCategory}
                    onChange={(e) => setLedgerCategory(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700"
                  >
                    <option value="all">All Categories</option>
                    {SPREADSHEET_EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={ledgerType}
                    onChange={(e) => setLedgerType(e.target.value as any)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700"
                  >
                    <option value="all">All Entries</option>
                    <option value="direct">Direct Expenses</option>
                    <option value="cash_request">Cash Requests</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold">Date</th>
                      <th className="px-3.5 py-2.5 font-semibold">Description</th>
                      <th className="px-3.5 py-2.5 font-semibold">Category</th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">Cash Requested</th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">Expense</th>
                      <th className="px-3.5 py-2.5 font-semibold">Remarks</th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">Status / Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {/* Direct Expenses */}
                    {filteredDirectExpenses.map((ex) => (
                      <tr key={`exp-${ex.id}`} className="hover:bg-slate-50/70">
                        <td className="px-3.5 py-2.5 font-mono text-slate-600 whitespace-nowrap">{ex.expense_date}</td>
                        <td className="px-3.5 py-2.5">
                          <div className="font-medium text-slate-900">{ex.description}</div>
                          <div className="text-[11px] text-slate-500">
                            {ex.ref_number} · {ex.supplier_recipient}
                            {ex.pr_ref ? ` · PR ${ex.pr_ref}` : ''}
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-700 whitespace-nowrap">{ex.category}</td>
                        <td className="px-3.5 py-2.5 text-right font-mono text-slate-400">—</td>
                        <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatCurrencyExact(ex.amount)}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-600">
                          <div>{ex.remarks || '—'}</div>
                          {ex.receipt_count > 0 ? (
                            <div className="text-[10px] text-emerald-700">
                              {ex.receipt_count} receipt photo{ex.receipt_count > 1 ? 's' : ''}
                            </div>
                          ) : ex.no_receipt_exception === 1 ? (
                            <div className="text-[10px] text-amber-700">No-Receipt Exception</div>
                          ) : null}
                        </td>
                        <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <StatusLabel status={ex.status} />
                            <button
                              type="button"
                              onClick={() => setReviewExpenseId(ex.id)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-900 hover:text-white"
                            >
                              <Eye className="h-3 w-3" />
                              {['pending', 'submitted', 'pending_review', 'resubmitted'].includes(ex.status) &&
                              hasPerm('financials', 'approve')
                                ? 'Review'
                                : ['draft', 'for_correction', 'correction_needed'].includes(ex.status)
                                ? 'Upload / Submit'
                                : 'Receipts'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {/* Cash Requests + Grouped Indented Liquidated Items */}
                    {filteredCashRequestGroups.map(({ cr, children }) => (
                      <React.Fragment key={`cr-${cr.id}`}>
                        <tr className="bg-amber-50/90 border-t border-amber-200/80">
                          <td className="px-3.5 py-2.5 font-mono font-semibold text-slate-800 whitespace-nowrap">
                            {cr.request_date}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <div className="font-semibold text-slate-900">{cr.description}</div>
                            <div className="text-[11px] text-amber-800">
                              {cr.ref_number} · Custodian: {cr.custodian_name}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 text-[11px] font-medium text-amber-900">Cash Request</td>
                          <td className="px-3.5 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                            {formatCurrencyExact(cr.amount_requested)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono text-[11px] text-amber-900 tabular-nums whitespace-nowrap">
                            Liq: {formatCurrencyExact(cr.liquidated_total)}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700">{cr.remarks || '—'}</td>
                          <td className="px-3.5 py-2.5 text-right">
                            {hasPerm('financials', 'edit') && children.length === 0 && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiRequest(`/api/cash-requests/${cr.id}`, { method: 'DELETE' });
                                  onRefresh();
                                }}
                                className="rounded p-1 text-amber-700 hover:bg-red-50 hover:text-red-600"
                                title="Delete empty cash request"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>

                        {children.map((ex) => (
                          <tr key={`cr-child-${ex.id}`} className="bg-white hover:bg-slate-50/60">
                            <td className="px-3.5 py-2 font-mono text-slate-400 whitespace-nowrap">
                              {ex.expense_date}
                            </td>
                            <td className="pl-8 pr-3.5 py-2">
                              <div className="font-medium text-slate-800">{ex.description}</div>
                              <div className="text-[11px] text-slate-400">
                                {ex.ref_number} · {ex.supplier_recipient}
                              </div>
                            </td>
                            <td className="px-3.5 py-2 text-slate-600 whitespace-nowrap">{ex.category}</td>
                            <td className="px-3.5 py-2 text-right font-mono text-slate-300">—</td>
                            <td className="px-3.5 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                              {formatCurrencyExact(ex.amount)}
                            </td>
                            <td className="px-3.5 py-2 text-slate-500">
                              <div>{ex.remarks || '—'}</div>
                              {ex.receipt_count > 0 ? (
                                <div className="text-[10px] text-emerald-700">
                                  {ex.receipt_count} receipt photo{ex.receipt_count > 1 ? 's' : ''}
                                </div>
                              ) : ex.no_receipt_exception === 1 ? (
                                <div className="text-[10px] text-amber-700">No-Receipt Exception</div>
                              ) : null}
                            </td>
                            <td className="px-3.5 py-2 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <StatusLabel status={ex.status} />
                                <button
                                  type="button"
                                  onClick={() => setReviewExpenseId(ex.id)}
                                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-900 hover:text-white"
                                >
                                  <Eye className="h-3 w-3" />
                                  {['pending', 'submitted', 'pending_review', 'resubmitted'].includes(ex.status) &&
                                  hasPerm('financials', 'approve')
                                    ? 'Review'
                                    : ['draft', 'for_correction', 'correction_needed'].includes(ex.status)
                                    ? 'Upload / Submit'
                                    : 'Receipts'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}

                    {filteredDirectExpenses.length === 0 && filteredCashRequestGroups.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                          No expenses or cash requests match your filters yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Custodian Cash Liquidation Tracker (Tim Mabalot style running ledger) */}
            <div className="lg:col-span-5 rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden flex flex-col">
              <div className="border-b border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Custodian Cash Liquidation
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Running Cash Requested vs. Cash Liquidated &amp; Cash on Hand per custodian.
                  </p>
                </div>
                {custodianLedgers.length > 0 && (
                  <select
                    value={activeCustodianLedger?.custodianName || ''}
                    onChange={(e) => setSelectedCustodian(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                  >
                    {custodianLedgers.map((cl) => (
                      <option key={cl.custodianName} value={cl.custodianName}>
                        {cl.custodianName}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {activeCustodianLedger ? (
                <>
                  <div className="grid grid-cols-3 gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500">Total Requested</div>
                      <div className="font-mono font-bold text-slate-900 tabular-nums">
                        {formatCurrencyExact(activeCustodianLedger.totalRequested)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Total Liquidated</div>
                      <div className="font-mono font-bold text-amber-700 tabular-nums">
                        {formatCurrencyExact(activeCustodianLedger.totalLiquidated)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Cash on Hand</div>
                      <div
                        className={`font-mono font-bold tabular-nums ${
                          activeCustodianLedger.cashOnHand >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {formatAccountingParen(activeCustodianLedger.cashOnHand)}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto flex-1">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Date</th>
                          <th className="px-3 py-2 font-semibold text-right">Cash Requested</th>
                          <th className="px-3 py-2 font-semibold text-right">Cash Liquidated</th>
                          <th className="px-3 py-2 font-semibold text-right">Cash on Hand</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeCustodianLedger.entries.map((row: any, idx: number) => (
                          <tr key={`${row.ref}-${idx}`} className="hover:bg-slate-50/70">
                            <td className="px-3 py-2">
                              <div className="font-mono text-slate-800 whitespace-nowrap">{row.date}</div>
                              <div className="text-[10px] text-slate-500 truncate max-w-[130px]" title={row.description}>
                                {row.description}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-800 tabular-nums whitespace-nowrap">
                              {row.cashRequested > 0 ? formatCurrencyExact(row.cashRequested) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-800 tabular-nums whitespace-nowrap">
                              {row.cashLiquidated > 0 ? formatCurrencyExact(row.cashLiquidated) : '—'}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                row.cashOnHand < 0 ? 'text-red-600' : 'text-slate-900'
                              }`}
                            >
                              {formatAccountingParen(row.cashOnHand)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-xs text-slate-500">
                  <Wallet className="h-8 w-8 text-slate-300 mb-2" />
                  <p className="font-medium text-slate-700">No custodian cash advances yet</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Issue a Cash Request to track running Cash Requested, Liquidated, and Cash on Hand per custodian.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {reviewExpenseId !== null && (
        <ExpenseReviewModal
          expenseId={reviewExpenseId}
          onClose={() => setReviewExpenseId(null)}
          onUpdated={onRefresh}
        />
      )}
    </div>
  );
};
