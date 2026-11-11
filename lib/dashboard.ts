// The logic behind the Command Center, kept apart from the page so the rank gates and the date
// rules can be tested. No figure is worked out from scratch here: the database totals them in
// dashboard_figures and job_cost_rollup, and this only sorts and sums what those return.
import { ALERT_SEVERITIES, type AlertRow, type AlertSeverity } from './alerts';
import { cents } from './billing-math';
import type { JobCost } from './job-cost';

/** Which money a rank sees. dashboard_figures and job_cost_rollup hold the same lines in the database. */
export function dashboardAccess(rank: number) {
  return { crew: rank >= 2, jobMoney: rank >= 3, finance: rank >= 4 };
}

export interface DashboardFigures {
  labour: { week_start: string; regular: number; overtime: number; cards: number };
  timecards?: { total: number; fresh: number; waiting: number; old: number; oldest_work_date: string | null };
  pipeline?: { total: number; proposals: number; estimates: number };
  receivables?: { outstanding: number; overdue: number; overdue_count: number; over_30: number; over_60: number; over_90: number };
  holdback?: { total: number; invoices: number; past_release: number };
}

export const isOverdueAlert = (alert: Pick<AlertRow, 'due_on'>, today: string) => !!alert.due_on && alert.due_on < today;

const severityOrder = (severity: AlertSeverity) => ALERT_SEVERITIES.indexOf(severity);

/**
 * Overdue first, most serious and oldest at the top. A critical alert with no date (an incident,
 * a failed inspection) is happening now, so it sits with the overdue ones rather than under them.
 */
export function attentionOrder<T extends Pick<AlertRow, 'due_on' | 'severity' | 'id'>>(alerts: readonly T[], today: string): T[] {
  const isNow = (a: T) => isOverdueAlert(a, today) || (a.severity === 'critical' && !a.due_on);
  return [...alerts].sort(
    (a, b) =>
      Number(isNow(b)) - Number(isNow(a)) ||
      severityOrder(a.severity) - severityOrder(b.severity) ||
      (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') ||
      a.id.localeCompare(b.id)
  );
}

/** How many alerts each module has, busiest first. */
export function alertCountsByModule(alerts: readonly Pick<AlertRow, 'module'>[]): { module: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const alert of alerts) counts.set(alert.module, (counts.get(alert.module) ?? 0) + 1);
  return [...counts].map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count || a.module.localeCompare(b.module));
}

const CHECK_STALE_MS = 30 * 3_600_000;

/** The daily run should be under a day old. Past 30 hours it was missed, and the list could be behind. */
export function checkIsStale(lastChecked: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastChecked) return false;
  return now.getTime() - new Date(lastChecked).getTime() > CHECK_STALE_MS;
}

export interface JobSummary {
  activeJobs: number;
  contract: number;
  billed: number;
  /** Left to bill, job by job: billing over on one job doesn't hide what's left on another. */
  remaining: number;
  overBudget: number;
  margin: number;
  marginPct: number | null;
  /** Active jobs, thinnest margin first. A job with no contract to measure against goes last. */
  byMargin: JobCost[];
}

export function summariseJobs(jobs: readonly JobCost[]): JobSummary {
  const active = jobs.filter((j) => j.project_status === 'Active' && j.status !== 'Closed');
  const sum = (pick: (j: JobCost) => number) => cents(active.reduce((total, j) => total + pick(j), 0));
  const contract = sum((j) => Number(j.revised_contract ?? 0));
  const margin = sum((j) => Number(j.margin ?? 0));
  const pct = (j: JobCost) => (j.margin_pct === null || j.margin_pct === undefined ? Infinity : Number(j.margin_pct));
  return {
    activeJobs: active.length,
    contract,
    billed: sum((j) => Number(j.billed_amount ?? 0)),
    remaining: sum((j) => Math.max(0, Number(j.revised_contract ?? 0) - Number(j.billed_amount ?? 0))),
    overBudget: jobs.filter((j) => j.status === 'Over Budget').length,
    margin,
    marginPct: contract > 0 ? cents((margin / contract) * 100) : null,
    byMargin: [...active].sort((a, b) => pct(a) - pct(b) || a.project_title.localeCompare(b.project_title)),
  };
}

export const hoursLabel = (hours: number) => `${Math.round(hours * 100) / 100}`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
