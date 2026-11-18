// The schedule calendar's pure logic: date math on plain YYYY-MM-DD strings and turning
// rows into calendar items. Every date is handled as a UTC midnight so nothing drifts a
// day in any time zone or across a clock change. No database, safe to import anywhere.
import { detailHref } from '@/lib/detail-pages';
import { getModule } from '@/lib/modules';
import { hasRank, type Role } from '@/lib/roles';

export type CalendarView = 'month' | 'week';

const DAY_MS = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const toUtc = (date: string) => {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A real calendar day written YYYY-MM-DD. 2026-02-30 is not one. */
export function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;
}

/** The date part of a date or timestamp column, or null. */
export function dateOnly(value: unknown): string | null {
  const day = typeof value === 'string' ? value.slice(0, 10) : null;
  return isDate(day) ? day : null;
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** 0 is Sunday. */
export function weekday(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

/** Weeks run Sunday to Saturday. */
export function startOfWeek(date: string): string {
  return addDays(date, -weekday(date));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 8)}01`;
}

/** Same day in another month, pulled back to that month's last day when it is shorter. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

export function weekDays(date: string): string[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Every week that touches the month, each a full Sunday to Saturday. */
export function monthWeeks(date: string): string[][] {
  const [y, m] = parts(date);
  const first = startOfMonth(date);
  const last = `${first.slice(0, 8)}${pad(daysInMonth(y, m))}`;
  const weeks: string[][] = [];
  for (let day = startOfWeek(first); day <= last; day = addDays(day, 7)) weeks.push(weekDays(day));
  return weeks;
}

/** First and last day the view shows, inclusive. */
export function viewRange(view: CalendarView, date: string): { from: string; to: string } {
  if (view === 'week') return { from: startOfWeek(date), to: addDays(startOfWeek(date), 6) };
  const weeks = monthWeeks(date);
  return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
}

/** One step back (-1) or forward (1): a week or a month. */
export function stepDate(view: CalendarView, date: string, direction: 1 | -1): string {
  return view === 'week' ? addDays(date, 7 * direction) : addMonths(date, direction);
}

type Param = string | string[] | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

/** Reads ?view= and ?date= from the URL. Anything missing or malformed falls back to this month and today. */
export function parseCalendarParams(params: { view?: Param; date?: Param }, today: string): { view: CalendarView; date: string } {
  const date = first(params.date);
  return { view: first(params.view) === 'week' ? 'week' : 'month', date: isDate(date) ? date : today };
}

export function calendarHref(view: CalendarView, date: string): string {
  return `/calendar?view=${view}&date=${date}`;
}

/** "Nov 8" */
export function shortDay(date: string): string {
  const [, m, d] = parts(date);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

/** "Sun, Nov 8" */
export function dayLabel(date: string): string {
  return `${WEEKDAYS[weekday(date)]}, ${shortDay(date)}`;
}

/** "November 2026" for a month, "Nov 8 to Nov 14, 2026" for a week. */
export function rangeLabel(view: CalendarView, date: string): string {
  if (view === 'month') return `${MONTHS[parts(date)[1] - 1]} ${parts(date)[0]}`;
  const { from, to } = viewRange('week', date);
  const fromYear = from.slice(0, 4);
  const toYear = to.slice(0, 4);
  return `${shortDay(from)}${fromYear === toYear ? '' : `, ${fromYear}`} to ${shortDay(to)}, ${toYear}`;
}

export interface CalendarSource {
  key: string;
  /** Module slug in lib/modules.ts. Its read rank decides who sees the source. */
  module: string;
  /** Legend text. */
  label: string;
  /** Prefix on every item, so the colour is never the only cue. */
  short: string;
  /** Date column the item sits on. */
  start: string;
  /** With an end column the item runs over every day from start to end. */
  end?: string;
  /** Records on these statuses stay off the calendar. */
  skipStatuses?: string[];
}

export const CALENDAR_SOURCES: CalendarSource[] = [
  { key: 'crew', module: 'crew-schedule', label: 'Crew booking', short: 'Crew', start: 'start_date', end: 'end_date', skipStatuses: ['Cancelled'] },
  { key: 'project-start', module: 'projects', label: 'Project start', short: 'Start', start: 'start_date' },
  { key: 'project-end', module: 'projects', label: 'Project end', short: 'End', start: 'end_date' },
  { key: 'bid', module: 'estimates', label: 'Bid due', short: 'Bid', start: 'bid_due' },
  { key: 'proposal', module: 'proposals', label: 'Proposal expires', short: 'Expires', start: 'valid_until' },
  { key: 'task', module: 'tasks', label: 'Task due', short: 'Task', start: 'due_date' },
  { key: 'invoice', module: 'invoices', label: 'Invoice due', short: 'Invoice', start: 'due_date' },
];

/** The sources whose module this role may read. */
export function visibleSources(role: Role): CalendarSource[] {
  return CALENDAR_SOURCES.filter((source) => {
    const mod = getModule(source.module);
    return !!mod && hasRank(role, mod.read);
  });
}

export interface CalendarItem {
  /** Unique on the page. */
  key: string;
  source: string;
  title: string;
  status: string;
  start: string;
  /** Same as start for a one-day item. */
  end: string;
  href: string;
}

/** One item per row that has the source's date. An end before the start is treated as a one-day item. */
export function toItems(source: CalendarSource, rows: Record<string, unknown>[]): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const row of rows) {
    const start = dateOnly(row[source.start]);
    const id = typeof row.id === 'string' ? row.id : '';
    const status = typeof row.status === 'string' ? row.status : '';
    if (!start || !id || source.skipStatuses?.includes(status)) continue;
    const end = source.end ? dateOnly(row[source.end]) : null;
    items.push({
      key: `${source.key}:${id}`,
      source: source.key,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'Untitled',
      status,
      start,
      end: end && end > start ? end : start,
      href: detailHref(source.module, id) ?? `/${source.module}`,
    });
  }
  return items;
}

const sourceOrder = (key: string) => CALENDAR_SOURCES.findIndex((source) => source.key === key);

/** What falls on a day, in legend order and then by name. */
export function itemsOnDay(items: CalendarItem[], day: string): CalendarItem[] {
  return items
    .filter((item) => item.start <= day && day <= item.end)
    .sort((a, b) => sourceOrder(a.source) - sourceOrder(b.source) || a.title.localeCompare(b.title));
}
