import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  FileText,
  Flag,
  Package,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import { DonutChart, StatusLabel } from '../components/Charts';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { formatCurrency } from '../lib/api';

interface ExecutiveDashboardProps {
  onOpenProject: (projectId: number) => void;
  onNavigate: (section: string) => void;
}

function formatCompactCurrency(amount: number): string {
  const n = Number(amount || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return formatCurrency(n);
}

function formatRelativeTime(iso: string): string {
  if (!iso) return 'Recently';
  const ts = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(ts)) return iso.slice(0, 10);
  const diffMin = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return iso.slice(0, 10);
}

function formatDaysLeft(targetDate: string): { text: string; tone: string } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const tgt = new Date(`${targetDate}T00:00:00`);
  const days = Math.round((tgt.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: 'text-red-600' };
  if (days === 0) return { text: 'Due today', tone: 'text-amber-600' };
  if (days <= 10) return { text: `${days} days left`, tone: 'text-blue-600' };
  if (days <= 20) return { text: `${days} days left`, tone: 'text-emerald-600' };
  if (days <= 30) return { text: `${days} days left`, tone: 'text-amber-600' };
  return { text: `${days} days left`, tone: 'text-violet-600' };
}

const BUDGET_COLORS = ['#2563EB', '#16A34A', '#F59E0B', '#7C3AED', '#0D9488', '#64748B'];

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({ onOpenProject, onNavigate }) => {
  const { user } = useAuth();
  const { fetchWithCache, syncVersion } = useSync();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fromCache, setFromCache] = useState(false);

  const [progressFilter, setProgressFilter] = useState<string>('all');
  const [budgetProjectId, setBudgetProjectId] = useState<string>('all');
  const [rangeLabel, setRangeLabel] = useState<string>('Portfolio YTD');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'progress' | 'budget'>('name');

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchWithCache('executive_dashboard', '/api/dashboard/executive')
      .then((res) => {
        if (!active) return;
        setData(res.data);
        setFromCache(res.fromCache);
        setError('');
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || 'Unable to load executive metrics');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchWithCache, syncVersion]);

  const projects: any[] = data?.projects || [];

  const progressOverviewProjects = useMemo(() => {
    return projects
      .filter((p) => {
        if (progressFilter === 'all') return true;
        const h = (p.schedule?.healthStatus || '').toLowerCase();
        if (progressFilter === 'on_track') return h === 'on schedule' || h === 'ahead of schedule';
        if (progressFilter === 'at_risk') return h === 'at risk';
        if (progressFilter === 'delayed') return h === 'delayed' || h === 'behind schedule';
        return true;
      })
      .slice(0, 6);
  }, [projects, progressFilter]);

  const budgetSummary = useMemo(() => {
    const fo = data?.financialOverview || {};
    if (budgetProjectId === 'all') {
      const totalBudget = Number(fo.totalApprovedBudgets || 0);
      const spent = Number(fo.totalActualExpenditures || 0);
      const commitments = Number(fo.totalOutstandingCommitments || 0);
      const remaining = totalBudget - spent - commitments;
      const pct = totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0;
      const cats: Array<{ category: string; total: number }> = data?.charts?.expenseCategories || [];
      return { totalBudget, spent, commitments, remaining, pct, cats };
    }
    const proj = projects.find((p) => String(p.id) === budgetProjectId);
    const totalBudget = Number(proj?.financials?.revisedBudget || 0);
    const spent = Number(proj?.financials?.actualExpenses || 0);
    const commitments = Number(proj?.financials?.outstandingCommitments || 0);
    const remaining = totalBudget - spent - commitments;
    const pct = totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0;
    const cats: Array<{ category: string; total: number }> = proj?.expenseCategories || [];
    return { totalBudget, spent, commitments, remaining, pct, cats };
  }, [data, projects, budgetProjectId]);

  const taskBreakdown = useMemo(() => {
    const dist: Array<{ status: string; cnt: number }> = data?.charts?.taskStatusDistribution || [];
    const countOf = (statuses: string[]) =>
      dist.filter((d) => statuses.includes(d.status)).reduce((s, d) => s + Number(d.cnt || 0), 0);

    const completed = countOf(['completed']);
    const inProgress = countOf(['in_progress', 'for_review', 'acknowledged']);
    const pending = countOf(['pending', 'on_hold']);
    const overdue = countOf(['overdue']);
    const total = Math.max(0, completed + inProgress + pending + overdue);

    return {
      total,
      items: [
        { label: 'Completed', value: completed, color: '#2563EB' },
        { label: 'In Progress', value: inProgress, color: '#16A34A' },
        { label: 'Pending', value: pending, color: '#F59E0B' },
        { label: 'Overdue', value: overdue, color: '#EF4444' },
      ],
    };
  }, [data]);

  const filteredProjects = useMemo(() => {
    const q = search.toLowerCase().trim();
    return [...projects]
      .filter((p: any) => {
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (
          q &&
          !p.name.toLowerCase().includes(q) &&
          !p.ref_number.toLowerCase().includes(q) &&
          !p.client_name.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a: any, b: any) => {
        if (sortBy === 'progress') return (b.schedule?.actualProgress || 0) - (a.schedule?.actualProgress || 0);
        if (sortBy === 'budget') return (b.financials?.revisedBudget || 0) - (a.financials?.revisedBudget || 0);
        return a.name.localeCompare(b.name);
      });
  }, [projects, search, statusFilter, sortBy]);

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="lg:col-span-7 h-80 animate-pulse rounded-xl border border-slate-200 bg-white" />
          <div className="lg:col-span-5 h-80 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{error}</div>;
  }

  const po = data?.projectOverview || {};
  const fo = data?.financialOverview || {};
  const oo = data?.operationalOverview || {};
  const upcomingMilestones: any[] = data?.upcomingMilestones || [];
  const recentActivity: any[] = data?.recentActivity || [];

  const totalBudgets = Number(fo.totalApprovedBudgets || 0);
  const totalSpent = Number(fo.totalActualExpenditures || 0);
  const budgetPct = totalBudgets > 0 ? Math.round((totalSpent / totalBudgets) * 100) : 0;
  const totalTasks = Number(oo.totalTasks ?? taskBreakdown.total);
  const completedTasks = Number(oo.completedTasks ?? 0);

  const firstName = user?.full_name?.split(' ')[0] || 'Executive';

  return (
    <div className="space-y-5">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Construction Project Tracker
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Welcome back, {firstName}! Live schedule, budget, and site activity across your portfolio
            {fromCache ? ' · Showing offline cached snapshot' : ''}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs">
            <Calendar className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={rangeLabel}
              onChange={(e) => setRangeLabel(e.target.value)}
              aria-label="Reporting timeframe"
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
            >
              <option value="Portfolio YTD">Portfolio YTD</option>
              <option value="Current Quarter">Current Quarter</option>
              <option value="Last 30 Days">Last 30 Days</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-2xs"
          >
            Reports
          </button>
        </div>
      </div>

      {/* Top Row: 5 KPI Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* 1. Total Projects */}
        <button
          type="button"
          onClick={() => onNavigate('projects')}
          className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 text-left shadow-2xs transition-shadow hover:shadow-md"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Total Projects</div>
            <div className="mt-0.5 font-display text-2xl font-bold text-slate-900 tabular-nums leading-none">
              {po.totalProjects ?? 0}
            </div>
            <div className="mt-1.5 text-[11px] font-medium text-blue-600 truncate">
              {po.activeProjects ?? 0} Active Projects
            </div>
          </div>
        </button>

        {/* 2. Overall Progress */}
        <div className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Overall Progress</div>
            <div className="mt-0.5 font-display text-2xl font-bold text-slate-900 tabular-nums leading-none">
              {Math.round(Number(po.overallCompletion ?? 0))}%
            </div>
            <div className="mt-1.5 text-[11px] font-medium text-emerald-600 truncate">Average Completion</div>
          </div>
        </div>

        {/* 3. Budget Progress */}
        <div className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
            <DollarSign className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Budget Progress</div>
            <div className="mt-0.5 font-display text-2xl font-bold text-slate-900 tabular-nums leading-none">
              {budgetPct}%
            </div>
            <div className="mt-1.5 text-[11px] font-medium text-amber-600 truncate tabular-nums">
              {formatCompactCurrency(totalSpent)} of {formatCompactCurrency(totalBudgets)}
            </div>
          </div>
        </div>

        {/* 4. Tasks Completed */}
        <button
          type="button"
          onClick={() => onNavigate('tasks')}
          className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 text-left shadow-2xs transition-shadow hover:shadow-md"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-xs">
            <CalendarCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Tasks Completed</div>
            <div className="mt-0.5 font-display text-2xl font-bold text-slate-900 tabular-nums leading-none">
              {completedTasks}
            </div>
            <div className="mt-1.5 text-[11px] font-medium text-violet-600 truncate tabular-nums">
              of {totalTasks} Tasks
            </div>
          </div>
        </button>

        {/* 5. Team Members */}
        <button
          type="button"
          onClick={() => onNavigate('personnel')}
          className="flex items-center gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 text-left shadow-2xs transition-shadow hover:shadow-md"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-xs">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Team Members</div>
            <div className="mt-0.5 font-display text-2xl font-bold text-slate-900 tabular-nums leading-none">
              {oo.activePersonnel ?? 0}
            </div>
            <div className="mt-1.5 text-[11px] font-medium text-teal-600 truncate">Across All Projects</div>
          </div>
        </button>
      </div>

      {/* Middle Row: Project Progress Overview (7 cols) + Project Budget Summary (5 cols) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Project Progress Overview */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-slate-900">Project Progress Overview</h2>
              <select
                value={progressFilter}
                onChange={(e) => setProgressFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
              >
                <option value="all">All Projects</option>
                <option value="on_track">On Track</option>
                <option value="at_risk">At Risk</option>
                <option value="delayed">Delayed</option>
              </select>
            </div>

            {/* Status Legend */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[11px] font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                Not Started
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                In Progress
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-600" />
                On Track
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                At Risk
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                Delayed
              </span>
            </div>

            {/* Horizontal Segmented Progress Rows */}
            <div className="mt-4 space-y-3.5">
              {progressOverviewProjects.map((p) => {
                const actual = Math.max(0, Math.min(100, Number(p.schedule?.actualProgress || 0)));
                const planned = Math.max(0, Math.min(100, Number(p.schedule?.plannedProgress || 0)));
                const health = (p.schedule?.healthStatus || '').toLowerCase();

                let statusColor = 'bg-emerald-500';
                if (health === 'at risk') statusColor = 'bg-amber-400';
                else if (health === 'delayed' || health === 'behind schedule') statusColor = 'bg-red-500';

                // Split completed bar visually into base progress (blue) + current schedule status segment
                const bluePct = actual > 12 ? actual * 0.72 : actual;
                const statusPct = Math.max(0, actual - bluePct);

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenProject(p.id)}
                    title={`${p.name} — Planned: ${planned.toFixed(1)}% | Actual: ${actual.toFixed(1)}%`}
                    className="group flex w-full items-center gap-3 text-left"
                  >
                    <div className="flex w-44 sm:w-48 shrink-0 items-center gap-2.5 min-w-0">
                      {p.hero_image ? (
                        <img
                          src={p.hero_image}
                          alt={p.name}
                          className="h-7 w-9 shrink-0 rounded object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="flex h-7 w-9 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500 border border-slate-200">
                          <Building2 className="h-3.5 w-3.5" />
                        </div>
                      )}
                      <span className="truncate text-xs font-medium text-slate-800 group-hover:text-blue-600">
                        {p.name}
                      </span>
                    </div>

                    <div className="relative flex-1 h-3.5 rounded-md bg-slate-200/80 overflow-hidden flex">
                      {bluePct > 0 && (
                        <div
                          className="h-full bg-blue-600 transition-all"
                          style={{ width: `${bluePct}%` }}
                        />
                      )}
                      {statusPct > 0 && (
                        <div
                          className={`h-full ${statusColor} transition-all`}
                          style={{ width: `${statusPct}%` }}
                        />
                      )}
                      {planned > 0 && (
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-slate-900/40"
                          style={{ left: `${Math.min(99.5, planned)}%` }}
                          title={`Planned: ${planned.toFixed(1)}%`}
                        />
                      )}
                    </div>

                    <div className="w-10 shrink-0 text-right font-mono text-xs font-semibold text-slate-800 tabular-nums">
                      {Math.round(actual)}%
                    </div>
                  </button>
                );
              })}

              {progressOverviewProjects.length === 0 && (
                <div className="py-10 text-center text-xs text-slate-500">
                  No projects match this schedule health filter.
                </div>
              )}
            </div>
          </div>

          {/* 0% - 100% Scale Footer */}
          <div className="mt-4 flex items-center gap-3 pt-1">
            <div className="w-44 sm:w-48 shrink-0" />
            <div className="flex flex-1 justify-between text-[11px] font-mono text-slate-500 tabular-nums">
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
            <div className="w-10 shrink-0" />
          </div>
        </div>

        {/* Project Budget Summary */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-slate-900">Project Budget Summary</h2>
              <select
                value={budgetProjectId}
                onChange={(e) => setBudgetProjectId(e.target.value)}
                className="max-w-[160px] rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 truncate"
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5 flex flex-col sm:flex-row items-center gap-6">
              <DonutChart
                segments={budgetSummary.cats.map((c, idx) => ({
                  label: c.category,
                  value: Number(c.total || 0),
                  color: BUDGET_COLORS[idx % BUDGET_COLORS.length],
                }))}
                centerValue={formatCompactCurrency(budgetSummary.spent)}
                centerLabel="Spent"
                centerSublabel={`(${budgetSummary.pct}%)`}
                size={168}
                strokeWidth={24}
              />

              <div className="flex-1 w-full space-y-2.5 text-xs">
                {budgetSummary.cats.length === 0 ? (
                  <p className="text-slate-500">No approved expenses recorded yet.</p>
                ) : (
                  budgetSummary.cats.slice(0, 5).map((cat, idx) => {
                    const share =
                      budgetSummary.spent > 0 ? Math.round((Number(cat.total) / budgetSummary.spent) * 100) : 0;
                    return (
                      <div key={cat.category} className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-slate-700 truncate">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: BUDGET_COLORS[idx % BUDGET_COLORS.length] }}
                          />
                          <span className="truncate">{cat.category}</span>
                        </span>
                        <span className="font-mono font-semibold text-slate-800 tabular-nums shrink-0">
                          {formatCompactCurrency(cat.total)}{' '}
                          <span className="font-normal text-slate-500">({share}%)</span>
                        </span>
                      </div>
                    );
                  })
                )}

                <div className="border-t border-slate-100 pt-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Total Budget</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCompactCurrency(budgetSummary.totalBudget)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Open Commitments</span>
                    <span className="font-mono font-medium text-slate-700 tabular-nums">
                      {formatCompactCurrency(budgetSummary.commitments)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Remaining</span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        budgetSummary.remaining >= 0 ? 'text-blue-600' : 'text-red-600'
                      }`}
                    >
                      {formatCompactCurrency(budgetSummary.remaining)} (
                      {budgetSummary.totalBudget > 0
                        ? Math.round((budgetSummary.remaining / budgetSummary.totalBudget) * 100)
                        : 0}
                      %)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bento Row: Upcoming Milestones | Tasks Status | Recent Activity */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 1. Upcoming Milestones */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Upcoming Milestones</h2>
            <button
              type="button"
              onClick={() => onNavigate('projects')}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              View All
            </button>
          </div>
          <div className="space-y-3.5">
            {upcomingMilestones.slice(0, 4).map((m, idx) => {
              const badgeThemes = [
                'bg-blue-600 text-white',
                'bg-emerald-600 text-white',
                'bg-amber-500 text-white',
                'bg-violet-600 text-white',
              ];
              const countdown = formatDaysLeft(m.end_date);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpenProject(m.project_id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg p-1.5 -mx-1.5 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        badgeThemes[idx % badgeThemes.length]
                      }`}
                    >
                      <Flag className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-900">{m.name}</div>
                      <div className="truncate text-[11px] text-slate-500">{m.project_name}</div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-medium text-slate-700 font-mono tabular-nums">
                      {new Date(`${m.end_date}T00:00:00`).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                    <div className={`text-[11px] font-medium ${countdown.tone}`}>{countdown.text}</div>
                  </div>
                </button>
              );
            })}
            {upcomingMilestones.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-500">
                No pending milestones in active schedules.
              </div>
            )}
          </div>
        </div>

        {/* 2. Tasks Status */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Tasks Status</h2>
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              View All
            </button>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-5 pt-1">
            <DonutChart
              segments={taskBreakdown.items}
              centerValue={String(taskBreakdown.total)}
              centerLabel="Total Tasks"
              size={152}
              strokeWidth={22}
            />
            <div className="flex-1 w-full space-y-3 text-xs">
              {taskBreakdown.items.map((item) => {
                const pct = taskBreakdown.total > 0 ? Math.round((item.value / taskBreakdown.total) * 100) : 0;
                return (
                  <div key={item.label} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span>{item.label}</span>
                    </span>
                    <span className="font-mono font-semibold text-slate-800 tabular-nums">
                      {item.value} <span className="font-normal text-slate-500">({pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. Recent Activity */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Recent Activity</h2>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              View All
            </button>
          </div>
          <div className="space-y-3.5">
            {recentActivity.slice(0, 4).map((act, idx) => {
              let iconBox = 'bg-blue-50 text-blue-600';
              let Icon = FileText;
              if (act.kind === 'task') {
                iconBox = 'bg-emerald-50 text-emerald-600';
                Icon = ClipboardCheck;
              } else if (act.kind === 'procurement') {
                iconBox = 'bg-amber-50 text-amber-600';
                Icon = Package;
              } else if (act.kind === 'personnel') {
                iconBox = 'bg-violet-50 text-violet-600';
                Icon = UserPlus;
              }

              return (
                <button
                  key={`${act.kind}-${act.id}-${idx}`}
                  type="button"
                  onClick={() => (act.project_id ? onOpenProject(act.project_id) : onNavigate('personnel'))}
                  className="flex w-full items-center justify-between gap-3 rounded-lg p-1.5 -mx-1.5 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBox}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-900">{act.title}</div>
                      <div className="truncate text-[11px] text-slate-500">{act.project_name}</div>
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-slate-400 tabular-nums">
                    {formatRelativeTime(act.created_at)}
                  </span>
                </button>
              );
            })}
            {recentActivity.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-500">No recent portfolio events logged.</div>
            )}
          </div>
        </div>
      </div>

      {/* Portfolio Financial Summary Strip + Project Comparison Table */}
      <div className="rounded-xl border border-slate-200/90 bg-white shadow-2xs">
        <div className="grid grid-cols-2 gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3.5 text-xs sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <div className="text-slate-500">Contract Value</div>
            <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
              {formatCurrency(fo.totalContractValue)}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Forecast Final Cost</div>
            <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
              {formatCurrency(fo.totalForecastFinalCost)}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Est. Profit</div>
            <div className="mt-0.5 font-mono font-bold text-emerald-700 tabular-nums">
              {formatCurrency(fo.estimatedProfit)}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Est. Margin</div>
            <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
              {fo.estimatedMarginPct !== null ? `${fo.estimatedMarginPct}%` : 'Provisional'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Pending PRs</div>
            <div className="mt-0.5 font-mono font-bold text-amber-700 tabular-nums">{oo.pendingPrs ?? 0}</div>
          </div>
          <div>
            <div className="text-slate-500">Stock Alerts</div>
            <div className="mt-0.5 font-mono font-bold text-red-700 tabular-nums">{oo.inventoryAlerts ?? 0}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-slate-900">Portfolio Project Comparison</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter project or client..."
                className="rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="on_hold">On Hold</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
            >
              <option value="name">Sort: Name</option>
              <option value="progress">Sort: Completion %</option>
              <option value="budget">Sort: Budget</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Project</th>
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold">Schedule Health</th>
                <th className="px-4 py-3 font-semibold text-right">Planned / Actual</th>
                <th className="px-4 py-3 font-semibold text-right">Approved Budget</th>
                <th className="px-4 py-3 font-semibold text-right">Actual Spent</th>
                <th className="px-4 py-3 font-semibold text-right">Commitments</th>
                <th className="px-4 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredProjects.map((p: any) => (
                <tr key={p.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{p.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {p.ref_number} · PM: {p.pm_name || 'Unassigned'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{p.client_name}</td>
                  <td className="px-4 py-3">
                    <StatusLabel status={p.schedule?.healthStatus || p.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {p.schedule?.plannedProgress?.toFixed(1)}% /{' '}
                    <strong className="text-slate-900">{p.schedule?.actualProgress?.toFixed(1)}%</strong>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatCurrency(p.financials?.revisedBudget)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-amber-800 tabular-nums">
                    {formatCurrency(p.financials?.actualExpenses)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600 tabular-nums">
                    {formatCurrency(p.financials?.outstandingCommitments)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenProject(p.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
                    >
                      Open
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No matching projects found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
