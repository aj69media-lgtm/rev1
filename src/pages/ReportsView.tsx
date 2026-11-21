import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Printer } from 'lucide-react';
import { StatusLabel } from '../components/Charts';
import { apiRequest, formatCurrency } from '../lib/api';

type ReportType = 'project_status' | 'financial_summary' | 'tasks' | 'procurement' | 'personnel' | 'inventory';

export const ReportsView: React.FC = () => {
  const [reportType, setReportType] = useState<ReportType>('project_status');
  const [execData, setExecData] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [prs, setPrs] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiRequest('/api/dashboard/executive').catch(() => null),
      apiRequest('/api/tasks').catch(() => ({ tasks: [] })),
      apiRequest('/api/purchase-requests').catch(() => ({ purchaseRequests: [] })),
      apiRequest('/api/personnel').catch(() => ({ personnel: [] })),
      apiRequest('/api/inventory').catch(() => ({ items: [] })),
    ])
      .then(([ex, t, p, per, inv]) => {
        setExecData(ex);
        setTasks(t?.tasks || []);
        setPrs(p?.purchaseRequests || []);
        setPersonnel(per?.personnel || []);
        setInventory(inv?.items || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const projects: any[] = execData?.projects || [];

  const getActiveRows = (): Array<Record<string, unknown>> => {
    const pid = projectFilter === 'all' ? null : Number(projectFilter);
    if (reportType === 'project_status') {
      return projects
        .filter((p) => !pid || p.id === pid)
        .map((p) => ({
          Reference: p.ref_number,
          Project: p.name,
          Client: p.client_name,
          Status: p.status,
          Health: p.schedule?.healthStatus,
          'Planned %': p.schedule?.plannedProgress,
          'Actual %': p.schedule?.actualProgress,
          'Variance %': p.schedule?.progressVariance,
          'Target End': p.revised_end_date || p.original_end_date,
        }));
    }
    if (reportType === 'financial_summary') {
      return projects
        .filter((p) => !pid || p.id === pid)
        .map((p) => ({
          Reference: p.ref_number,
          Project: p.name,
          'Contract Amount': p.financials?.contractAmount,
          'Approved Budget': p.financials?.revisedBudget,
          'Actual Expenses': p.financials?.actualExpenses,
          'Open Commitments': p.financials?.outstandingCommitments,
          'Remaining Budget': p.financials?.remainingAvailableBudget,
          'Forecast Final Cost': p.financials?.forecastFinalCost,
          'Estimated Profit': p.financials?.estimatedProfit,
          'SPI': p.evm?.spi ?? 'Provisional',
          'CPI': p.evm?.cpi ?? 'Provisional',
        }));
    }
    if (reportType === 'tasks') {
      return tasks
        .filter((t) => !pid || t.project_id === pid)
        .map((t) => ({
          Ref: t.ref_number,
          Project: t.project_name,
          Title: t.title,
          Assignee: t.assigned_to_name || 'Unassigned',
          Priority: t.priority,
          Status: t.status,
          Progress: `${t.progress_pct}%`,
          Deadline: t.deadline,
        }));
    }
    if (reportType === 'procurement') {
      return prs
        .filter((pr) => !pid || pr.project_id === pid)
        .map((pr) => ({
          'PR Ref': pr.ref_number,
          Project: pr.project_name,
          Item: pr.item_description,
          Category: pr.category,
          Qty: `${pr.quantity} ${pr.unit}`,
          'Estimated Cost': pr.estimated_total_cost,
          Commitment: pr.commitment_amount,
          Settled: pr.settled_amount,
          Status: pr.status,
        }));
    }
    if (reportType === 'personnel') {
      return personnel
        .filter((per) => !pid || per.assigned_project_id === pid)
        .map((per) => ({
          'Employee ID': per.employee_code,
          Name: per.full_name,
          Position: per.position,
          Trade: per.trade_skill,
          Project: per.project_name || 'Unassigned',
          Status: per.employment_status,
        }));
    }
    return inventory
      .filter((i) => !pid || i.assigned_project_id === pid)
      .map((i) => ({
        SKU: i.sku,
        Item: i.name,
        Category: i.category,
        'Current Qty': `${i.current_qty} ${i.unit}`,
        'Min Stock': i.min_stock_level,
        Location: i.storage_location,
        'Unit Cost': i.unit_cost,
      }));
  };

  const rows = getActiveRows();

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CBMS Report');
    XLSX.writeFile(wb, `CBMS_${reportType}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportCsv = () => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CBMS_${reportType}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Management Reports & Exports</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Database-reconciled operational, schedule, EVM, procurement, and resource reports.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={exportExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export Excel (.xlsx)
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Printer className="h-3.5 w-3.5" />
            Print / Save PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 no-print">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          {[
            ['project_status', 'Project & Schedule'],
            ['financial_summary', 'Budget & EVM'],
            ['tasks', 'Tasks'],
            ['procurement', 'Procurement'],
            ['personnel', 'Personnel'],
            ['inventory', 'Inventory'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setReportType(key as ReportType)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                reportType === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800"
        >
          <option value="all">All Accessible Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.ref_number} · {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Report Output · {rows.length} Record(s)
          </h2>
          <span className="font-mono text-xs text-slate-500">Generated {new Date().toISOString().slice(0, 10)}</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Compiling report data...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No records match the current report filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  {Object.keys(rows[0]).map((col) => (
                    <th key={col} className="px-4 py-2.5 font-semibold whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    {Object.entries(row).map(([col, val]) => {
                      const isMoney = ['Contract Amount', 'Approved Budget', 'Actual Expenses', 'Open Commitments', 'Remaining Budget', 'Forecast Final Cost', 'Estimated Profit', 'Estimated Cost', 'Commitment', 'Settled', 'Unit Cost'].includes(col);
                      const isStatus = ['Status', 'Health'].includes(col);
                      return (
                        <td key={col} className="px-4 py-2.5 font-mono text-slate-800 tabular-nums whitespace-nowrap">
                          {isStatus ? (
                            <StatusLabel status={String(val || '')} />
                          ) : isMoney && typeof val === 'number' ? (
                            formatCurrency(val)
                          ) : (
                            String(val ?? '—')
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
