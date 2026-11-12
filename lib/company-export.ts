// "Download all company data": one JSON file with every row the company owns, read as the
// signed-in owner so row security decides what is in it. tests/company-export.test.ts checks these
// lists against the database: a company table an owner can read that is missing here fails it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordColumns } from '@/lib/crud';
import { MODULES } from '@/lib/modules';

export const EXPORT_FORMAT = 'tradequote-company-export';
export const EXPORT_VERSION = 1;
/** Rows per request. Supabase returns at most 1000 by default; reading goes on until the count is reached, whatever the server's limit. */
export const EXPORT_PAGE_SIZE = 1000;

export interface ExportSource {
  table: string;
  /** What to select: `*`, or the columns a signed-in user may read when some are closed to everyone. */
  columns: string;
  /** A stable order, so pages neither skip nor repeat rows. */
  order: string[];
}

// The company row. default_markup and default_labour_rate are read through company_rates, and the
// Stripe ids through company_billing_ids: no signed-in user can select them directly.
export const COMPANY_EXPORT_COLUMNS =
  'id, name, province, subscription_status, trial_ends_at, current_period_end, contact, phone, email, address, default_tax, default_terms, overtime_multiplier, default_holdback_pct, created_at, tax_number, logo_path';

/** Company tables outside the module registry that an owner can read. */
const OTHER_SOURCES: ExportSource[] = [
  { table: 'company_users', columns: '*', order: ['user_id'] },
  // Not the token: whoever held the file could accept a pending invitation with it
  { table: 'invitations', columns: 'id, company_id, email, role, invited_by, created_at, expires_at, accepted_at', order: ['id'] },
  { table: 'estimate_items', columns: '*', order: ['id'] },
  { table: 'proposal_shares', columns: '*', order: ['id'] },
  { table: 'assemblies', columns: '*', order: ['id'] },
  { table: 'assembly_lines', columns: '*', order: ['id'] },
  { table: 'job_cost_entries', columns: '*', order: ['id'] },
  { table: 'alerts', columns: '*', order: ['id'] },
  // Snoozes and dismissals: row security returns only the owner's own
  { table: 'alert_member_state', columns: '*', order: ['alert_id', 'user_id'] },
  { table: 'automation_company_state', columns: '*', order: ['company_id'] },
  { table: 'ai_usage', columns: '*', order: ['day'] },
];

/**
 * Company tables only the server reads (automation history, digest and trial email sends, number
 * counters). No signed-in user can select them, so they can't be in an export made as the owner.
 */
export const SERVER_ONLY_TABLES = ['automation_events', 'company_counters', 'digest_sends', 'trial_emails'];

export const EXPORT_SOURCES: ExportSource[] = [...MODULES.map((m) => ({ table: m.table, columns: recordColumns(m), order: ['id'] })), ...OTHER_SOURCES];

/** Columns left out of the file, and why, so whoever reads it knows nothing was lost by accident. */
export const EXPORT_OMITTED_COLUMNS: Record<string, string[]> = {
  companies: ['default_markup', 'default_labour_rate', 'stripe_customer_id', 'stripe_subscription_id'],
  invitations: ['token'],
  ...Object.fromEntries(MODULES.filter((m) => m.fields.some((f) => f.restricted)).map((m) => [m.table, m.fields.filter((f) => f.restricted).map((f) => f.key)])),
};

const NOTES = [
  'Every record your company has in TradeQuote PRO, one list per table, as the owner could read it on the day of the export.',
  'Photos and the company logo are not inside this file. Records list the names of their files.',
  'Some cost and contract columns cannot be read directly by anyone signed in, so they are not in this file. They are listed under omitted_columns.',
];

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };
type Page = { data: unknown[] | null; error: DbError | null; count?: number | null };

export interface CompanyExport {
  export_format: typeof EXPORT_FORMAT;
  export_version: typeof EXPORT_VERSION;
  exported_at: string;
  company_name: string;
  exported_by: string | null;
  notes: string[];
  omitted_columns: Record<string, string[]>;
  row_counts: Record<string, number>;
  tables: Record<string, Row[]>;
}

/** Every row of one table the caller can read, page by page. */
export async function readAllRows(supabase: SupabaseClient, source: ExportSource, pageSize = EXPORT_PAGE_SIZE): Promise<{ rows: Row[] } | { error: DbError }> {
  const rows: Row[] = [];
  let total: number | null = null;
  for (;;) {
    // The count is asked for once, with the first page
    const first = rows.length === 0;
    const select = supabase.from(source.table).select(source.columns, first ? { count: 'exact' } : undefined);
    const ordered = source.order.reduce((query, column) => query.order(column, { ascending: true }), select);
    const { data, error, count } = (await ordered.range(rows.length, rows.length + pageSize - 1)) as Page;
    if (error) return { error };
    const page = (data ?? []) as Row[];
    if (first) total = typeof count === 'number' ? count : null;
    rows.push(...page);
    // Stop on an empty page, or once the count is reached. A server limit below pageSize only means more pages.
    if (!page.length || (total !== null ? rows.length >= total : page.length < pageSize)) return { rows };
  }
}

/** Runs `work` over `items`, a few at a time. */
async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) results.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return results;
}

/**
 * Reads the whole company as the signed-in user. Fails as a whole when any table can't be read,
 * so an owner never keeps a file that is quietly missing part of their data.
 */
export async function buildCompanyExport(
  supabase: SupabaseClient,
  company: { id: string; name: string },
  options: { exportedBy?: string | null; now?: Date; pageSize?: number } = {}
): Promise<{ data: CompanyExport } | { error: DbError; table: string }> {
  const { data: companyRow, error: companyError } = await supabase.from('companies').select(COMPANY_EXPORT_COLUMNS).eq('id', company.id).maybeSingle();
  if (companyError) return { error: companyError, table: 'companies' };

  const results = await inBatches(EXPORT_SOURCES, 6, async (source) => ({ source, result: await readAllRows(supabase, source, options.pageSize) }));
  const tables: Record<string, Row[]> = { companies: companyRow ? [companyRow as unknown as Row] : [] };
  for (const { source, result } of results) {
    if ('error' in result) return { error: result.error, table: source.table };
    tables[source.table] = result.rows;
  }

  const companyName = (companyRow as { name?: string } | null)?.name ?? company.name;
  return {
    data: {
      export_format: EXPORT_FORMAT,
      export_version: EXPORT_VERSION,
      exported_at: (options.now ?? new Date()).toISOString(),
      company_name: companyName,
      exported_by: options.exportedBy ?? null,
      notes: NOTES,
      omitted_columns: EXPORT_OMITTED_COLUMNS,
      row_counts: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])),
      tables,
    },
  };
}

/** A file name with the company and the date in it, safe on every operating system. */
export function exportFileName(companyName: string, now: Date = new Date()): string {
  const slug = companyName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `tradequote-${slug || 'company'}-${now.toISOString().slice(0, 10)}.json`;
}
