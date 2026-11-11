// The money loop: estimate totals, conversions, and the job cost rollup in
// 20261104000200_job_costing.sql, as the database itself enforces them.
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { bootDb, readMigration, type TestDb } from './helpers/db';
import { estimateTotals, lineSellPrice } from '@/lib/estimate-math';
import { hubTabs, jobStatus, reconcileAllJobCosts, BudgetSchema, EntrySchema, type JobCost } from '@/lib/job-cost';
import { DETAIL_PAGES } from '@/lib/detail-pages';
import { getModule } from '@/lib/modules';
import { parseRecord } from '@/lib/validation';

const SIGNATURE = 'data:image/png;base64,AAAA';
const users = {
  owner: { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' },
  admin: { id: '00000000-0000-4000-8000-00000000000b', email: 'admin@alpha.ca' },
  pm: { id: '00000000-0000-4000-8000-00000000000c', email: 'pm@alpha.ca' },
  foreman: { id: '00000000-0000-4000-8000-00000000000d', email: 'foreman@alpha.ca' },
  elec: { id: '00000000-0000-4000-8000-00000000000e', email: 'elec@alpha.ca' },
  other: { id: '00000000-0000-4000-8000-00000000000f', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

let t: TestDb<U>;
let company: string;
let otherCompany: string;

const newId = async (who: U, sql: string, params: unknown[] = []) => (await t.as<{ id: string }>(who, sql, params))[0].id;
const newProject = (title: string, contract = 100000) => newId('pm', `insert into public.projects (title, status, contract_value) values ($1, 'Active', $2) returning id`, [title, contract]);
const job = async (project: string) => {
  const [row] = await t.asSystem<Record<string, string | null>>('select * from public.job_costing where project_id = $1', [project]);
  return row;
};
const money = async (project: string, key: string) => Number((await job(project))[key]);
const budget = (project: string, hours: number, labour: number, material: number, other = 0) =>
  t.as('pm', 'select public.set_job_budget($1, $2, $3, $4, $5)', [project, hours, labour, material, other]);
const addEntry = (project: string, category: string, description: string, amount: number) =>
  newId('pm', `insert into public.job_cost_entries (project_id, category, description, amount) values ($1, $2, $3, $4) returning id`, [project, category, description, amount]);

function card(project: string, regular: number, overtime = 0, date = '2026-11-02', name = 'Sam') {
  return newId('pm', `insert into public.timecards (title, status, project_id, employee_name, work_date, regular_hours, overtime_hours) values ('Labour', 'Submitted', $1, $2, $3, $4, $5) returning id`, [project, name, date, regular, overtime]);
}
const decide = (ids: string[], action: string) => t.as('pm', 'select public.decide_timecards($1, $2)', [ids, action]);

beforeAll(async () => {
  t = await bootDb(users);
  company = await t.createCompany('owner', 'Alpha Electric');
  await t.join('owner', 'admin', 'admin');
  await t.join('owner', 'pm', 'project_manager');
  await t.join('owner', 'foreman', 'foreman');
  await t.join('owner', 'elec', 'electrician');
  otherCompany = await t.createCompany('other', 'Bravo Electric', 'AB');
  await t.as('owner', 'update public.companies set default_labour_rate = 100, overtime_multiplier = 1.5, default_markup = 10, default_tax = 5 where id = $1', [company]);
}, 120000);

describe('estimate totals', () => {
  const lines = [
    { description: 'EMT', quantity: 100, unit: 'm', material_unit_cost: 3.15, labour_hours_per_unit: 0.1 },
    { description: 'Panel', quantity: 1, unit: 'ea', material_unit_cost: 900, labour_hours_per_unit: 8 },
  ];
  let estimate: string;
  beforeAll(async () => {
    estimate = await newId('pm', `insert into public.estimates (title, status, labour_rate, markup_percentage, tax_percentage) values ('Totals', 'Draft', 85, 15, 5) returning id`);
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [estimate, JSON.stringify(lines)]);
  });
  const stored = async () => Number((await t.as<{ total_amount: string }>('pm', 'select total_amount from public.estimates where id = $1', [estimate]))[0].total_amount);

  it('works out the total on the server, to the cent of the preview', async () => {
    // Material 315 + 900; labour 18 h x 85 = 1530; +15% = 3156.75; +5% = 3314.59
    expect(await stored()).toBe(3314.59);
    expect(await stored()).toBe(estimateTotals(lines, 85, 15, 5).total);
  });

  it('agrees with the preview on awkward numbers', async () => {
    const awkward = [
      { description: 'a', quantity: 1.005, unit: 'ea', material_unit_cost: 1.15, labour_hours_per_unit: 0.333 },
      { description: 'b', quantity: 3.333, unit: 'ea', material_unit_cost: 19.99, labour_hours_per_unit: 1.125 },
      { description: 'c', quantity: 7, unit: 'ea', material_unit_cost: 0.07, labour_hours_per_unit: 0.015 },
    ];
    const id = await newId('pm', `insert into public.estimates (title, status, labour_rate, markup_percentage, tax_percentage) values ('Awkward', 'Draft', 77.77, 12.5, 11) returning id`);
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [id, JSON.stringify(awkward)]);
    const [row] = await t.as<{ total_amount: string }>('pm', 'select total_amount from public.estimates where id = $1', [id]);
    expect(Number(row.total_amount)).toBe(estimateTotals(awkward, 77.77, 12.5, 11).total);
  });

  it('recomputes on any rate change', async () => {
    await t.as('pm', 'update public.estimates set labour_rate = 100 where id = $1', [estimate]);
    expect(await stored()).toBe(estimateTotals(lines, 100, 15, 5).total);
    await t.as('pm', 'update public.estimates set tax_percentage = 0 where id = $1', [estimate]);
    expect(await stored()).toBe(estimateTotals(lines, 100, 15, 0).total);
    await t.as('pm', 'update public.estimates set markup_percentage = 0 where id = $1', [estimate]);
    expect(await stored()).toBe(estimateTotals(lines, 100, 0, 0).total);
  });

  it('ignores a total sent directly, in the old RPC or in the generic form', async () => {
    const before = await stored();
    await t.as('pm', 'update public.estimates set total_amount = 1 where id = $1', [estimate]);
    expect(await stored()).toBe(before);
    await t.as('pm', `insert into public.estimates (title, status, total_amount) values ('Typed', 'Draft', 999)`);
    const [typed] = await t.as<{ total_amount: string }>('pm', `select total_amount from public.estimates where title = 'Typed'`);
    expect(Number(typed.total_amount)).toBe(0);
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb, 1)', [estimate, JSON.stringify([{ description: 'One', quantity: 1, material_unit_cost: 10 }])]);
    expect(await stored()).toBe(10);
    const parsed = parseRecord(getModule('estimates')!, { title: 'x', total_amount: 5 }, 'create');
    expect(parsed.ok && 'total_amount' in parsed.data).toBe(false);
  });

  it('follows a direct change to a line', async () => {
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [estimate, JSON.stringify([{ description: 'One', quantity: 1, material_unit_cost: 100 }])]);
    expect(await stored()).toBe(100);
    await t.as('pm', 'update public.estimate_items set quantity = 2 where estimate_id = $1', [estimate]);
    expect(await stored()).toBe(200);
    await t.as('pm', 'delete from public.estimate_items where estimate_id = $1', [estimate]);
    expect(await stored()).toBe(0);
  });

  it('refuses a rate that is not a number', async () => {
    expect(await t.fails('pm', `update public.estimates set labour_rate = 'NaN' where id = $1`, [estimate])).toMatch(/real numbers/);
  });

  it('refuses a line that is not a number, however it arrives, and the total stays good', async () => {
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [estimate, JSON.stringify([{ description: 'One', quantity: 1, material_unit_cost: 100 }])]);
    const before = await stored();
    expect(await t.fails('pm', `update public.estimate_items set quantity = 'NaN' where estimate_id = $1`, [estimate])).toMatch(/real numbers/);
    expect(await t.fails('pm', `update public.estimate_items set labour_hours_per_unit = 'NaN' where estimate_id = $1`, [estimate])).toMatch(/real numbers/);
    expect(await t.fails('pm', 'select public.save_estimate_items($1, $2::jsonb)', [estimate, JSON.stringify([{ description: 'Bad', quantity: 'NaN', material_unit_cost: 5 }])])).toMatch(/real numbers/);
    expect(await stored()).toBe(before);
  });
});

describe('estimate to proposal to project', () => {
  let estimate: string;
  let proposal: string;
  const lines = [{ description: 'Panel', quantity: 2, unit: 'ea', material_unit_cost: 1000, labour_hours_per_unit: 10 }];
  const totals = estimateTotals(lines, 80, 25, 5);

  beforeAll(async () => {
    const client = await newId('pm', `insert into public.crm (title, status) values ('Cargill', 'Active Client') returning id`);
    estimate = await newId(
      'pm',
      `insert into public.estimates (title, status, client_id, client_name, client_address, labour_rate, markup_percentage, tax_percentage, scope, terms)
       values ('Unit 3 MCC', 'Submitted', $1, 'Cargill', '1 Plant Rd', 80, 25, 5, 'Replace the MCC', 'Net 30') returning id`,
      [client]
    );
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [estimate, JSON.stringify(lines)]);
  });

  it('makes a draft proposal from the estimate', async () => {
    proposal = (await t.as<{ id: string }>('pm', 'select public.create_proposal_from_estimate($1) as id', [estimate]))[0].id;
    const [p] = await t.as<Record<string, string>>('pm', 'select * from public.proposals where id = $1', [proposal]);
    expect(p).toMatchObject({ estimate_id: estimate, status: 'Draft', client_name: 'Cargill', scope_of_work: 'Replace the MCC', terms: 'Net 30', title: 'Unit 3 MCC' });
    expect(p.client_id).toBeTruthy();
    expect(Number(p.total_amount)).toBe(totals.total);
    expect(p.valid_until).toBeTruthy();
  });

  it('a repeat returns the same proposal and makes nothing new', async () => {
    const again = (await t.as<{ id: string }>('pm', 'select public.create_proposal_from_estimate($1) as id', [estimate]))[0].id;
    expect(again).toBe(proposal);
    expect((await t.as('pm', 'select 1 from public.proposals where estimate_id = $1', [estimate])).length).toBe(1);
  });

  it('a draft proposal follows its estimate, and its total cannot be typed over', async () => {
    await t.as('pm', 'update public.estimates set markup_percentage = 30 where id = $1', [estimate]);
    const read = async () => Number((await t.as<{ total_amount: string }>('pm', 'select total_amount from public.proposals where id = $1', [proposal]))[0].total_amount);
    expect(await read()).toBe(estimateTotals(lines, 80, 30, 5).total);
    await t.as('pm', 'update public.estimates set markup_percentage = 25 where id = $1', [estimate]);
    await t.as('pm', 'update public.proposals set total_amount = 1 where id = $1', [proposal]);
    expect(await read()).toBe(totals.total);
  });

  it('cannot create the project before the proposal is accepted', async () => {
    expect(await t.fails('pm', 'select public.create_project_from_proposal($1)', [proposal])).toMatch(/accepted/);
  });

  it('once sent, the estimate price and lines are locked until it goes back to draft', async () => {
    await t.as('pm', `update public.proposals set status = 'Sent' where id = $1`, [proposal]);
    expect(await t.fails('pm', 'update public.estimates set markup_percentage = 50 where id = $1', [estimate])).toMatch(/with the client/);
    // The same lines again are not a change, and pass: review.usability covers that
    expect(await t.fails('pm', 'select public.save_estimate_items($1, $2::jsonb)', [estimate, JSON.stringify([...lines, { description: 'More', quantity: 1, unit: 'ea', material_unit_cost: 1, labour_hours_per_unit: 0 }])])).toMatch(/with the client/);
    await t.as('pm', `update public.proposals set status = 'Draft' where id = $1`, [proposal]);
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [estimate, JSON.stringify(lines)]);
    await t.as('pm', `update public.proposals set status = 'Sent' where id = $1`, [proposal]);
    await t.as('pm', `update public.proposals set status = 'Accepted' where id = $1`, [proposal]);
  });

  it('makes the project and its job cost row from the accepted proposal, and marks the estimate won', async () => {
    const project = (await t.as<{ id: string }>('pm', 'select public.create_project_from_proposal($1) as id', [proposal]))[0].id;
    const [p] = await t.asSystem<Record<string, string>>('select * from public.projects where id = $1', [project]);
    expect(p).toMatchObject({ title: 'Unit 3 MCC', client_name: 'Cargill', site: '1 Plant Rd', estimate_id: estimate, proposal_id: proposal });
    // Before tax: tax is charged on each invoice, so it can't also be in the contract
    expect(Number(p.contract_value)).toBe(totals.beforeTax);
    const [est] = await t.as<{ status: string; project_id: string }>('pm', 'select status, project_id from public.estimates where id = $1', [estimate]);
    expect(est).toEqual({ status: 'Won', project_id: project });
    const row = await job(project);
    expect(Number(row.budget_material)).toBe(2000);
    expect(Number(row.budget_labour_hours)).toBe(20);
    expect(Number(row.budget_labour)).toBe(1600);
    expect(Number(row.budget)).toBe(3600);
    expect(row.status).toBe('On Track');
  });

  it('a repeat returns the same project and makes nothing new', async () => {
    const [{ id: first }] = await t.as<{ id: string }>('pm', 'select id from public.projects where proposal_id = $1', [proposal]);
    const again = (await t.as<{ id: string }>('pm', 'select public.create_project_from_proposal($1) as id', [proposal]))[0].id;
    expect(again).toBe(first);
    expect((await t.as('pm', 'select 1 from public.projects where proposal_id = $1', [proposal])).length).toBe(1);
    expect((await t.asSystem('select 1 from public.job_costing where project_id = $1', [first])).length).toBe(1);
  });

  it('an accepted proposal with a project stays accepted', async () => {
    expect(await t.fails('pm', `update public.proposals set status = 'Draft' where id = $1`, [proposal])).toMatch(/stays accepted/);
  });

  it('a project can be deleted by an admin, which frees the proposal', async () => {
    const [{ id }] = await t.as<{ id: string }>('pm', 'select id from public.projects where proposal_id = $1', [proposal]);
    await t.as('admin', 'delete from public.projects where id = $1', [id]);
    expect(await job(id)).toBeUndefined();
    const [{ project_id }] = await t.as<{ project_id: string | null }>('pm', 'select project_id from public.proposals where id = $1', [proposal]);
    expect(project_id).toBeNull();
    const fresh = (await t.as<{ id: string }>('pm', 'select public.create_project_from_proposal($1) as id', [proposal]))[0].id;
    expect(fresh).not.toBe(id);
  });

  it('other companies and lower roles cannot convert', async () => {
    expect(await t.fails('other', 'select public.create_proposal_from_estimate($1)', [estimate])).toMatch(/not found/);
    expect(await t.fails('foreman', 'select public.create_proposal_from_estimate($1)', [estimate])).toMatch(/not found/);
    expect(await t.fails('other', 'select public.create_project_from_proposal($1)', [proposal])).toMatch(/not found/);
    expect(await t.fails('foreman', 'select public.create_project_from_proposal($1)', [proposal])).toMatch(/not found/);
    expect(await t.fails(null, 'select public.create_proposal_from_estimate($1)', [estimate])).toMatch(/permission denied/);
  });

  it('a hand-typed proposal keeps its typed total and can still make a project', async () => {
    const id = await newId('pm', `insert into public.proposals (title, status, total_amount, client_name) values ('Typed', 'Accepted', 5000, 'Someone') returning id`);
    const project = (await t.as<{ id: string }>('pm', 'select public.create_project_from_proposal($1) as id', [id]))[0].id;
    const [p] = await t.asSystem<{ contract_value: string; estimate_id: string | null }>('select contract_value, estimate_id from public.projects where id = $1', [project]);
    expect(Number(p.contract_value)).toBe(5000);
    expect(p.estimate_id).toBeNull();
  });
});

describe('what the client has stays what the job gets', () => {
  const line = [{ description: 'Panel', quantity: 1, unit: 'ea', material_unit_cost: 1000, labour_hours_per_unit: 0 }];
  const quote = async (title: string, projectId: string | null = null) => {
    const est = await newId('pm', `insert into public.estimates (title, status, labour_rate, markup_percentage, tax_percentage, project_id) values ($1, 'Submitted', 0, 10, 0, $2) returning id`, [title, projectId]);
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [est, JSON.stringify(line)]);
    const prop = (await t.as<{ id: string }>('pm', 'select public.create_proposal_from_estimate($1) as id', [est]))[0].id;
    return { est, prop };
  };
  const setStatus = (prop: string, status: string) => t.as('pm', 'update public.proposals set status = $2 where id = $1', [prop, status]);

  it('a price input is locked while the proposal is out, other edits are not, and Draft frees it', async () => {
    const { est, prop } = await quote('Lock inputs');
    await setStatus(prop, 'Sent');
    for (const set of ['labour_rate = 50', 'markup_percentage = 0, tax_percentage = 10']) {
      expect(await t.fails('pm', `update public.estimates set ${set} where id = $1`, [est]), set).toMatch(/with the client/);
    }
    // A form re-saving the same numbers, or a blank that means zero, is not a change
    await t.as('pm', `update public.estimates set title = 'Renamed', labour_rate = null, tax_percentage = 0.00 where id = $1`, [est]);
    await setStatus(prop, 'Draft');
    await t.as('pm', 'update public.estimates set markup_percentage = 0, tax_percentage = 10 where id = $1', [est]);
  });

  it('a proposal follows its estimate to a job, in both directions, until it has made a project', async () => {
    const first = await newProject('Follow A', 0);
    const second = await newProject('Follow B', 0);
    const { est, prop } = await quote('Follow');
    const link = async () => (await t.as<{ project_id: string | null }>('pm', 'select project_id from public.proposals where id = $1', [prop]))[0].project_id;
    await t.as('pm', 'update public.estimates set project_id = $2 where id = $1', [est, first]);
    expect(await link()).toBe(first);
    await t.as('pm', 'update public.estimates set project_id = $2 where id = $1', [est, second]);
    expect(await link()).toBe(second);
    await setStatus(prop, 'Accepted');
    expect((await t.as<{ id: string }>('pm', 'select public.create_project_from_proposal($1) as id', [prop]))[0].id).toBe(second);
    await t.as('pm', 'update public.estimates set project_id = $2 where id = $1', [est, first]);
    expect(await link()).toBe(second);
  });

  it('conversion uses a job only the estimate knows about, and the proposal and estimate end up on it', async () => {
    const target = await newProject('Only estimate', 0);
    const { est, prop } = await quote('Only estimate quote');
    await setStatus(prop, 'Accepted');
    // A row from before proposals followed their estimate
    await t.asSystem('alter table public.estimates disable trigger user');
    await t.asSystem('update public.estimates set project_id = $2 where id = $1', [est, target]);
    await t.asSystem('alter table public.estimates enable trigger user');
    expect((await t.as<{ id: string }>('pm', 'select public.create_project_from_proposal($1) as id', [prop]))[0].id).toBe(target);
    expect((await t.as<{ project_id: string }>('pm', 'select project_id from public.proposals where id = $1', [prop]))[0].project_id).toBe(target);
    // A proposal pointed by hand at another job wins, and the estimate comes with it
    const other = await newProject('Picked on proposal', 0);
    const second = await quote('Picked quote', target);
    await t.as('pm', 'update public.proposals set project_id = $2 where id = $1', [second.prop, other]);
    await setStatus(second.prop, 'Accepted');
    expect((await t.as<{ id: string }>('pm', 'select public.create_project_from_proposal($1) as id', [second.prop]))[0].id).toBe(other);
    expect((await t.as<{ project_id: string }>('pm', 'select project_id from public.estimates where id = $1', [second.est]))[0].project_id).toBe(other);
  });

  it('a typed price is free in Draft, and going back to Draft frees it even in the same write', async () => {
    const id = await newId('pm', `insert into public.proposals (title, status, total_amount) values ('Typed lock', 'Draft', 100) returning id`);
    const total = async () => Number((await t.as<{ total_amount: string }>('pm', 'select total_amount from public.proposals where id = $1', [id]))[0].total_amount);
    await t.as('pm', 'update public.proposals set total_amount = 200 where id = $1', [id]);
    await t.as('pm', `update public.proposals set status = 'Sent', total_amount = 300 where id = $1`, [id]);
    expect(await t.fails('pm', 'update public.proposals set total_amount = 1 where id = $1', [id])).toMatch(/with the client/);
    expect(await t.fails('pm', `update public.proposals set status = 'Accepted', total_amount = 1 where id = $1`, [id])).toMatch(/with the client/);
    await t.as('pm', `update public.proposals set title = 'Typed lock renamed' where id = $1`, [id]);
    expect(await total()).toBe(300);
    await t.as('pm', `update public.proposals set status = 'Draft', total_amount = 400 where id = $1`, [id]);
    expect(await total()).toBe(400);
  });

  it('a NaN pay rate is refused, and the upgrade clears an old one and the card that froze it', async () => {
    for (const bad of ['NaN', 'Infinity']) {
      expect(await t.fails('admin', `insert into public.employees (title, status, hourly_cost) values ('Bad', 'Active', $1)`, [bad]), bad).toBeTruthy();
    }
    const employee = await newId('admin', `insert into public.employees (title, status, hourly_cost) values ('Old Pay', 'Active', 40) returning id`);
    expect(await t.fails('admin', `update public.employees set hourly_cost = 'NaN' where id = $1`, [employee])).toBeTruthy();
    const project = await newProject('Old pay job', 10000);
    const id = await card(project, 8, 0, '2026-11-03', 'Old Pay');
    await decide([id], 'approve');
    await t.asSystem('alter table public.employees disable trigger user');
    await t.asSystem('alter table public.timecards disable trigger user');
    await t.asSystem(`update public.employees set hourly_cost = 'NaN' where id = $1`, [employee]);
    await t.asSystem(`update public.timecards set hourly_cost = 'NaN', labour_cost = 'NaN' where id = $1`, [id]);
    await t.asSystem('alter table public.timecards enable trigger user');
    await t.asSystem('alter table public.employees enable trigger user');
    // A frozen NaN doesn't reach the job even before the upgrade clears it
    await t.asService('select public.reconcile_job_costs($1)', [company]);
    expect(await money(project, 'actual_labour')).toBe(0);
    expect(await money(project, 'margin')).toBe(10000);
    await t.pg.exec(readMigration('20261104000200_job_costing.sql'));
    // A later file replaces some of what that one defines, so it runs again too, as it would in order
    await t.pg.exec(readMigration('20261104000310_contract_rules.sql'));
    expect((await t.asSystem<{ hourly_cost: string | null }>('select hourly_cost from public.employees where id = $1', [employee]))[0].hourly_cost).toBeNull();
    // Back on the company rate: 8 h x 100
    expect(Number((await t.asSystem<{ labour_cost: string }>('select labour_cost from public.timecards where id = $1', [id]))[0].labour_cost)).toBe(800);
    expect(await money(project, 'actual_labour')).toBe(800);
  });

  it('new invoice keeps one balance draft at today\'s balance, up and down, with the same number', async () => {
    const project = await newProject('Reprice', 1000);
    const click = async () => (await t.as<{ id: string }>('admin', 'select public.create_invoice_from_project($1) as id', [project]))[0].id;
    const row = async (id: string) => (await t.as<{ amount: string; invoice_number: string; lines: unknown[] }>('admin', 'select amount, invoice_number, lines from public.invoices where id = $1', [id]))[0];
    const id = await click();
    const number = (await row(id)).invoice_number;
    const sent = await newId('admin', `insert into public.invoices (title, status, project_id, lines) values ('Part', 'Draft', $1, '[{"type":"free","description":"Part","amount":1000}]'::jsonb) returning id`, [project]);
    await t.as('admin', `update public.invoices set status = 'Sent' where id = $1`, [sent]);
    // Nothing left to bill: the draft is emptied rather than left billing past the contract
    expect(await click()).toBe(id);
    expect(Number((await row(id)).amount)).toBe(0);
    expect((await row(id)).lines).toEqual([]);
    await t.as('pm', 'update public.projects set contract_value = 1500 where id = $1', [project]);
    expect(await click()).toBe(id);
    expect(Number((await row(id)).amount)).toBe(500);
    expect((await row(id)).invoice_number).toBe(number);
  });

  it('a draw number stays past the highest on the job, and an odd title is not mistaken for one', async () => {
    const project = await newProject('Numbers', 1000);
    const draw = (title: string) => newId('pm', `insert into public.progress_billing (title, status, project_id, amount_billed) values ($1, 'Draft', $2, 1) returning id`, [title, project]);
    await draw('Draw #7');
    await draw('Draw #99999999999999999999');
    await draw('Mobilization');
    const [{ id }] = await t.as<{ id: string }>('pm', 'select public.create_draw_from_project($1) as id', [project]);
    expect((await t.as<{ title: string }>('pm', 'select title from public.progress_billing where id = $1', [id]))[0].title).toBe('Draw #8');
  });
});

describe('printed line prices', () => {
  const line = (quantity: number, material_unit_cost: number, labour_hours_per_unit = 0) => ({ description: 'x', unit: 'ea', quantity, material_unit_cost, labour_hours_per_unit });
  const printed = (lines: ReturnType<typeof line>[], rate: number, markup: number) => {
    const totals = estimateTotals(lines, rate, markup, 5);
    return { totals, each: lines.map((_, i) => lineSellPrice(totals, i, rate)) };
  };
  const added = (each: number[]) => Math.round(each.reduce((s, x) => s + x, 0) * 100) / 100;

  it('add up to the subtotal over awkward lines, and each stays within a cent of its share', () => {
    for (let n = 1; n <= 40; n++) {
      const lines = Array.from({ length: n }, (_, i) => line(1 + (i % 3) / 3, 33.33 + i * 1.07, (i % 4) * 0.125));
      const { totals, each } = printed(lines, 87.5, 12.5);
      expect(added(each), `${n} lines`).toBe(totals.beforeTax);
      const costs = totals.lines.map((l) => l.material + l.hours * 87.5);
      const allCost = costs.reduce((s, c) => s + c, 0);
      each.forEach((x, i) => expect(Math.abs(x - (costs[i] / allCost) * totals.beforeTax)).toBeLessThanOrEqual(0.0101));
    }
  });

  it('a line that costs nothing prints nothing, and an empty estimate is fine', () => {
    const { totals, each } = printed([line(1, 100), line(0, 50), line(1, 0)], 0, 10);
    expect(each).toEqual([110, 0, 0]);
    expect(totals.beforeTax).toBe(110);
    expect(printed([], 100, 10).each).toEqual([]);
  });
});

describe('a quote for a job that already exists', () => {
  const lines = [{ description: 'Panel', quantity: 1, unit: 'ea', material_unit_cost: 1000, labour_hours_per_unit: 10 }];
  // 1000 material + 10 h x 100 = 2000; +10% = 2200 before tax
  const accepted = async (projectId: string, title: string) => {
    const est = await newId('pm', `insert into public.estimates (title, status, labour_rate, markup_percentage, tax_percentage, client_name, client_address, project_id) values ($1, 'Submitted', 100, 10, 5, 'Cargill', '1 Plant Rd', $2) returning id`, [title, projectId]);
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [est, JSON.stringify(lines)]);
    const prop = (await t.as<{ id: string }>('pm', 'select public.create_proposal_from_estimate($1) as id', [est]))[0].id;
    await t.as('pm', `update public.proposals set status = 'Accepted' where id = $1`, [prop]);
    return { est, prop };
  };
  const convert = async (prop: string) => (await t.as<{ id: string }>('pm', 'select public.create_project_from_proposal($1) as id', [prop]))[0].id;
  const projectRow = async (id: string) => (await t.asSystem<Record<string, string | null>>('select * from public.projects where id = $1', [id]))[0];

  it('fills in the contract and budget of a job that has none, and a repeat changes nothing', async () => {
    const id = await newId('pm', `insert into public.projects (title, status) values ('Bare Job', 'Active') returning id`);
    const { est, prop } = await accepted(id, 'Bare quote');
    expect(await convert(prop)).toBe(id);
    const row = await projectRow(id);
    expect(Number(row.contract_value)).toBe(2200);
    expect(row).toMatchObject({ proposal_id: prop, estimate_id: est, client_name: 'Cargill', site: '1 Plant Rd' });
    const costing = await job(id);
    expect(Number(costing.budget_material)).toBe(1000);
    expect(Number(costing.budget_labour)).toBe(1000);
    expect(Number(costing.budget_labour_hours)).toBe(10);
    expect(Number(costing.budget)).toBe(2000);
    expect((await t.as<{ status: string }>('pm', 'select status from public.estimates where id = $1', [est]))[0].status).toBe('Won');

    const before = JSON.stringify([await projectRow(id), await job(id)]);
    expect(await convert(prop)).toBe(id);
    expect(JSON.stringify([await projectRow(id), await job(id)])).toBe(before);
    expect((await t.as('pm', 'select 1 from public.projects where proposal_id = $1', [prop])).length).toBe(1);
    expect(await t.fails('pm', `update public.proposals set status = 'Draft' where id = $1`, [prop])).toMatch(/stays accepted/);
  });

  it('never overwrites a contract or budget someone already set', async () => {
    const id = await newId('pm', `insert into public.projects (title, status, contract_value, site, client_name) values ('Set Job', 'Active', 50000, 'Yard 2', 'Viterra') returning id`);
    await budget(id, 40, 4000, 6000);
    const { est, prop } = await accepted(id, 'Extra work quote');
    expect(await convert(prop)).toBe(id);
    const row = await projectRow(id);
    expect(Number(row.contract_value)).toBe(50000);
    expect(row).toMatchObject({ site: 'Yard 2', client_name: 'Viterra' });
    const costing = await job(id);
    expect(Number(costing.budget_material)).toBe(6000);
    expect(Number(costing.budget_labour_hours)).toBe(40);
    expect((await t.as<{ status: string }>('pm', 'select status from public.estimates where id = $1', [est]))[0].status).toBe('Won');
  });

  it('a second quote on the same job does not take over the first one\'s link', async () => {
    const id = await newId('pm', `insert into public.projects (title, status) values ('Two Quotes', 'Active') returning id`);
    const first = await accepted(id, 'First quote');
    const second = await accepted(id, 'Second quote');
    await convert(first.prop);
    expect(await convert(second.prop)).toBe(id);
    const row = await projectRow(id);
    expect(row.proposal_id).toBe(first.prop);
    expect(Number(row.contract_value)).toBe(2200);
    expect((await t.as<{ status: string }>('pm', 'select status from public.estimates where id = $1', [second.est]))[0].status).toBe('Won');
  });

  it('filling a budget is for a project manager in the same company', async () => {
    const id = await newId('pm', `insert into public.projects (title, status) values ('Guarded', 'Active') returning id`);
    expect(await t.fails('foreman', 'select public.seed_job_budget_from_estimate($1)', [id])).toMatch(/project manager/);
    expect(await t.fails('other', 'select public.seed_job_budget_from_estimate($1)', [id])).toMatch(/not found/);
    expect(await t.fails(null, 'select public.seed_job_budget_from_estimate($1)', [id])).toMatch(/permission denied/);
  });
});

describe('new invoice or draw from a project', () => {
  let project: string;
  beforeAll(async () => {
    project = await newId('pm', `insert into public.projects (title, status, contract_value, client_name) values ('Billing Job', 'Active', 40000, 'Cargill') returning id`);
  });

  it('prefills a draft invoice with the client and balance, and a repeat returns it', async () => {
    const id = (await t.as<{ id: string }>('admin', 'select public.create_invoice_from_project($1) as id', [project]))[0].id;
    const [inv] = await t.as<{ status: string; client_name: string; project_id: string; amount: string; lines: { description: string }[] }>('admin', 'select * from public.invoices where id = $1', [id]);
    expect(inv).toMatchObject({ status: 'Draft', client_name: 'Cargill', project_id: project });
    expect(Number(inv.amount)).toBe(40000);
    expect(inv.lines[0].description).toBe('Balance of contract');
    const again = (await t.as<{ id: string }>('admin', 'select public.create_invoice_from_project($1) as id', [project]))[0].id;
    expect(again).toBe(id);
  });

  it('a draft someone has changed is left alone, and the next click makes a new one', async () => {
    const [{ id }] = await t.as<{ id: string }>('admin', 'select id from public.invoices where project_id = $1', [project]);
    await t.as('admin', `update public.invoices set lines = '[{"type":"free","description":"Mobilization","amount":100}]'::jsonb where id = $1`, [id]);
    const next = (await t.as<{ id: string }>('admin', 'select public.create_invoice_from_project($1) as id', [project]))[0].id;
    expect(next).not.toBe(id);
  });

  it('invoices stay admin-only', async () => {
    expect(await t.fails('pm', 'select public.create_invoice_from_project($1)', [project])).toMatch(/row-level security/);
  });

  it('prefills a draft draw for a project manager, and a repeat returns it', async () => {
    const id = (await t.as<{ id: string }>('pm', 'select public.create_draw_from_project($1) as id', [project]))[0].id;
    const [d] = await t.as<{ title: string; amount_billed: string; project_id: string; status: string }>('pm', 'select * from public.progress_billing where id = $1', [id]);
    expect(d).toMatchObject({ title: 'Draw #1', project_id: project, status: 'Draft' });
    expect(Number(d.amount_billed)).toBe(40000);
    expect((await t.as<{ id: string }>('pm', 'select public.create_draw_from_project($1) as id', [project]))[0].id).toBe(id);
  });

  it('another company cannot', async () => {
    expect(await t.fails('other', 'select public.create_draw_from_project($1)', [project])).toMatch(/not found/);
    expect(await t.fails('other', 'select public.create_invoice_from_project($1)', [project])).toMatch(/not found/);
  });
});

describe('the rollup', () => {
  let project: string;
  beforeAll(async () => {
    project = await newProject('Rollup Job', 100000);
    await budget(project, 100, 10000, 5000);
  });

  it('every project has a row, in the right company', async () => {
    const row = await job(project);
    expect(row.company_id).toBe(company);
    expect(row.status).toBe('On Track');
    expect(Number(row.budget)).toBe(15000);
    expect(Number(row.margin)).toBe(100000);
  });

  describe('labour', () => {
    let id: string;
    it('counts nothing until a card is approved, then its frozen cost with overtime', async () => {
      id = await card(project, 8, 2);
      expect(await money(project, 'actual_labour')).toBe(0);
      await decide([id], 'approve');
      // 8 x 100 + 2 x 100 x 1.5
      expect(await money(project, 'actual_labour')).toBe(1100);
      expect(await money(project, 'actual_labour_hours')).toBe(10);
      expect(await money(project, 'actual_cost')).toBe(1100);
    });

    it("uses the frozen cost, not today's rate", async () => {
      await t.as('owner', 'update public.companies set default_labour_rate = 500 where id = $1', [company]);
      await t.asService('select public.reconcile_job_costs($1)', [company]);
      expect(await money(project, 'actual_labour')).toBe(1100);
      await t.as('owner', 'update public.companies set default_labour_rate = 100 where id = $1', [company]);
    });

    it('an exported card still counts', async () => {
      await t.as('pm', 'select public.export_timecards($1, $2)', ['2026-11-02', '2026-11-02']);
      expect(await money(project, 'actual_labour')).toBe(1100);
      await decide([id], 'reopen');
      expect(await money(project, 'actual_labour')).toBe(1100);
    });

    it('un-approving and deleting take it back out', async () => {
      await decide([id], 'unapprove');
      expect(await money(project, 'actual_labour')).toBe(0);
      await decide([id], 'approve');
      expect(await money(project, 'actual_labour')).toBe(1100);
      await decide([id], 'unapprove');
      await t.as('pm', 'delete from public.timecards where id = $1', [id]);
      expect(await money(project, 'actual_labour')).toBe(0);
      expect(await money(project, 'actual_labour_hours')).toBe(0);
    });

    it('moving a card between projects recalculates both', async () => {
      const second = await newProject('Second Job', 1000);
      const moved = await card(project, 10, 0, '2026-11-03');
      await decide([moved], 'approve');
      expect(await money(project, 'actual_labour')).toBe(1000);
      await decide([moved], 'unapprove');
      await t.as('pm', 'update public.timecards set project_id = $1 where id = $2', [second, moved]);
      await decide([moved], 'approve');
      expect(await money(project, 'actual_labour')).toBe(0);
      expect(await money(second, 'actual_labour')).toBe(1000);
      // The server's service role can move an approved card in one write
      await t.asService('update public.timecards set project_id = $1 where id = $2', [project, moved]);
      expect(await money(project, 'actual_labour')).toBe(1000);
      expect(await money(second, 'actual_labour')).toBe(0);
      await decide([moved], 'unapprove');
      await t.as('pm', 'delete from public.timecards where id = $1', [moved]);
    });
  });

  describe('material and commitments', () => {
    it('counts bills once approved or paid, and takes them back out', async () => {
      const bill = await newId('admin', `insert into public.payables (title, status, project_id, amount) values ('Westburne', 'To Approve', $1, 2000) returning id`, [project]);
      expect(await money(project, 'actual_material')).toBe(0);
      await t.as('admin', `update public.payables set status = 'Approved' where id = $1`, [bill]);
      expect(await money(project, 'actual_material')).toBe(2000);
      await t.as('admin', `update public.payables set status = 'Paid' where id = $1`, [bill]);
      expect(await money(project, 'actual_material')).toBe(2000);
      await t.as('admin', `update public.payables set status = 'To Approve' where id = $1`, [bill]);
      expect(await money(project, 'actual_material')).toBe(0);
      await t.as('admin', `update public.payables set status = 'Approved' where id = $1`, [bill]);
      await t.as('admin', 'delete from public.payables where id = $1', [bill]);
      expect(await money(project, 'actual_material')).toBe(0);
    });

    it('counts a PO as committed until a bill is matched to it', async () => {
      const po = await newId('pm', `insert into public.purchase_orders (title, status, project_id, amount) values ('PO-1', 'Draft', $1, 3000) returning id`, [project]);
      expect(await money(project, 'committed')).toBe(0);
      await t.as('pm', `update public.purchase_orders set status = 'Issued' where id = $1`, [po]);
      expect(await money(project, 'committed')).toBe(3000);
      const bill = await newId('admin', `insert into public.payables (title, status, project_id, amount, purchase_order_id) values ('Against PO', 'Approved', $1, 3100, $2) returning id`, [project, po]);
      expect(await money(project, 'committed')).toBe(0);
      expect(await money(project, 'actual_material')).toBe(3100);
      await t.as('admin', 'delete from public.payables where id = $1', [bill]);
      expect(await money(project, 'committed')).toBe(3000);
      await t.as('pm', `update public.purchase_orders set status = 'Closed' where id = $1`, [po]);
      expect(await money(project, 'committed')).toBe(0);
      await t.as('pm', 'delete from public.purchase_orders where id = $1', [po]);
    });

    it('a bill on one job matched to a PO on another moves both', async () => {
      const second = await newProject('PO Job', 1000);
      const po = await newId('pm', `insert into public.purchase_orders (title, status, project_id, amount) values ('PO-2', 'Issued', $1, 700) returning id`, [second]);
      expect(await money(second, 'committed')).toBe(700);
      const bill = await newId('admin', `insert into public.payables (title, status, project_id, amount, purchase_order_id) values ('Crossed', 'Approved', $1, 700, $2) returning id`, [project, po]);
      expect(await money(second, 'committed')).toBe(0);
      await t.as('admin', 'delete from public.payables where id = $1', [bill]);
      expect(await money(second, 'committed')).toBe(700);
    });

    it('ignores a NaN amount instead of poisoning the totals', async () => {
      const bill = await newId('admin', `insert into public.payables (title, status, project_id, amount) values ('Bad', 'Approved', $1, 'NaN') returning id`, [project]);
      expect(await money(project, 'actual_material')).toBe(0);
      await t.as('admin', 'delete from public.payables where id = $1', [bill]);
    });
  });

  describe('manual entries', () => {
    it('adds by category, a negative is a credit, and undo takes it out', async () => {
      const material = await addEntry(project, 'Material', 'Local wire', 500);
      const rental = await addEntry(project, 'Equipment', 'Boom lift', 1200);
      const credit = await addEntry(project, 'Equipment', 'Rental credit', -200);
      expect(await money(project, 'actual_material')).toBe(500);
      expect(await money(project, 'actual_other')).toBe(1000);
      expect(await money(project, 'actual_cost')).toBe(1500);
      const [rollup] = (await t.as<{ r: JobCost[] }>('pm', 'select public.job_cost_rollup($1) as r', [project]))[0].r;
      expect(rollup.entries).toEqual({ Material: 500, Equipment: 1000 });
      await t.as('pm', 'update public.job_cost_entries set amount = 300 where id = $1', [material]);
      expect(await money(project, 'actual_material')).toBe(300);
      await t.as('pm', 'delete from public.job_cost_entries where id = any($1)', [[material, rental, credit]]);
      expect(await money(project, 'actual_cost')).toBe(0);
    });

    it("refuses bad entries, and an entry on another company's project", async () => {
      const foreign = await newId('other', `insert into public.projects (title, status) values ('Foreign', 'Active') returning id`);
      const insert = `insert into public.job_cost_entries (project_id, category, description, amount) values ($1, $2, $3, $4)`;
      expect(await t.fails('pm', insert, [foreign, 'Other', 'x', 10])).toMatch(/could not be found/);
      expect(await t.fails('pm', insert, [project, 'Other', 'x', 0])).toMatch(/Enter an amount/);
      expect(await t.fails('pm', insert, [project, 'Other', 'x', 'NaN'])).toMatch(/Enter an amount/);
      expect(await t.fails('pm', insert, [project, 'Other', '   ', 10])).toBeTruthy();
      expect(await t.fails('pm', insert, [project, 'Fuel', 'x', 10])).toMatch(/check constraint/);
      expect(await t.fails('foreman', insert, [project, 'Other', 'x', 10])).toMatch(/row-level security/);
    });

    it('stops the project being deleted while entries are on it', async () => {
      const second = await newProject('Entry Job', 1000);
      const entry = await addEntry(second, 'Other', 'Kept', 10);
      expect(await t.fails('admin', 'delete from public.projects where id = $1', [second])).toMatch(/foreign key/);
      await t.as('pm', 'delete from public.job_cost_entries where id = $1', [entry]);
      await t.as('admin', 'delete from public.projects where id = $1', [second]);
    });
  });

  describe('change orders', () => {
    it('approved revenue and cost move the contract and the budget, and reopening takes them back', async () => {
      const co = await newId('pm', `insert into public.change_orders (title, status, project_id, material_cost, labour_hours, labour_rate, markup_pct, tax_pct) values ('Add VFDs', 'Draft', $1, 1000, 10, 120, 20, 5) returning id`, [project]);
      expect(await money(project, 'co_revenue')).toBe(0);
      const before = await money(project, 'budget');
      await t.as('pm', `update public.change_orders set status = 'Sent' where id = $1`, [co]);
      await t.as('pm', `update public.change_orders set status = 'Approved', approved_by = 'Client', signature = $2 where id = $1`, [co, SIGNATURE]);
      // Price: (1000 + 10 x 120) x 1.2. Cost side at the company's rate: 1000 + 10 x 100.
      expect(await money(project, 'co_revenue')).toBe(2640);
      expect(await money(project, 'co_cost')).toBe(2000);
      expect(await money(project, 'co_labour_hours')).toBe(10);
      expect(await money(project, 'budget')).toBe(before + 2000);
      expect(await money(project, 'margin')).toBe(102640);
      await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co]);
      expect(await money(project, 'co_revenue')).toBe(0);
      expect(await money(project, 'budget')).toBe(before);
      expect(await money(project, 'margin')).toBe(100000);
      await t.as('pm', 'delete from public.change_orders where id = $1', [co]);
    });
  });

  describe('billing', () => {
    it('billed counts once sent, paid once paid, before tax, and a void takes it back out', async () => {
      const inv = await newId('admin', `insert into public.invoices (title, status, project_id, tax_pct, holdback_pct, lines) values ('Draw', 'Draft', $1, 5, 10, '[{"type":"free","description":"Work","amount":10000}]'::jsonb) returning id`, [project]);
      expect(await money(project, 'billed_amount')).toBe(0);
      await t.as('admin', `update public.invoices set status = 'Sent' where id = $1`, [inv]);
      expect(await money(project, 'billed_amount')).toBe(10000);
      expect(await money(project, 'paid_amount')).toBe(0);
      await t.as('admin', `update public.invoices set status = 'Paid' where id = $1`, [inv]);
      expect(await money(project, 'paid_amount')).toBe(10000);
      await t.as('admin', `update public.invoices set status = 'Sent' where id = $1`, [inv]);
      expect(await money(project, 'paid_amount')).toBe(0);
      await t.as('admin', `update public.invoices set status = 'Void' where id = $1`, [inv]);
      expect(await money(project, 'billed_amount')).toBe(0);
    });

    it('a sent invoice stays counted because it cannot be deleted, and deleting a draft moves nothing', async () => {
      const inv = await newId('admin', `insert into public.invoices (title, status, project_id, lines) values ('Kept', 'Draft', $1, '[{"type":"free","description":"Work","amount":700}]'::jsonb) returning id`, [project]);
      await t.as('admin', `update public.invoices set status = 'Sent' where id = $1`, [inv]);
      expect(await money(project, 'billed_amount')).toBe(700);
      expect(await t.fails('admin', 'delete from public.invoices where id = $1', [inv])).toMatch(/Only a draft/);
      expect(await money(project, 'billed_amount')).toBe(700);
      await t.as('admin', `update public.invoices set status = 'Void' where id = $1`, [inv]);
      expect(await money(project, 'billed_amount')).toBe(0);
      const draft = await newId('admin', `insert into public.invoices (title, status, project_id, lines) values ('Draft', 'Draft', $1, '[{"type":"free","description":"Work","amount":50}]'::jsonb) returning id`, [project]);
      await t.as('admin', 'delete from public.invoices where id = $1', [draft]);
      expect(await money(project, 'billed_amount')).toBe(0);
    });
  });

  describe('status', () => {
    it('follows the thresholds, and a zero budget stays on track', async () => {
      const id = await newProject('Status Job', 10000);
      const first = await addEntry(id, 'Other', 'Spend', 5000);
      expect((await job(id)).status).toBe('On Track');
      await budget(id, 0, 0, 10000);
      expect(Number((await job(id)).cost_used_pct)).toBe(50);
      expect((await job(id)).status).toBe('On Track');
      await t.as('pm', 'update public.job_cost_entries set amount = 8499 where id = $1', [first]);
      expect((await job(id)).status).toBe('On Track');
      await t.as('pm', 'update public.job_cost_entries set amount = 8500 where id = $1', [first]);
      expect((await job(id)).status).toBe('At Risk');
      await t.as('pm', 'update public.job_cost_entries set amount = 9999.99 where id = $1', [first]);
      expect((await job(id)).status).toBe('At Risk');
      await t.as('pm', 'update public.job_cost_entries set amount = 10000 where id = $1', [first]);
      expect((await job(id)).status).toBe('Over Budget');
      await budget(id, 0, 0, 0);
      expect((await job(id)).status).toBe('On Track');
      expect((await job(id)).cost_used_pct).toBeNull();
    });

    it('Closed never changes until someone reopens it, and the numbers stay right', async () => {
      const id = await newProject('Closed Job', 10000);
      await budget(id, 0, 0, 100);
      await t.as('pm', 'select public.set_job_closed($1, true)', [id]);
      expect((await job(id)).status).toBe('Closed');
      await addEntry(id, 'Other', 'Late bill', 500);
      await t.asService('select public.reconcile_job_costs($1)', [company]);
      expect((await job(id)).status).toBe('Closed');
      expect(await money(id, 'actual_cost')).toBe(500);
      await t.as('pm', 'select public.set_job_closed($1, false)', [id]);
      expect((await job(id)).status).toBe('Over Budget');
    });

    it('the browser preview uses the same thresholds', () => {
      expect(jobStatus(0, 0, 'On Track')).toBe('On Track');
      expect(jobStatus(500, null, 'At Risk')).toBe('On Track');
      expect(jobStatus(84.99, 100, 'On Track')).toBe('On Track');
      expect(jobStatus(85, 100, 'On Track')).toBe('At Risk');
      expect(jobStatus(100, 100, 'On Track')).toBe('Over Budget');
      expect(jobStatus(100, 100, 'Closed')).toBe('Closed');
    });
  });

  describe('reconcile', () => {
    it('re-running changes nothing', async () => {
      const snapshot = async () => JSON.stringify(await t.asSystem('select * from public.job_costing order by id'));
      await t.asService('select public.reconcile_job_costs($1)', [company]);
      const before = await snapshot();
      const [{ changed }] = await t.asService<{ changed: number }>('select public.reconcile_job_costs($1) as changed', [company]);
      expect(changed).toBe(0);
      expect(await snapshot()).toBe(before);
    });

    it('repairs drift, however it got there', async () => {
      await t.asSystem('update public.job_costing set actual_cost = 123456, margin = -1 where project_id = $1', [project]);
      const [{ changed }] = await t.asService<{ changed: number }>('select public.reconcile_job_costs($1) as changed', [company]);
      expect(changed).toBe(1);
      expect(await money(project, 'actual_cost')).toBe(0);
    });

    it('recreates a missing row', async () => {
      const id = await newProject('Lost Row', 500);
      await t.asSystem('alter table public.job_costing disable trigger user');
      await t.asSystem('delete from public.job_costing where project_id = $1', [id]);
      await t.asSystem('alter table public.job_costing enable trigger user');
      await t.asService('select public.reconcile_job_costs($1)', [company]);
      expect((await job(id)).title).toBe('Lost Row');
    });

    it('is not open to signed-in users or visitors', async () => {
      expect(await t.fails('owner', 'select public.reconcile_job_costs($1)', [company])).toMatch(/permission denied/);
      expect(await t.fails(null, 'select public.reconcile_job_costs($1)', [company])).toMatch(/permission denied/);
    });
  });

  describe('who sees what', () => {
    let spend: string;
    beforeAll(async () => {
      spend = await newId('admin', `insert into public.payables (title, status, project_id, amount) values ('Private bill', 'Paid', $1, 4321) returning id`, [project]);
    });

    it('a project manager sees correct totals despite not reading payables row by row', async () => {
      expect(await t.as('pm', 'select id from public.payables where id = $1', [spend])).toEqual([]);
      const [row] = (await t.as<{ r: JobCost[] }>('pm', 'select public.job_cost_rollup($1) as r', [project]))[0].r;
      expect(Number(row.actual_material)).toBe(4321);
      expect(Number(row.actual_cost)).toBe(4321);
      expect(row.project_title).toBe('Rollup Job');
      expect(Number(row.revised_contract)).toBe(100000);
      expect(Number(row.margin)).toBe(95679);
      expect(Number(row.margin_pct)).toBe(95.68);
    });

    it("a project manager still cannot read a card's pay directly", async () => {
      expect(await t.fails('pm', 'select labour_cost from public.timecards limit 1')).toMatch(/permission denied/);
    });

    it('lists every job when asked for none in particular', async () => {
      const rows = (await t.as<{ r: JobCost[] }>('pm', 'select public.job_cost_rollup() as r'))[0].r;
      expect(rows.some((r) => r.project_id === project)).toBe(true);
      expect(rows.every((r) => r.company_id === company)).toBe(true);
    });

    it('a foreman and an electrician get refused', async () => {
      for (const who of ['foreman', 'elec'] as const) {
        expect(await t.fails(who, 'select public.job_cost_rollup($1)', [project])).toMatch(/project manager/);
        expect(await t.fails(who, 'select public.job_cost_rollup()')).toMatch(/project manager/);
        expect(await t.as(who, 'select * from public.job_costing')).toEqual([]);
        expect(await t.as(who, 'select * from public.job_cost_entries')).toEqual([]);
        expect(await t.fails(who, 'select public.set_job_budget($1, 1, 1, 1, 1)', [project])).toMatch(/project manager/);
        expect(await t.fails(who, 'select public.set_job_closed($1, true)', [project])).toMatch(/project manager/);
      }
      expect(await t.fails(null, 'select public.job_cost_rollup()')).toMatch(/permission denied/);
    });

    it('another tenant sees nothing', async () => {
      expect((await t.as<{ r: JobCost[] }>('other', 'select public.job_cost_rollup($1) as r', [project]))[0].r).toEqual([]);
      const theirs = (await t.as<{ r: JobCost[] }>('other', 'select public.job_cost_rollup() as r'))[0].r;
      expect(theirs.every((r) => r.company_id === otherCompany)).toBe(true);
      expect(await t.as('other', 'select * from public.job_costing where project_id = $1', [project])).toEqual([]);
      expect(await t.fails('other', 'select public.set_job_budget($1, 1, 1, 1, 1)', [project])).toMatch(/not found/);
      expect(await t.fails('other', 'select public.set_job_closed($1, true)', [project])).toMatch(/not found/);
    });

    it('nobody signed in can write the numbers, not even the owner', async () => {
      expect(await t.fails('owner', 'update public.job_costing set actual_cost = 1 where project_id = $1', [project])).toMatch(/permission denied/);
      expect(await t.fails('owner', 'update public.job_costing set status = $2 where project_id = $1', [project, 'Closed'])).toMatch(/permission denied/);
      expect(await t.fails('owner', `insert into public.job_costing (title, status) values ('x', 'On Track')`)).toMatch(/permission denied/);
    });

    it('a linked row cannot be deleted out from under its project, but an old unlinked one can', async () => {
      expect(await t.fails('owner', 'delete from public.job_costing where project_id = $1', [project])).toMatch(/follows its project/);
      const [{ id }] = await t.asSystem<{ id: string }>(`insert into public.job_costing (company_id, title, status, budget, actual_cost) values ($1, 'Old typed job', 'On Track', 900, 100) returning id`, [company]);
      await t.as('admin', 'delete from public.job_costing where id = $1', [id]);
    });

    it('a lapsed company is read-only here too', async () => {
      await t.setLapsed(company, true);
      expect(await t.fails('pm', 'select public.set_job_budget($1, 1, 1, 1, 1)', [project])).toMatch(/ended/);
      expect(await t.fails('pm', 'select public.set_job_closed($1, true)', [project])).toMatch(/ended/);
      expect(await t.fails('pm', `insert into public.job_cost_entries (project_id, category, description, amount) values ($1, 'Other', 'x', 10)`, [project])).toMatch(/row-level security/);
      // Reading still works
      expect((await t.as<{ r: JobCost[] }>('pm', 'select public.job_cost_rollup($1) as r', [project]))[0].r.length).toBe(1);
      await t.setLapsed(company, false);
    });
  });
});

describe('upgrading old rows', () => {
  // The migration again, over rows the old app left, as a live database would have them.
  it('keeps typed money and is safe to run twice', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/20261104000200_job_costing.sql', 'utf8');
    const id = await newProject('Old Job', 1000);
    await t.asSystem(`update public.job_costing set rolled_up_at = null, budget = 700, actual_cost = 250, budget_other = 0 where project_id = $1`, [id]);
    const lump = await newId('pm', `insert into public.estimates (title, status, markup_percentage, tax_percentage) values ('Old lump', 'Draft', 15, 5) returning id`);
    await t.asSystem('alter table public.estimates disable trigger user');
    await t.asSystem('update public.estimates set total_amount = 1234.5 where id = $1', [lump]);
    await t.asSystem('alter table public.estimates enable trigger user');
    await t.pg.exec(sql);
    await t.pg.exec(sql);
    const row = await job(id);
    expect(Number(row.budget)).toBe(700);
    expect(Number(row.actual_cost)).toBe(250);
    const entries = await t.asSystem('select 1 from public.job_cost_entries where project_id = $1', [id]);
    expect(entries.length).toBe(1);
    const [est] = await t.asSystem<{ total_amount: string }>('select total_amount from public.estimates where id = $1', [lump]);
    expect(Number(est.total_amount)).toBe(1234.5);
    expect((await t.asSystem('select 1 from public.estimate_items where estimate_id = $1', [lump])).length).toBe(1);
  });
});

describe('the nightly job', () => {
  const fakeAdmin = (ids: string[], failFor?: string) => {
    const rpc = vi.fn(async (_name: string, args: { p_company: string }) => (args.p_company === failFor ? { data: null, error: { message: 'boom' } } : { data: 2, error: null }));
    const query = { select: () => query, order: () => query, limit: () => query, gt: () => query, then: (done: (v: unknown) => unknown) => done({ data: ids, error: null }) };
    return { admin: { from: () => query, rpc } as unknown as SupabaseClient, rpc };
  };

  it('runs every company, and one failing does not stop the rest', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin, rpc } = fakeAdmin([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as unknown as string[], 'b');
    expect(await reconcileAllJobCosts(admin)).toEqual({ companies: 3, changed: 4, failed: 1, outOfTime: false });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith('reconcile_job_costs', { p_company: 'c' });
    spy.mockRestore();
  });

  it('stops in time to answer', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin, rpc } = fakeAdmin([{ id: 'a' }, { id: 'b' }] as unknown as string[]);
    let clock = 0;
    const summary = await reconcileAllJobCosts(admin, 10, () => (clock += 8));
    expect(summary.outOfTime).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('really runs the database function as the service role', async () => {
    const [{ changed }] = await t.asService<{ changed: number }>('select public.reconcile_job_costs($1) as changed', [company]);
    expect(changed).toBe(0);
  });
});

describe('the page rules', () => {
  it('registers the detail pages', () => {
    expect(DETAIL_PAGES.projects).toBe('/projects');
    expect(DETAIL_PAGES.proposals).toBe('/proposals');
  });

  it('shows each role only the tabs it can read', () => {
    const slugs = (role: 'owner' | 'project_manager' | 'foreman' | 'electrician') => hubTabs(role).map((tab) => tab.slug as string);
    expect(slugs('owner')).toContain('invoices');
    expect(slugs('project_manager')).not.toContain('invoices');
    expect(slugs('foreman')).toContain('change-orders');
    expect(slugs('electrician')).not.toContain('change-orders');
    expect(slugs('electrician')).toContain('timecards');
    for (const slug of ['rfis', 'change-orders', 'submittals', 'drawings', 'daily-logs', 'timecards', 'invoices', 'punch-list']) expect(slugs('owner')).toContain(slug);
  });

  it('validates budgets and entries', () => {
    expect(BudgetSchema.safeParse({ hours: '10', labour: '', material: '2000.555', other: 0 }).success).toBe(true);
    expect(BudgetSchema.safeParse({ hours: -1, labour: 0, material: 0, other: 0 }).success).toBe(false);
    const good = EntrySchema.safeParse({ category: 'Equipment', description: ' Lift ', amount: '-200.005', entry_date: '2026-11-04' });
    expect(good.success && good.data).toMatchObject({ description: 'Lift', amount: -200.01 });
    expect(EntrySchema.safeParse({ category: 'Fuel', description: 'x', amount: 1, entry_date: '2026-11-04' }).success).toBe(false);
    expect(EntrySchema.safeParse({ category: 'Other', description: 'x', amount: 0, entry_date: '2026-11-04' }).success).toBe(false);
    expect(EntrySchema.safeParse({ category: 'Other', description: '', amount: 1, entry_date: '2026-11-04' }).success).toBe(false);
    expect(EntrySchema.safeParse({ category: 'Other', description: 'x', amount: 1, entry_date: '2026-02-31' }).success).toBe(false);
  });
});
