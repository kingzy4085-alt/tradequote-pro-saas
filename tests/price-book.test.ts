// The company price book: the pure rules, the database's own isolation, role and subscription gates
// (real Postgres), the migration that repaired the table, and the routes (Supabase mocked).
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';
import { bootDb, migrationFiles, readMigration, type TestDb } from './helpers/db';

const mocks = vi.hoisted(() => ({ server: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => mocks.server }));

import { DELETE as priceDelete, GET as priceGet, PUT as pricePut } from '@/app/api/price-book/route';
import { GET as referenceGet } from '@/app/api/price-book/reference/route';
import { PRICE_BOOK_MAX_ITEMS, parsePriceBookBody, parsePriceCsv, priceBookCsv, splitCsvLine, toCompanyPrice } from '@/lib/price-book';
import { priceTakeoff } from '@/lib/costbook';

const MIGRATION = '20261120000100_company_price_book.sql';

describe('price book rules', () => {
  it('reads a list or an object with items, trims codes, and lets later rows win', () => {
    const a = parsePriceBookBody([{ itemCode: ' NMD90-14-2 ', unitCost: 2.5 }, { itemCode: 'NMD90-14-2', unitCost: 3, labourHours: 0.03 }]);
    expect(a).toEqual({ ok: true, items: [{ itemCode: 'NMD90-14-2', unitCost: 3, labourHours: 0.03 }] });
    expect(parsePriceBookBody({ items: [{ itemCode: 'X', unitCost: 0 }] })).toMatchObject({ ok: true });
  });

  it('refuses bad input and says which price is wrong', () => {
    expect(parsePriceBookBody({})).toMatchObject({ ok: false });
    expect(parsePriceBookBody([])).toMatchObject({ ok: false });
    expect(parsePriceBookBody([{ itemCode: 'A', unitCost: 1 }, { itemCode: 'B', unitCost: -1 }])).toEqual({ ok: false, error: 'Price 2: A price cannot be below zero' });
    expect(parsePriceBookBody([{ itemCode: '', unitCost: 1 }])).toMatchObject({ ok: false });
    expect(parsePriceBookBody([{ itemCode: 'A', unitCost: 'ten' }])).toMatchObject({ ok: false });
    expect(parsePriceBookBody([{ itemCode: 'A', unitCost: 1, labourHours: -2 }])).toMatchObject({ ok: false });
    expect(parsePriceBookBody([{ itemCode: 'A'.repeat(61), unitCost: 1 }])).toMatchObject({ ok: false });
    expect(parsePriceBookBody(Array.from({ length: PRICE_BOOK_MAX_ITEMS + 1 }, (_, n) => ({ itemCode: `C${n}`, unitCost: 1 })))).toMatchObject({ ok: false });
    expect(parsePriceBookBody(Array.from({ length: PRICE_BOOK_MAX_ITEMS }, (_, n) => ({ itemCode: `C${n}`, unitCost: 1 })))).toMatchObject({ ok: true });
  });

  it('turns a saved row into the camelCase shape the cost engine takes', () => {
    expect(toCompanyPrice({ item_code: 'A', unit_cost: '4.50', labour_hours: null, description: '', unit: 'm' })).toEqual({ itemCode: 'A', unitCost: 4.5, labourHours: null, description: null, unit: 'm' });
    expect(toCompanyPrice({ item_code: 'A', unit_cost: 1, labour_hours: '0.25' }).labourHours).toBe(0.25);
  });

  it('reads CSV with or without a header, quotes, dollar signs and blank lines', () => {
    expect(splitCsvLine('"A, B",2,"say ""hi"""')).toEqual(['A, B', '2', 'say "hi"']);
    const ok = parsePriceCsv('code,unit_cost,labour_hours\r\nNMD90-14-2,$2.35,0.025\n\nEMT-1/2,"3,10"\nPEX-1/2,0.4,\n');
    expect(ok.errors).toEqual([]);
    expect(ok.items).toEqual([
      { itemCode: 'NMD90-14-2', unitCost: 2.35, labourHours: 0.025 },
      { itemCode: 'EMT-1/2', unitCost: 310, labourHours: null },
      { itemCode: 'PEX-1/2', unitCost: 0.4, labourHours: null },
    ]);
    expect(parsePriceCsv('NMD90-14-2,2.35').items).toHaveLength(1);
  });

  it('names the lines it cannot read', () => {
    const bad = parsePriceCsv('A,1\nB\nC,abc\nD,-1\nE,1,x\nF,,');
    expect(bad.items.map((i) => i.itemCode)).toEqual(['A']);
    expect(bad.errors).toHaveLength(5);
    expect(bad.errors[0]).toMatch(/^Line 2: use code,unit_cost/);
    expect(bad.errors[1]).toMatch(/^Line 3: /);
    expect(bad.errors[2]).toMatch(/^Line 4: A price cannot be below zero/);
  });

  it('exports what it imports, and defuses spreadsheet formulas', () => {
    const prices = [
      { itemCode: 'B', unitCost: 2, labourHours: null },
      { itemCode: 'A,1', unitCost: 1.5, labourHours: 0.1 },
      { itemCode: '=HYPERLINK("x")', unitCost: 3, labourHours: 0 },
    ];
    const text = priceBookCsv(prices);
    expect(text.split('\n')[0]).toBe('code,unit_cost,labour_hours');
    expect(text).toContain(`"'=HYPERLINK(""x"")",3,0`);
    expect(text).toContain('"A,1",1.5,0.1');
    const back = parsePriceCsv(priceBookCsv([prices[0], prices[1]]));
    expect(back.errors).toEqual([]);
    expect(back.items).toEqual([
      { itemCode: 'A,1', unitCost: 1.5, labourHours: 0.1 },
      { itemCode: 'B', unitCost: 2, labourHours: null },
    ]);
  });
});

const users = {
  ownerA: { id: '00000000-0000-4000-8000-0000000000a1', email: 'owner@alpha.ca' },
  pmA: { id: '00000000-0000-4000-8000-0000000000a3', email: 'pm@alpha.ca' },
  foremanA: { id: '00000000-0000-4000-8000-0000000000a4', email: 'foreman@alpha.ca' },
  crewA: { id: '00000000-0000-4000-8000-0000000000a5', email: 'crew@alpha.ca' },
  ownerB: { id: '00000000-0000-4000-8000-0000000000b1', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

const UPSERT = `insert into public.material_price_book (item_code, category, description, unit, unit_cost, labour_hours)
  values ($1, 'Cable', 'Test item', 'm', $2, $3)
  on conflict (company_id, item_code) do update set unit_cost = excluded.unit_cost, labour_hours = excluded.labour_hours
  returning id`;

describe('the price book in the database', () => {
  let t: TestDb<U>;
  let alpha: string;
  let bravo: string;

  beforeAll(async () => {
    t = await bootDb(users);
    alpha = await t.createCompany('ownerA', 'Alpha Electric');
    bravo = await t.createCompany('ownerB', 'Bravo Power');
    await t.join('ownerA', 'pmA', 'project_manager');
    await t.join('ownerA', 'foremanA', 'foreman');
    await t.join('ownerA', 'crewA', 'electrician');
    await t.as('pmA', UPSERT, ['NMD90-14-2', 2.5, 0.03]);
  });

  it('saves a price under the caller`s company, with the company taken from the session', async () => {
    const [row] = await t.as<{ company_id: string; unit_cost: string; labour_hours: string; updated_at: string }>('ownerA', `select company_id, unit_cost, labour_hours, updated_at from public.material_price_book where item_code = 'NMD90-14-2'`);
    expect(row.company_id).toBe(alpha);
    expect(Number(row.unit_cost)).toBe(2.5);
    expect(Number(row.labour_hours)).toBe(0.03);
  });

  it('upserts: one price per company and item code, updated in place', async () => {
    await t.as('pmA', UPSERT, ['NMD90-14-2', 2.75, null]);
    const rows = await t.as<{ unit_cost: string; labour_hours: string | null }>('ownerA', `select unit_cost, labour_hours from public.material_price_book where item_code = 'NMD90-14-2'`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].unit_cost)).toBe(2.75);
    expect(rows[0].labour_hours).toBeNull();
    expect(await t.fails('pmA', `insert into public.material_price_book (item_code, category, description, unit, unit_cost) values ('NMD90-14-2', '', '', 'm', 1)`)).toMatch(/duplicate key|unique/i);
  });

  it('another company can neither see, change, delete nor plant a price', async () => {
    expect(await t.as('ownerB', 'select 1 from public.material_price_book')).toEqual([]);
    expect(await t.as('ownerB', `update public.material_price_book set unit_cost = 0 where item_code = 'NMD90-14-2' returning id`)).toEqual([]);
    expect(await t.as('ownerB', `delete from public.material_price_book where item_code = 'NMD90-14-2' returning id`)).toEqual([]);
    expect(await t.fails('ownerB', `insert into public.material_price_book (company_id, item_code, category, description, unit, unit_cost) values ($1, 'PLANTED', '', '', 'ea', 1)`, [alpha])).toMatch(/row-level security/);
    // the same code in another company is its own price
    await t.as('ownerB', UPSERT, ['NMD90-14-2', 9, 0.5]);
    const [mine] = await t.as<{ unit_cost: string }>('ownerA', `select unit_cost from public.material_price_book where item_code = 'NMD90-14-2'`);
    expect(Number(mine.unit_cost)).toBe(2.75);
    expect((await t.asSystem<{ company_id: string }>(`select company_id from public.material_price_book where item_code = 'NMD90-14-2' order by company_id`)).map((r) => r.company_id).sort()).toEqual([alpha, bravo].sort());
  });

  it('an update cannot move a price to another company', async () => {
    await t.as('ownerA', `update public.material_price_book set company_id = $1 where item_code = 'NMD90-14-2'`, [bravo]);
    const [row] = await t.as<{ company_id: string }>('ownerA', `select company_id from public.material_price_book where item_code = 'NMD90-14-2'`);
    expect(row.company_id).toBe(alpha);
  });

  it('follows the estimate roles: project managers and above may read and write, a foreman and crew may not', async () => {
    expect((await t.as('ownerA', 'select 1 from public.material_price_book')).length).toBe(1);
    expect((await t.as('pmA', 'select 1 from public.material_price_book')).length).toBe(1);
    for (const who of ['foremanA', 'crewA'] as const) {
      expect(await t.as(who, 'select 1 from public.material_price_book'), who).toEqual([]);
      expect(await t.fails(who, UPSERT, ['FOREMAN-ITEM', 1, null]), who).toMatch(/row-level security/);
      expect(await t.as(who, `update public.material_price_book set unit_cost = 0 returning id`), who).toEqual([]);
      expect(await t.as(who, `delete from public.material_price_book returning id`), who).toEqual([]);
    }
  });

  it('visitors who are not signed in are refused outright', async () => {
    expect(await t.fails(null, 'select 1 from public.material_price_book')).toMatch(/permission denied/);
    expect(await t.fails(null, UPSERT, ['ANON', 1, null])).toMatch(/permission denied/);
    expect(await t.fails(null, 'delete from public.material_price_book')).toMatch(/permission denied/);
    const grants = await t.asSystem<{ grantee: string }>(`select grantee from information_schema.role_table_grants where table_schema = 'public' and table_name = 'material_price_book'`);
    expect(grants.map((g) => g.grantee)).not.toContain('anon');
    expect(grants.map((g) => g.grantee)).not.toContain('PUBLIC');
    expect(grants.map((g) => g.grantee)).toContain('authenticated');
  });

  it('refuses negative prices and hours, and blank or padded codes', async () => {
    expect(await t.fails('ownerA', UPSERT, ['NEG', -1, null])).toMatch(/check constraint/);
    expect(await t.fails('ownerA', UPSERT, ['NEG-H', 1, -1])).toMatch(/check constraint/);
    expect(await t.fails('ownerA', UPSERT, ['', 1, null])).toMatch(/check constraint/);
    expect(await t.fails('ownerA', UPSERT, [' PADDED ', 1, null])).toMatch(/check constraint/);
    expect(await t.fails('ownerA', UPSERT, ['X'.repeat(61), 1, null])).toMatch(/check constraint/);
    expect(await t.as('ownerA', `select 1 from public.material_price_book where item_code in ('NEG', 'NEG-H', '', ' PADDED ')`)).toEqual([]);
  });

  it('a lapsed company can still read its prices but not change them', async () => {
    await t.setLapsed(alpha, true);
    expect((await t.as('ownerA', 'select 1 from public.material_price_book')).length).toBe(1);
    expect(await t.fails('ownerA', UPSERT, ['AFTER-LAPSE', 1, null])).toMatch(/row-level security/);
    expect(await t.as('ownerA', `update public.material_price_book set unit_cost = 99 returning id`)).toEqual([]);
    expect(await t.as('ownerA', 'delete from public.material_price_book returning id')).toEqual([]);
    await t.setLapsed(alpha, false);
    expect((await t.as('ownerA', `delete from public.material_price_book where item_code = 'NMD90-14-2' returning id`)).length).toBe(1);
  });

  it('deleting a company takes its prices with it', async () => {
    await t.as('ownerB', UPSERT, ['BRAVO-ONLY', 1, null]);
    await t.asSystem('delete from public.companies where id = $1', [bravo]);
    expect(await t.asSystem('select 1 from public.material_price_book where company_id = $1', [bravo])).toEqual([]);
  });
});

describe('the price book migration', () => {
  it('is a new LF file that runs after the table was created, with no stray line endings', () => {
    const text = readMigration(MIGRATION);
    expect(text).not.toMatch(/\r/);
    expect(migrationFiles().indexOf(MIGRATION)).toBeGreaterThan(migrationFiles().indexOf('20261113000000_add_deposits_and_pricebook.sql'));
    expect(text).toMatch(/enable row level security/i);
    expect(text).toMatch(/revoke all on public\.material_price_book from public, anon, authenticated/i);
  });

  it('repairs an old table: drops rows with no company, keeps the newest duplicate, and is safe to run twice', async () => {
    const t2 = await bootDb(users, { include: (f) => f !== MIGRATION });
    const alpha = await t2.createCompany('ownerA', 'Alpha Electric');
    const bravo = await t2.createCompany('ownerB', 'Bravo Power');
    // The state production may be in: five sample rows with no company, and a company with duplicates
    expect((await t2.asSystem('select 1 from public.material_price_book where company_id is null')).length).toBe(5);
    const insert = `insert into public.material_price_book (company_id, item_code, category, description, unit, unit_cost, created_at) values ($1, $2, 'c', 'd', 'm', $3, $4)`;
    await t2.asSystem(insert, [alpha, 'DUP', 1, '2026-01-01T00:00:00Z']);
    await t2.asSystem(insert, [alpha, 'DUP', 2, '2026-03-01T00:00:00Z']);
    await t2.asSystem(insert, [alpha, 'DUP', 3, '2026-02-01T00:00:00Z']);
    await t2.asSystem(insert, [bravo, 'DUP', 7, '2026-01-01T00:00:00Z']);
    await t2.asSystem(insert, [alpha, 'SOLO', 5, '2026-01-01T00:00:00Z']);
    await t2.asSystem(`insert into public.material_price_book (company_id, item_code, category, description, unit, unit_cost) values (null, 'ORPHAN', 'c', 'd', 'm', 1)`);

    const sql = readMigration(MIGRATION);
    await t2.pg.exec(sql);
    await t2.pg.exec(sql);

    expect(await t2.asSystem('select 1 from public.material_price_book where company_id is null')).toEqual([]);
    const rows = await t2.asSystem<{ company_id: string; item_code: string; unit_cost: string }>('select company_id, item_code, unit_cost from public.material_price_book order by item_code, company_id');
    expect(rows.map((r) => `${r.company_id === alpha ? 'A' : 'B'}:${r.item_code}:${Number(r.unit_cost)}`).sort()).toEqual(['A:DUP:2', 'A:SOLO:5', 'B:DUP:7']);
    expect(await t2.fails(null, 'select 1 from public.material_price_book')).toMatch(/permission denied/);
    expect(await t2.asSystem(`insert into public.material_price_book (company_id, item_code, category, description, unit, unit_cost) values ($1, 'DUP', '', '', 'm', 1)`, [alpha]).catch((e) => (e as Error).message)).toMatch(/duplicate key|unique/i);
    // A redeploy re-runs every migration, including the old one that inserts five sample rows with no company
    await t2.pg.exec(readMigration('20261113000000_add_deposits_and_pricebook.sql'));
    expect(await t2.asSystem('select 1 from public.material_price_book where company_id is null')).toEqual([]);
    expect((await t2.asSystem('select 1 from public.material_price_book')).length).toBe(3);
    const policies = await t2.asSystem<{ policyname: string }>(`select policyname from pg_policies where tablename = 'material_price_book' order by policyname`);
    expect(policies.map((p) => p.policyname)).toEqual(['material_price_book_delete', 'material_price_book_insert', 'material_price_book_select', 'material_price_book_update']);
    const cols = await t2.asSystem<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'material_price_book'`);
    for (const c of ['labour_hours', 'updated_at', 'company_id']) expect(cols.map((x) => x.column_name)).toContain(c);
  });

  it('keeps the company export working: an owner exports the book with select *', async () => {
    const t3 = await bootDb(users);
    await t3.createCompany('ownerA', 'Alpha Electric');
    await t3.as('ownerA', UPSERT, ['NMD90-14-2', 2.5, null]);
    const rows = await t3.as<Record<string, unknown>>('ownerA', 'select * from public.material_price_book order by id');
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(['id', 'company_id', 'item_code', 'unit_cost', 'labour_hours', 'updated_at']));
    expect(readFileSync('lib/company-export.ts', 'utf8')).toContain("table: 'material_price_book'");
  });
});

// ---- routes, with Supabase mocked ----------------------------------------------------------

const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' };
const COMPANY = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Alpha',
  province: 'BC',
  subscription_status: 'active',
  trial_ends_at: '2030-01-01T00:00:00Z',
  current_period_end: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
};
const OTHER = '22222222-2222-4222-8222-222222222222';

function signedIn(tables: Record<string, Record<string, unknown>[]> = {}, role = 'owner', company: Record<string, unknown> = COMPANY) {
  const fake = fakeSupabase({ company_users: [{ user_id: USER.id, role, company }], ...tables });
  const client = Object.assign(fake, { auth: { getUser: async () => ({ data: { user: USER }, error: null }) } });
  mocks.server = client;
  return client;
}

const book = [
  { company_id: COMPANY.id, item_code: 'NMD90-14-2', unit_cost: 2.5, labour_hours: 0.03, description: 'NMD90 copper cable 14/2', unit: 'm', category: 'Cable' },
  { company_id: COMPANY.id, item_code: 'MY-DOOR', unit_cost: 120, labour_hours: null, description: 'My door', unit: 'ea', category: '' },
  { company_id: OTHER, item_code: 'THEIRS', unit_cost: 1, labour_hours: null, description: 'Other company', unit: 'ea', category: '' },
];

const put = (body: unknown, raw?: string) => pricePut(new Request('http://x/api/price-book', { method: 'PUT', body: raw ?? JSON.stringify(body) }));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/price-book', () => {
  it('returns this company`s prices as camelCase, never another company`s', async () => {
    signedIn({ material_price_book: book.map((r) => ({ ...r })) });
    const res = await priceGet();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual([
      { itemCode: 'MY-DOOR', unitCost: 120, labourHours: null, description: 'My door', unit: 'ea' },
      { itemCode: 'NMD90-14-2', unitCost: 2.5, labourHours: 0.03, description: 'NMD90 copper cable 14/2', unit: 'm' },
    ]);
  });

  it('is for project managers and above, and for signed-in people only', async () => {
    signedIn({}, 'foreman');
    expect((await priceGet()).status).toBe(403);
    signedIn({}, 'electrician');
    expect((await priceGet()).status).toBe(403);
    signedIn({}, 'project_manager');
    expect((await priceGet()).status).toBe(200);
    mocks.server = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
    expect((await priceGet()).status).toBe(401);
  });

  it('a lapsed company may still read', async () => {
    signedIn({}, 'owner', { ...COMPANY, subscription_status: 'canceled', trial_ends_at: '2020-01-01T00:00:00Z' });
    expect((await priceGet()).status).toBe(200);
  });
});

describe('PUT /api/price-book', () => {
  it('saves prices, filling the description and unit from the catalog when none is sent', async () => {
    const client = signedIn();
    const res = await put([{ itemCode: 'NMD90-14-2', unitCost: 2.6, labourHours: 0.04 }, { itemCode: 'MY-NEW', unitCost: 5, description: 'Mine', unit: 'box' }, { itemCode: 'BARE', unitCost: 1 }]);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ saved: 3 });
    const rows = client.tables.material_price_book;
    expect(rows).toEqual([
      { item_code: 'NMD90-14-2', category: 'Cable', description: 'NMD90 copper cable 14/2', unit: 'm', unit_cost: 2.6, labour_hours: 0.04 },
      { item_code: 'MY-NEW', category: '', description: 'Mine', unit: 'box', unit_cost: 5, labour_hours: null },
      { item_code: 'BARE', category: '', description: 'BARE', unit: 'ea', unit_cost: 1, labour_hours: null },
    ]);
    // company_id is never sent by the route: the database fills it from the session
    for (const row of rows) expect(row).not.toHaveProperty('company_id');
  });

  it('keeps what a company already had when a price comes without a description or hours', async () => {
    const client = signedIn({ material_price_book: book.map((r) => ({ ...r })) });
    await put([{ itemCode: 'MY-DOOR', unitCost: 130 }]);
    const sent = client.log.find((l) => l.op === 'insert')!.values as Record<string, unknown>[];
    expect(sent).toEqual([{ item_code: 'MY-DOOR', category: '', description: 'My door', unit: 'ea', unit_cost: 130, labour_hours: null }]);
    await put([{ itemCode: 'NMD90-14-2', unitCost: 2.7 }]);
    const again = client.log.filter((l) => l.op === 'insert').at(-1)!.values as Record<string, unknown>[];
    expect(again[0]).toMatchObject({ labour_hours: 0.03, unit_cost: 2.7 });
  });

  it('accepts {items: [...]} and up to 500 prices, and refuses more', async () => {
    signedIn();
    expect((await put({ items: [{ itemCode: 'A', unitCost: 1 }] })).status).toBe(200);
    expect((await put(Array.from({ length: 500 }, (_, n) => ({ itemCode: `C${n}`, unitCost: 1 })))).status).toBe(200);
    const tooMany = await put(Array.from({ length: 501 }, (_, n) => ({ itemCode: `C${n}`, unitCost: 1 })));
    expect(tooMany.status).toBe(400);
  });

  it('refuses bad prices, bad JSON and oversized bodies without touching the database', async () => {
    const client = signedIn();
    expect((await put([{ itemCode: 'A', unitCost: -5 }])).status).toBe(400);
    expect((await put([{ itemCode: 'A', unitCost: 'free' }])).status).toBe(400);
    expect((await put({ not: 'a list' })).status).toBe(400);
    expect((await put(null, '{nope')).status).toBe(400);
    expect((await put(null, JSON.stringify([{ itemCode: 'A', unitCost: 1, description: 'x'.repeat(300_000) }]))).status).toBe(413);
    expect(client.log.filter((l) => l.table === 'material_price_book')).toEqual([]);
  });

  it('is a write: project managers and above, and not for a lapsed company', async () => {
    signedIn({}, 'foreman');
    expect((await put([{ itemCode: 'A', unitCost: 1 }])).status).toBe(403);
    const lapsed = signedIn({}, 'owner', { ...COMPANY, subscription_status: 'canceled', trial_ends_at: '2020-01-01T00:00:00Z' });
    expect((await put([{ itemCode: 'A', unitCost: 1 }])).status).toBe(402);
    expect(lapsed.log.filter((l) => l.table === 'material_price_book')).toEqual([]);
    mocks.server = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
    expect((await put([{ itemCode: 'A', unitCost: 1 }])).status).toBe(401);
  });
});

describe('DELETE /api/price-book', () => {
  const del = (query: string) => priceDelete(new Request(`http://x/api/price-book${query}`, { method: 'DELETE' }));

  it('removes one of this company`s prices and no one else`s', async () => {
    const client = signedIn({ material_price_book: book.map((r) => ({ ...r })) });
    expect((await del('?code=MY-DOOR')).status).toBe(200);
    expect(client.tables.material_price_book.map((r) => r.item_code).sort()).toEqual(['NMD90-14-2', 'THEIRS']);
    // asking for another company's code removes nothing of theirs
    await del('?code=THEIRS');
    expect(client.tables.material_price_book.map((r) => r.item_code)).toContain('THEIRS');
  });

  it('needs a code, project manager rank and an active company', async () => {
    signedIn();
    expect((await del('')).status).toBe(400);
    expect((await del('?code=')).status).toBe(400);
    signedIn({}, 'foreman');
    expect((await del('?code=A')).status).toBe(403);
    signedIn({}, 'owner', { ...COMPANY, subscription_status: 'canceled', trial_ends_at: '2020-01-01T00:00:00Z' });
    expect((await del('?code=A')).status).toBe(402);
  });
});

describe('GET /api/price-book/reference', () => {
  const ref = (query = '') => referenceGet(new Request(`http://x/api/price-book/reference${query}`));

  it('searches the catalog, prices it for the company`s region and merges the company`s own price', async () => {
    signedIn({ material_price_book: book.map((r) => ({ ...r })) });
    const res = await ref('?q=nmd90%2014/2');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.region).toMatchObject({ code: 'BC' });
    const [item] = json.data;
    expect(item).toMatchObject({ code: 'NMD90-14-2', unit: 'm', trade: 'electrical', company: { unitCost: 2.5, labourHours: 0.03 } });
    // BC: the reference price carries the 7% PST the contractor cannot recover
    const [expected] = priceTakeoff([{ code: 'NMD90-14-2', description: '', quantity: 1, unit: 'm' }], { region: 'BC' });
    expect(item.referenceUnitCost).toBe(expected.materialUnitCost);
    expect(item.referenceNote).toMatch(/7% BC PST/);
    expect(json.data.every((i: { code: string }) => i.code !== 'THEIRS')).toBe(true);
  });

  it('prices for the region asked for, and falls back to the province for an unknown one', async () => {
    signedIn();
    const on = (await (await ref('?q=nmd90%2014/2&region=ON')).json()) as { data: { referenceUnitCost: number; referenceNote: string | null; company: unknown }[]; region: { code: string } };
    expect(on.region.code).toBe('ON');
    expect(on.data[0].referenceNote).toBeNull();
    expect(on.data[0].company).toBeNull();
    const calgary = await (await ref('?q=nmd90%2014/2&region=AB-CALGARY')).json();
    expect(calgary.region.code).toBe('AB-CALGARY');
    const unknown = await (await ref('?q=nmd90%2014/2&region=AB-NOWHERE')).json();
    expect(unknown.region.code).toBe('AB');
  });

  it('filters by trade, refuses an unknown trade and caps the limit', async () => {
    signedIn();
    const plumbing = await (await ref('?trade=plumbing&limit=500')).json();
    expect(plumbing.data.length).toBeGreaterThan(5);
    expect(plumbing.data.length).toBeLessThanOrEqual(200);
    expect(plumbing.data.every((i: { trade: string }) => i.trade === 'plumbing')).toBe(true);
    expect((await ref('?trade=wizardry')).status).toBe(400);
    expect((await (await ref('?limit=3')).json()).data).toHaveLength(3);
    expect((await (await ref()).json()).data.length).toBeLessThanOrEqual(50);
  });

  it('is for project managers and above, and for signed-in people only', async () => {
    signedIn({}, 'foreman');
    expect((await ref()).status).toBe(403);
    mocks.server = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
    expect((await ref()).status).toBe(401);
  });
});

describe('price book routes are guarded', () => {
  it('every handler calls requireApi, and every write passes write: true', () => {
    const route = readFileSync('app/api/price-book/route.ts', 'utf8');
    const reference = readFileSync('app/api/price-book/reference/route.ts', 'utf8');
    expect(route.match(/requireApi\(/g)).toHaveLength(3);
    expect(route.match(/write: true/g)).toHaveLength(2);
    expect(route).not.toMatch(/createSupabaseAdminClient|service/i);
    expect(reference.match(/requireApi\(/g)).toHaveLength(1);
    expect(reference).not.toMatch(/write: true|createSupabaseAdminClient/);
    for (const text of [route, reference]) expect(text).toContain('if (ctx instanceof Response) return ctx;');
    expect(readdirSync('app/(app)/price-book').sort()).toEqual(['page.tsx', 'price-book-manager.tsx']);
    expect(readFileSync('app/(app)/layout.tsx', 'utf8')).toContain("'/price-book'");
  });
});
