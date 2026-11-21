import { db } from './db.ts';

export type ScheduleHealth =
  | 'Completed'
  | 'Ahead of Schedule'
  | 'On Schedule'
  | 'At Risk'
  | 'Behind Schedule'
  | 'Delayed'
  | 'Provisional';

export interface ActivityRow {
  id: number;
  wbs_code: string;
  name: string;
  phase_id: number | null;
  start_date: string;
  end_date: string;
  duration_days: number;
  dependencies_json: string;
  is_milestone: number;
  milestone_status: string | null;
  weight_percent: number;
  planned_progress: number;
  actual_progress: number;
  is_critical_path: number;
}

export interface ProjectFinancialSummary {
  contractAmount: number;
  originalBudget: number;
  revisedBudget: number;
  actualExpenses: number;
  outstandingCommitments: number;
  remainingAvailableBudget: number;
  budgetUtilizationPct: number;
  budgetVariance: number;
  projectSavings: number;
  projectProfit: number;
  projectGpPct: number;
  tpcRate: number;
  tpcAmount: number;
  salesCommission: number;
  opexAmount: number;
  totalCost: number;
  finalGp: number;
  finalGpPct: number;
  totalPaymentsReceived: number;
  outstandingReceivable: number;
  forecastFinalCost: number;
  estimatedProfit: number;
  estimatedMarginPct: number | null;
  isProfitProvisional: boolean;
}

export interface ProjectScheduleMetrics {
  hasApprovedSchedule: boolean;
  revisionNumber: number | null;
  asOfDate: string;
  plannedProgress: number;
  actualProgress: number;
  progressVariance: number;
  healthStatus: ScheduleHealth;
  isProvisional: boolean;
  provisionalReason: string;
  delayedActivitiesCount: number;
  atRiskActivitiesCount: number;
  completedMilestones: number;
  totalMilestones: number;
}

export interface EvmMetrics {
  pv: number;
  ev: number;
  ac: number;
  sv: number;
  cv: number;
  spi: number | null;
  cpi: number | null;
  eac: number | null;
  etc: number | null;
  bac: number;
  isProvisional: boolean;
  missingDataReasons: string[];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function daysBetween(startIso: string, endIso: string): number {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 1;
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

/**
 * Calculates planned progress of an activity at a given reporting date.
 */
export function computeActivityPlannedPctAtDate(startIso: string, endIso: string, asOfIso: string): number {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  const a = new Date(asOfIso).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || Number.isNaN(a)) return 0;
  if (a <= s) return 0;
  if (a >= e) return 100;
  const total = Math.max(1, e - s);
  return clamp(((a - s) / total) * 100, 0, 100);
}

/**
 * Computes Critical Path Method (CPM) forward/backward pass and marks critical path activities.
 */
export function computeCriticalPath(activities: ActivityRow[]): Set<number> {
  if (activities.length === 0) return new Set();

  const byWbs = new Map<string, ActivityRow>();
  for (const act of activities) {
    byWbs.set(act.wbs_code.trim(), act);
  }

  const es = new Map<number, number>();
  const ef = new Map<number, number>();

  // Sort by start date for forward pass approximation with dependency relaxation
  const ordered = [...activities].sort((a, b) => a.start_date.localeCompare(b.start_date));
  for (const act of ordered) {
    let deps: string[] = [];
    try {
      deps = JSON.parse(act.dependencies_json || '[]');
    } catch {
      deps = [];
    }
    let earlyStart = 0;
    for (const depCode of deps) {
      const pred = byWbs.get(String(depCode).trim());
      if (pred) {
        earlyStart = Math.max(earlyStart, ef.get(pred.id) || 0);
      }
    }
    const dur = Math.max(1, act.duration_days || daysBetween(act.start_date, act.end_date));
    es.set(act.id, earlyStart);
    ef.set(act.id, earlyStart + dur);
  }

  let projectEnd = 0;
  for (const v of ef.values()) {
    projectEnd = Math.max(projectEnd, v);
  }

  const ls = new Map<number, number>();
  const lf = new Map<number, number>();

  // Build successor map
  const successors = new Map<number, number[]>();
  for (const act of ordered) {
    let deps: string[] = [];
    try {
      deps = JSON.parse(act.dependencies_json || '[]');
    } catch {
      deps = [];
    }
    for (const depCode of deps) {
      const pred = byWbs.get(String(depCode).trim());
      if (pred) {
        const list = successors.get(pred.id) || [];
        list.push(act.id);
        successors.set(pred.id, list);
      }
    }
  }

  for (let i = ordered.length - 1; i >= 0; i--) {
    const act = ordered[i];
    const succs = successors.get(act.id) || [];
    const lateFinish =
      succs.length === 0
        ? projectEnd
        : Math.min(...succs.map((sid) => ls.get(sid) ?? projectEnd));
    const dur = Math.max(1, act.duration_days || daysBetween(act.start_date, act.end_date));
    lf.set(act.id, lateFinish);
    ls.set(act.id, lateFinish - dur);
  }

  const criticalIds = new Set<number>();
  for (const act of ordered) {
    const floatDays = (ls.get(act.id) ?? 0) - (es.get(act.id) ?? 0);
    if (Math.abs(floatDays) <= 0.5) {
      criticalIds.add(act.id);
    }
  }
  return criticalIds;
}

export function getProjectScheduleMetrics(projectId: number, asOfDate?: string): ProjectScheduleMetrics {
  const reportDate = asOfDate || new Date().toISOString().slice(0, 10);
  const project = db
    .prepare('SELECT id, status, overall_progress, start_date, original_end_date, revised_end_date FROM projects WHERE id = ?')
    .get(projectId) as
    | {
        id: number;
        status: string;
        overall_progress: number;
        start_date: string;
        original_end_date: string;
        revised_end_date: string | null;
      }
    | undefined;

  const activeRev = db
    .prepare(
      'SELECT id, revision_number FROM schedule_revisions WHERE project_id = ? AND is_active = 1 ORDER BY revision_number DESC LIMIT 1'
    )
    .get(projectId) as { id: number; revision_number: number } | undefined;

  if (!project || !activeRev) {
    return {
      hasApprovedSchedule: false,
      revisionNumber: null,
      asOfDate: reportDate,
      plannedProgress: 0,
      actualProgress: project?.overall_progress || 0,
      progressVariance: 0,
      healthStatus: project?.status === 'completed' ? 'Completed' : 'Provisional',
      isProvisional: true,
      provisionalReason: 'No active approved schedule revision exists for this project.',
      delayedActivitiesCount: 0,
      atRiskActivitiesCount: 0,
      completedMilestones: 0,
      totalMilestones: 0,
    };
  }

  const activities = db
    .prepare('SELECT * FROM project_activities WHERE project_id = ? AND revision_id = ?')
    .all(projectId, activeRev.id) as ActivityRow[];

  if (activities.length === 0) {
    return {
      hasApprovedSchedule: true,
      revisionNumber: activeRev.revision_number,
      asOfDate: reportDate,
      plannedProgress: 0,
      actualProgress: project.overall_progress || 0,
      progressVariance: 0,
      healthStatus: 'Provisional',
      isProvisional: true,
      provisionalReason: 'Active schedule revision contains zero activities.',
      delayedActivitiesCount: 0,
      atRiskActivitiesCount: 0,
      completedMilestones: 0,
      totalMilestones: 0,
    };
  }

  // Use explicit weight_percent if provided and > 0, else duration-weighted
  const sumExplicitWeight = activities.reduce((acc, a) => acc + (a.weight_percent || 0), 0);
  const useExplicitWeights = sumExplicitWeight > 0;
  const totalWeight = useExplicitWeights
    ? sumExplicitWeight
    : activities.reduce((acc, a) => acc + Math.max(1, a.duration_days || daysBetween(a.start_date, a.end_date)), 0);

  let weightedPlanned = 0;
  let weightedActual = 0;
  let delayedCount = 0;
  let atRiskCount = 0;
  let totalMilestones = 0;
  let completedMilestones = 0;

  for (const act of activities) {
    const w = useExplicitWeights
      ? act.weight_percent || 0
      : Math.max(1, act.duration_days || daysBetween(act.start_date, act.end_date));
    const plannedAtDate = computeActivityPlannedPctAtDate(act.start_date, act.end_date, reportDate);
    const actual = clamp(act.actual_progress || 0, 0, 100);

    weightedPlanned += plannedAtDate * w;
    weightedActual += actual * w;

    const actVariance = actual - plannedAtDate;
    if (actual < 100 && (reportDate > act.end_date || actVariance <= -15)) {
      delayedCount++;
    } else if (actual < 100 && actVariance <= -5) {
      atRiskCount++;
    }

    if (act.is_milestone) {
      totalMilestones++;
      if (actual >= 100 || act.milestone_status === 'completed') {
        completedMilestones++;
      }
    }
  }

  const plannedProgress = Number((weightedPlanned / Math.max(1, totalWeight)).toFixed(2));
  const actualProgress = Number((weightedActual / Math.max(1, totalWeight)).toFixed(2));
  const progressVariance = Number((actualProgress - plannedProgress).toFixed(2));

  const targetEnd = project.revised_end_date || project.original_end_date;
  let healthStatus: ScheduleHealth = 'On Schedule';
  if (project.status === 'completed' || actualProgress >= 100) {
    healthStatus = 'Completed';
  } else if (reportDate > targetEnd || progressVariance <= -15) {
    healthStatus = 'Delayed';
  } else if (progressVariance <= -8) {
    healthStatus = 'Behind Schedule';
  } else if (progressVariance <= -3) {
    healthStatus = 'At Risk';
  } else if (progressVariance >= 4) {
    healthStatus = 'Ahead of Schedule';
  }

  return {
    hasApprovedSchedule: true,
    revisionNumber: activeRev.revision_number,
    asOfDate: reportDate,
    plannedProgress,
    actualProgress,
    progressVariance,
    healthStatus,
    isProvisional: !useExplicitWeights,
    provisionalReason: useExplicitWeights
      ? ''
      : 'Activity weights not specified; using duration-weighted progress calculation.',
    delayedActivitiesCount: delayedCount,
    atRiskActivitiesCount: atRiskCount,
    completedMilestones,
    totalMilestones,
  };
}

export function getProjectFinancialSummary(projectId: number): ProjectFinancialSummary {
  const project = db
    .prepare(
      'SELECT contract_amount, approved_budget, revised_budget, tpc_rate, sales_commission, opex_amount FROM projects WHERE id = ?'
    )
    .get(projectId) as
    | {
        contract_amount: number;
        approved_budget: number;
        revised_budget: number;
        tpc_rate: number;
        sales_commission: number;
        opex_amount: number;
      }
    | undefined;

  if (!project) {
    return {
      contractAmount: 0,
      originalBudget: 0,
      revisedBudget: 0,
      actualExpenses: 0,
      outstandingCommitments: 0,
      remainingAvailableBudget: 0,
      budgetUtilizationPct: 0,
      budgetVariance: 0,
      projectSavings: 0,
      projectProfit: 0,
      projectGpPct: 0,
      tpcRate: 0,
      tpcAmount: 0,
      salesCommission: 0,
      opexAmount: 0,
      totalCost: 0,
      finalGp: 0,
      finalGpPct: 0,
      totalPaymentsReceived: 0,
      outstandingReceivable: 0,
      forecastFinalCost: 0,
      estimatedProfit: 0,
      estimatedMarginPct: null,
      isProfitProvisional: true,
    };
  }

  const effectiveBudget = project.revised_budget > 0 ? project.revised_budget : project.approved_budget;

  const expenseAgg = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE project_id = ? AND status = 'approved'"
    )
    .get(projectId) as { total: number };

  // Outstanding commitments strictly separated from settled actuals
  const commitmentAgg = db
    .prepare(
      `SELECT COALESCE(SUM(MAX(0, commitment_amount - settled_amount)), 0) AS total
       FROM purchase_requests
       WHERE project_id = ? AND status IN ('approved', 'for_procurement', 'ordered', 'partially_delivered')`
    )
    .get(projectId) as { total: number };

  const paymentAgg = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM project_payments WHERE project_id = ?')
    .get(projectId) as { total: number };

  const actualExpenses = Number((expenseAgg.total || 0).toFixed(2));
  const outstandingCommitments = Number((commitmentAgg.total || 0).toFixed(2));
  const remainingAvailableBudget = Number(
    (effectiveBudget - actualExpenses - outstandingCommitments).toFixed(2)
  );
  const budgetUtilizationPct =
    effectiveBudget > 0
      ? Number((((actualExpenses + outstandingCommitments) / effectiveBudget) * 100).toFixed(2))
      : 0;
  const budgetVariance = Number((effectiveBudget - actualExpenses).toFixed(2));
  const projectSavings = budgetVariance;
  const projectProfit = Number((project.contract_amount - actualExpenses).toFixed(2));
  const projectGpPct =
    project.contract_amount > 0
      ? Number(((projectProfit / project.contract_amount) * 100).toFixed(2))
      : 0;

  const tpcRate = Number(project.tpc_rate || 0);
  const tpcAmount = Number((actualExpenses * (tpcRate / 100)).toFixed(2));
  const salesCommission = Number(project.sales_commission || 0);
  const opexAmount = Number(project.opex_amount || 0);
  const totalCost = Number((actualExpenses + tpcAmount + salesCommission + opexAmount).toFixed(2));
  const finalGp = Number((project.contract_amount - totalCost).toFixed(2));
  const finalGpPct =
    project.contract_amount > 0 ? Number(((finalGp / project.contract_amount) * 100).toFixed(2)) : 0;

  const totalPaymentsReceived = Number((paymentAgg.total || 0).toFixed(2));
  const outstandingReceivable = Number((project.contract_amount - totalPaymentsReceived).toFixed(2));

  const schedule = getProjectScheduleMetrics(projectId);
  const actualPct = schedule.actualProgress;

  // Estimate at Completion: if sufficient progress (>5%) and budget exist, use CPI-based EAC; otherwise baseline budget + overrun if any
  let forecastFinalCost = effectiveBudget;
  let isProfitProvisional = true;

  if (effectiveBudget > 0 && actualPct >= 5 && actualExpenses > 0) {
    const ev = (actualPct / 100) * effectiveBudget;
    const cpi = ev / actualExpenses;
    if (cpi > 0.1) {
      forecastFinalCost = Number(Math.max(actualExpenses + outstandingCommitments, effectiveBudget / cpi).toFixed(2));
      isProfitProvisional = schedule.isProvisional;
    }
  } else {
    forecastFinalCost = Number(Math.max(effectiveBudget, actualExpenses + outstandingCommitments).toFixed(2));
  }

  // Never treat unused budget as profit! Profit = Contract Amount - Forecast Final Cost
  const estimatedProfit = Number((project.contract_amount - forecastFinalCost).toFixed(2));
  const estimatedMarginPct =
    project.contract_amount > 0
      ? Number(((estimatedProfit / project.contract_amount) * 100).toFixed(2))
      : null;

  return {
    contractAmount: project.contract_amount,
    originalBudget: project.approved_budget,
    revisedBudget: effectiveBudget,
    actualExpenses,
    outstandingCommitments,
    remainingAvailableBudget,
    budgetUtilizationPct,
    budgetVariance,
    projectSavings,
    projectProfit,
    projectGpPct,
    tpcRate,
    tpcAmount,
    salesCommission,
    opexAmount,
    totalCost,
    finalGp,
    finalGpPct,
    totalPaymentsReceived,
    outstandingReceivable,
    forecastFinalCost,
    estimatedProfit,
    estimatedMarginPct,
    isProfitProvisional,
  };
}

export function getProjectEvmMetrics(projectId: number, asOfDate?: string): EvmMetrics {
  const schedule = getProjectScheduleMetrics(projectId, asOfDate);
  const fin = getProjectFinancialSummary(projectId);
  const bac = fin.revisedBudget;
  const missingDataReasons: string[] = [];

  if (!schedule.hasApprovedSchedule) {
    missingDataReasons.push('Missing approved baseline schedule');
  }
  if (bac <= 0) {
    missingDataReasons.push('Missing approved project budget (BAC)');
  }
  if (schedule.isProvisional && schedule.provisionalReason) {
    missingDataReasons.push(schedule.provisionalReason);
  }

  const pv = Number(((schedule.plannedProgress / 100) * bac).toFixed(2));
  const ev = Number(((schedule.actualProgress / 100) * bac).toFixed(2));
  const ac = fin.actualExpenses;
  const sv = Number((ev - pv).toFixed(2));
  const cv = Number((ev - ac).toFixed(2));

  const spi = pv > 0 ? Number((ev / pv).toFixed(3)) : null;
  const cpi = ac > 0 ? Number((ev / ac).toFixed(3)) : null;
  const eac = cpi && cpi > 0 ? Number((bac / cpi).toFixed(2)) : null;
  const etc = eac !== null ? Number(Math.max(0, eac - ac).toFixed(2)) : null;

  return {
    pv,
    ev,
    ac,
    sv,
    cv,
    spi,
    cpi,
    eac,
    etc,
    bac,
    isProvisional: missingDataReasons.length > 0 || ac === 0,
    missingDataReasons,
  };
}

/**
 * Recomputes project overall_progress & phase actual_progress from approved schedule activities
 */
export function syncProjectProgressFromSchedule(projectId: number): void {
  const activeRev = db
    .prepare('SELECT id FROM schedule_revisions WHERE project_id = ? AND is_active = 1 LIMIT 1')
    .get(projectId) as { id: number } | undefined;
  if (!activeRev) return;

  const phases = db
    .prepare('SELECT id FROM project_phases WHERE project_id = ? AND revision_id = ?')
    .all(projectId, activeRev.id) as Array<{ id: number }>;

  const today = new Date().toISOString().slice(0, 10);

  for (const phase of phases) {
    const acts = db
      .prepare('SELECT * FROM project_activities WHERE phase_id = ?')
      .all(phase.id) as ActivityRow[];
    if (acts.length === 0) continue;

    const sumW = acts.reduce((a, b) => a + (b.weight_percent || 0), 0);
    const totalW =
      sumW > 0
        ? sumW
        : acts.reduce((a, b) => a + Math.max(1, b.duration_days || daysBetween(b.start_date, b.end_date)), 0);

    let wPlan = 0;
    let wAct = 0;
    for (const act of acts) {
      const w = sumW > 0 ? act.weight_percent || 0 : Math.max(1, act.duration_days || 1);
      wPlan += computeActivityPlannedPctAtDate(act.start_date, act.end_date, today) * w;
      wAct += clamp(act.actual_progress || 0, 0, 100) * w;
    }
    const pPlan = Number((wPlan / Math.max(1, totalW)).toFixed(2));
    const pAct = Number((wAct / Math.max(1, totalW)).toFixed(2));
    let phaseStatus = 'upcoming';
    if (pAct >= 100) phaseStatus = 'completed';
    else if (pAct > 0) phaseStatus = 'in_progress';

    db.prepare(
      'UPDATE project_phases SET planned_progress = ?, actual_progress = ?, status = ? WHERE id = ?'
    ).run(pPlan, pAct, phaseStatus, phase.id);
  }

  const metrics = getProjectScheduleMetrics(projectId, today);
  db.prepare('UPDATE projects SET overall_progress = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    metrics.actualProgress,
    projectId
  );
}
