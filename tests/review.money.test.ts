// Adversarial review of money across the engines, on PGlite. One job is walked through the whole
// loop: estimate > proposal > project > timecards and change orders > draws and invoices > payables
// and POs > job cost, and every total is checked against the rollup, the dashboard and the sums the
// printed documents use. Tests named [BUG] are reproduced defects and stay failing for the fixer.
import { beforeAll, describe, expect, it } from 'vitest';
import { bootDb, type TestDb } from './helpers/db';
import { changeOrderTotals, invoiceTotals } from '@/lib/billing-math';
import { summariseJobs } from '@/lib/dashboard';
import { estimateTotals } from '@/lib/estimate-math';
import type { JobCost } from '@/lib/job-cost';
import { getModule } from '@/lib/modules';

const uid = (n: number) => `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`;
const USERS = {
  walker: { id: uid(1), email: 'walker@walk.ca' },
  owner: { id: uid(2), email: 'owner@alpha.ca' },
  lapsed: { id: uid(3), email: 'owner@lapsed.ca' },
};
type U = keyof typeof USERS;
type Row = Record<string, any>;

const SIG = 'data:image/png;base64,AAAA';
const LINES = [{ description: 'Panel', quantity: 2, unit: 'ea', material_unit_cost: 1000, labour_hours_per_unit: 10 }];
let t: TestDb<U>;
let today: string;

async function ins(who: U, table: string, row: Row): Promise<Row> {
  const keys = Object.keys(row);
  const [r] = await t.as<Row>(who, `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(row));
  return get(table, r.id);
}
const get = async (table: string, id: string) => (await t.asSystem<Row>(`select * from public.${table} where id = $1`, [id]))[0];
const job = async (project: string) => (await t.asSystem<Row>('select * from public.job_costing where project_id = $1', [project]))[0];
const setStatus = (who: U, table: string, id: string, status: string) => t.as(who, `update public.${table} set status = $2 where id = $1`, [id, status]);
const free = (amount: number, description = 'Work') => ({ type: 'free', description, amount });

async function quoteToProject(who: U, overEstimate: Row = {}): Promise<{ estimate: string; proposal: string; project: string }> {
  const est = await ins(who, 'estimates', { title: 'Plant job', status: 'Submitted', labour_rate: 80, markup_percentage: 25, tax_percentage: 5, client_name: 'Cargill', client_address: '1 Plant Rd', ...overEstimate });
  await t.as(who, 'select public.save_estimate_items($1, $2::jsonb)', [est.id, JSON.stringify(LINES)]);
  const [{ id: proposal }] = await t.as<{ id: string }>(who, 'select public.create_proposal_from_estimate($1) as id', [est.id]);
  await setStatus(who, 'proposals', proposal, 'Sent');
  await setStatus(who, 'proposals', proposal, 'Accepted');
  const [{ id: project }] = await t.as<{ id: string }>(who, 'select public.create_project_from_proposal($1) as id', [proposal]);
  await setStatus(who, 'projects', project, 'Active');
  return { estimate: est.id, proposal, project };
}
const newProject = async (who: U, contract: number) => (await ins(who, 'projects', { title: 'Job', status: 'Active', contract_value: contract, client_name: 'Cargill' })).id as string;

async function approvedCo(who: U, project: string, over: Row = {}) {
  const co = await ins(who, 'change_orders', { title: 'Add VFD', status: 'Draft', project_id: project, material_cost: 1000, labour_hours: 10, labour_rate: 120, markup_pct: 20, tax_pct: 5, ...over });
  await setStatus(who, 'change_orders', co.id, 'Sent');
  await t.as(who, `update public.change_orders set status = 'Approved', approved_by = 'Client', signature = $2 where id = $1`, [co.id, SIG]);
  return co.id as string;
}
const invoice = (who: U, project: string | null, lines: unknown[], over: Row = {}) =>
  ins(who, 'invoices', { title: 'INV', status: 'Draft', project_id: project, tax_pct: 5, holdback_pct: 10, lines: JSON.stringify(lines), ...over });
const send = (who: U, id: string) => setStatus(who, 'invoices', id, 'Sent');
const figures = async (who: U) => (await t.as<{ f: Row }>(who, 'select public.dashboard_figures($1, $2) as f', [today, 'America/Regina']))[0].f;
const rollup = async (who: U, project?: string) => (await t.as<{ r: JobCost[] }>(who, 'select public.job_cost_rollup($1) as r', [project ?? null]))[0].r;

beforeAll(async () => {
  t = await bootDb(USERS);
  today = (await t.asSystem<{ d: string }>(`select current_date::text as d`))[0].d;
  await t.createCompany('walker', 'Walk');
  await t.createCompany('owner', 'Alpha');
  await t.createCompany('lapsed', 'Lapsed');
  for (const who of ['walker', 'owner', 'lapsed'] as const) {
    await t.as(who, 'update public.companies set default_labour_rate = 100, overtime_multiplier = 1.5, default_markup = 10, default_tax = 5, default_holdback_pct = 10 where id = public.user_company_id()');
  }
}, 180_000);

describe('one job through the whole loop', () => {
  it('every total agrees between the database, the rollup, the dashboard and the printed sums, and every reversal undoes itself', async () => {
    const who = 'walker';
    const { estimate, proposal, project } = await quoteToProject(who);

    // Estimate and proposal: what prints is what is stored
    const printed = estimateTotals(LINES, 80, 25, 5);
    expect(Number((await get('estimates', estimate)).total_amount)).toBe(4725);
    expect(printed.total).toBe(4725);
    expect(printed.sell.reduce((s, x) => s + x, 0)).toBe(printed.beforeTax);
    expect(Number((await get('proposals', proposal)).total_amount)).toBe(printed.total);

    // Project: contract is the price before tax, budget is the cost
    const p = await get('projects', project);
    expect(Number(p.contract_value)).toBe(printed.beforeTax);
    expect(Number((await job(project)).budget)).toBe(3600);

    // Timecard: 8 + 2 OT at the company's 100
    const [card] = await t.as<{ id: string }>(who, `insert into public.timecards (title, status, project_id, employee_name, work_date, regular_hours, overtime_hours)
      values ('Labour', 'Submitted', $1, 'Sam', $2, 8, 2) returning id`, [project, today]);
    await t.as(who, `select public.decide_timecards($1, 'approve')`, [[card.id]]);
    expect(Number((await job(project)).actual_labour)).toBe(1100);

    // Change order: price is revenue, budget_cost is at the company's rate
    const co = await approvedCo(who, project);
    const coPrinted = changeOrderTotals({ material_cost: 1000, labour_hours: 10, labour_rate: 120, markup_pct: 20, tax_pct: 5 });
    const coRow = await get('change_orders', co);
    expect(Number(coRow.price)).toBe(coPrinted.price);
    expect(Number(coRow.total)).toBe(coPrinted.total);
    expect(Number((await get('projects', project)).revised_contract)).toBe(4500 + coPrinted.price);
    expect(Number((await job(project)).budget)).toBe(3600 + 2000);

    // Invoice: half the contract and the change order
    const inv = await invoice(who, project, [{ type: 'percent', percent: 50 }, { type: 'change_order', change_order_id: co }]);
    await send(who, inv.id);
    const invRow = await get('invoices', inv.id);
    const invPrinted = invoiceTotals(invRow.lines, 5, 10);
    expect([Number(invRow.amount), Number(invRow.gst), Number(invRow.holdback_amount), Number(invRow.total)]).toEqual([invPrinted.subtotal, invPrinted.tax, invPrinted.holdback, invPrinted.total]);
    expect(invPrinted).toEqual({ subtotal: 4890, tax: 244.5, holdback: 489, total: 4645.5 });
    const rec = (await t.asSystem<Row>('select * from public.receivables where invoice_id = $1', [inv.id]))[0];
    expect(Number(rec.amount)).toBe(4645.5);

    // Draw: its own holdback carries to its invoice
    const draw = await ins(who, 'progress_billing', { title: 'Draw 1', status: 'Draft', project_id: project, amount_billed: 2000, holdback_percent: 5 });
    const [{ id: drawInv }] = await t.as<{ id: string }>(who, 'select public.create_invoice_from_draw($1) as id', [draw.id]);
    await send(who, drawInv);
    const drawRow = await get('invoices', drawInv);
    expect([Number(drawRow.amount), Number(drawRow.gst), Number(drawRow.holdback_amount), Number(drawRow.total)]).toEqual([2000, 100, 100, 2000]);
    expect((await get('progress_billing', draw.id)).status).toBe('Invoiced');

    // PO then its bill, and a credit
    const po = await ins(who, 'purchase_orders', { title: 'PO', status: 'Issued', project_id: project, vendor: 'W', amount: 1500 });
    expect(Number((await job(project)).committed)).toBe(1500);
    const bill = await ins(who, 'payables', { title: 'Bill', status: 'Approved', project_id: project, vendor: 'W', amount: 1500, purchase_order_id: po.id });
    await ins(who, 'job_cost_entries', { project_id: project, category: 'Material', description: 'Return credit', amount: -100 });
    let j = await job(project);
    expect([Number(j.committed), Number(j.actual_material), Number(j.actual_labour), Number(j.actual_cost)]).toEqual([0, 1400, 1100, 2500]);
    expect([Number(j.margin), Number(j.margin_pct), Number(j.cost_used_pct), j.status]).toEqual([4640, 64.99, 44.64, 'On Track']);

    await setStatus(who, 'invoices', inv.id, 'Paid');
    j = await job(project);
    // Paid is before tax and leaves out the 489 held back
    expect([Number(j.billed_amount), Number(j.paid_amount)]).toEqual([6890, 4401]);

    // The dashboard agrees with the rows
    const [rolled] = await rollup(who, project);
    expect(Number(rolled.revised_contract)).toBe(7140);
    const sum = summariseJobs(await rollup(who));
    expect(sum).toMatchObject({ activeJobs: 1, contract: 7140, billed: 6890, remaining: 250, margin: 4640 });
    let f = await figures(who);
    expect(Number(f.receivables.outstanding)).toBe(2000);
    expect(Number(f.holdback.total)).toBe(589);
    expect(Number(f.holdback.invoices)).toBe(2);
    const [{ b }] = await t.as<{ b: string }>(who, 'select public.project_balance($1) as b', [project]);
    expect(Number(b)).toBe(250);

    // Reversals, one at a time
    await setStatus(who, 'invoices', inv.id, 'Sent');
    expect(Number((await job(project)).paid_amount)).toBe(0);
    await setStatus(who, 'invoices', inv.id, 'Void');
    expect((await get('change_orders', co)).invoice_id).toBeNull();
    expect(await t.asSystem('select 1 from public.receivables where invoice_id = $1', [inv.id])).toEqual([]);
    expect(Number((await job(project)).billed_amount)).toBe(2000);
    f = await figures(who);
    expect(Number(f.holdback.total)).toBe(100);
    expect(Number(f.receivables.outstanding)).toBe(2000);

    await setStatus(who, 'change_orders', co, 'Draft');
    expect(Number((await get('projects', project)).revised_contract)).toBe(4500);
    expect(Number((await job(project)).budget)).toBe(3600);

    await t.as(who, `select public.decide_timecards($1, 'unapprove')`, [[card.id]]);
    expect(Number((await job(project)).actual_labour)).toBe(0);

    await setStatus(who, 'payables', bill.id, 'To Approve');
    j = await job(project);
    expect(Number(j.actual_material)).toBe(-100);

    await setStatus(who, 'invoices', drawInv, 'Void');
    expect(await get('progress_billing', draw.id)).toMatchObject({ status: 'Draft', invoice_id: null });
    j = await job(project);
    expect([Number(j.billed_amount), Number(j.actual_cost)]).toEqual([0, -100]);
  });

  it('records moved between projects move their money, and closing a job freezes only its status', async () => {
    const a = await newProject('owner', 10000);
    const b = await newProject('owner', 20000);
    const bill = await ins('owner', 'payables', { title: 'Bill', status: 'Approved', project_id: a, vendor: 'W', amount: 700 });
    const po = await ins('owner', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: a, vendor: 'W', amount: 300 });
    const entry = await ins('owner', 'job_cost_entries', { project_id: a, category: 'Other', description: 'Crane', amount: 50 });
    await t.as('owner', 'update public.payables set project_id = $2 where id = $1', [bill.id, b]);
    await t.as('owner', 'update public.purchase_orders set project_id = $2 where id = $1', [po.id, b]);
    await t.as('owner', 'update public.job_cost_entries set project_id = $2 where id = $1', [entry.id, b]);
    expect([Number((await job(a)).actual_cost), Number((await job(a)).committed)]).toEqual([0, 0]);
    expect([Number((await job(b)).actual_cost), Number((await job(b)).committed)]).toEqual([750, 300]);

    const draft = await invoice('owner', a, [{ type: 'percent', percent: 10 }]);
    expect(Number(draft.amount)).toBe(1000);
    await t.as('owner', 'update public.invoices set project_id = $2 where id = $1', [draft.id, b]);
    expect(Number((await get('invoices', draft.id)).amount)).toBe(2000);

    await t.as('owner', 'select public.set_job_budget($1, 0, 100, 0, 0)', [b]);
    await t.as('owner', 'select public.set_job_closed($1, true)', [b]);
    expect((await job(b)).status).toBe('Closed');
    await ins('owner', 'job_cost_entries', { project_id: b, category: 'Other', description: 'Late bill', amount: 25 });
    expect([(await job(b)).status, Number((await job(b)).actual_cost)]).toEqual(['Closed', 775]);
    await t.as('owner', 'select public.set_job_closed($1, false)', [b]);
    expect((await job(b)).status).toBe('Over Budget');
  });

  it('a credit invoice nets through billed and receivables', async () => {
    const p = await newProject('owner', 1000);
    await send('owner', (await invoice('owner', p, [free(1000)])).id);
    const credit = await invoice('owner', p, [free(-200, 'Credit for removed scope')]);
    await send('owner', credit.id);
    expect([Number(credit.amount), Number(credit.gst), Number(credit.holdback_amount), Number(credit.total)]).toEqual([-200, -10, -20, -190]);
    expect(Number((await job(p)).billed_amount)).toBe(800);
    expect(Number((await t.asSystem<Row>('select amount from public.receivables where invoice_id = $1', [credit.id]))[0].amount)).toBe(-190);
  });

  it('a lapsed company cannot move any money, by table or by function, and can still read it', async () => {
    const who = 'lapsed';
    const { project, proposal } = await quoteToProject(who);
    const co = await ins(who, 'change_orders', { title: 'CO', status: 'Draft', project_id: project, material_cost: 100, labour_hours: 0, labour_rate: 0, markup_pct: 0, tax_pct: 5 });
    await setStatus(who, 'change_orders', co.id, 'Sent');
    const inv = await invoice(who, project, [free(100)]);
    const draw = await ins(who, 'progress_billing', { title: 'D', status: 'Draft', project_id: project, amount_billed: 100 });
    const [card] = await t.as<{ id: string }>(who, `insert into public.timecards (title, status, project_id, employee_name, work_date, regular_hours) values ('L', 'Submitted', $1, 'Sam', $2, 8) returning id`, [project, today]);
    const before = await job(project);
    const companyId = (await get('projects', project)).company_id;
    await t.setLapsed(companyId, true);

    const attempts: [string, unknown[]][] = [
      [`update public.invoices set status = 'Sent' where id = $1`, [inv.id]],
      [`update public.change_orders set status = 'Approved', approved_by = 'X', signature = '${SIG}' where id = $1`, [co.id]],
      [`select public.decide_timecards($1, 'approve')`, [[card.id]]],
      [`select public.export_timecards('2000-01-01', '2100-01-01')`, []],
      [`select public.create_invoice_from_draw($1)`, [draw.id]],
      [`select public.create_invoice_from_project($1)`, [project]],
      [`select public.create_draw_from_project($1)`, [project]],
      [`select public.create_project_from_proposal($1)`, [proposal]],
      [`select public.set_job_budget($1, 1, 1, 1, 1)`, [project]],
      [`select public.set_job_closed($1, true)`, [project]],
      [`insert into public.job_cost_entries (project_id, category, description, amount) values ($1, 'Other', 'X', 5)`, [project]],
      [`insert into public.payables (title, status, project_id, amount) values ('X', 'Approved', $1, 5)`, [project]],
      [`update public.projects set contract_value = 1 where id = $1`, [project]],
    ];
    for (const [sql, params] of attempts) await t.as(who, sql, params).catch(() => null);

    expect((await get('invoices', inv.id)).status).toBe('Draft');
    expect((await get('change_orders', co.id)).status).toBe('Sent');
    expect((await get('timecards', card.id)).status).toBe('Submitted');
    expect((await get('progress_billing', draw.id)).invoice_id).toBeNull();
    const after = await job(project);
    expect([after.budget, after.actual_cost, after.status, after.billed_amount]).toEqual([before.budget, before.actual_cost, before.status, before.billed_amount]);
    expect(Number((await get('projects', project)).contract_value)).toBe(4500);
    expect((await rollup(who, project)).length).toBe(1);
    await t.setLapsed(companyId, false);
  });
});

describe('reproduced defects', () => {
  it('[BUG] the tax the client accepted on the proposal is what they are invoiced', async () => {
    // Company default is 5. The quote the client signed says 13.
    const { proposal, project } = await quoteToProject('owner', { tax_percentage: 13 });
    const accepted = Number((await get('proposals', proposal)).total_amount);
    expect(accepted).toBe(5085);
    const [{ id }] = await t.as<{ id: string }>('owner', 'select public.create_invoice_from_project($1) as id', [project]);
    const inv = await get('invoices', id);
    expect(Number(inv.amount) + Number(inv.gst)).toBe(accepted);
  });

  it('[BUG] the tax on a signed change order is what it is invoiced at', async () => {
    const p = await newProject('owner', 10000);
    const co = await approvedCo('owner', p, { tax_pct: 13 });
    const signed = await get('change_orders', co);
    expect(Number(signed.total)).toBe(2983.2);
    // No tax_pct sent: the same as the invoice editor's new invoice before anyone edits it
    const inv = await ins('owner', 'invoices', { title: 'INV', status: 'Draft', project_id: p, holdback_pct: 0, lines: JSON.stringify([{ type: 'change_order', change_order_id: co }]) });
    expect(Number(inv.total)).toBe(Number(signed.total));
  });

  it('[BUG] a change order already billed by a Balance of contract invoice cannot be billed again', async () => {
    const p = await newProject('owner', 10000);
    const co = await approvedCo('owner', p);
    const price = Number((await get('change_orders', co)).price);
    const [{ id: balance }] = await t.as<{ id: string }>('owner', 'select public.create_invoice_from_project($1) as id', [p]);
    await send('owner', balance);
    expect(Number((await job(p)).billed_amount)).toBe(10000 + price);

    // The invoice editor still offers this change order as unbilled: invoice_id is null
    expect((await get('change_orders', co)).invoice_id).toBeNull();
    const second = await invoice('owner', p, [{ type: 'change_order', change_order_id: co }]);
    await send('owner', second.id).catch(() => null);
    expect(Number((await job(p)).billed_amount)).toBeLessThanOrEqual(10000 + price);
  });

  it('[BUG] a change order billed through the balance is locked like any other billed one', async () => {
    const p = await newProject('owner', 10000);
    const co = await approvedCo('owner', p);
    const [{ id: balance }] = await t.as<{ id: string }>('owner', 'select public.create_invoice_from_project($1) as id', [p]);
    await send('owner', balance);
    await setStatus('owner', 'change_orders', co, 'Draft').catch(() => null);
    const billed = Number((await job(p)).billed_amount);
    const revised = Number((await get('projects', p)).revised_contract);
    expect(billed).toBeLessThanOrEqual(revised);
  });

  it('[BUG] draws from the Create draw button cannot bill the contract twice', async () => {
    const p = await newProject('owner', 10000);
    const invoices: string[] = [];
    // The second click makes a new draw for the whole balance, because the first is on a draft invoice
    for (let i = 0; i < 2; i++) {
      const [{ id: draw }] = await t.as<{ id: string }>('owner', 'select public.create_draw_from_project($1) as id', [p]);
      const [{ id: inv }] = await t.as<{ id: string }>('owner', 'select public.create_invoice_from_draw($1) as id', [draw]);
      invoices.push(inv);
    }
    expect(new Set(invoices).size).toBe(2);
    for (const inv of invoices) await send('owner', inv).catch(() => null);
    expect(Number((await job(p)).billed_amount)).toBeLessThanOrEqual(10000);
  });

  it('[BUG] the dashboard holdback nets a credit invoice, the way billed and receivables do', async () => {
    const before = Number((await figures('owner')).holdback.total);
    const p = await newProject('owner', 50000);
    await send('owner', (await invoice('owner', p, [free(10000)])).id);
    await send('owner', (await invoice('owner', p, [free(-2000, 'Credit')])).id);
    expect(Number((await figures('owner')).holdback.total) - before).toBe(800);
  });

  it('[BUG] a deduct change order can be approved and lowers the contract', async () => {
    const p = await newProject('owner', 10000);
    const co = await ins('owner', 'change_orders', { title: 'Delete scope', status: 'Draft', project_id: p, material_cost: -500, labour_hours: 0, labour_rate: 0, markup_pct: 0, tax_pct: 5 });
    expect(Number(co.price)).toBe(-500);
    await setStatus('owner', 'change_orders', co.id, 'Sent');
    await t.as('owner', `update public.change_orders set status = 'Approved', approved_by = 'Client', signature = $2 where id = $1`, [co.id, SIG]);
    expect(Number((await get('projects', p)).revised_contract)).toBe(9500);
  });

  it('[BUG] Paid on the job does not count holdback the client has not paid', async () => {
    const p = await newProject('owner', 10000);
    const inv = await invoice('owner', p, [free(1000)]);
    await send('owner', inv.id);
    await setStatus('owner', 'invoices', inv.id, 'Paid');
    const row = await get('invoices', inv.id);
    expect(Number(row.total)).toBe(950);
    // Before tax, as labelled: 1000 less the 100 still held back
    expect(Number((await job(p)).paid_amount)).toBe(900);
  });

  it('[BUG] a bill can be matched to its PO from the app, or its PO stays committed for good', () => {
    // module-page.tsx hides this field and leaves it out of every save, and nothing else in app/, components/ or lib/ writes it
    const field = getModule('payables')!.fields.find((f) => f.key === 'purchase_order_id')!;
    expect(field.hidden).toBeFalsy();
  });

  it('[BUG] a PO with a bill not yet approved stays visible on the job', async () => {
    const p = await newProject('owner', 10000);
    const po = await ins('owner', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: p, vendor: 'W', amount: 5000 });
    await ins('owner', 'payables', { title: 'Bill', status: 'To Approve', project_id: p, vendor: 'W', amount: 5000, purchase_order_id: po.id });
    const j = await job(p);
    expect(Number(j.committed) + Number(j.actual_material)).toBe(5000);
  });

  it('[BUG] part-billing a PO leaves the rest committed', async () => {
    const p = await newProject('owner', 10000);
    const po = await ins('owner', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: p, vendor: 'W', amount: 5000 });
    await ins('owner', 'payables', { title: 'Bill', status: 'Approved', project_id: p, vendor: 'W', amount: 1000, purchase_order_id: po.id });
    const j = await job(p);
    expect(Number(j.committed) + Number(j.actual_material)).toBe(5000);
  });

  it('[BUG] an approved bill matched to a PO on the job counts on the job even with its own project left blank', async () => {
    const p = await newProject('owner', 10000);
    const po = await ins('owner', 'purchase_orders', { title: 'PO', status: 'Issued', project_id: p, vendor: 'W', amount: 5000 });
    await ins('owner', 'payables', { title: 'Bill', status: 'Approved', vendor: 'W', amount: 5000, purchase_order_id: po.id });
    const j = await job(p);
    expect(Number(j.committed) + Number(j.actual_material)).toBe(5000);
  });

  it('[BUG] a draw on an invoice keeps the same holdback terms as that invoice', async () => {
    const p = await newProject('owner', 10000);
    const draw = await ins('owner', 'progress_billing', { title: 'D', status: 'Draft', project_id: p, amount_billed: 1000, holdback_percent: 10, holdback_release_date: '2027-01-01' });
    const [{ id }] = await t.as<{ id: string }>('owner', 'select public.create_invoice_from_draw($1) as id', [draw.id]);
    await send('owner', id);
    // The draw page leaves the release date open while linked, and the database also takes the percent
    await t.as('owner', `update public.progress_billing set holdback_release_date = '2027-06-01', holdback_percent = 50 where id = $1`, [draw.id]);
    const [d, i] = [await get('progress_billing', draw.id), await get('invoices', id)];
    expect(Number(d.holdback_percent)).toBe(Number(i.holdback_pct));
    expect(String(d.holdback_release_date)).toBe(String(i.holdback_release_date));
  });

  it('[BUG] percents that add up to 100 bill the whole contract', async () => {
    const p = await newProject('owner', 1000);
    for (const percent of [33.3333, 33.3333, 33.3334]) await send('owner', (await invoice('owner', p, [{ type: 'percent', percent }])).id);
    expect(Number((await job(p)).billed_amount)).toBe(1000);
  });

  it('[BUG] a second accepted quote on a job moves the contract or is refused, not silently marked Won', async () => {
    const { project } = await quoteToProject('owner');
    const contract = Number((await get('projects', project)).contract_value);
    const est = await ins('owner', 'estimates', { title: 'Extra', status: 'Submitted', labour_rate: 80, markup_percentage: 25, tax_percentage: 5, project_id: project });
    await t.as('owner', 'select public.save_estimate_items($1, $2::jsonb)', [est.id, JSON.stringify(LINES)]);
    const [{ id: prop }] = await t.as<{ id: string }>('owner', 'select public.create_proposal_from_estimate($1) as id', [est.id]);
    await setStatus('owner', 'proposals', prop, 'Sent');
    await setStatus('owner', 'proposals', prop, 'Accepted');
    const outcome = await t.as('owner', 'select public.create_project_from_proposal($1)', [prop]).then(() => 'accepted', () => 'refused');
    if (outcome === 'accepted') expect(Number((await get('projects', project)).contract_value)).toBe(contract + 4500);
  });
});
