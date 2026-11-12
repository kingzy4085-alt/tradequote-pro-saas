// "Download all company data": the lists of what is exported, checked against the real database;
// an export made as the owner on PGlite, so row security decides what is in it; the route; and the
// account page that offers it.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase, type FakeOptions } from './helpers/fake-supabase';
import { bootDb, type TestDb } from './helpers/db';
import { companyTables, seedCompany } from './helpers/seed-company';

const mocks = vi.hoisted(() => ({ server: null as unknown, page: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => mocks.server }));
vi.mock('@/lib/context', async (original) => ({ ...(await original<typeof import('@/lib/context')>()), getPageContext: async () => mocks.page }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

import AccountPage from '@/app/(app)/settings/account/page';
import { GET as exportRoute } from '@/app/api/account/export/route';
import { COMPANY_EXPORT_COLUMNS, EXPORT_FORMAT, EXPORT_OMITTED_COLUMNS, EXPORT_SOURCES, SERVER_ONLY_TABLES, buildCompanyExport, exportFileName, readAllRows, type CompanyExport } from '@/lib/company-export';
import { MODULES } from '@/lib/modules';

const uid = (n: number) => `00000000-0000-4000-8000-0000000015${String(n).padStart(2, '0')}`;
const users = {
  ownerA: { id: uid(1), email: 'owner@alpha.ca' },
  pmA: { id: uid(2), email: 'pm@alpha.ca' },
  foremanA: { id: uid(3), email: 'foreman@alpha.ca' },
  elecA: { id: uid(4), email: 'elec@alpha.ca' },
  ownerB: { id: uid(5), email: 'owner@bravo.ca' },
};
type U = keyof typeof users;
type Row = Record<string, unknown>;

const split = (columns: string) => columns.split(',').map((c) => c.trim());
const sourceOf = (table: string) => EXPORT_SOURCES.find((s) => s.table === table);

/**
 * The supabase-js calls the export makes (select with a count, order, range, eq, maybeSingle),
 * answered by PGlite as a real user. Enough to run buildCompanyExport against row security.
 */
function clientAs(t: TestDb<U>, who: U): SupabaseClient {
  return {
    from(table: string) {
      const state = { columns: '*', count: false, order: [] as string[], range: null as [number, number] | null, filters: [] as [string, unknown][], single: false };
      async function run() {
        const params = state.filters.map(([, v]) => v);
        const where = state.filters.length ? ` where ${state.filters.map(([c], i) => `${c} = $${i + 1}`).join(' and ')}` : '';
        const order = state.order.length ? ` order by ${state.order.join(', ')}` : '';
        const page = state.range ? ` limit ${state.range[1] - state.range[0] + 1} offset ${state.range[0]}` : '';
        try {
          const rows = await t.as<Row>(who, `select ${state.columns} from public.${table}${where}${order}${page}`, params);
          const count = state.count ? (await t.as<{ n: number }>(who, `select count(*)::int as n from public.${table}${where}`, params))[0].n : null;
          return { data: state.single ? (rows[0] ?? null) : rows, error: null, count };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code }, count: null };
        }
      }
      const builder = {
        select(columns: string, opts?: { count?: string }) {
          state.columns = columns;
          state.count = !!opts?.count;
          return builder;
        },
        order(column: string) {
          state.order.push(column);
          return builder;
        },
        range(from: number, to: number) {
          state.range = [from, to];
          return builder;
        },
        eq(column: string, value: unknown) {
          state.filters.push([column, value]);
          return builder;
        },
        maybeSingle() {
          state.single = true;
          return builder;
        },
        then<T>(resolve: (r: unknown) => T, reject?: (e: unknown) => T) {
          return run().then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('what the export reads, checked against the database', () => {
  let t: TestDb<U>;
  let alpha: string;
  let bravo: string;
  let exported: CompanyExport;

  /** Columns of a public table, and those a signed-in user may select. */
  const columnsOf = async (table: string) => {
    const rows = await t.asSystem<{ column_name: string; readable: boolean }>(
      `select column_name, has_column_privilege('authenticated', format('public.%I', table_name)::regclass, column_name, 'SELECT') as readable
       from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
      [table]
    );
    return { all: rows.map((r) => r.column_name), readable: rows.filter((r) => r.readable).map((r) => r.column_name) };
  };

  beforeAll(async () => {
    t = await bootDb(users);
    alpha = await t.createCompany('ownerA', 'Alpha Electric');
    bravo = await t.createCompany('ownerB', 'Bravo Power');
    await t.join('ownerA', 'pmA', 'project_manager');
    await t.join('ownerA', 'foremanA', 'foreman');
    await t.join('ownerA', 'elecA', 'electrician');
    await t.as('ownerA', `update public.companies set tax_number = '12345 6789 RT0001', default_labour_rate = 95 where id = $1`, [alpha]);
    await seedCompany(t, { owner: 'ownerA', pm: 'pmA', foreman: 'foremanA', elec: 'elecA' });
    await seedCompany(t, { owner: 'ownerB', pm: 'ownerB', foreman: 'ownerB', elec: 'ownerB' });
    // Small pages, so every table with more than two rows is read in several requests
    const result = await buildCompanyExport(clientAs(t, 'ownerA'), { id: alpha, name: 'Alpha Electric' }, { pageSize: 2, exportedBy: users.ownerA.email, now: new Date('2026-11-12T15:00:00Z') });
    if ('error' in result) throw new Error(`${result.table}: ${result.error.message}`);
    exported = result.data;
  }, 240_000);

  it('every table a signed-in user can read is in the export', async () => {
    const readable = await t.asSystem<{ table_name: string }>(
      `select distinct c.table_name from information_schema.columns c
       where c.table_schema = 'public' and has_column_privilege('authenticated', format('public.%I', c.table_name)::regclass, c.column_name, 'SELECT')
       order by 1`
    );
    const exportedTables = new Set(['companies', ...EXPORT_SOURCES.map((s) => s.table)]);
    const missing = readable.map((r) => r.table_name).filter((name) => !exportedTables.has(name));
    expect(missing, 'add these tables to lib/company-export.ts').toEqual([]);
    expect(new Set(EXPORT_SOURCES.map((s) => s.table)).size).toBe(EXPORT_SOURCES.length);
  });

  it('every company table is either exported or one only the server can read', async () => {
    const tables = await companyTables(t);
    const exportedTables = new Set(EXPORT_SOURCES.map((s) => s.table));
    expect(tables.filter((name) => !exportedTables.has(name) && !SERVER_ONLY_TABLES.includes(name)), 'add these tables to lib/company-export.ts').toEqual([]);
    for (const table of SERVER_ONLY_TABLES) {
      expect(tables, table).toContain(table);
      expect((await columnsOf(table)).readable, table).toEqual([]);
    }
    // Including the four the task named, and every module
    for (const table of ['estimate_items', 'proposal_shares', 'assemblies', 'assembly_lines', ...MODULES.map((m) => m.table)]) expect(exportedTables.has(table), table).toBe(true);
  });

  it('every column is either exported or listed as left out, and only what nobody signed in can select is left out', async () => {
    const sources = [{ table: 'companies', columns: COMPANY_EXPORT_COLUMNS }, ...EXPORT_SOURCES];
    for (const { table, columns } of sources) {
      const { all, readable } = await columnsOf(table);
      const omitted = EXPORT_OMITTED_COLUMNS[table] ?? [];
      const chosen = columns === '*' ? all : split(columns);
      expect([...chosen, ...omitted].sort(), table).toEqual([...all].sort());
      expect(chosen.filter((c) => !readable.includes(c)), table).toEqual([]);
      // Left out only because it can't be read, apart from the invitation token, which is left out on purpose
      expect(omitted.filter((c) => readable.includes(c)), table).toEqual(table === 'invitations' ? ['token'] : []);
    }
  });

  it('leaves out the columns the registry marks as restricted, and lists them', () => {
    for (const mod of MODULES) {
      const restricted = mod.fields.filter((f) => f.restricted).map((f) => f.key);
      if (!restricted.length) continue;
      expect(EXPORT_OMITTED_COLUMNS[mod.table], mod.table).toEqual(restricted);
      const columns = sourceOf(mod.table)!.columns;
      for (const key of restricted) expect(split(columns), `${mod.table}.${key}`).not.toContain(key);
    }
  });

  it('holds every row of the company, read as the owner across several pages, and nothing of anyone else', async () => {
    for (const table of await companyTables(t)) {
      if (SERVER_ONLY_TABLES.includes(table)) continue;
      const [{ n }] = await t.asSystem<{ n: number }>(`select count(*)::int as n from public.${table} where company_id = $1`, [alpha]);
      expect(exported.tables[table]?.length, table).toBe(n);
      for (const row of exported.tables[table]) expect(row.company_id, table).toBe(alpha);
    }
    // A full company: most tables have something in them, and paging was really used
    expect(Object.values(exported.row_counts).filter((n) => n > 0).length).toBeGreaterThan(20);
    expect(Math.max(...Object.values(exported.row_counts))).toBeGreaterThan(2);
    const [{ n: snoozes }] = await t.asSystem<{ n: number }>(`select count(*)::int as n from public.alert_member_state where user_id = $1`, [users.ownerA.id]);
    expect(exported.tables.alert_member_state.length).toBe(snoozes);
    expect(JSON.stringify(exported)).not.toContain(bravo);
  });

  it('carries the company name, the date, who made it and the counts, and no restricted value', () => {
    expect(exported).toMatchObject({ export_format: EXPORT_FORMAT, export_version: 1, company_name: 'Alpha Electric', exported_at: '2026-11-12T15:00:00.000Z', exported_by: users.ownerA.email });
    expect(exported.tables.companies).toHaveLength(1);
    expect(exported.tables.companies[0]).toMatchObject({ id: alpha, name: 'Alpha Electric', tax_number: '12345 6789 RT0001' });
    expect(Object.keys(exported.tables.companies[0])).not.toContain('default_labour_rate');
    for (const [table, rows] of Object.entries(exported.tables)) expect(exported.row_counts[table], table).toBe(rows.length);
    for (const row of exported.tables.projects) for (const key of ['contract_value', 'approved_changes', 'revised_contract']) expect(row, key).not.toHaveProperty(key);
    for (const row of exported.tables.timecards) expect(row).not.toHaveProperty('labour_cost');
    for (const row of exported.tables.invitations) expect(row).not.toHaveProperty('token');
    expect(exported.tables.invitations.length).toBeGreaterThan(0);
    expect(exported.omitted_columns.companies).toEqual(['default_markup', 'default_labour_rate', 'stripe_customer_id', 'stripe_subscription_id']);
  });

  it('as another company, the same calls read only that company', async () => {
    const result = await buildCompanyExport(clientAs(t, 'ownerB'), { id: bravo, name: 'Bravo Power' });
    if ('error' in result) throw new Error(result.error.message);
    expect(result.data.company_name).toBe('Bravo Power');
    expect(JSON.stringify(result.data)).not.toContain(alpha);
    // Asking for the other company's row by id finds nothing
    const sneaky = await buildCompanyExport(clientAs(t, 'ownerB'), { id: alpha, name: 'Alpha Electric' });
    if ('error' in sneaky) throw new Error(sneaky.error.message);
    expect(sneaky.data.tables.companies).toEqual([]);
    expect(JSON.stringify(sneaky.data.tables.projects)).not.toContain(alpha);
  });
});

describe('reading a table page by page', () => {
  /** Answers like PostgREST with a row limit of `cap`, whatever range is asked for. */
  const capped = (rows: Row[], cap: number, log: [number, number][] = []) =>
    ({
      from: () => {
        let range: [number, number] = [0, 0];
        let count = false;
        const builder = {
          select: (_c: string, opts?: { count?: string }) => ((count = !!opts?.count), builder),
          order: () => builder,
          range: (a: number, b: number) => {
            range = [a, b];
            log.push(range);
            return builder;
          },
          then: (resolve: (r: unknown) => unknown) => resolve({ data: rows.slice(range[0], Math.min(range[1] + 1, range[0] + cap)), error: null, count: count ? rows.length : null }),
        };
        return builder;
      },
    }) as unknown as SupabaseClient;

  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(5, '0') }));

  it('keeps reading until it has every row, even when the server sends fewer than asked', async () => {
    const log: [number, number][] = [];
    const result = await readAllRows(capped(rows, 400), { table: 'crm', columns: '*', order: ['id'] }, 1000);
    expect('rows' in result && result.rows).toEqual(rows);
    const again = await readAllRows(capped(rows, 5000, log), { table: 'crm', columns: '*', order: ['id'] });
    expect('rows' in again && again.rows).toEqual(rows);
    expect(log).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('an empty table takes one request', async () => {
    const log: [number, number][] = [];
    expect(await readAllRows(capped([], 1000, log), { table: 'crm', columns: '*', order: ['id'] })).toEqual({ rows: [] });
    expect(log).toHaveLength(1);
  });
});

describe('the file name', () => {
  it('names the company and the day, safely', () => {
    const day = new Date('2026-11-12T23:30:00Z');
    expect(exportFileName('Alpha Electric Ltd.', day)).toBe('tradequote-alpha-electric-ltd-2026-11-12.json');
    expect(exportFileName('Électricité Côté & Fils', day)).toBe('tradequote-electricite-cote-fils-2026-11-12.json');
    expect(exportFileName('"/\\:*?<>|', day)).toBe('tradequote-company-2026-11-12.json');
    // Cut to 60 characters without leaving a dash hanging off the end
    expect(exportFileName(`${'a'.repeat(59)} b`, day)).toBe(`tradequote-${'a'.repeat(59)}-2026-11-12.json`);
  });
});

// The route and the page ------------------------------------------------------------------------

const USER = { id: 'user-1', email: 'owner@alpha.ca' };
const COMPANY = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha Electric', province: 'SK', subscription_status: 'active', trial_ends_at: '2020-01-01T00:00:00Z', current_period_end: null };

function signedIn(role = 'owner', options: { company?: typeof COMPANY; failOn?: FakeOptions['failOn'] } = {}) {
  const company = options.company ?? COMPANY;
  const fake = fakeSupabase(
    {
      company_users: [{ user_id: USER.id, role, company }],
      companies: [{ id: company.id, name: company.name, province: 'SK' }],
      crm: [{ id: 'c1', company_id: company.id, title: 'Cargill' }],
      projects: [{ id: 'p1', company_id: company.id, title: 'Canola plant' }],
    },
    { failOn: options.failOn }
  );
  mocks.server = Object.assign(fake, { auth: { getUser: async () => ({ data: { user: USER }, error: null }) } });
  return fake;
}

describe('GET /api/account/export', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('gives the owner one JSON file to download, never cached', async () => {
    const fake = signedIn();
    const res = await exportRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="tradequote-alpha-electric-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const file = JSON.parse(await res.text());
    expect(file).toMatchObject({ export_format: EXPORT_FORMAT, company_name: 'Alpha Electric', exported_by: USER.email });
    expect(new Date(file.exported_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(file.tables.crm).toEqual([{ id: 'c1', company_id: COMPANY.id, title: 'Cargill' }]);
    expect(Object.keys(file.tables).sort()).toEqual(['companies', ...EXPORT_SOURCES.map((s) => s.table)].sort());
    // Asked for as the signed-in user, for this company, and never naming a restricted column
    expect(fake.log.find((l) => l.table === 'companies' && l.op === 'select' && l.columns === COMPANY_EXPORT_COLUMNS)?.filters).toContainEqual(['eq', 'id', COMPANY.id]);
    for (const table of ['projects', 'timecards', 'change_orders']) {
      const asked = fake.log.find((l) => l.table === table)!.columns!;
      for (const key of EXPORT_OMITTED_COLUMNS[table]) expect(split(asked), `${table}.${key}`).not.toContain(key);
    }
  });

  it('is for the owner alone', async () => {
    for (const role of ['admin', 'project_manager', 'foreman', 'electrician']) {
      signedIn(role);
      expect((await exportRoute()).status, role).toBe(403);
    }
  });

  it('stays open to a company whose trial or subscription has ended', async () => {
    signedIn('owner', { company: { ...COMPANY, subscription_status: 'canceled' } });
    expect((await exportRoute()).status).toBe(200);
  });

  it('makes no file at all when any table cannot be read, and says so in plain words', async () => {
    signedIn('owner', { failOn: ({ table }) => (table === 'crm' ? { code: '42501', message: 'permission denied for table crm' } : null) });
    const res = await exportRoute();
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Disposition')).toBeNull();
    const text = await res.text();
    expect(JSON.parse(text).error).toMatch(/no file was made/);
    expect(text).not.toMatch(/crm|permission denied/);
  });
});

describe('the account page', () => {
  const page = (role: string) => {
    mocks.page = { status: 'ok', ctx: { supabase: fakeSupabase({}), role, canWrite: true, user: USER, company: COMPANY } };
    return AccountPage().then((el) => renderToStaticMarkup(el));
  };

  it('offers the owner the download and the closing, with the name to type', async () => {
    const html = await page('owner');
    expect(html).toContain('Download all company data');
    expect(html).toContain('Close this company account');
    expect(html).toContain('Type Alpha Electric to confirm');
    // Closing stays disabled until the name is typed
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Close this company account<\/button>/);
  });

  it('offers neither to anyone else, and says who can', async () => {
    for (const role of ['admin', 'project_manager', 'electrician']) {
      const html = await page(role);
      expect(html, role).not.toContain('Download all company data');
      expect(html, role).not.toContain('Close this company account');
      expect(html, role).toContain('The company owner can download');
    }
  });

  it('every button and link on it is a phone-sized target', async () => {
    const html = await page('owner');
    const targets = [...html.matchAll(/<(button|a)\b[^>]*class="([^"]*)"/g)];
    expect(targets.length).toBeGreaterThan(4);
    for (const [tag, , cls] of targets) expect(cls, tag).toContain('min-h-[48px] lg:min-h-0');
  });

  it('a signed-out visitor is sent to sign in', async () => {
    mocks.page = { status: 'signed-out' };
    await expect(AccountPage()).rejects.toThrow('REDIRECT /login');
  });
});
