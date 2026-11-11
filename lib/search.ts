// Search across the whole app from one box. Kept apart from the route so the role gate, the
// filter text and the links can be tested without a database.
import { detailHref } from './detail-pages';
import { getModule, type ModuleDef } from './modules';
import { hasRank, type Role } from './roles';

/** Modules the search box looks in, most useful first, with the columns besides the title that are matched. */
const SEARCHED: [slug: string, columns: string[]][] = [
  ['crm', ['contact_person', 'email', 'phone', 'project_site']],
  ['estimates', ['client_name', 'client_address']],
  ['proposals', ['client_name']],
  ['projects', ['client_name', 'site']],
  ['invoices', ['invoice_number', 'client_name']],
  ['change-orders', ['co_number']],
  ['tasks', ['assigned_to']],
  ['rfis', []],
  ['purchase-orders', []],
  ['vendors', []],
  ['employees', []],
  ['equipment', []],
];

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;
export const SEARCH_PER_MODULE = 5;

export interface SearchTarget {
  mod: ModuleDef;
  /** Text columns matched, title first. Only ones the registry has and a signed-in user may read. */
  columns: string[];
}

const TEXT_TYPES = new Set(['text', 'email', 'tel']);

/** What this role can search. A module the role can't read is never queried at all. */
export function searchTargets(role: Role): SearchTarget[] {
  return SEARCHED.flatMap(([slug, extra]) => {
    const mod = getModule(slug);
    if (!mod || !hasRank(role, mod.read)) return [];
    const columns = extra.filter((key) => mod.fields.some((f) => f.key === key && TEXT_TYPES.has(f.type) && !f.restricted));
    return [{ mod, columns: ['title', ...columns] }];
  });
}

/** The typed text, trimmed and capped, or null when it's too short to search. */
export function cleanQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? '').trim().slice(0, SEARCH_MAX_LENGTH);
  return q.length >= SEARCH_MIN_LENGTH ? q : null;
}

/**
 * A PostgREST `or` filter matching any of the columns. Characters that mean something to
 * ilike are escaped, and ones that would end the value early (comma, brackets, quotes) become spaces.
 */
export function searchFilter(columns: readonly string[], q: string): string {
  const pattern = q.replace(/[\\%_]/g, (c) => '\\' + c).replace(/[,()"]/g, ' ');
  return columns.map((c) => `${c}.ilike.%${pattern}%`).join(',');
}

export interface SearchHit {
  id: string;
  title: string;
  status: string | null;
  /** The matched extra column's value, if the title wasn't what matched. */
  detail: string | null;
  href: string;
}

export interface SearchGroup {
  slug: string;
  label: string;
  hits: SearchHit[];
}

/** The record's own page, or its list narrowed to that title when the module only has a list. */
export function hitHref(slug: string, id: string, title: string): string {
  return detailHref(slug, id) ?? `/${slug}?${new URLSearchParams({ q: title })}`;
}

export function toHit(target: SearchTarget, row: Record<string, unknown>, q: string): SearchHit {
  const title = String(row.title ?? '');
  const needle = q.toLowerCase();
  const extra = title.toLowerCase().includes(needle) ? undefined : target.columns.slice(1).find((c) => String(row[c] ?? '').toLowerCase().includes(needle));
  const fallback = target.columns.slice(1).map((c) => row[c]).find((v) => v !== null && v !== undefined && v !== '');
  const detail = extra ? row[extra] : fallback;
  return {
    id: String(row.id),
    title,
    status: typeof row.status === 'string' ? row.status : null,
    detail: detail === null || detail === undefined || detail === '' ? null : String(detail),
    href: hitHref(target.mod.slug, String(row.id), title),
  };
}

export interface QuickAction {
  label: string;
  href: string;
}

// Timecards have their own entry page rather than the shared list's "new" form
const QUICK_ACTIONS: [slug: string, label: string, href?: string][] = [
  ['estimates', 'New Estimate'],
  ['crm', 'New Client'],
  ['invoices', 'New Invoice'],
  ['daily-logs', 'New Daily Log'],
  ['timecards', 'Enter Time', '/timecards'],
  ['tasks', 'New Task'],
];

/** The "new" shortcuts this person can actually use: their role may write there, and the company can still edit. */
export function quickActions(role: Role, canWrite: boolean): QuickAction[] {
  if (!canWrite) return [];
  return QUICK_ACTIONS.flatMap(([slug, label, href]) => {
    const mod = getModule(slug);
    return mod && hasRank(role, mod.write) ? [{ label, href: href ?? `/${slug}?new=1` }] : [];
  });
}
