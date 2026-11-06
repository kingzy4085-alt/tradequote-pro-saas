// Timecard rules shared by the page, the API and the tests. The rules that protect pay
// (who approves, frozen rate, labour cost, locks) live in the guard_timecard trigger, in
// supabase/migrations/20261104000100_timecards.sql. Nothing here computes money.
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { LINK_OPTION_LIMIT } from './pagination';
import { provinceTimeZone } from './provinces';
import { isCalendarDate } from './validation';

export const FOREMAN_RANK = 2;
export const PM_RANK = 3;
/** The most cards one approve or reject call takes. Mirrors decide_timecards. */
export const DECIDE_BATCH = 500;
const WEEK_PAGE = 1000;
const WEEK_PAGES = 5;
export const MAX_DAY_HOURS = 24;

export type TimecardStatus = 'Submitted' | 'Approved' | 'Rejected' | 'Exported';

export interface Timecard {
  id: string;
  title: string;
  status: TimecardStatus;
  notes: string | null;
  project_id: string | null;
  employee_name: string;
  employee_id: string | null;
  worker_user_id: string | null;
  work_date: string | null;
  regular_hours: number | string | null;
  overtime_hours: number | string | null;
  reject_reason: string | null;
  hourly_cost: number | string | null;
  labour_cost: number | string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  exported_at: string | null;
  created_by: string | null;
}

export interface Worker {
  employee_id: string | null;
  user_id: string | null;
  name: string;
}

export interface ProjectOption {
  id: string;
  title: string;
}

/**
 * What a signed-in user can read from the table. Pay isn't here: nobody signed in has select on
 * hourly_cost or labour_cost, so asking for them (or for *) is refused. Project managers get
 * them from cardsWithPay.
 */
export const TIMECARD_COLUMNS = 'id, title, status, notes, project_id, employee_name, employee_id, worker_user_id, work_date, regular_hours, overtime_hours, reject_reason, approved_by_name, approved_at, exported_at, created_by';

// Dates are plain YYYY-MM-DD strings, worked on in UTC so a time zone can't shift the day.
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** The Monday of the week holding this date. */
export function weekStart(iso: string): string {
  return addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Today where the company is, not where the server is. */
export function companyDate(province: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: provinceTimeZone(province), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The week a page asked for, or this week if the address holds anything else. */
export function resolveWeek(param: unknown, today: string): string {
  return typeof param === 'string' && isCalendarDate(param) ? weekStart(param) : weekStart(today);
}

export function formatDay(iso: string): string {
  return toDate(iso).toLocaleDateString('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatWeek(start: string): string {
  const opts = { timeZone: 'UTC', month: 'short', day: 'numeric' } as const;
  return `${toDate(start).toLocaleDateString('en-CA', opts)} to ${toDate(addDays(start, 6)).toLocaleDateString('en-CA', { ...opts, year: 'numeric' })}`;
}

export const hoursOf = (card: Pick<Timecard, 'regular_hours' | 'overtime_hours'>) => Number(card.regular_hours ?? 0) + Number(card.overtime_hours ?? 0);

export interface Totals {
  regular: number;
  overtime: number;
  cost: number;
}

/** A rejected card's hours don't count until it is fixed and sent back. */
export function totals(cards: Timecard[]): Totals {
  return cards.filter((c) => c.status !== 'Rejected').reduce<Totals>(
    (t, c) => ({ regular: t.regular + Number(c.regular_hours ?? 0), overtime: t.overtime + Number(c.overtime_hours ?? 0), cost: t.cost + Number(c.labour_cost ?? 0) }),
    { regular: 0, overtime: 0, cost: 0 }
  );
}

export interface CardGroup {
  key: string;
  label: string;
  cards: Timecard[];
}

/** Cards under each worker or each job, alphabetically, oldest day first. */
export function groupCards(cards: Timecard[], by: 'worker' | 'job'): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const card of cards) {
    const label = by === 'worker' ? card.employee_name : card.title;
    const key = label.trim().toLowerCase();
    const group = groups.get(key);
    if (group) group.cards.push(card);
    else groups.set(key, { key, label, cards: [card] });
  }
  for (const group of Array.from(groups.values())) group.cards.sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)) || a.employee_name.localeCompare(b.employee_name));
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/** Pay is for project managers and up. A foreman approves hours without seeing the crew's rates. */
export function hidePay(card: Timecard): Timecard {
  return { ...card, hourly_cost: null, labour_cost: null };
}

/** Fills in the frozen pay on these cards. The database refuses this below project manager. */
export async function cardsWithPay(supabase: SupabaseClient, cards: Timecard[]): Promise<Timecard[]> {
  if (cards.length === 0) return cards;
  const { data, error } = await supabase.rpc('timecard_pay', { p_ids: cards.map((c) => c.id) });
  if (error) throw new Error(`Could not load pay: ${error.message}`);
  const pay = new Map(((data ?? []) as Pick<Timecard, 'id' | 'hourly_cost' | 'labour_cost'>[]).map((p) => [p.id, p]));
  return cards.map((c) => ({ ...c, hourly_cost: pay.get(c.id)?.hourly_cost ?? null, labour_cost: pay.get(c.id)?.labour_cost ?? null }));
}

// Validation ----------------------------------------------------------------

/** The plain-language problem with these hours, or null. The trigger enforces the same rule. */
export function hoursProblem(regular: number, overtime: number): string | null {
  if (regular < 0 || overtime < 0) return 'Hours cannot be negative.';
  if (regular + overtime <= 0) return 'Enter the hours worked.';
  if (regular + overtime > MAX_DAY_HOURS) return `A timecard cannot be more than ${MAX_DAY_HOURS} hours in one day.`;
  return null;
}

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null);
const dateSchema = z.string().refine(isCalendarDate, 'Pick a date');
const hoursSchema = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? 0 : v ?? 0), z.coerce.number().finite());

const EntrySchema = z
  .object({
    employee_id: z.preprocess(blankToNull, z.string().uuid().nullable()),
    worker_user_id: z.preprocess(blankToNull, z.string().uuid().nullable()),
    employee_name: z.preprocess(blankToNull, z.string().trim().min(1).max(300).nullable()),
    regular_hours: hoursSchema,
    overtime_hours: hoursSchema,
  })
  .superRefine((e, ctx) => {
    const problem = hoursProblem(e.regular_hours, e.overtime_hours);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['regular_hours'] });
  });

export const CrewEntrySchema = z
  .object({
    work_date: dateSchema,
    project_id: z.preprocess(blankToNull, z.string().uuid().nullable()),
    /** Time that isn't on a project: shop, travel, training. */
    job: z.preprocess(blankToNull, z.string().trim().max(300).nullable()),
    notes: z.preprocess(blankToNull, z.string().trim().max(2000).nullable()),
    entries: z.array(EntrySchema).min(1, 'Enter hours for at least one worker.').max(200, 'Up to 200 workers at a time.'),
  })
  .superRefine((v, ctx) => {
    if (!v.project_id && !v.job) ctx.addIssue({ code: 'custom', message: 'Pick a project or type the job.', path: ['project_id'] });
  });
export type CrewEntry = z.infer<typeof CrewEntrySchema>;

export const DECIDE_ACTIONS = ['approve', 'reject', 'unapprove', 'reopen'] as const;
export type DecideAction = (typeof DECIDE_ACTIONS)[number];

export const DecideSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Pick at least one timecard.').max(DECIDE_BATCH),
  action: z.enum(DECIDE_ACTIONS),
  reason: z.preprocess(blankToNull, z.string().trim().max(500).nullable()),
});

export const ExportSchema = z
  .object({ from: dateSchema, to: dateSchema, again: z.boolean().optional() })
  .refine((v) => v.from <= v.to, { message: 'The start date is after the end date.', path: ['to'] });

/** The first message of a failed parse, for showing as-is. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Some values were not valid.';
}

/** Who a crew entry row is for. Null when the picked worker isn't one this person can enter time for. */
export function resolveWorker(entry: CrewEntry['entries'][number], workers: Worker[], rank: number): Worker | null {
  // Workers below foreman get a list of one: themselves
  if (rank < FOREMAN_RANK) return workers[0] ?? null;
  if (entry.worker_user_id || entry.employee_id) {
    return workers.find((w) => (entry.worker_user_id ? w.user_id === entry.worker_user_id : w.employee_id === entry.employee_id)) ?? null;
  }
  return entry.employee_name ? { employee_id: null, user_id: null, name: entry.employee_name } : null;
}

/** The rows a crew entry inserts. Pay and approval fields are never here: the trigger owns them. */
export function crewRows(entry: CrewEntry, title: string, resolved: Worker[]) {
  return entry.entries.map((e, i) => ({
    title,
    status: 'Submitted',
    project_id: entry.project_id,
    work_date: entry.work_date,
    notes: entry.notes,
    regular_hours: e.regular_hours,
    overtime_hours: e.overtime_hours,
    employee_name: resolved[i].name,
    employee_id: resolved[i].employee_id,
    worker_user_id: resolved[i].user_id,
  }));
}

// Payroll file --------------------------------------------------------------

/**
 * One CSV cell. Names and notes are typed by people, and a spreadsheet runs a cell that
 * starts with = + - or @ as a formula, so those get a leading apostrophe.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s ﻿]*[=+\-@＝＋－＠]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const fixed = (value: unknown) => Number(value ?? 0).toFixed(2);

export const PAYROLL_HEADER = ['Worker', 'Date', 'Job', 'Regular Hours', 'Overtime Hours', 'Hourly Cost', 'Labour Cost', 'Approved By', 'Approved At', 'Notes'];

/** The payroll file. Starts with a byte order mark so Excel reads accented names properly. */
export function payrollCsv(cards: Timecard[]): string {
  const lines = cards.map((c) =>
    [c.employee_name, c.work_date, c.title, fixed(c.regular_hours), fixed(c.overtime_hours), fixed(c.hourly_cost), fixed(c.labour_cost), c.approved_by_name, c.approved_at, c.notes].map(csvCell).join(',')
  );
  return `﻿${[PAYROLL_HEADER.join(','), ...lines].join('\r\n')}\r\n`;
}

// Loading -------------------------------------------------------------------

/** A week's cards as the signed-in user may see them. `partial` means there were too many to load. */
export async function loadWeek(supabase: SupabaseClient, from: string, to: string, project?: string | null, withPay = false): Promise<{ cards: Timecard[]; partial: boolean }> {
  const cards: Timecard[] = [];
  for (let page = 0; page < WEEK_PAGES; page++) {
    let query = supabase.from('timecards').select(TIMECARD_COLUMNS).gte('work_date', from).lte('work_date', to);
    if (project) query = query.eq('project_id', project);
    const { data, error } = await query
      .order('work_date', { ascending: true })
      .order('id', { ascending: true })
      .range(page * WEEK_PAGE, (page + 1) * WEEK_PAGE - 1);
    if (error) throw new Error(`Could not load timecards: ${error.message}`);
    const rows = (data ?? []) as unknown as Timecard[];
    cards.push(...rows.map(hidePay));
    if (rows.length < WEEK_PAGE) return { cards: withPay ? await cardsWithPay(supabase, cards) : cards, partial: false };
  }
  return { cards: withPay ? await cardsWithPay(supabase, cards) : cards, partial: true };
}

export async function loadWorkers(supabase: SupabaseClient): Promise<Worker[]> {
  const { data, error } = await supabase.rpc('timecard_workers');
  if (error) throw new Error(`Could not load workers: ${error.message}`);
  return (data ?? []) as Worker[];
}

export async function loadProjects(supabase: SupabaseClient): Promise<ProjectOption[]> {
  const { data, error } = await supabase.from('projects').select('id, title').order('title', { ascending: true }).order('id', { ascending: true }).limit(LINK_OPTION_LIMIT);
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  return (data ?? []) as ProjectOption[];
}
