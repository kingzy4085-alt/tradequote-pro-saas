// What the daily automation watches, and the pure logic for who sees which alert.
// Safe to import from the browser: no secrets, no service role. The rules below are the
// source of truth for the seed in supabase/migrations/20261104000210_automation.sql, and
// tests/automation.test.ts fails if the two drift apart or a rule stops matching MODULES.
import { detailHref } from '@/lib/detail-pages';
import { formatValue } from '@/lib/format';
import { getModule } from '@/lib/modules';
import { provinceTimeZone } from '@/lib/provinces';

export type AlertSeverity = 'critical' | 'warning' | 'info';
export const ALERT_SEVERITIES: AlertSeverity[] = ['critical', 'warning', 'info'];
export const SEVERITY_LABEL: Record<AlertSeverity, string> = { critical: 'Needs action now', warning: 'Coming up', info: 'For your information' };

export interface AutomationRule {
  key: string;
  /** Module slug in lib/modules.ts. */
  module: string;
  table: string;
  group: 'Finance' | 'Compliance' | 'Field' | 'Sales';
  /**
   * date: fires at day offsets from a date column (positive means before the date, negative after it).
   * age: fires once a record has been sitting for ageDays.
   * condition: fires while the record matches, whatever the date.
   */
  kind: 'date' | 'age' | 'condition';
  /** Lowest role rank that can read the alert. Never below the module's own read rank. */
  minRank: number;
  dateColumn?: string;
  /** Only records on these statuses. Omitted means any status. */
  statuses?: string[];
  offsets?: number[];
  /** After the last offset, a new bucket every 7 days. */
  weekly?: boolean;
  ageDays?: number;
  /** Extra filter, trusted SQL with `r` as the record, `$2` as today and `$7` as the company's time zone. */
  whereSql?: string;
  /** What makes a new bucket on a condition rule. Default: one bucket for as long as it matches. */
  bucketSql?: string;
  /** Text added to the message. */
  detailSql?: string;
  /** `{n}` becomes "3 days". " in {n}" becomes " today" on the day. */
  soon: string;
  past?: string;
  /** Severity once past the date, or always for age and condition rules. */
  severity: AlertSeverity;
  /** Raised the moment a record is saved, and emailed once to rank 3 and up. */
  immediate?: boolean;
  /** Raised and cleared by a trigger on save instead of waiting for the daily run. */
  onWrite?: boolean;
  /** Word for the list-page highlight when the date has passed. Date rules only. */
  overdueWord?: string;
}

const ACTIVE_RECEIVABLE = ['Current', '30 Days', '60 Days', '90+ Days'];

export const AUTOMATION_RULES: AutomationRule[] = [
  // Finance
  { key: 'invoices.due', module: 'invoices', table: 'invoices', group: 'Finance', kind: 'date', minRank: 4, dateColumn: 'due_date', statuses: ['Sent', 'Overdue'], offsets: [3, 0, -1, -30, -60, -90], soon: 'Payment due in {n}', past: 'Payment overdue by {n}', severity: 'critical', overdueWord: 'Overdue' },
  { key: 'receivables.overdue', module: 'receivables', table: 'receivables', group: 'Finance', kind: 'date', minRank: 4, dateColumn: 'due_date', statuses: ACTIVE_RECEIVABLE, offsets: [-30, -60, -90], soon: 'Due in {n}', past: 'Still unpaid {n} past due', severity: 'critical', overdueWord: 'Overdue' },
  { key: 'payables.due', module: 'payables', table: 'payables', group: 'Finance', kind: 'date', minRank: 4, dateColumn: 'due_date', statuses: ['To Approve', 'Approved'], offsets: [7, 0, -1], soon: 'Bill due in {n}', past: 'Bill overdue by {n}', severity: 'critical', overdueWord: 'Overdue' },
  { key: 'purchase_orders.required', module: 'purchase-orders', table: 'purchase_orders', group: 'Finance', kind: 'date', minRank: 3, dateColumn: 'required_date', statuses: ['Issued', 'Partially Received'], offsets: [7, 2, -1], soon: 'Material required on site in {n}', past: 'Material late by {n}', severity: 'warning', overdueWord: 'Late' },
  { key: 'progress_billing.holdback', module: 'progress-billing', table: 'progress_billing', group: 'Finance', kind: 'date', minRank: 3, dateColumn: 'holdback_release_date', offsets: [7, 0], whereSql: 'r.holdback_percent is null or r.holdback_percent > 0', soon: 'Holdback release date in {n}', past: 'Holdback release date passed {n} ago', severity: 'warning' },
  // The invoice has its own release date, and its holdback is still owed after the rest is paid. Stays quiet when its draw is already alerting.
  { key: 'invoices.holdback', module: 'invoices', table: 'invoices', group: 'Finance', kind: 'date', minRank: 4, dateColumn: 'holdback_release_date', statuses: ['Sent', 'Overdue', 'Paid'], offsets: [7, 0], whereSql: 'r.holdback_amount > 0 and not exists (select 1 from public.progress_billing d where d.invoice_id = r.id and d.holdback_release_date is not null and (d.holdback_percent is null or d.holdback_percent > 0))', soon: 'Holdback release date in {n}', past: 'Holdback release date passed {n} ago', severity: 'warning' },

  // Compliance
  { key: 'sub_compliance.liability', module: 'sub-compliance', table: 'sub_compliance', group: 'Compliance', kind: 'date', minRank: 2, dateColumn: 'liability_expiry', offsets: [30, 14, 7, 0, -1], soon: 'Liability insurance expires in {n}', past: 'Liability insurance expired {n} ago', severity: 'critical', overdueWord: 'Expired' },
  { key: 'sub_compliance.wcb', module: 'sub-compliance', table: 'sub_compliance', group: 'Compliance', kind: 'date', minRank: 2, dateColumn: 'wcb_clearance_expiry', offsets: [14, 7, 0, -1], soon: 'WCB clearance expires in {n}', past: 'WCB clearance expired {n} ago', severity: 'critical', overdueWord: 'Expired' },
  { key: 'sub_compliance.missing', module: 'sub-compliance', table: 'sub_compliance', group: 'Compliance', kind: 'condition', minRank: 2, whereSql: 'r.liability_expiry is null or r.wcb_clearance_expiry is null', soon: 'Insurance or WCB expiry date is missing', severity: 'warning' },
  { key: 'sub_compliance.safety_cert', module: 'sub-compliance', table: 'sub_compliance', group: 'Compliance', kind: 'condition', minRank: 2, whereSql: 'r.safety_cert_verified = false', soon: 'COR or safety certificate not verified', severity: 'info' },
  { key: 'vendors.insurance', module: 'vendors', table: 'vendors', group: 'Compliance', kind: 'date', minRank: 2, dateColumn: 'insurance_expiry', statuses: ['Preferred', 'Approved'], offsets: [30, 14, 0], soon: 'Insurance expires in {n}', past: 'Insurance expired {n} ago', severity: 'critical', overdueWord: 'Expired' },
  { key: 'employees.ticket', module: 'employees', table: 'employees', group: 'Compliance', kind: 'date', minRank: 4, dateColumn: 'ticket_expiry', statuses: ['Active'], offsets: [60, 30, 7, 0, -1], soon: 'Tickets expire in {n}', past: 'Tickets expired {n} ago', severity: 'critical', overdueWord: 'Expired' },
  { key: 'warranty.expiry', module: 'warranty', table: 'warranty', group: 'Compliance', kind: 'date', minRank: 2, dateColumn: 'expiry_date', statuses: ['Active', 'Expiring'], offsets: [60, 30, 7], soon: 'Warranty ends in {n}', past: 'Warranty ended {n} ago', severity: 'warning', overdueWord: 'Expired' },
  { key: 'warehouse.low_stock', module: 'warehouse-inventory', table: 'warehouse_inventory', group: 'Compliance', kind: 'condition', minRank: 2, statuses: ['Low', 'Out of Stock'], bucketSql: 'r.status', detailSql: "case when r.status = 'Out of Stock' then 'Out of stock. Reorder now.' else 'Stock is at or below the reorder point.' end", soon: '', severity: 'warning', onWrite: true },

  // Field
  { key: 'equipment_rentals.off_rent', module: 'equipment-rentals', table: 'equipment_rentals', group: 'Field', kind: 'date', minRank: 1, dateColumn: 'off_rent_date', statuses: ['On Rent'], offsets: [2, 0, -1], weekly: true, detailSql: "case when isfinite(r.off_rent_date) and r.daily_rate is not null and $2 > r.off_rent_date then 'Accrued since then: $' || to_char(($2 - r.off_rent_date) * r.daily_rate, 'FM999,999,990.00') || '.' end", soon: 'Off-rent date in {n}', past: 'Past its off-rent date by {n}.', severity: 'warning', overdueWord: 'Past off-rent' },
  { key: 'equipment_rentals.no_date', module: 'equipment-rentals', table: 'equipment_rentals', group: 'Field', kind: 'age', minRank: 1, dateColumn: 'created_at', statuses: ['On Rent'], ageDays: 31, whereSql: 'r.off_rent_date is null', soon: 'On rent for {n} with no off-rent date', severity: 'info' },
  { key: 'tool_crib.due_back', module: 'tool-crib', table: 'tool_crib', group: 'Field', kind: 'date', minRank: 1, dateColumn: 'due_back', statuses: ['Checked Out'], offsets: [0, -1], weekly: true, soon: 'Due back in {n}', past: 'Tool late by {n}', severity: 'warning', overdueWord: 'Late' },
  { key: 'inspections.scheduled', module: 'inspections', table: 'inspections', group: 'Field', kind: 'date', minRank: 1, dateColumn: 'inspection_date', statuses: ['Scheduled'], offsets: [2, 0, -1], soon: 'Inspection in {n}', past: 'Inspection was {n} ago. Record the result.', severity: 'warning', overdueWord: 'Result needed' },
  { key: 'inspections.failed_followup', module: 'inspections', table: 'inspections', group: 'Field', kind: 'age', minRank: 1, dateColumn: 'inspection_date', statuses: ['Failed', 'Re-inspect'], ageDays: 7, whereSql: 'not exists (select 1 from public.inspections n where n.company_id = r.company_id and n.id <> r.id and (n.project_id = r.project_id or n.title = r.title) and coalesce(n.inspection_date, n.created_at::date) > coalesce(r.inspection_date, r.created_at::date))', soon: 'No re-inspection booked {n} after the result', severity: 'warning' },
  { key: 'inspections.failed', module: 'inspections', table: 'inspections', group: 'Field', kind: 'condition', minRank: 2, statuses: ['Failed'], soon: 'Inspection failed', severity: 'critical', immediate: true, onWrite: true },
  { key: 'rfis.due', module: 'rfis', table: 'rfis', group: 'Field', kind: 'date', minRank: 1, dateColumn: 'due_date', statuses: ['Open'], offsets: [2, 0, -1], weekly: true, soon: 'Answer due in {n}', past: 'Answer overdue by {n}', severity: 'warning', overdueWord: 'Overdue' },
  { key: 'rfis.no_date', module: 'rfis', table: 'rfis', group: 'Field', kind: 'age', minRank: 1, dateColumn: 'created_at', statuses: ['Open'], ageDays: 8, whereSql: 'r.due_date is null', soon: 'Open for {n} with no response date', severity: 'info' },
  { key: 'submittals.pending', module: 'submittals', table: 'submittals', group: 'Field', kind: 'age', minRank: 1, dateColumn: 'created_at', statuses: ['Pending Review'], ageDays: 14, soon: 'Waiting on review for {n}', severity: 'warning' },
  { key: 'punch_list.due', module: 'punch-list', table: 'punch_list', group: 'Field', kind: 'date', minRank: 1, dateColumn: 'due_date', statuses: ['Open', 'In Progress', 'Ready for Review'], offsets: [2, 0, -1], soon: 'Punch item due in {n}', past: 'Punch item overdue by {n}', severity: 'warning', overdueWord: 'Overdue' },
  // The early warning for blockers. Hands over to punch_list.due at +2, so one item never shows twice
  { key: 'punch_list.blocker', module: 'punch-list', table: 'punch_list', group: 'Field', kind: 'date', minRank: 1, dateColumn: 'due_date', statuses: ['Open', 'In Progress', 'Ready for Review'], offsets: [7], whereSql: "r.priority = 'Critical / Inspection Blocker' and r.due_date > $2 + 2", soon: 'Inspection blocker due in {n}', severity: 'warning' },
  { key: 'tasks.due', module: 'tasks', table: 'tasks', group: 'Field', kind: 'date', minRank: 1, dateColumn: 'due_date', statuses: ['To Do', 'In Progress'], offsets: [0, -1], soon: 'Task due in {n}', past: 'Task overdue by {n}', severity: 'warning', overdueWord: 'Overdue' },
  { key: 'maintenance.due', module: 'maintenance', table: 'maintenance', group: 'Field', kind: 'date', minRank: 1, dateColumn: 'due_date', statuses: ['Scheduled'], offsets: [7, 0, -1], soon: 'Service due in {n}', past: 'Service overdue by {n}', severity: 'warning', overdueWord: 'Overdue' },
  { key: 'safety_logs.open', module: 'safety-logs', table: 'safety_logs', group: 'Field', kind: 'age', minRank: 1, dateColumn: 'created_at', statuses: ['Open', 'Under Investigation'], ageDays: 8, soon: 'Incident still open after {n}', severity: 'warning' },
  // Resolving an open incident clears this. One logged after the fact as already Resolved (never edited, so updated_at = created_at) still has to reach people, for its first week.
  { key: 'safety_logs.incident', module: 'safety-logs', table: 'safety_logs', group: 'Field', kind: 'condition', minRank: 2, whereSql: "(r.severity in ('High', 'Critical') or r.incident_type in ('Medical Aid', 'Lost Time')) and (r.status in ('Open', 'Under Investigation') or (r.updated_at = r.created_at and $2 - public.alert_local_date(r.created_at, $7) <= 7))", detailSql: "concat_ws(', ', r.severity, r.incident_type) || ' incident reported.' || case when r.status = 'Resolved' then ' Logged as already resolved.' else '' end", soon: '', severity: 'critical', immediate: true, onWrite: true },
  // Deadlines differ by province and change, so this names none: the company knows its own board's rule.
  // Closing an incident doesn't mean it was reported, so a resolved one keeps this for its first week. That week only stops it sitting forever; it is no WCB period.
  { key: 'safety_logs.wcb_reminder', module: 'safety-logs', table: 'safety_logs', group: 'Field', kind: 'age', minRank: 2, dateColumn: 'created_at', ageDays: 1, whereSql: "r.incident_type in ('Medical Aid', 'Lost Time') and (r.status in ('Open', 'Under Investigation') or $2 - public.alert_local_date(r.created_at, $7) <= 7)", soon: "Check this has been reported to your province's WCB. Logged {n} ago.", severity: 'critical' },
  { key: 'safety_inspections.unsafe', module: 'safety-inspections', table: 'safety_inspections', group: 'Field', kind: 'condition', minRank: 2, whereSql: "r.result = 'Unsafe: Work Stopped'", soon: 'Safety inspection found it unsafe. Work stopped.', severity: 'critical', immediate: true, onWrite: true },
  { key: 'loto_permits.open', module: 'loto-permits', table: 'loto_permits', group: 'Field', kind: 'age', minRank: 1, dateColumn: 'created_at', statuses: ['Draft', 'Locked Out', 'Verified Zero Energy'], ageDays: 8, soon: 'Permit not released after {n}', severity: 'warning' },
  { key: 'tailgate_logs.sign_off', module: 'tailgate-logs', table: 'tailgate_logs', group: 'Field', kind: 'age', minRank: 1, dateColumn: 'created_at', statuses: ['Needs Sign-off'], ageDays: 2, soon: 'Waiting on sign-off for {n}', severity: 'warning' },
  { key: 'daily_logs.draft', module: 'daily-logs', table: 'daily_logs', group: 'Field', kind: 'age', minRank: 1, dateColumn: 'created_at', statuses: ['Draft'], ageDays: 3, soon: 'Still a draft after {n}', severity: 'info' },
  { key: 'timecards.submitted', module: 'timecards', table: 'timecards', group: 'Field', kind: 'age', minRank: 3, dateColumn: 'created_at', statuses: ['Submitted'], ageDays: 4, soon: 'Waiting on approval for {n}', severity: 'warning' },
  // Only the card's own worker sees this, in the app by the alerts_select policy and by email through cardOwners below
  { key: 'timecards.rejected', module: 'timecards', table: 'timecards', group: 'Field', kind: 'condition', minRank: 1, statuses: ['Rejected'], detailSql: "case when btrim(coalesce(r.reject_reason, '')) <> '' then 'Reason: ' || r.reject_reason end", soon: 'Timecard sent back. Fix it and save to resubmit.', severity: 'warning', onWrite: true },

  // Sales
  { key: 'proposals.valid', module: 'proposals', table: 'proposals', group: 'Sales', kind: 'date', minRank: 3, dateColumn: 'valid_until', statuses: ['Sent'], offsets: [7, 0], soon: 'Prices lapse in {n}', past: 'Prices lapsed {n} ago', severity: 'warning', overdueWord: 'Lapsed' },
  { key: 'proposals.follow_up', module: 'proposals', table: 'proposals', group: 'Sales', kind: 'age', minRank: 3, dateColumn: 'updated_at', statuses: ['Sent'], ageDays: 14, soon: 'No change in {n}. Time to follow up.', severity: 'info' },
  { key: 'estimates.bid_due', module: 'estimates', table: 'estimates', group: 'Sales', kind: 'date', minRank: 3, dateColumn: 'bid_due', statuses: ['Draft', 'Submitted'], offsets: [3, 1], soon: 'Bid due in {n}', past: 'Bid date passed {n} ago', severity: 'warning', overdueWord: 'Past bid date' },
  { key: 'rfq.deadline', module: 'rfq', table: 'rfq', group: 'Sales', kind: 'date', minRank: 2, dateColumn: 'deadline', statuses: ['Sent'], offsets: [2, 0], soon: 'Quote due in {n}', past: 'Quote late by {n}', severity: 'warning', overdueWord: 'Late' },
  { key: 'rfp.closing', module: 'rfp', table: 'rfp', group: 'Sales', kind: 'date', minRank: 3, dateColumn: 'closing_date', statuses: ['Reviewing', 'Bidding'], offsets: [7, 2], soon: 'Closes in {n}', past: 'Closed {n} ago', severity: 'warning', overdueWord: 'Closed' },
  // The revised end date, so an approved change order that adds days moves this alert too
  { key: 'projects.overrun', module: 'projects', table: 'projects', group: 'Sales', kind: 'date', minRank: 1, dateColumn: 'revised_end_date', statuses: ['Active'], offsets: [-1], weekly: true, soon: 'Ends in {n}', past: 'Past its end date by {n}', severity: 'warning', overdueWord: 'Past end date' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date (YYYY-MM-DD) where the company is. After 6pm in Regina the UTC date is already tomorrow. */
export function companyToday(province: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: provinceTimeZone(province), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today on this device. For the list highlight, which runs in the browser of someone on site. */
export function deviceToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const HIGHLIGHT_RULES = new Map<string, AutomationRule[]>();
for (const rule of AUTOMATION_RULES) {
  if (!rule.overdueWord) continue;
  HIGHLIGHT_RULES.set(rule.module, [...(HIGHLIGHT_RULES.get(rule.module) ?? []), rule]);
}

/**
 * The word to flag a list row with when its date has passed, or null. Works from the row
 * itself, so a list is right even if last night's automation run was missed.
 */
export function overdueWord(slug: string, row: Record<string, unknown>, today: string): string | null {
  for (const rule of HIGHLIGHT_RULES.get(slug) ?? []) {
    if (rule.statuses && !rule.statuses.includes(String(row.status))) continue;
    const date = row[rule.dateColumn!];
    if (typeof date === 'string' && date.slice(0, 10) < today) return rule.overdueWord!;
  }
  return null;
}

export interface AlertRow {
  id: string;
  company_id?: string;
  rule_key: string;
  module: string;
  record_id: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  min_rank: number;
  bucket: string;
  due_on: string | null;
  bucket_changed_at: string;
  resolved_at?: string | null;
}

export interface AlertMemberState {
  alert_id: string;
  user_id: string;
  snoozed_until: string | null;
  dismissed_bucket: string | null;
}

export interface AlertSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  last_checked: string | null;
}

export const REJECTED_CARD_RULE = 'timecards.rejected';

/**
 * The alerts one member may be told about. Rank is checked against both the alert and the
 * module it came from, so a mistake in one still can't put an invoice in a foreman's inbox.
 */
export function alertsForMember<T extends AlertRow>(
  alerts: readonly T[],
  member: { userId: string; rank: number },
  options: { today: string; since?: string; states?: readonly AlertMemberState[]; /** For the digest, which reads as the service role: the login each rejected timecard belongs to. */ cardOwners?: ReadonlyMap<string, string | null> }
): T[] {
  const states = new Map((options.states ?? []).filter((s) => s.user_id === member.userId).map((s) => [s.alert_id, s]));
  const since = options.since ? new Date(options.since).getTime() : null;
  return alerts.filter((alert) => {
    const mod = getModule(alert.module);
    if (!mod || member.rank < alert.min_rank || member.rank < mod.read) return false;
    if (alert.resolved_at) return false;
    // In the app row security does this
    if (alert.rule_key === REJECTED_CARD_RULE && options.cardOwners?.get(alert.record_id) !== member.userId) return false;
    if (since !== null && new Date(alert.bucket_changed_at).getTime() <= since) return false;
    const state = states.get(alert.id);
    if (state?.dismissed_bucket === alert.bucket) return false;
    if (state?.snoozed_until && state.snoozed_until > options.today) return false;
    return true;
  });
}

/** When the daily check last ran, for the foot of an alert list. */
export function lastCheckedLabel(iso: string | null | undefined): string {
  if (!iso) return 'Not checked yet. The first check runs overnight.';
  return `Last checked ${formatValue('datetime', iso)}`;
}

/** Where an alert goes when tapped: its record's page, or its module's list. */
export function alertHref(alert: Pick<AlertRow, 'module' | 'record_id'>): string {
  return detailHref(alert.module, alert.record_id) ?? `/${alert.module}`;
}

export function moduleLabel(slug: string): string {
  return getModule(slug)?.label ?? slug;
}

export function groupBySeverity<T extends Pick<AlertRow, 'severity'>>(alerts: readonly T[]): { severity: AlertSeverity; alerts: T[] }[] {
  return ALERT_SEVERITIES.map((severity) => ({ severity, alerts: alerts.filter((a) => a.severity === severity) })).filter((g) => g.alerts.length > 0);
}
