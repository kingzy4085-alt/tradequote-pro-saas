// Adversarial verification of the job cost engine, on PGlite. Written by the verifier, not the
// builder. Everything calls the database the way PostgREST would: as the signed-in user, with
// no help from the pages or the API routes. A failing test in this file is a reproduced bug
// and stays failing for the fixer. Those tests are marked [BUG] in their names.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BASELINE_FILE, OLD_BASELINE_FIXTURE, bootDb, migrationFiles, readMigration, type TestDb } from './helpers/db';
import { listColumns } from '@/lib/crud';
import { estimateTotals, lineSellPrice } from '@/lib/estimate-math';
import { hubTabs } from '@/lib/job-cost';
import { getModule } from '@/lib/modules';
import { parseRecord } from '@/lib/validation';

const uid = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;
const USERS = {
  owner: { id: uid(1), email: 'owner@alpha.ca' },
  admin: { id: uid(2), email: 'admin@alpha.ca' },
  pm: { id: uid(3), email: 'pm@alpha.ca' },
  foreman: { id: uid(4), email: 'foreman@alpha.ca' },
  elec: { id: uid(5), email: 'elec@alpha.ca' },
  rival: { id: uid(6), email: 'owner@rival.ca' },
  lapsed: { id: uid(7), email: 'owner@lapsed.ca' },
  lapsedPm: { id: uid(8), email: 'pm@lapsed.ca' },
  nobody: { id: uid(9), email: 'nobody@nowhere.ca' },
};
type U = keyof typeof USERS;
type Row = Record<string, any>;

const SIG = 'data:image/png;base64,AAAA';
let t: TestDb<U>;
let company: string;
let rivalCompany: string;
let lapsedCompany: string;

const refused = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

const HIDDEN_MONEY = new Set(['projects', 'change_orders']);
async function ins(who: U | null, table: string, row: Row): Promise<Row> {
  const keys = Object.keys(row);
  const [r] = await t.as<Row>(who, `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning ${HIDDEN_MONEY.has(table) ? 'id' : '*'}`, Object.values(row));
  // Nobody signed in can read a project's contract columns or a change order's money, so `returning *` is refused
  return HIDDEN_MONEY.has(table) ? get(table, r.id as string) : r;
}
const get = async (table: string, rowId: string) => (await t.asSystem<Row>(`select * from public.${table} where id = $1`, [rowId]))[0];
const newProject = async (contract: number | string | null = 100000, who: U = 'pm', extra: Row = {}) => ins(who, 'projects', { title: 'Job', status: 'Active', contract_value: contract, ...extra });
const job = async (project: string) => (await t.asSystem<Row>('select * from public.job_costing where project_id = $1', [project]))[0];
const num = async (project: string, col: string) => Number((await job(project))[col]);
const budget = (project: string, hours: number, labour: number, material: number, other = 0, who: U = 'pm') => t.as(who, 'select public.set_job_budget($1, $2, $3, $4, $5)', [project, hours, labour, material, other]);
const entry = async (project: string, amount: number | string, category = 'Other', who: U = 'pm') =>
  (await ins(who, 'job_cost_entries', { project_id: project, category, description: 'Cost', amount })).id as string;
const reconcile = async (co: string = company) => Number((await t.asService<{ n: number }>('select public.reconcile_job_costs($1) as n', [co]))[0].n);
const ALL_LINES = [{ description: 'Panel', quantity: 2, unit: 'ea', material_unit_cost: 1000, labour_hours_per_unit: 10 }];

async function newEstimate(lines: unknown[] = ALL_LINES, over: Row = {}, who: U = 'pm') {
  const est = await ins(who, 'estimates', { title: 'Quote', status: 'Submitted', labour_rate: 80, markup_percentage: 25, tax_percentage: 5, client_name: 'Cargill', client_address: '1 Plant Rd', scope: 'Work', terms: 'Net 30', ...over });
  await t.as(who, 'select public.save_estimate_items($1, $2::jsonb)', [est.id, JSON.stringify(lines)]);
  return est.id as string;
}
const toProposal = async (est: string, who: U = 'pm') => (await t.as<{ id: string }>(who, 'select public.create_proposal_from_estimate($1) as id', [est]))[0].id;
const toProject = async (prop: string, who: U = 'pm') => (await t.as<{ id: string }>(who, 'select public.create_project_from_proposal($1) as id', [prop]))[0].id;
const setProposal = (prop: string, status: string, who: U = 'pm') => t.as(who, 'update public.proposals set status = $2 where id = $1', [prop, status]);

let cardDay = 0;
async function card(project: string | null, regular: number, overtime = 0, over: Row = {}) {
  cardDay++;
  const day = `2026-${String((cardDay % 12) + 1).padStart(2, '0')}-${String((cardDay % 27) + 1).padStart(2, '0')}`;
  const row: Row = { title: 'Labour', status: 'Submitted', project_id: project, employee_name: `Worker ${cardDay}`, work_date: day, regular_hours: regular, overtime_hours: overtime, ...over };
  const keys = Object.keys(row);
  // Pay columns can't be selected by a signed-in user, so no returning *
  return (await t.as<{ id: string }>('pm', `insert into public.timecards (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(row)))[0].id;
}
const decide = (ids: string[], action: string) => t.as('pm', 'select public.decide_timecards($1, $2)', [ids, action]);
async function approvedCo(project: string, over: Row = {}) {
  const co = await ins('pm', 'change_orders', { title: 'Change', status: 'Draft', project_id: project, material_cost: 1000, labour_hours: 10, labour_rate: 120, markup_pct: 20, tax_pct: 5, ...over });
  await t.as('pm', `update public.change_orders set status = 'Sent' where id = $1`, [co.id]);
  await t.as('pm', `update public.change_orders set status = 'Approved', approved_by = 'Client', signature = $2 where id = $1`, [co.id, SIG]);
  return co.id as string;
}
const LOTO = (p: string): Row => ({ title: 'L', status: 'Draft', project_id: p, equipment_isolated: 'MCC-3', authorized_person: 'Sam' });
const free = (amount: unknown, description = 'Work') => ({ type: 'free', description, amount });
const invoice = async (project: string, amount: number, status = 'Sent') => {
  const inv = await ins('admin', 'invoices', { title: 'INV', status: 'Draft', project_id: project, tax_pct: 5, holdback_pct: 10, lines: JSON.stringify([free(amount)]) });
  if (status !== 'Draft') await t.as('admin', 'update public.invoices set status = $2 where id = $1', [inv.id, status]);
  return inv.id as string;
};

beforeAll(async () => {
  t = await bootDb(USERS);
  company = await t.createCompany('owner', 'Alpha');
  rivalCompany = await t.createCompany('rival', 'Rival');
  lapsedCompany = await t.createCompany('lapsed', 'Lapsed');
  await t.join('owner', 'admin', 'admin');
  await t.join('owner', 'pm', 'project_manager');
  await t.join('owner', 'foreman', 'foreman');
  await t.join('owner', 'elec', 'electrician');
  await t.join('lapsed', 'lapsedPm', 'project_manager');
  await t.as('owner', 'update public.companies set default_labour_rate = 100, overtime_multiplier = 1.5, default_markup = 10, default_tax = 5 where id = $1', [company]);
}, 180_000);

describe('wrong role', () => {
  it('no function in this migration is open to visitors, and only the intended ones to signed-in users', async () => {
    const names = ['estimate_totals', 'estimate_is_with_client', 'guard_estimate_total', 'sync_estimate_proposals', 'estimate_items_changed', 'save_estimate_items', 'guard_proposal', 'create_proposal_from_estimate', 'create_project_from_proposal', 'guard_job_cost_entry', 'job_cost_status', 'recalc_job_cost', 'recalc_job_costs', 'job_cost_touch', 'job_cost_touch_payable', 'job_cost_touch_project', 'guard_job_costing_delete', 'set_job_budget', 'set_job_closed', 'seed_job_budget_from_estimate', 'job_cost_rollup', 'reconcile_job_costs', 'project_balance', 'create_invoice_from_project', 'create_draw_from_project'];
    const rows = await t.asSystem<{ proname: string; anon: boolean; auth: boolean; secdef: boolean; config: string[] | null }>(
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth, p.prosecdef as secdef, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)`, [names]);
    expect(rows.length).toBeGreaterThanOrEqual(names.length);
    expect(rows.filter((r) => r.anon).map((r) => r.proname)).toEqual([]);
    const open = rows.filter((r) => r.auth).map((r) => r.proname).sort();
    expect(open).toEqual(['create_draw_from_project', 'create_invoice_from_project', 'create_project_from_proposal', 'create_proposal_from_estimate', 'estimate_totals', 'job_cost_rollup', 'project_balance', 'save_estimate_items', 'seed_job_budget_from_estimate', 'set_job_budget', 'set_job_closed'].sort());
    for (const r of rows.filter((x) => x.secdef)) expect((r.config ?? []).join(), r.proname).toMatch(/search_path=/);
  });

  it('crew cannot read estimate lines or job money through the helper functions', async () => {
    const est = await newEstimate();
    const p = await newProject(5000);
    await entry(p.id, 700);
    for (const who of ['foreman', 'elec', 'nobody'] as const) {
      const [row] = await t.as<Row>(who, 'select * from public.estimate_totals($1, 80, 25, 5)', [est]);
      expect(Number(row.total), who).toBe(0);
      expect(await t.as(who, 'select * from public.estimate_items where estimate_id = $1', [est])).toEqual([]);
      expect(await t.as(who, 'select * from public.job_cost_entries where project_id = $1', [p.id])).toEqual([]);
      expect(await refused(t.as(who, 'select public.job_cost_rollup($1)', [p.id])), who).toMatch(/project manager/);
      expect(await refused(t.as(who, 'select public.set_job_budget($1, 1, 1, 1, 1)', [p.id])), who).toBeTruthy();
      expect(await refused(t.as(who, 'select public.seed_job_budget_from_estimate($1)', [p.id])), who).toBeTruthy();
      expect(await refused(t.as(who, 'select public.create_draw_from_project($1)', [p.id])), who).toBeTruthy();
      expect(await refused(t.as(who, 'select public.create_invoice_from_project($1)', [p.id])), who).toBeTruthy();
    }
  });

  it('nobody signed in can call the recount or write the row, whatever their rank', async () => {
    const p = await newProject();
    for (const who of ['owner', 'admin', 'pm', 'rival'] as const) {
      expect(await refused(t.as(who, 'select public.recalc_job_cost($1)', [p.id])), who).toMatch(/permission denied/);
      expect(await refused(t.as(who, 'select public.recalc_job_costs($1)', [[p.id]])), who).toMatch(/permission denied/);
      expect(await refused(t.as(who, 'select public.reconcile_job_costs($1)', [company])), who).toMatch(/permission denied/);
      expect(await refused(t.as(who, 'update public.job_costing set budget_material = 1 where project_id = $1', [p.id])), who).toMatch(/permission denied/);
      expect(await refused(t.as(who, 'update public.job_costing set status = $2 where project_id = $1', [p.id, 'Closed'])), who).toMatch(/permission denied/);
    }
  });

  it('a project manager can read totals but still no payable row and no pay column', async () => {
    const p = await newProject();
    const bill = await ins('admin', 'payables', { title: 'Bill', status: 'Paid', project_id: p.id, amount: 321 });
    const [{ r }] = await t.as<{ r: Row[] }>('pm', 'select public.job_cost_rollup($1) as r', [p.id]);
    expect(Number(r[0].actual_material)).toBe(321);
    expect(await t.as('pm', 'select * from public.payables where id = $1', [bill.id])).toEqual([]);
    expect(await refused(t.as('pm', 'select labour_cost from public.timecards limit 1'))).toMatch(/permission denied/);
    expect(await refused(t.as('pm', 'select hourly_cost from public.timecards limit 1'))).toMatch(/permission denied/);
  });
});

describe('another tenant', () => {
  it('cannot link its records to our estimate, proposal, project or PO, by any column', async () => {
    const est = await newEstimate();
    const prop = await toProposal(await newEstimate());
    const p = await newProject();
    const po = await ins('pm', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: p.id, amount: 500 });

    expect(await refused(ins('rival', 'proposals', { title: 'x', status: 'Draft', estimate_id: est }))).toBeTruthy();
    expect(await refused(ins('rival', 'projects', { title: 'x', status: 'Active', estimate_id: est }))).toBeTruthy();
    expect(await refused(ins('rival', 'projects', { title: 'x', status: 'Active', proposal_id: prop }))).toBeTruthy();
    expect(await refused(ins('rival', 'payables', { title: 'x', status: 'Approved', amount: 1, purchase_order_id: po.id }))).toBeTruthy();
    expect(await refused(ins('rival', 'job_cost_entries', { project_id: p.id, category: 'Other', description: 'x', amount: 1 }))).toBeTruthy();
    expect(await refused(ins('rival', 'timecards', { title: 'x', status: 'Submitted', project_id: p.id, employee_name: 'x', work_date: '2026-11-01', regular_hours: 1, overtime_hours: 0 }))).toBeTruthy();
    expect(await refused(ins('rival', 'invoices', { title: 'x', status: 'Draft', project_id: p.id, lines: '[]' }))).toBeTruthy();
    expect(await refused(ins('rival', 'estimate_items', { estimate_id: est, description: 'x', quantity: 1, material_unit_cost: 1e6 }))).toBeTruthy();
    // Our row stays right
    expect(await num(p.id, 'committed')).toBe(500);
    expect(await num(p.id, 'actual_cost')).toBe(0);
    expect((await get('estimates', est)).total_amount).toBe('4725.00');
  });

  it('cannot move its own entry or estimate line onto our records', async () => {
    const mine = await newProject();
    const est = await newEstimate();
    const rivalProject = await newProject(1, 'rival');
    const rivalEntry = await ins('rival', 'job_cost_entries', { project_id: rivalProject.id, category: 'Other', description: 'x', amount: 10 });
    expect(await refused(t.as('rival', 'update public.job_cost_entries set project_id = $1 where id = $2', [mine.id, rivalEntry.id]))).toBeTruthy();
    const rivalEst = await ins('rival', 'estimates', { title: 'x', status: 'Draft' });
    const [line] = await t.as<Row>('rival', `insert into public.estimate_items (estimate_id, description, quantity, material_unit_cost) values ($1, 'x', 1, 5) returning id`, [rivalEst.id]);
    expect(await refused(t.as('rival', 'update public.estimate_items set estimate_id = $1 where id = $2', [est, line.id]))).toBeTruthy();
    expect(await num(mine.id, 'actual_cost')).toBe(0);
    expect(Number((await get('estimates', est)).total_amount)).toBe(4725);
  });

  it('gets nothing from the rollup, and a reconcile touches only the company asked for', async () => {
    const p = await newProject();
    const [{ r }] = await t.as<{ r: Row[] }>('rival', 'select public.job_cost_rollup($1) as r', [p.id]);
    expect(r).toEqual([]);
    await t.asSystem('update public.job_costing set actual_cost = 42 where project_id = $1', [p.id]);
    await reconcile(rivalCompany);
    expect(await num(p.id, 'actual_cost')).toBe(42);
    expect(await reconcile(company)).toBeGreaterThanOrEqual(1);
    expect(await num(p.id, 'actual_cost')).toBe(0);
  });

  it('cannot convert or bill our records, and their errors reveal nothing', async () => {
    const est = await newEstimate();
    const prop = await toProposal(est);
    const p = await newProject();
    expect(await refused(t.as('rival', 'select public.create_proposal_from_estimate($1)', [est]))).toMatch(/not found/);
    expect(await refused(t.as('rival', 'select public.create_project_from_proposal($1)', [prop]))).toMatch(/not found/);
    expect(await refused(t.as('rival', 'select public.create_invoice_from_project($1)', [p.id]))).toMatch(/not found/);
    expect(await refused(t.as('rival', 'select public.create_draw_from_project($1)', [p.id]))).toMatch(/not found/);
    expect(await refused(t.as('rival', 'select public.seed_job_budget_from_estimate($1)', [p.id]))).toMatch(/not found/);
    expect(await refused(t.as('rival', 'select public.save_estimate_items($1, $2::jsonb)', [est, '[]']))).toMatch(/not found/i);
  });
});

describe('lapsed subscription', () => {
  let project: string;
  let est: string;
  let accepted: string;
  let draft: string;
  let entryId: string;
  beforeAll(async () => {
    await t.setLapsed(lapsedCompany, false);
    project = (await newProject(1000, 'lapsedPm')).id;
    est = await newEstimate(ALL_LINES, {}, 'lapsedPm');
    draft = await toProposal(est, 'lapsedPm');
    const est2 = await newEstimate(ALL_LINES, {}, 'lapsedPm');
    accepted = await toProposal(est2, 'lapsedPm');
    await setProposal(accepted, 'Accepted', 'lapsedPm');
    entryId = await entry(project, 50, 'Other', 'lapsedPm');
    await t.setLapsed(lapsedCompany, true);
  });

  it('refuses every conversion, budget, entry, line and status write', async () => {
    const who = 'lapsedPm';
    for (const [sql, params] of [
      ['select public.create_proposal_from_estimate($1)', [est]],
      ['select public.create_project_from_proposal($1)', [accepted]],
      ['select public.create_draw_from_project($1)', [project]],
      ['select public.create_invoice_from_project($1)', [project]],
      ['select public.set_job_budget($1, 1, 1, 1, 1)', [project]],
      ['select public.set_job_closed($1, true)', [project]],
      ['select public.seed_job_budget_from_estimate($1)', [project]],
      ['select public.save_estimate_items($1, $2::jsonb)', [est, '[]']],
    ] as [string, unknown[]][]) {
      expect(await refused(t.as(who, sql, params)), sql).toBeTruthy();
    }
    for (const sql of ['update public.job_cost_entries set amount = 1 where id = $1', 'delete from public.job_cost_entries where id = $1']) {
      await t.as(who, sql, [entryId]);
    }
    expect(Number((await get('job_cost_entries', entryId)).amount)).toBe(50);
    await t.as(who, 'delete from public.estimate_items where estimate_id = $1', [est]);
    expect((await t.asSystem('select 1 from public.estimate_items where estimate_id = $1', [est])).length).toBe(1);
    await t.as(who, `update public.proposals set status = 'Sent' where id = $1`, [draft]);
    expect((await get('proposals', draft)).status).toBe('Draft');
    await t.as(who, 'update public.estimates set labour_rate = 1 where id = $1', [est]);
    expect(Number((await get('estimates', est)).labour_rate)).toBe(80);
  });

  it('a double click on an already converted record still reads as refused, not a new row', async () => {
    const count = async () => (await t.asSystem('select 1 from public.projects where company_id = $1', [lapsedCompany])).length;
    const before = await count();
    await refused(t.as('lapsed', 'select public.create_project_from_proposal($1)', [accepted]));
    expect(await count()).toBe(before);
  });

  it('deleting an old unlinked job row is refused too', async () => {
    const [{ id }] = await t.asSystem<{ id: string }>(`insert into public.job_costing (company_id, title, status, budget, actual_cost) values ($1, 'Old typed', 'On Track', 1, 1) returning id`, [lapsedCompany]);
    await t.as('lapsed', 'delete from public.job_costing where id = $1', [id]);
    expect(await get('job_costing', id)).toBeTruthy();
  });

  it('reads still work and the nightly reconcile still runs', async () => {
    const [{ r }] = await t.as<{ r: Row[] }>('lapsedPm', 'select public.job_cost_rollup($1) as r', [project]);
    expect(Number(r[0].actual_cost)).toBe(50);
    await t.asSystem('update public.job_costing set actual_cost = 42 where project_id = $1', [project]);
    expect(await reconcile(lapsedCompany)).toBeGreaterThanOrEqual(1);
    expect(await num(project, 'actual_cost')).toBe(50);
  });
});

describe('double submit', () => {
  it('estimate > proposal twice, in parallel and by a direct insert, makes one record', async () => {
    const est = await newEstimate();
    const [a, b] = await Promise.all([toProposal(est), toProposal(est)]);
    expect(a).toBe(b);
    expect(await refused(ins('pm', 'proposals', { title: 'Dup', status: 'Draft', estimate_id: est }))).toMatch(/duplicate|unique/);
    expect((await t.asSystem('select 1 from public.proposals where estimate_id = $1', [est])).length).toBe(1);
  });

  it('proposal > project twice, in parallel and by a direct insert, makes one project and one job row', async () => {
    const prop = await toProposal(await newEstimate());
    await setProposal(prop, 'Accepted');
    const [a, b] = await Promise.all([toProject(prop), toProject(prop)]);
    expect(a).toBe(b);
    expect(await refused(ins('pm', 'projects', { title: 'Dup', status: 'Active', proposal_id: prop }))).toMatch(/duplicate|unique/);
    expect((await t.asSystem('select 1 from public.projects where proposal_id = $1', [prop])).length).toBe(1);
    expect((await t.asSystem('select 1 from public.job_costing where project_id = $1', [a])).length).toBe(1);
  });

  it('a second job row for a project cannot exist, even from the service role', async () => {
    const p = await newProject();
    expect(await refused(t.asSystem(`insert into public.job_costing (company_id, title, status, project_id) values ($1, 'Dup', 'On Track', $2)`, [company, p.id]))).toMatch(/duplicate|unique/);
  });

  it('invoice and draw twice return the same draft and use one invoice number', async () => {
    const p = await newProject(1000);
    const [i1, i2] = await Promise.all([t.as<Row>('admin', 'select public.create_invoice_from_project($1) as id', [p.id]), t.as<Row>('admin', 'select public.create_invoice_from_project($1) as id', [p.id])]);
    expect(i1[0].id).toBe(i2[0].id);
    expect((await t.asSystem('select 1 from public.invoices where project_id = $1', [p.id])).length).toBe(1);
    const [d1, d2] = await Promise.all([t.as<Row>('pm', 'select public.create_draw_from_project($1) as id', [p.id]), t.as<Row>('pm', 'select public.create_draw_from_project($1) as id', [p.id])]);
    expect(d1[0].id).toBe(d2[0].id);
    expect((await t.asSystem('select 1 from public.progress_billing where project_id = $1', [p.id])).length).toBe(1);
  });

  it('an invoice with a blank-looking lines value cannot break the repeat lookup', async () => {
    const p = await newProject(1000);
    const bad = await refused(ins('admin', 'invoices', { title: 'x', status: 'Draft', project_id: p.id, lines: '{}' }));
    expect(bad).toBeTruthy();
    expect((await t.as<Row>('admin', 'select public.create_invoice_from_project($1) as id', [p.id]))[0].id).toBeTruthy();
  });
});

describe('bypassing the UI', () => {
  it('[BUG] a Sent proposal price cannot be restructured by moving markup into tax with the same total', async () => {
    // Before tax 1100, no tax: what the client saw, and what the contract would be
    const est = await newEstimate([{ description: 'x', quantity: 1, material_unit_cost: 1000, labour_hours_per_unit: 0 }], { labour_rate: 0, markup_percentage: 10, tax_percentage: 0 });
    const prop = await toProposal(est);
    await setProposal(prop, 'Sent');
    // The lock only compares total_amount: 1000 + 10% tax is also 1100
    const message = await refused(t.as('pm', 'update public.estimates set markup_percentage = 0, tax_percentage = 10 where id = $1', [est]));
    await setProposal(prop, 'Accepted');
    const project = await toProject(prop);
    expect(message ?? 'the write went through').toMatch(/with the client/);
    expect(Number((await get('projects', project)).contract_value)).toBe(1100);
  });

  it('an estimate cannot be given a negative rate or percent, even by a direct write', async () => {
    const est = await newEstimate();
    expect(await refused(t.as('pm', 'update public.estimates set labour_rate = -500 where id = $1', [est]))).toMatch(/check constraint/);
    expect(await refused(t.as('pm', 'update public.estimates set markup_percentage = -200 where id = $1', [est]))).toMatch(/check constraint/);
    expect(await refused(t.as('pm', 'update public.estimates set tax_percentage = -50 where id = $1', [est]))).toMatch(/check constraint/);
    expect(await refused(t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [est, JSON.stringify([{ quantity: -1, material_unit_cost: 5 }])]))).toMatch(/check constraint/);
    expect(await refused(t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [est, JSON.stringify([{ quantity: 1, material_unit_cost: -5 }])]))).toMatch(/check constraint/);
    expect(Number((await get('estimates', est)).total_amount)).toBe(4725);
  });

  it('total, contract rollups and locked links cannot be set directly', async () => {
    const est = await newEstimate();
    const prop = await toProposal(est);
    await t.as('pm', 'update public.estimates set total_amount = 1 where id = $1', [est]);
    expect(Number((await get('estimates', est)).total_amount)).toBe(4725);
    await t.as('pm', 'update public.proposals set total_amount = 1 where id = $1', [prop]);
    expect(Number((await get('proposals', prop)).total_amount)).toBe(4725);
    await t.as('pm', 'update public.proposals set estimate_id = null where id = $1', [prop]);
    expect((await get('proposals', prop)).estimate_id).toBe(est);
    const p = await newProject(1000);
    await t.as('pm', 'update public.projects set approved_changes = 999, revised_contract = 999 where id = $1', [p.id]);
    const row = await get('projects', p.id);
    expect(Number(row.approved_changes)).toBe(0);
    expect(Number(row.revised_contract)).toBe(1000);
    expect(await num(p.id, 'margin')).toBe(1000);
  });

  it('NaN and Infinity are refused at every money door of this engine', async () => {
    const p = await newProject();
    const est = await newEstimate();
    for (const bad of ['NaN', 'Infinity', '-Infinity']) {
      expect(await refused(t.as('pm', 'select public.set_job_budget($1, $2, 0, 0, 0)', [p.id, bad])), bad).toBeTruthy();
      expect(await refused(t.as('pm', 'select public.set_job_budget($1, 0, 0, $2, 0)', [p.id, bad])), bad).toBeTruthy();
      expect(await refused(ins('pm', 'job_cost_entries', { project_id: p.id, category: 'Other', description: 'x', amount: bad })), bad).toBeTruthy();
      expect(await refused(t.as('pm', 'update public.projects set contract_value = $2 where id = $1', [p.id, bad])), bad).toBeTruthy();
      expect(await refused(t.as('pm', 'update public.estimates set tax_percentage = $2 where id = $1', [est, bad])), bad).toBeTruthy();
      expect(await refused(ins('pm', 'proposals', { title: 'x', status: 'Draft', total_amount: bad })), bad).toBeTruthy();
      expect(await refused(t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [est, JSON.stringify([{ quantity: bad, material_unit_cost: 1 }])])), bad).toBeTruthy();
    }
    expect(await num(p.id, 'budget')).toBe(0);
  });

  it('[BUG] a NaN employee pay rate cannot poison the job through an approved card', async () => {
    const p = await newProject(10000);
    const rate = await refused(ins('admin', 'employees', { title: 'Poison Pay', status: 'Active', hourly_cost: 'NaN' }));
    if (!rate) {
      const c = await card(p.id, 8, 0, { employee_name: 'Poison Pay' });
      await refused(decide([c], 'approve'));
    }
    const row = await job(p.id);
    expect(row.actual_labour).not.toBe('NaN');
    expect(row.actual_cost).not.toBe('NaN');
    expect(row.margin).not.toBe('NaN');
    await t.asSystem(`delete from public.timecards where project_id = $1`, [p.id]).catch(() => {});
    await t.asSystem(`update public.employees set hourly_cost = null where title = 'Poison Pay'`);
  });

  it('a NaN company labour rate cannot poison the job through an approved card or change order', async () => {
    const p = await newProject(10000);
    await budget(p.id, 0, 0, 1000);
    const rate = await refused(t.as('owner', `update public.companies set default_labour_rate = 'NaN' where id = $1`, [company]));
    try {
      if (!rate) {
        const c = await card(p.id, 8, 0);
        await refused(decide([c], 'approve'));
        await refused(approvedCo(p.id));
      }
      const row = await job(p.id);
      expect(row.actual_cost).not.toBe('NaN');
      expect(row.budget).not.toBe('NaN');
      expect(row.status).toBe('On Track');
    } finally {
      await t.asSystem('update public.companies set default_labour_rate = 100 where id = $1', [company]);
      await t.asSystem('alter table public.timecards disable trigger user');
      await t.asSystem(`delete from public.timecards where project_id = $1`, [p.id]);
      await t.asSystem('alter table public.timecards enable trigger user');
      await t.asSystem('alter table public.change_orders disable trigger user');
      await t.asSystem(`delete from public.change_orders where project_id = $1`, [p.id]);
      await t.asSystem('alter table public.change_orders enable trigger user');
      await t.asService('select public.reconcile_job_costs($1)', [company]);
    }
  });

  it('a NaN overtime multiplier cannot poison the job through an approved card', async () => {
    const p = await newProject(10000);
    const rate = await refused(t.as('owner', `update public.companies set overtime_multiplier = 'NaN' where id = $1`, [company]));
    try {
      if (!rate) {
        const c = await card(p.id, 8, 2);
        await refused(decide([c], 'approve'));
      }
      expect((await job(p.id)).actual_cost).not.toBe('NaN');
    } finally {
      await t.asSystem('update public.companies set overtime_multiplier = 1.5 where id = $1', [company]);
      await t.asSystem('alter table public.timecards disable trigger user');
      await t.asSystem(`delete from public.timecards where project_id = $1`, [p.id]);
      await t.asSystem('alter table public.timecards enable trigger user');
      await t.asService('select public.reconcile_job_costs($1)', [company]);
    }
  });
});

describe('boundary values', () => {
  it('status at the edges of each threshold, with one cent of budget and with credits', async () => {
    const p = await newProject(10000);
    await budget(p.id, 0, 0, 100);
    const e = await entry(p.id, 84.99);
    expect((await job(p.id)).status).toBe('On Track');
    await t.as('pm', 'update public.job_cost_entries set amount = 85 where id = $1', [e]);
    expect((await job(p.id)).status).toBe('At Risk');
    await t.as('pm', 'update public.job_cost_entries set amount = 99.99 where id = $1', [e]);
    expect((await job(p.id)).status).toBe('At Risk');
    await t.as('pm', 'update public.job_cost_entries set amount = 100 where id = $1', [e]);
    expect((await job(p.id)).status).toBe('Over Budget');
    expect(Number((await job(p.id)).cost_used_pct)).toBe(100);
    await t.as('pm', 'update public.job_cost_entries set amount = -5000 where id = $1', [e]);
    const credit = await job(p.id);
    expect(credit.status).toBe('On Track');
    expect(Number(credit.margin)).toBe(15000);
    expect(Number(credit.cost_used_pct)).toBe(-5000);
    await budget(p.id, 0, 0, 0.01);
    await t.as('pm', 'update public.job_cost_entries set amount = 0.01 where id = $1', [e]);
    expect((await job(p.id)).status).toBe('Over Budget');
    await t.as('pm', 'update public.job_cost_entries set amount = 999999999 where id = $1', [e]);
    expect(Number((await job(p.id)).cost_used_pct)).toBe(9999999990000);
  });

  it('no contract gives no margin percent, not a division error, and a loss is shown as a loss', async () => {
    const p = await newProject(0);
    await entry(p.id, 10);
    const row = await job(p.id);
    expect(row.margin_pct).toBeNull();
    expect(Number(row.margin)).toBe(-10);
    const nullContract = await newProject(null);
    await entry(nullContract.id, 10);
    expect(Number((await job(nullContract.id)).margin)).toBe(-10);
    expect(await reconcile()).toBe(0);
  });

  it('a sum that would overflow the column is refused whole and leaves nothing half-done', async () => {
    const p = await newProject(0);
    await entry(p.id, 900000000000);
    expect(await refused(entry(p.id, 900000000000))).toBeTruthy();
    expect((await t.asSystem('select 1 from public.job_cost_entries where project_id = $1', [p.id])).length).toBe(1);
    expect(await num(p.id, 'actual_cost')).toBe(900000000000);
  });

  it('budget refuses negatives and keeps cents exact', async () => {
    const p = await newProject();
    expect(await refused(budget(p.id, -1, 0, 0))).toBeTruthy();
    expect(await refused(budget(p.id, 0, 0, -0.01))).toBeTruthy();
    await budget(p.id, 10.555, 100.005, 200.004, 0.005);
    const row = await job(p.id);
    expect(Number(row.budget_labour_hours)).toBe(10.56);
    expect(Number(row.budget_labour)).toBe(100.01);
    expect(Number(row.budget_material)).toBe(200);
    expect(Number(row.budget_other)).toBe(0.01);
    expect(Number(row.budget)).toBe(300.02);
  });

  it('a timecard at exactly 24 hours counts, and one over is refused', async () => {
    const p = await newProject();
    const c = await card(p.id, 16, 8);
    await decide([c], 'approve');
    expect(await num(p.id, 'actual_labour')).toBe(2800);
    expect(await refused(card(p.id, 16, 8.01))).toBeTruthy();
    await decide([c], 'unapprove');
  });
});

describe('rounding', () => {
  const round3 = (x: number) => Math.round(x * 1000) / 1000;
  it('database totals match the browser and print sums on 150 awkward estimates', async () => {
    let seed = 20261104;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const est = await newEstimate([]);
    const bad: unknown[] = [];
    for (let i = 0; i < 150; i++) {
      const count = 1 + Math.floor(rnd() * 5);
      const lines = Array.from({ length: count }, (_, k) => ({
        description: `L${k}`,
        unit: 'ea',
        quantity: round3(rnd() * (i % 3 ? 20 : 1000)),
        material_unit_cost: Math.round(rnd() * 100000) / 100,
        labour_hours_per_unit: round3(rnd() * 4),
      }));
      const rate = Math.round(rnd() * 15000) / 100;
      const markup = Math.round(rnd() * 3000) / 100;
      const tax = [0, 5, 6, 11, 13, 14.975][i % 6];
      await t.as('pm', 'update public.estimates set labour_rate = $2, markup_percentage = $3, tax_percentage = $4 where id = $1', [est, rate, markup, tax]);
      await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [est, JSON.stringify(lines)]);
      const js = estimateTotals(lines, rate, markup, tax);
      const [db] = await t.as<Row>('pm', 'select * from public.estimate_totals($1, $2, $3, $4)', [est, rate, markup, tax]);
      const stored = Number((await get('estimates', est)).total_amount);
      if (Number(db.total) !== js.total || stored !== js.total || Number(db.before_tax) !== js.beforeTax || Number(db.material) !== js.material || Number(db.labour) !== js.labour) {
        bad.push({ lines, rate, markup, tax, db, js: { total: js.total, beforeTax: js.beforeTax, material: js.material, labour: js.labour }, stored });
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('[BUG] the printed line amounts add up to the printed subtotal', () => {
    // Three equal lines, 10% markup: the client sees 36.66 + 36.66 + 36.66 = 109.98 over a subtotal of 109.99
    const lines = Array.from({ length: 3 }, () => ({ description: 'x', quantity: 1, unit: 'ea', material_unit_cost: 33.33, labour_hours_per_unit: 0 }));
    const totals = estimateTotals(lines, 0, 10, 0);
    const printed = lines.reduce((sum, _, i) => sum + lineSellPrice(totals, i, 0), 0);
    expect(Math.round(printed * 100) / 100).toBe(totals.beforeTax);
  });

  it('frozen card cost and awkward hours settle: a reconcile finds nothing to change', async () => {
    const p = await newProject(12345.67);
    const c1 = await card(p.id, 7.125, 1.333);
    const c2 = await card(p.id, 0.01, 0);
    await decide([c1, c2], 'approve');
    await approvedCo(p.id, { material_cost: 33.33, labour_hours: 1.125, labour_rate: 77.77, markup_pct: 12.5, tax_pct: 11 });
    await ins('pm', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: p.id, amount: 10.005 });
    await ins('admin', 'payables', { title: 'B', status: 'Paid', project_id: p.id, amount: 3.335 });
    await invoice(p.id, 33.335);
    expect(await reconcile()).toBe(0);
    const before = JSON.stringify(await job(p.id));
    expect(await reconcile()).toBe(0);
    expect(JSON.stringify(await job(p.id))).toBe(before);
    const row = await job(p.id);
    expect(Number(row.actual_cost)).toBe(Math.round((Number(row.actual_labour) + Number(row.actual_material) + Number(row.actual_other)) * 100) / 100);
    expect(Number(row.margin)).toBe(Math.round((Number((await get('projects', p.id)).revised_contract) - Number(row.actual_cost)) * 100) / 100);
    await decide([c1, c2], 'unapprove');
  });
});

describe('out-of-order status changes', () => {
  it('each way a proposal can fail to be accepted refuses the conversion', async () => {
    const est = await newEstimate();
    const prop = await toProposal(est);
    for (const status of ['Draft', 'Sent', 'Declined']) {
      await setProposal(prop, status);
      expect(await refused(toProject(prop)), status).toMatch(/accepted/i);
    }
    await setProposal(prop, 'Accepted');
    await setProposal(prop, 'Declined');
    expect(await refused(toProject(prop))).toMatch(/accepted/i);
    expect((await get('estimates', est)).status).toBe('Submitted');
  });

  it('[BUG] an estimate linked to an existing job after its proposal was made does not create a duplicate job', async () => {
    const job1 = await newProject(0);
    const est = await newEstimate();
    const prop = await toProposal(est);
    // The estimate form has a project picker and the price does not change, so the lock lets this through
    await t.as('pm', 'update public.estimates set project_id = $1 where id = $2', [job1.id, est]);
    await setProposal(prop, 'Accepted');
    const made = await toProject(prop);
    const [estRow, projRow] = [await get('estimates', est), await get('projects', made)];
    // Whichever job is right, the estimate and the project have to agree on it
    expect(estRow.project_id).toBe(made);
    expect(projRow.estimate_id).toBe(est);
    expect(made).toBe(job1.id);
  });

  it('[BUG] a hand-typed proposal price is locked once it is with the client, like an estimate-backed one', async () => {
    const prop = (await ins('pm', 'proposals', { title: 'Typed', status: 'Sent', total_amount: 5000 })).id;
    await setProposal(prop, 'Accepted');
    const project = await toProject(prop);
    // The project's contract is 5000 and this proposal says it stays accepted, but the price it shows moves
    await refused(t.as('pm', 'update public.proposals set total_amount = 1 where id = $1', [prop]));
    expect(Number((await get('proposals', prop)).total_amount)).toBe(5000);
    expect(Number((await get('projects', project)).contract_value)).toBe(5000);
  });

  it('job closed, then every cost path still moves the numbers and never the status', async () => {
    const p = await newProject(1000);
    await budget(p.id, 0, 0, 10);
    await t.as('pm', 'select public.set_job_closed($1, true)', [p.id]);
    await t.as('pm', 'select public.set_job_closed($1, true)', [p.id]);
    const c = await card(p.id, 1);
    await decide([c], 'approve');
    await ins('admin', 'payables', { title: 'B', status: 'Approved', project_id: p.id, amount: 5 });
    await entry(p.id, 5);
    await budget(p.id, 0, 0, 1000000);
    await reconcile();
    const row = await job(p.id);
    expect(row.status).toBe('Closed');
    expect(Number(row.actual_cost)).toBe(110);
    await t.as('pm', 'select public.set_job_closed($1, false)', [p.id]);
    expect((await job(p.id)).status).toBe('On Track');
    await decide([c], 'unapprove');
  });

  it('a card rejected, resubmitted and approved twice counts once, and the frozen rate is re-read on re-approval only', async () => {
    const p = await newProject();
    const c = await card(p.id, 10);
    await decide([c], 'reject').catch(() => t.as('pm', 'select public.decide_timecards($1, $2, $3)', [[c], 'reject', 'wrong day']));
    expect(await num(p.id, 'actual_labour')).toBe(0);
    await t.as('pm', `update public.timecards set status = 'Submitted' where id = $1`, [c]);
    await decide([c], 'approve');
    await refused(decide([c], 'approve'));
    expect(await num(p.id, 'actual_labour')).toBe(1000);
    await t.as('owner', 'update public.companies set default_labour_rate = 200 where id = $1', [company]);
    await reconcile();
    expect(await num(p.id, 'actual_labour')).toBe(1000);
    await decide([c], 'unapprove');
    await decide([c], 'approve');
    expect(await num(p.id, 'actual_labour')).toBe(2000);
    await t.as('owner', 'update public.companies set default_labour_rate = 100 where id = $1', [company]);
    await decide([c], 'unapprove');
  });

  it('an invoice through every legal state keeps billed and paid right, and an illegal one changes nothing', async () => {
    const p = await newProject(1000);
    const inv = await invoice(p.id, 400, 'Draft');
    expect(await num(p.id, 'billed_amount')).toBe(0);
    expect(await refused(t.as('admin', `update public.invoices set status = 'Paid' where id = $1`, [inv]))).toBeTruthy();
    await t.as('admin', `update public.invoices set status = 'Sent' where id = $1`, [inv]);
    expect(await num(p.id, 'billed_amount')).toBe(400);
    await t.asService(`update public.invoices set status = 'Overdue' where id = $1`, [inv]);
    expect(await num(p.id, 'billed_amount')).toBe(400);
    await t.as('admin', `update public.invoices set status = 'Paid' where id = $1`, [inv]);
    // Before tax, less the 10% holdback the client hasn't paid
    expect(await num(p.id, 'paid_amount')).toBe(360);
    expect(await refused(t.as('admin', `update public.invoices set status = 'Void' where id = $1`, [inv]))).toBeTruthy();
    expect(await num(p.id, 'paid_amount')).toBe(360);
    await t.as('admin', `update public.invoices set status = 'Sent' where id = $1`, [inv]);
    await t.as('admin', `update public.invoices set status = 'Void' where id = $1`, [inv]);
    expect(await num(p.id, 'billed_amount')).toBe(0);
    expect(await num(p.id, 'paid_amount')).toBe(0);
    expect(await refused(t.as('admin', `update public.invoices set status = 'Sent' where id = $1`, [inv]))).toBeTruthy();
    expect(await num(p.id, 'billed_amount')).toBe(0);
  });
});

describe('deleting referenced records', () => {
  it('an estimate behind a proposal or project cannot be deleted, at any status', async () => {
    for (const status of ['Draft', 'Sent', 'Accepted']) {
      const est = await newEstimate();
      const prop = await toProposal(est);
      await setProposal(prop, status);
      expect(await refused(t.as('pm', 'delete from public.estimates where id = $1', [est])), status).toBeTruthy();
      expect(await get('estimates', est), status).toBeTruthy();
      expect((await t.asSystem('select 1 from public.estimate_items where estimate_id = $1', [est])).length, status).toBe(1);
    }
  });

  it('a proposal with a project cannot be deleted, and the project keeps its contract', async () => {
    const prop = await toProposal(await newEstimate());
    await setProposal(prop, 'Accepted');
    const project = await toProject(prop);
    expect(await refused(t.as('pm', 'delete from public.proposals where id = $1', [prop]))).toBeTruthy();
    expect(await get('proposals', prop)).toBeTruthy();
    expect(Number((await get('projects', project)).contract_value)).toBe(4500);
  });

  it('a project with costs cannot be deleted and its job row survives the failed attempt', async () => {
    const makers: [string, (p: string) => Promise<unknown>][] = [
      ['card', (p) => card(p, 1)],
      ['payable', (p) => ins('admin', 'payables', { title: 'B', status: 'Paid', project_id: p, amount: 5 })],
      ['po', (p) => ins('pm', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: p, amount: 5 })],
      ['co', (p) => approvedCo(p)],
      ['invoice', (p) => invoice(p, 5)],
      ['draw', (p) => ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p, amount_billed: 5 })],
      ['entry', (p) => entry(p, 5)],
      ['loto', (p) => ins('foreman', 'loto_permits', LOTO(p))],
    ];
    for (const [name, make] of makers) {
      const p = await newProject(1000);
      await make(p.id);
      const before = JSON.stringify(await job(p.id));
      expect(await refused(t.as('admin', 'delete from public.projects where id = $1', [p.id])), name).toBeTruthy();
      expect(await get('projects', p.id), name).toBeTruthy();
      expect(JSON.stringify(await job(p.id)), name).toBe(before);
    }
  });

  it('a PO matched to a bill cannot be deleted, and a bill removed puts the commitment back', async () => {
    const p = await newProject();
    const po = await ins('pm', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: p.id, amount: 500 });
    const bill = await ins('admin', 'payables', { title: 'B', status: 'Approved', project_id: p.id, amount: 500, purchase_order_id: po.id });
    expect(await refused(t.as('pm', 'delete from public.purchase_orders where id = $1', [po.id]))).toBeTruthy();
    expect(await num(p.id, 'committed')).toBe(0);
    await t.as('admin', 'delete from public.payables where id = $1', [bill.id]);
    expect(await num(p.id, 'committed')).toBe(500);
    expect(await num(p.id, 'actual_material')).toBe(0);
  });

  it('deleting a project made by mistake lets its proposal make exactly one more', async () => {
    const est = await newEstimate();
    const prop = await toProposal(est);
    await setProposal(prop, 'Accepted');
    const first = await toProject(prop);
    await t.as('admin', 'delete from public.projects where id = $1', [first]);
    expect(await job(first)).toBeUndefined();
    const second = await toProject(prop);
    expect(second).not.toBe(first);
    expect(await toProject(prop)).toBe(second);
    expect((await get('estimates', est)).project_id).toBe(second);
    expect(await num(second, 'budget')).toBe(3600);
  });

  it('an approved change order and an approved card cannot be deleted by a signed-in user', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    const c = await card(p.id, 1);
    await decide([c], 'approve');
    expect(await refused(t.as('pm', 'delete from public.change_orders where id = $1', [co]))).toBeTruthy();
    expect(await refused(t.as('pm', 'delete from public.timecards where id = $1', [c]))).toBeTruthy();
    expect(await num(p.id, 'co_revenue')).toBe(2640);
    expect(await num(p.id, 'actual_labour')).toBe(100);
    await decide([c], 'unapprove');
  });

  it('a company can be removed even when its jobs have manual cost entries', async () => {
    // companies cascade to everything; job_cost_entries.project_id has no cascade, so the projects leg trips on it
    const u = { id: uid(20), email: 'gone@gone.ca' };
    await t.asSystem('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
    const [{ id: gone }] = await t.asSystem<{ id: string }>(`insert into public.companies (name, province) values ('Gone', 'SK') returning id`);
    const [{ id: project }] = await t.asSystem<{ id: string }>(`insert into public.projects (company_id, title, status) values ($1, 'Bare', 'Active') returning id`, [gone]);
    await t.asSystem(`insert into public.job_cost_entries (company_id, project_id, category, description, amount) values ($1, $2, 'Other', 'x', 5)`, [gone, project]);
    const message = await refused(t.asSystem('delete from public.companies where id = $1', [gone]));
    expect(message).toBeNull();
  });
});

describe('interactions with the timecard, billing and safety guards', () => {
  it('one decision across three projects recounts all three, and export keeps every one', async () => {
    const a = await newProject();
    const b = await newProject();
    const none = await card(null, 5);
    const [c1, c2] = [await card(a.id, 1), await card(b.id, 2)];
    await decide([c1, c2, none], 'approve');
    expect(await num(a.id, 'actual_labour')).toBe(100);
    expect(await num(b.id, 'actual_labour')).toBe(200);
    await t.as('pm', 'select public.export_timecards($1, $2)', ['2026-01-01', '2026-12-31']);
    expect(await num(a.id, 'actual_labour')).toBe(100);
    expect(await num(b.id, 'actual_labour')).toBe(200);
    expect(await reconcile()).toBe(0);
    await decide([c1, c2, none], 'reopen');
    await decide([c1, c2, none], 'unapprove');
    expect(await num(a.id, 'actual_labour')).toBe(0);
  });

  it('an approved card cannot be moved or re-houred by a signed-in user, so the job cannot drift', async () => {
    const a = await newProject();
    const b = await newProject();
    const c = await card(a.id, 4);
    await decide([c], 'approve');
    expect(await refused(t.as('pm', 'update public.timecards set project_id = $1 where id = $2', [b.id, c]))).toBeTruthy();
    expect(await refused(t.as('pm', 'update public.timecards set regular_hours = 20 where id = $1', [c]))).toBeTruthy();
    expect(await num(a.id, 'actual_labour')).toBe(400);
    expect(await num(b.id, 'actual_labour')).toBe(0);
    await decide([c], 'unapprove');
  });

  it('a change order feeds revenue, the contract, cost and the budget, and a company rate change does not move an approved one', async () => {
    const p = await newProject(1000);
    await budget(p.id, 0, 0, 500);
    const co = await approvedCo(p.id);
    const row = await get('projects', p.id);
    expect(Number(row.approved_changes)).toBe(2640);
    expect(Number(row.revised_contract)).toBe(3640);
    const j = await job(p.id);
    expect(Number(j.co_revenue)).toBe(2640);
    expect(Number(j.co_cost)).toBe(2000);
    expect(Number(j.budget)).toBe(2500);
    expect(Number(j.margin)).toBe(3640);
    await t.as('owner', 'update public.companies set default_labour_rate = 900 where id = $1', [company]);
    await reconcile();
    expect(await num(p.id, 'co_cost')).toBe(2000);
    await t.as('owner', 'update public.companies set default_labour_rate = 100 where id = $1', [company]);
    expect(await refused(t.as('pm', 'update public.change_orders set price = 1, budget_cost = 1 where id = $1', [co]))).toMatch(/locked/);
    expect(await num(p.id, 'co_revenue')).toBe(2640);
    expect(await num(p.id, 'co_cost')).toBe(2000);
    await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co]);
    expect(await num(p.id, 'budget')).toBe(500);
    expect(Number((await get('projects', p.id)).revised_contract)).toBe(1000);
  });

  it('project > draw > invoice runs on the billing guard, and billed moves only when sent', async () => {
    const p = await newProject(1000);
    const [{ id: draw }] = await t.as<{ id: string }>('pm', 'select public.create_draw_from_project($1) as id', [p.id]);
    expect(Number((await get('progress_billing', draw)).amount_billed)).toBe(1000);
    const [{ id: inv }] = await t.as<{ id: string }>('admin', 'select public.create_invoice_from_draw($1) as id', [draw]);
    expect(await num(p.id, 'billed_amount')).toBe(0);
    await t.as('admin', `update public.invoices set status = 'Sent' where id = $1`, [inv]);
    expect(await num(p.id, 'billed_amount')).toBe(1000);
    const [{ b }] = await t.as<{ b: string }>('pm', 'select public.project_balance($1) as b', [p.id]);
    expect(Number(b)).toBe(0);
    const [{ id: next }] = await t.as<{ id: string }>('pm', 'select public.create_draw_from_project($1) as id', [p.id]);
    expect(next).not.toBe(draw);
    expect((await get('progress_billing', next)).amount_billed).toBeNull();
    expect(await refused(t.as('admin', 'delete from public.progress_billing where id = $1', [draw]))).toMatch(/on an invoice/);
  });

  it('[BUG] the next "new invoice" click does not hand back a draft priced at a balance that has since changed', async () => {
    const p = await newProject(1000);
    const [{ id: first }] = await t.as<{ id: string }>('admin', 'select public.create_invoice_from_project($1) as id', [p.id]);
    expect(Number((await get('invoices', first)).amount)).toBe(1000);
    await invoice(p.id, 400);
    // Balance is now 600. The draw button compares the amount and makes a fresh one; the invoice button does not.
    const [{ id: again }] = await t.as<{ id: string }>('admin', 'select public.create_invoice_from_project($1) as id', [p.id]);
    expect(Number((await get('invoices', again)).amount)).toBe(600);
  });

  it('[BUG] a second draw after the first was deleted does not repeat a number already on the job', async () => {
    const p = await newProject(1000);
    const [{ id: d1 }] = await t.as<{ id: string }>('pm', 'select public.create_draw_from_project($1) as id', [p.id]);
    await t.as('pm', 'update public.progress_billing set amount_billed = 100 where id = $1', [d1]);
    const [{ id: d2 }] = await t.as<{ id: string }>('pm', 'select public.create_draw_from_project($1) as id', [p.id]);
    expect((await get('progress_billing', d2)).title).toBe('Draw #2');
    await t.as('admin', 'delete from public.progress_billing where id = $1', [d1]);
    await t.as('pm', 'update public.progress_billing set amount_billed = 100 where id = $1', [d2]);
    const [{ id: d3 }] = await t.as<{ id: string }>('pm', 'select public.create_draw_from_project($1) as id', [p.id]);
    expect((await get('progress_billing', d3)).title).not.toBe('Draw #2');
  });

  it('safety records on a job do not touch its money', async () => {
    const p = await newProject(1000);
    await ins('foreman', 'loto_permits', LOTO(p.id));
    expect(await num(p.id, 'actual_cost')).toBe(0);
    expect(await reconcile()).toBe(0);
  });

  it('a bill or PO moved between jobs, one on each, moves both sides', async () => {
    const a = await newProject();
    const b = await newProject();
    const po = await ins('pm', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: a.id, amount: 500 });
    await t.as('pm', 'update public.purchase_orders set project_id = $1 where id = $2', [b.id, po.id]);
    expect(await num(a.id, 'committed')).toBe(0);
    expect(await num(b.id, 'committed')).toBe(500);
    const bill = await ins('admin', 'payables', { title: 'B', status: 'Paid', project_id: a.id, amount: 70, purchase_order_id: po.id });
    expect(await num(a.id, 'actual_material')).toBe(70);
    expect(await num(b.id, 'committed')).toBe(430);
    await t.as('admin', 'update public.payables set project_id = $1, purchase_order_id = null where id = $2', [b.id, bill.id]);
    expect(await num(a.id, 'actual_material')).toBe(0);
    expect(await num(b.id, 'actual_material')).toBe(70);
    expect(await num(b.id, 'committed')).toBe(500);
    const e = await entry(a.id, 9, 'Material');
    await t.as('pm', 'update public.job_cost_entries set project_id = $1 where id = $2', [b.id, e]);
    expect(await num(a.id, 'actual_material')).toBe(0);
    expect(await num(b.id, 'actual_material')).toBe(79);
    expect(await reconcile()).toBe(0);
  });

  it('the triggers leave nothing for the nightly reconcile to find after a mixed day of writes', async () => {
    await reconcile();
    const p = await newProject(5000);
    await budget(p.id, 10, 1000, 1000);
    const c = await card(p.id, 3, 1);
    await decide([c], 'approve');
    const co = await approvedCo(p.id);
    await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co]);
    await approvedCo(p.id, { material_cost: 5 });
    await invoice(p.id, 200);
    const inv = await invoice(p.id, 75);
    await t.as('admin', `update public.invoices set status = 'Paid' where id = $1`, [inv]);
    await ins('admin', 'payables', { title: 'B', status: 'Approved', project_id: p.id, amount: 12 });
    await ins('pm', 'purchase_orders', { title: 'PO', status: 'Received', project_id: p.id, amount: 13 });
    await entry(p.id, -3);
    await t.as('pm', `update public.projects set title = 'Renamed', contract_value = 6000 where id = $1`, [p.id]);
    await t.as('owner', 'update public.employees set hourly_cost = 1 where false');
    expect(await reconcile()).toBe(0);
    const row = await job(p.id);
    expect(row.title).toBe('Renamed');
    expect(Number(row.billed_amount)).toBe(275);
    expect(Number(row.paid_amount)).toBe(67.5); // 75 less the 10% holdback
    await decide([c], 'unapprove');
  });
});

describe('what the pages really ask the database for', () => {
  const ROLES: [U, 'owner' | 'admin' | 'project_manager' | 'foreman' | 'electrician'][] = [['owner', 'owner'], ['admin', 'admin'], ['pm', 'project_manager'], ['foreman', 'foreman'], ['elec', 'electrician']];

  it('every hub tab query runs for every role it is shown to, and the pay columns are never in it', async () => {
    const p = await newProject();
    const c = await card(p.id, 2);
    await decide([c], 'approve');
    for (const [who, role] of ROLES) {
      for (const tab of hubTabs(role)) {
        const mod = getModule(tab.slug)!;
        const columns = listColumns(mod);
        expect(columns, tab.slug).not.toMatch(/hourly_cost|labour_cost/);
        const message = await refused(t.as(who, `select ${columns} from public.${mod.table} where project_id = $1 order by created_at desc, id desc limit 25`, [p.id]));
        expect(message, `${who} on ${tab.slug}`).toBeNull();
      }
    }
    await decide([c], 'unapprove');
  });

  it('the print page columns exist, and no cost column comes back on the proposal itself', async () => {
    const prop = await toProposal(await newEstimate());
    const [row] = await t.as<Row>('pm', 'select * from public.proposals where id = $1', [prop]);
    for (const secret of ['material_unit_cost', 'labour_rate', 'markup_percentage', 'budget', 'cost']) expect(Object.keys(row)).not.toContain(secret);
    await t.as('pm', 'select client_address, labour_rate, markup_percentage, tax_percentage from public.estimates where id = $1', [row.estimate_id]);
    await t.as('pm', 'select id, description, quantity, unit, material_unit_cost, labour_hours_per_unit from public.estimate_items where estimate_id = $1 order by sort', [row.estimate_id]);
  });
});

describe('open questions the builder raised, confirmed as they stand', () => {
  it('crew cannot read contract money on projects, directly or through the balance helper', async () => {
    const p = await newProject(77777);
    expect(await refused(t.as<Row>('elec', 'select contract_value, revised_contract from public.projects where id = $1', [p.id]))).toMatch(/permission denied/);
    await invoice(p.id, 1000);
    expect(await refused(t.as<{ b: string }>('elec', 'select public.project_balance($1) as b', [p.id]))).toMatch(/project manager/);
    const [{ b }] = await t.as<{ b: string }>('pm', 'select public.project_balance($1) as b', [p.id]);
    expect(Number(b)).toBeGreaterThan(0);
  });

  it('a PO stays committed for whatever approved bills have not covered yet', async () => {
    const p = await newProject();
    const po = await ins('pm', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: p.id, amount: 10000 });
    const bill = await ins('admin', 'payables', { title: 'B', status: 'To Approve', project_id: p.id, amount: 100, purchase_order_id: po.id });
    expect(await num(p.id, 'committed')).toBe(10000);
    expect(await num(p.id, 'actual_material')).toBe(0);
    await t.as('admin', `update public.payables set status = 'Approved' where id = $1`, [bill.id]);
    expect(await num(p.id, 'committed')).toBe(9900);
    expect(await num(p.id, 'actual_material')).toBe(100);
    await t.as('admin', 'delete from public.payables where id = $1', [bill.id]);
    expect(await num(p.id, 'committed')).toBe(10000);
  });
});

describe('the nightly job is really scheduled', () => {
  it('vercel.json calls the route, and the route checks the cron secret', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] };
    expect(config.crons.some((c) => c.path === '/api/cron/job-costs')).toBe(true);
    expect(readFileSync('app/api/cron/job-costs/route.ts', 'utf8')).toMatch(/requireCron/);
  });
});

describe('upgrading a database with old rows', () => {
  const OWNER = uid(30);
  const COMPANY = '00000000-0000-4000-8000-000000000300';
  let old: TestDb<never>;
  const q = async (sql: string, params: unknown[] = []) => (await old.pg.query<Row>(sql, params)).rows;
  const oldJob = async (title: string) => (await q(`select j.* from public.job_costing j join public.projects p on p.id = j.project_id where p.title = $1`, [title]))[0];

  beforeAll(async () => {
    const photos = '20261101000100_job_photos_storage.sql';
    old = (await bootDb({}, { include: (f) => f === BASELINE_FILE || f === photos, baselineSql: readFileSync(OLD_BASELINE_FIXTURE, 'utf8') })) as unknown as TestDb<never>;
    await old.pg.exec(`
      insert into auth.users (id, email) values ('${OWNER}', 'owner@old.ca');
      insert into public.companies (id, name, province, subscription_status, trial_ends_at, default_labour_rate) values ('${COMPANY}', 'Old', 'SK', 'active', now() + interval '1 year', 100);
      insert into public.company_users (user_id, company_id, role) values ('${OWNER}', '${COMPANY}', 'owner');
      insert into public.projects (company_id, title, status, contract_value) values
        ('${COMPANY}', 'Typed Job', 'Active', 1000),
        ('${COMPANY}', 'Twice Job', 'Active', 1000),
        ('${COMPANY}', 'Closed Job', 'Complete', 1000),
        ('${COMPANY}', 'Nan Job', 'Active', 1000),
        ('${COMPANY}', 'Nan Contract', 'Active', 'NaN'),
        ('${COMPANY}', 'Negative Job', 'Active', 1000),
        ('${COMPANY}', 'Rowless Job', 'Active', 700);
      insert into public.job_costing (company_id, title, status, budget, actual_cost) values
        ('${COMPANY}', 'Typed Job', 'At Risk', 700, 250),
        ('${COMPANY}', 'Twice Job', 'On Track', 100, 10),
        ('${COMPANY}', 'Closed Job', 'Closed', 10, 9000),
        ('${COMPANY}', 'Nan Job', 'Not a status', 'NaN', 'NaN'),
        ('${COMPANY}', 'Negative Job', 'On Track', -50, -25),
        ('${COMPANY}', 'Never linked', 'On Track', 55, 44);
      insert into public.job_costing (company_id, title, status, budget, actual_cost, created_at) values
        ('${COMPANY}', 'Twice Job', 'On Track', 200, 20, now() + interval '1 hour');
      insert into public.estimates (id, company_id, title, status, total_amount, labour_rate, markup_percentage, tax_percentage) values
        ('00000000-0000-4000-8000-000000000e01', '${COMPANY}', 'Typed lump', 'Submitted', 1234.5, 90, 15, 5),
        ('00000000-0000-4000-8000-000000000e02', '${COMPANY}', 'Stale lines', 'Submitted', 9999, 100, 0, 0),
        ('00000000-0000-4000-8000-000000000e03', '${COMPANY}', 'Nan estimate', 'Draft', 'NaN', 'NaN', null, null),
        ('00000000-0000-4000-8000-000000000e04', '${COMPANY}', 'Nan line', 'Draft', 50, 100, 0, 0),
        ('00000000-0000-4000-8000-000000000e05', '${COMPANY}', 'Empty zero', 'Draft', null, 100, 10, 5);
      insert into public.estimate_items (company_id, estimate_id, description, quantity, material_unit_cost, labour_hours_per_unit) values
        ('${COMPANY}', '00000000-0000-4000-8000-000000000e02', 'Real line', 2, 10, 1),
        ('${COMPANY}', '00000000-0000-4000-8000-000000000e04', 'Bad', 'NaN', 5, 1),
        ('${COMPANY}', '00000000-0000-4000-8000-000000000e04', 'Good', 1, 5, 0);
      insert into public.proposals (company_id, title, status, total_amount) values
        ('${COMPANY}', 'Old typed accepted', 'Accepted', 4321),
        ('${COMPANY}', 'Old nan', 'Draft', 'NaN');
      insert into public.timecards (company_id, title, status, employee_name, work_date, regular_hours, overtime_hours) values
        ('${COMPANY}', 'Old card', 'Approved', 'Old Worker', '2026-01-05', 8, 0);
      insert into public.payables (company_id, title, status, amount) values ('${COMPANY}', 'Old nan bill', 'Approved', 'NaN');
      insert into public.purchase_orders (company_id, title, status, amount) values ('${COMPANY}', 'Old nan PO', 'Issued', 'NaN');
    `);
    for (const f of migrationFiles()) if (f !== BASELINE_FILE && f !== photos) await old.pg.exec(readMigration(f));
  }, 180_000);

  it('a typed budget and actual become the job\'s, and the status comes from the numbers', async () => {
    const row = await oldJob('Typed Job');
    expect(Number(row.budget_other)).toBe(700);
    expect(Number(row.budget)).toBe(700);
    expect(Number(row.actual_cost)).toBe(250);
    expect(row.status).toBe('On Track');
    expect(Number(row.margin)).toBe(750);
    expect(row.rolled_up_at).toBeTruthy();
  });

  it('two old rows on one job keep one link, the older, and lose no typed money', async () => {
    const row = await oldJob('Twice Job');
    expect(Number(row.budget)).toBe(100);
    expect(Number(row.actual_cost)).toBe(10);
    const rows = await q(`select project_id, budget, actual_cost from public.job_costing where title = 'Twice Job' order by budget`);
    expect(rows.length).toBe(2);
    expect(rows[1].project_id).toBeNull();
    expect(Number(rows[1].budget)).toBe(200);
  });

  it('an old Closed row stays Closed and its numbers are kept', async () => {
    const row = await oldJob('Closed Job');
    expect(row.status).toBe('Closed');
    expect(Number(row.actual_cost)).toBe(9000);
  });

  it('[BUG] old NaN anywhere does not reach any job, estimate or proposal number', async () => {
    const poison = await q(`
      select 'job' as w, id::text from public.job_costing where 'NaN'::numeric in (budget, actual_cost, margin, committed, billed_amount, actual_labour, actual_material, actual_other, margin_pct, cost_used_pct)
      union all select 'est', id::text from public.estimates where 'NaN'::numeric in (total_amount, labour_rate, markup_percentage, tax_percentage)
      union all select 'line', id::text from public.estimate_items where 'NaN'::numeric in (quantity, material_unit_cost, labour_hours_per_unit)
      union all select 'proposal', id::text from public.proposals where total_amount = 'NaN'::numeric
      union all select 'project', id::text from public.projects where 'NaN'::numeric in (contract_value, revised_contract)`);
    expect(poison).toEqual([]);
    const row = await oldJob('Nan Contract');
    expect(Number(row.margin)).toBe(0);
    expect(row.status).toBe('On Track');
  });

  it('a negative typed budget does not become the job budget, and a negative typed actual stays as a credit', async () => {
    const row = await oldJob('Negative Job');
    expect(Number(row.budget)).toBe(0);
    expect(Number(row.actual_cost)).toBe(-25);
  });

  it('a project with no old row gets one, a row never linked stays as it was', async () => {
    const row = await oldJob('Rowless Job');
    expect(row).toBeTruthy();
    expect(Number(row.margin)).toBe(700);
    const [never] = await q(`select * from public.job_costing where title = 'Never linked'`);
    expect(never.project_id).toBeNull();
    expect(Number(never.budget)).toBe(55);
    expect(never.rolled_up_at).toBeNull();
  });

  it('estimates: typed lump keeps its price, stale total follows the lines, empty stays zero', async () => {
    const est = async (title: string) => (await q(`select * from public.estimates where title = $1`, [title]))[0];
    expect(Number((await est('Typed lump')).total_amount)).toBe(1234.5);
    expect(Number((await est('Stale lines')).total_amount)).toBe(220);
    expect(Number((await est('Nan estimate')).total_amount)).toBe(0);
    expect(Number((await est('Nan line')).total_amount)).toBe(5);
    expect(Number((await est('Empty zero')).total_amount)).toBe(0);
  });

  it('running the job cost migration again adds no entries, no lines, and changes no money', async () => {
    const snap = async () => JSON.stringify([
      await q('select id, project_id, status, budget, budget_other, actual_cost, margin, cost_used_pct from public.job_costing order by id'),
      await q('select id, amount from public.job_cost_entries order by id'),
      await q('select id, total_amount from public.estimates order by id'),
      await q('select id from public.estimate_items order by id'),
    ]);
    const before = await snap();
    await old.pg.exec(readMigration('20261104000200_job_costing.sql'));
    expect(await snap()).toBe(before);
    const [{ n }] = await q(`select public.reconcile_job_costs('${COMPANY}') as n`);
    expect(Number(n)).toBe(0);
  });

  it('an old typed accepted proposal can still make a project through the button', async () => {
    const [prop] = await q(`select id from public.proposals where title = 'Old typed accepted'`);
    await old.pg.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [OWNER, JSON.stringify({ sub: OWNER, email: 'owner@old.ca' })]);
    await old.pg.exec('set role authenticated');
    let id: string;
    try {
      id = (await old.pg.query<{ id: string }>('select public.create_project_from_proposal($1) as id', [prop.id])).rows[0].id;
    } finally {
      await old.pg.exec('reset role');
    }
    const [p] = await q('select contract_value from public.projects where id = $1', [id]);
    expect(Number(p.contract_value)).toBe(4321);
    const [j] = await q('select * from public.job_costing where project_id = $1', [id]);
    expect(j.status).toBe('On Track');
  });
});
