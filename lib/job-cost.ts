// Job costing rules shared by the pages, the API and the tests. The money itself is worked out
// by recalc_job_cost in supabase/migrations/20261104000200_job_costing.sql. Nothing here adds up
// a total: these are the shapes it comes back in, and the checks on what people type.
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { cents } from './billing-math';
import { getModule } from './modules';
import { ROLE_RANK, type Role } from './roles';
import { isCalendarDate } from './validation';

export const ENTRY_CATEGORIES = ['Material', 'Equipment', 'Subcontract', 'Other'] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

type Money = number | string | null;

/** One job from job_cost_rollup. */
export interface JobCost {
  id: string;
  company_id: string;
  project_id: string;
  status: string;
  project_title: string;
  project_status: string;
  client_name: string | null;
  contract_value: Money;
  approved_changes: Money;
  revised_contract: Money;
  budget: Money;
  budget_labour_hours: Money;
  budget_labour: Money;
  budget_material: Money;
  budget_other: Money;
  co_revenue: Money;
  co_cost: Money;
  co_labour_hours: Money;
  actual_cost: Money;
  actual_labour_hours: Money;
  actual_labour: Money;
  actual_material: Money;
  actual_other: Money;
  committed: Money;
  billed_amount: Money;
  paid_amount: Money;
  margin: Money;
  margin_pct: Money;
  cost_used_pct: Money;
  entries: Partial<Record<EntryCategory, number>>;
}

export interface CostEntry {
  id: string;
  project_id: string;
  category: EntryCategory;
  description: string;
  amount: number | string;
  entry_date: string;
}

/** The same thresholds as public.job_cost_status: actual over budget, Closed never changes, no budget stays On Track. */
export function jobStatus(actual: unknown, budget: unknown, current: string): string {
  if (current === 'Closed') return 'Closed';
  const b = Number(budget);
  if (!Number.isFinite(b) || b <= 0) return 'On Track';
  const used = Number(actual) / b;
  if (used >= 1) return 'Over Budget';
  if (used >= 0.85) return 'At Risk';
  return 'On Track';
}

const STATUS_TONES: Record<string, string> = {
  'On Track': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  'At Risk': 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  'Over Budget': 'bg-red-500/10 text-red-300 border-red-500/30',
  Closed: 'bg-slate-700/40 text-slate-300 border-slate-600',
};

export const statusTone = (status: string) => STATUS_TONES[status] ?? STATUS_TONES.Closed;

/** How far along a bar to draw, 0 to 100, when `of` is what full means. */
export function barPercent(value: unknown, of: unknown): number {
  const whole = Number(of);
  if (!Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(100, Math.max(0, (Number(value) / whole) * 100));
}

const blankToZero = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? 0 : v ?? 0);
const budgetFigure = z.preprocess(blankToZero, z.coerce.number().finite().min(0, 'Budget figures cannot be negative.').max(1e11)).transform(cents);

export const BudgetSchema = z.object({ hours: budgetFigure, labour: budgetFigure, material: budgetFigure, other: budgetFigure });

export const ClosedSchema = z.object({ closed: z.boolean() });

export const EntrySchema = z.object({
  category: z.enum(ENTRY_CATEGORIES, { message: 'Pick a category.' }),
  description: z.string().trim().min(1, 'Enter a description.').max(300),
  amount: z.coerce
    .number({ message: 'Enter an amount.' })
    .finite('Enter an amount.')
    .min(-1e11)
    .max(1e11)
    .transform(cents)
    .refine((n) => n !== 0, 'Enter an amount. Use a negative amount for a credit.'),
  entry_date: z.string().refine(isCalendarDate, 'Pick a date.'),
});

/** The first message of a failed parse, for showing as-is. */
export const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? 'Some values were not valid.';

/** One call from a page to the API. Throws the server's plain-language message, or a network one. */
export async function apiCall<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('Network error. Check your connection and try again.');
  }
  if (res.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new Error('Sign in again to continue.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = json.details ? Object.values(json.details as Record<string, string>).join(' ') : '';
    throw new Error([json.error ?? 'That did not work. Try again.', details].filter(Boolean).join(': '));
  }
  return json.data as T;
}

/** Every job, or one. The database refuses this below project manager. */
export async function loadRollup(supabase: SupabaseClient, project?: string): Promise<JobCost[]> {
  const { data, error } = await supabase.rpc('job_cost_rollup', project ? { p_project: project } : {});
  if (error) throw new Error(`Could not load job costs: ${error.message}`);
  return (data ?? []) as JobCost[];
}

const RECONCILE_BATCH = 200;

/** The nightly job: every company's jobs, one company at a time, so one that fails doesn't stop the rest. Takes the service role client. */
export async function reconcileAllJobCosts(admin: SupabaseClient, timeBudgetMs = 270_000, now = () => Date.now()) {
  const started = now();
  const summary = { companies: 0, changed: 0, failed: 0, outOfTime: false };
  let cursor: string | null = null;
  for (;;) {
    let query = admin.from('companies').select('id').order('id', { ascending: true }).limit(RECONCILE_BATCH);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) {
      console.error('Job cost reconcile could not load companies', error);
      summary.failed++;
      return summary;
    }
    const companies = (data ?? []) as { id: string }[];
    for (const company of companies) {
      if (now() - started > timeBudgetMs) {
        summary.outOfTime = true;
        console.error('Job cost reconcile ran out of time; the rest wait for the next run');
        return summary;
      }
      summary.companies++;
      const { data: changed, error: rpcError } = await admin.rpc('reconcile_job_costs', { p_company: company.id });
      if (rpcError) {
        summary.failed++;
        console.error(`Job cost reconcile failed for company ${company.id}`, rpcError);
      } else {
        summary.changed += Number(changed ?? 0);
      }
    }
    if (companies.length < RECONCILE_BATCH) return summary;
    cursor = companies[companies.length - 1].id;
  }
}

export const PROJECT_TABS = [
  { slug: 'rfis', label: 'RFIs' },
  { slug: 'change-orders', label: 'Change Orders' },
  { slug: 'submittals', label: 'Submittals' },
  { slug: 'drawings', label: 'Drawings' },
  { slug: 'daily-logs', label: 'Daily Logs' },
  { slug: 'field-logs', label: 'Field Logs' },
  { slug: 'timecards', label: 'Timecards' },
  { slug: 'invoices', label: 'Invoices' },
  { slug: 'progress-billing', label: 'Draws' },
  { slug: 'loto-permits', label: 'LOTO' },
  { slug: 'tailgate-logs', label: 'Tailgates' },
  { slug: 'safety-inspections', label: 'Safety Inspections' },
  { slug: 'punch-list', label: 'Punch List' },
] as const;

/** The tabs a role can read, by the same rank the module itself asks for. */
export function hubTabs(role: Role) {
  return PROJECT_TABS.filter((tab) => ROLE_RANK[role] >= getModule(tab.slug)!.read);
}
