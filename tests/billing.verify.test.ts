// Adversarial verification of the billing engine, on PGlite. Written by the verifier, not the
// builder. Everything calls the database the way PostgREST would: as the signed-in user, with
// no help from the pages or the API routes. A failing test in this file is a reproduced bug
// and stays failing for the fixer. Those tests are marked [BUG] in their names.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BASELINE_FILE, OLD_BASELINE_FIXTURE, bootDb, migrationFiles, readMigration, type TestDb } from './helpers/db';
import { InvoiceLinesSchema, changeOrderBudgetCost, changeOrderTotals, invoiceTotals, percentAmount, pricePercentLines, receivableAge } from '@/lib/billing-math';
import { getModule } from '@/lib/modules';
import { SignatureImage, SignerName } from '@/lib/signature';
import { parseRecord } from '@/lib/validation';

const id = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const USERS = {
  owner: { id: id(1), email: 'owner@alpha.ca' },
  admin: { id: id(2), email: 'admin@alpha.ca' },
  pm: { id: id(3), email: 'pm@alpha.ca' },
  foreman: { id: id(4), email: 'foreman@alpha.ca' },
  elec: { id: id(5), email: 'elec@alpha.ca' },
  rival: { id: id(6), email: 'owner@rival.ca' },
  lapsed: { id: id(7), email: 'owner@lapsed.ca' },
  lapsedPm: { id: id(8), email: 'pm@lapsed.ca' },
  nobody: { id: id(9), email: 'nobody@nowhere.ca' },
  fresh: { id: id(10), email: 'owner@fresh.ca' },
};
type U = keyof typeof USERS;
type Row = Record<string, any>;

const SIG = 'data:image/png;base64,AAAA';
let t: TestDb<U>;
let company: string;
let rivalCompany: string;
let lapsedCompany: string;
let rivalProject: string;

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
const newCo = async (project: string | null, over: Row = {}, who: U = 'pm') =>
  ins(who, 'change_orders', { title: 'Change', status: 'Draft', project_id: project, material_cost: 100, labour_hours: 0, labour_rate: 0, markup_pct: 0, tax_pct: 0, ...over });
// Sent first when it is still a draft: Draft to Approved is refused, which has its own test below
const approve = async (coId: string, who: U = 'pm', name = 'Client', signature = SIG) => {
  await t.as(who, `update public.change_orders set status = 'Sent' where id = $1 and status = 'Draft'`, [coId]);
  const moved = await t.as<Row>(who, `update public.change_orders set status = 'Approved', approved_by = $2, signature = $3 where id = $1 returning id`, [coId, name, signature]);
  return moved.length ? [await get('change_orders', coId)] : [];
};
const approvedCo = async (project: string | null, over: Row = {}) => (await approve((await newCo(project, over)).id))[0];
const newInvoice = async (project: string | null, lines: unknown[] = [], over: Row = {}, who: U = 'owner') =>
  ins(who, 'invoices', { title: 'INV', status: 'Draft', project_id: project, tax_pct: 5, holdback_pct: 10, lines: JSON.stringify(lines), ...over });
const setInvoice = async (invoice: string, status: string, who: U = 'owner') => (await t.as<Row>(who, 'update public.invoices set status = $2 where id = $1 returning *', [invoice, status]))[0];
const free = (amount: unknown, description = 'Work') => ({ type: 'free', description, amount });
const save = async (who: U | null, invoice: string, fields: Row, lines: unknown[] | null) =>
  (await t.as<Row>(who, 'select * from public.save_invoice($1, $2::jsonb, $3::jsonb)', [invoice, JSON.stringify(fields), lines === null ? null : JSON.stringify(lines)]))[0];
const fromDraw = async (who: U, draw: string) => (await t.as<{ id: string }>(who, 'select public.create_invoice_from_draw($1) as id', [draw]))[0].id;
const counter = async (co: string, kind: string) => Number((await t.asSystem<Row>('select last_value from public.company_counters where company_id = $1 and kind = $2', [co, kind]))[0]?.last_value ?? 0);
const receivableOf = async (invoice: string) => t.asSystem<Row>('select * from public.receivables where invoice_id = $1', [invoice]);

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
  await t.as('owner', 'update public.companies set default_labour_rate = 60, default_markup = 20, default_tax = 11, default_holdback_pct = 7.5');
  rivalProject = (await newProject(5000, 'rival')).id;
}, 180_000);

describe('wrong role', () => {
  it('electrician sees no change order, invoice, draw or receivable and cannot write any', async () => {
    const p = await newProject();
    const co = await newCo(p.id);
    const inv = await newInvoice(p.id, [free(10)]);
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 10 });
    for (const [table, rowId] of [['change_orders', co.id], ['invoices', inv.id], ['progress_billing', draw.id]]) {
      expect(await t.as('elec', `select id from public.${table} where id = $1`, [rowId])).toEqual([]);
      expect(await t.as('elec', `update public.${table} set title = 'hacked' where id = $1 returning id`, [rowId])).toEqual([]);
      expect(await t.as('elec', `delete from public.${table} where id = $1 returning id`, [rowId])).toEqual([]);
    }
    expect(await refused(ins('elec', 'change_orders', { title: 'x', status: 'Draft' }))).toBeTruthy();
    expect(await refused(ins('elec', 'invoices', { title: 'x', status: 'Draft' }))).toBeTruthy();
  });

  it('a foreman reads a change order but cannot approve, reopen, edit or delete it', async () => {
    const p = await newProject();
    const co = await newCo(p.id);
    expect(await approve(co.id, 'foreman')).toEqual([]);
    expect((await get('change_orders', co.id)).status).toBe('Draft');
    const done = await approvedCo(p.id);
    expect(await t.as('foreman', `update public.change_orders set status = 'Draft' where id = $1 returning id`, [done.id])).toEqual([]);
    expect(await t.as('foreman', 'delete from public.change_orders where id = $1 returning id', [co.id])).toEqual([]);
    expect(await t.as('foreman', 'select id from public.change_orders where id = $1', [co.id])).toHaveLength(1);
  });

  it('a PM cannot see or touch invoices, by table or RPC, or read receivables', async () => {
    const p = await newProject();
    const inv = await newInvoice(p.id, [free(10)]);
    await setInvoice(inv.id, 'Sent');
    expect(await t.as('pm', 'select id from public.invoices where id = $1', [inv.id])).toEqual([]);
    expect(await refused(save('pm', inv.id, { title: 'x' }, null))).toMatch(/not found/i);
    expect(await refused(ins('pm', 'invoices', { title: 'x', status: 'Draft' }))).toBeTruthy();
    expect(await t.as('pm', 'select id from public.receivables where invoice_id = $1', [inv.id])).toEqual([]);
  });

  it('a PM can make a draw but its Create invoice is refused, and nothing is claimed', async () => {
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 500 });
    expect(await refused(fromDraw('pm', draw.id))).toBeTruthy();
    expect((await get('progress_billing', draw.id)).invoice_id).toBeNull();
  });

  it('a user with no company cannot write or read anything', async () => {
    expect(await refused(ins('nobody', 'change_orders', { title: 'x', status: 'Draft' }))).toBeTruthy();
    expect(await refused(ins('nobody', 'invoices', { title: 'x', status: 'Draft' }))).toBeTruthy();
    expect(await t.as('nobody', 'select id from public.invoices')).toEqual([]);
  });

  it('a visitor cannot reach the tables or the RPCs', async () => {
    const p = await newProject();
    const inv = await newInvoice(p.id, [free(10)]);
    expect(await refused(t.as(null, 'select id from public.invoices'))).toBeTruthy();
    expect(await refused(t.as(null, `update public.invoices set total = 0 where id = '${inv.id}'`))).toBeTruthy();
    expect(await refused(save(null, inv.id, {}, null))).toBeTruthy();
    expect(await refused(t.as(null, `select public.create_invoice_from_draw('${inv.id}')`))).toBeTruthy();
  });

  it.each([
    [`select public.next_company_number('11111111-1111-4111-8111-111111111111', 'invoice', 1)`],
    [`select public.price_invoice_lines(gen_random_uuid(), gen_random_uuid(), null, '[]')`],
    ['select * from public.company_counters'],
    [`insert into public.company_counters values (public.user_company_id(), 'invoice', 0)`],
    ['select public.sync_invoice()'],
    ['select public.guard_invoice()'],
    ['select public.guard_change_order()'],
  ])('signed-in owner cannot run internals: %s', async (sql) => {
    expect(await refused(t.as('owner', sql))).toMatch(/permission denied|trigger functions can only/i);
  });
});

describe('other tenant', () => {
  it('sees nothing and changes nothing, by table or RPC', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    const inv = await newInvoice(p.id, [free(10)]);
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 500 });
    for (const [table, rowId] of [['change_orders', co.id], ['invoices', inv.id], ['progress_billing', draw.id], ['projects', p.id]]) {
      expect(await t.as('rival', `select id from public.${table} where id = $1`, [rowId])).toEqual([]);
      expect(await t.as('rival', `update public.${table} set title = 'hacked' where id = $1 returning id`, [rowId])).toEqual([]);
      expect(await t.as('rival', `delete from public.${table} where id = $1 returning id`, [rowId])).toEqual([]);
    }
    expect(await refused(save('rival', inv.id, { title: 'hacked' }, null))).toMatch(/not found/i);
    expect(await refused(fromDraw('rival', draw.id))).toMatch(/not found/i);
    expect((await get('invoices', inv.id)).title).toBe('INV');
  });

  it('cannot bill my change order, draw or contract from its own invoice', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 500 });
    expect(await refused(newInvoice(null, [{ type: 'change_order', change_order_id: co.id }], {}, 'rival'))).toMatch(/could not be found/);
    expect(await refused(newInvoice(null, [{ type: 'draw', progress_billing_id: draw.id }], {}, 'rival'))).toMatch(/could not be found/);
    expect(await refused(newInvoice(p.id, [], {}, 'rival'))).toBeTruthy();
    expect(await refused(newInvoice(p.id, [{ type: 'percent', percent: 10 }], {}, 'rival'))).toBeTruthy();
    expect((await get('change_orders', co.id)).invoice_id).toBeNull();
  });

  it('cannot plant a record in my company or bump my counters', async () => {
    const before = await counter(company, 'invoice');
    const beforeCo = await counter(company, 'change_order');
    expect(await refused(ins('rival', 'invoices', { title: 'x', status: 'Draft', company_id: company }))).toMatch(/permission/i);
    expect(await refused(ins('rival', 'change_orders', { title: 'x', status: 'Draft', company_id: company }))).toMatch(/permission/i);
    expect(await refused(ins('rival', 'progress_billing', { title: 'x', status: 'Draft', company_id: company }))).toBeTruthy();
    expect(await refused(ins('rival', 'receivables', { title: 'x', status: 'Current', company_id: company }))).toBeTruthy();
    expect(await counter(company, 'invoice')).toBe(before);
    expect(await counter(company, 'change_order')).toBe(beforeCo);
  });

  it('my records cannot be linked to its project or client', async () => {
    const [{ id: theirClient }] = await t.as<{ id: string }>('rival', `insert into public.crm (title, status) values ('Their client', 'Lead') returning id`);
    expect(await refused(newCo(rivalProject))).toBeTruthy();
    expect(await refused(newInvoice(rivalProject))).toBeTruthy();
    expect(await refused(newInvoice(null, [], { client_id: theirClient }))).toBeTruthy();
    expect(await refused(ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: rivalProject }))).toBeTruthy();
    const inv = await newInvoice(null);
    expect(await refused(save('owner', inv.id, { project_id: rivalProject }, null))).toBeTruthy();
  });

  it('cannot move its record into my company', async () => {
    const inv = await newInvoice(null, [], {}, 'rival');
    const co = await newCo(null, {}, 'rival');
    const draw = await ins('rival', 'progress_billing', { title: 'D', status: 'Draft' });
    expect(await refused(t.as('rival', 'update public.invoices set company_id = $1 where id = $2', [company, inv.id]))).toBeTruthy();
    expect(await refused(t.as('rival', 'update public.change_orders set company_id = $1 where id = $2', [company, co.id]))).toBeTruthy();
    // set_updated_at quietly puts company_id back here instead of raising, which is just as safe
    await refused(t.as('rival', 'update public.progress_billing set company_id = $1 where id = $2', [company, draw.id]));
    expect((await get('progress_billing', draw.id)).company_id).toBe(rivalCompany);
    expect((await get('invoices', inv.id)).company_id).toBe(rivalCompany);
    expect((await get('change_orders', co.id)).company_id).toBe(rivalCompany);
  });
});

describe('lapsed subscription', () => {
  let p: Row;
  let draftCo: Row;
  let doneCo: Row;
  let inv: Row;
  let sent: Row;
  let draw: Row;

  beforeAll(async () => {
    p = await newProject(1000, 'lapsedPm');
    draftCo = await newCo(p.id, {}, 'lapsedPm');
    [doneCo] = await approve((await newCo(p.id, {}, 'lapsedPm')).id, 'lapsedPm');
    inv = await newInvoice(p.id, [free(10)], {}, 'lapsed');
    sent = await newInvoice(p.id, [free(20)], {}, 'lapsed');
    await setInvoice(sent.id, 'Sent', 'lapsed');
    draw = await ins('lapsedPm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 100 });
    await t.setLapsed(lapsedCompany, true);
  });

  it('reads still work', async () => {
    expect(await t.as('lapsed', 'select id from public.invoices where id = $1', [inv.id])).toHaveLength(1);
    expect(await t.as('lapsedPm', 'select id from public.change_orders where id = $1', [draftCo.id])).toHaveLength(1);
  });

  it('no approve, reopen, edit or delete of a change order, and no new number is taken', async () => {
    const before = await counter(lapsedCompany, 'change_order');
    expect(await approve(draftCo.id, 'lapsedPm')).toEqual([]);
    expect(await t.as('lapsedPm', `update public.change_orders set status = 'Draft' where id = $1 returning id`, [doneCo.id])).toEqual([]);
    expect(await t.as('lapsedPm', 'delete from public.change_orders where id = $1 returning id', [draftCo.id])).toEqual([]);
    expect(await refused(newCo(p.id, {}, 'lapsedPm'))).toBeTruthy();
    expect(await counter(lapsedCompany, 'change_order')).toBe(before);
    expect((await get('change_orders', doneCo.id)).status).toBe('Approved');
  });

  it('no invoice status move, save, create from draw or delete, and no new number is taken', async () => {
    const before = await counter(lapsedCompany, 'invoice');
    expect(await refused(newInvoice(p.id, [free(1)], {}, 'lapsed'))).toBeTruthy();
    expect(await t.as('lapsed', `update public.invoices set status = 'Paid' where id = $1 returning id`, [sent.id])).toEqual([]);
    expect(await refused(save('lapsed', inv.id, { title: 'x' }, null))).toMatch(/not found/i);
    expect(await refused(fromDraw('lapsed', draw.id))).toBeTruthy();
    expect(await t.as('lapsed', 'delete from public.invoices where id = $1 returning id', [inv.id])).toEqual([]);
    expect(await counter(lapsedCompany, 'invoice')).toBe(before);
    expect((await get('invoices', sent.id)).status).toBe('Sent');
    expect((await receivableOf(sent.id))[0].status).not.toBe('Collected');
  });

  it('no draw or receivable write', async () => {
    expect(await t.as('lapsedPm', `update public.progress_billing set amount_billed = 1 where id = $1 returning id`, [draw.id])).toEqual([]);
    expect(await t.as('lapsedPm', 'delete from public.progress_billing where id = $1 returning id', [draw.id])).toEqual([]);
    expect(await refused(ins('lapsed', 'receivables', { title: 'x', status: 'Current' }))).toBeTruthy();
    const [rec] = await receivableOf(sent.id);
    expect(await t.as('lapsed', 'delete from public.receivables where id = $1 returning id', [rec.id])).toEqual([]);
  });

  it('a canceled subscription is read-only too', async () => {
    await t.asSystem(`update public.companies set subscription_status = 'canceled', trial_ends_at = now() + interval '10 days' where id = $1`, [lapsedCompany]);
    expect(await approve(draftCo.id, 'lapsedPm')).toEqual([]);
    await t.setLapsed(lapsedCompany, true);
  });
});

describe('bypassing the UI: change orders', () => {
  it('server computes money on insert and update, whatever a client writes', async () => {
    const co = await newCo(null, { material_cost: 1000, labour_hours: 10, labour_rate: 85, markup_pct: 15, tax_pct: 5, price: 1, tax: 1, total: 1, cost_impact: 1, budget_cost: 1 });
    expect(Number(co.price)).toBe(2127.5);
    expect(Number(co.total)).toBe(2233.88);
    expect(Number(co.budget_cost)).toBe(1600); // 1000 + 10h x company rate 60
    await t.as('pm', 'update public.change_orders set price = 9, tax = 9, total = 9, cost_impact = 9, budget_cost = 9 where id = $1', [co.id]);
    const u = await get('change_orders', co.id as string);
    expect(Number(u.price)).toBe(2127.5);
    expect(Number(u.budget_cost)).toBe(1600);
  });

  it('every locked column stays put once approved', async () => {
    const p = await newProject();
    const p2 = await newProject();
    const co = await approvedCo(p.id);
    const attempts: [string, unknown[]][] = [
      ['material_cost = 1', []],
      ['title = \'changed\'', []],
      ['scope = \'changed\'', []],
      ['days_impact = 99', []],
      ['approved_by = \'Someone else\'', []],
      ['signature = null', []],
      [`signature = '${SIG}B'`, []],
      [`approved_at = '2000-01-01'`, []],
      [`project_id = '${p2.id}'`, []],
      ['price = 1', []],
      ['total = 1', []],
    ];
    for (const [set] of attempts) {
      expect(await refused(t.as('pm', `update public.change_orders set ${set} where id = $1`, [co.id])), set).toMatch(/locked/);
    }
    const same = await get('change_orders', co.id);
    expect(same.status).toBe('Approved');
    expect(Number(same.price)).toBe(100);
    expect(Number((await get('projects', p.id)).approved_changes)).toBe(100);
  });

  it('the number and the invoice link cannot be written, at any status', async () => {
    const p = await newProject();
    const inv = await newInvoice(p.id);
    const draft = await newCo(p.id);
    await t.as('pm', `update public.change_orders set co_number = '999999', invoice_id = $2 where id = $1`, [draft.id, inv.id]);
    const u = await get('change_orders', draft.id as string);
    expect(u.co_number).toBe(draft.co_number);
    expect(u.invoice_id).toBeNull();
    const done = await approvedCo(p.id);
    await t.as('pm', `update public.change_orders set co_number = '999999', invoice_id = $2 where id = $1`, [done.id, inv.id]);
    const u2 = await get('change_orders', done.id as string);
    expect(u2.co_number).toBe(done.co_number);
    expect(u2.invoice_id).toBeNull();
  });

  it('reopening cannot change money or carry a name, and clears the sign-off', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id, { material_cost: 500 });
    expect(await refused(t.as('pm', `update public.change_orders set status = 'Draft', material_cost = 1 where id = $1`, [co.id]))).toMatch(/locked/);
    await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]);
    const open = await get('change_orders', co.id as string);
    expect(open.signature).toBeNull();
    expect(open.approved_by).toBeNull();
    expect(open.approved_at).toBeNull();
    expect(Number(open.price)).toBe(500);
    expect(Number((await get('projects', p.id)).approved_changes)).toBe(0);
  });

  it('[BUG] a NaN material cost is refused, not priced and approved onto the contract', async () => {
    const p = await newProject(1000);
    const outcome = await refused(
      (async () => {
        const co = await newCo(p.id, { material_cost: 'NaN' });
        await approve(co.id);
      })(),
    );
    const project = await get('projects', p.id);
    expect(outcome, `project approved_changes is now ${project.approved_changes}, revised_contract ${project.revised_contract}`).toBeTruthy();
    expect(Number.isFinite(Number(project.revised_contract))).toBe(true);
  });

  it.each([['markup_pct'], ['labour_hours'], ['labour_rate'], ['tax_pct'], ['days_impact']])('[BUG] %s = NaN is refused by a direct write', async (column) => {
    const result = await refused(newCo(null, { [column]: 'NaN', labour_hours: column === 'labour_hours' ? 'NaN' : 1, labour_rate: column === 'labour_rate' ? 'NaN' : 1 }));
    expect(result).toBeTruthy();
  });

  it('the API form refuses NaN too (so this is reachable only by writing to the database directly)', () => {
    const parsed = parseRecord(getModule('change-orders')!, { title: 'x', status: 'Draft', material_cost: 'NaN', markup_pct: 'NaN' }, 'create');
    expect(parsed.ok).toBe(false);
  });

  it.each([
    ['0.01 passes', { material_cost: 0.01 }, true],
    ['0 refused', { material_cost: 0 }, false],
    ['a fraction that rounds to 0 refused', { material_cost: 0, labour_hours: 0.001, labour_rate: 1 }, false],
    ['a credit passes', { material_cost: -50 }, true],
    ['blank money refused', { material_cost: null, labour_hours: null, labour_rate: null }, false],
  ])('approval boundary on price: %s', async (_name, over, ok) => {
    const p = await newProject();
    const co = await newCo(p.id, over as Row);
    const message = await refused(approve(co.id));
    if (ok) expect(message).toBeNull();
    else expect(message).toMatch(/price above zero/);
  });

  it.each([
    ['no project', null, 'Client', SIG],
    ['a blank name', 'P', '   ', SIG],
    ['a null signature', 'P', 'Client', null],
    ['a signature of another type', 'P', 'Client', 'data:image/svg+xml;base64,AAAA'],
  ])('approval needs everything: %s', async (_name, project, name, sig) => {
    const p = await newProject();
    const co = await newCo(project ? p.id : null, { status: 'Sent' });
    expect(await refused(t.as('pm', `update public.change_orders set status = 'Approved', approved_by = $2, signature = $3 where id = $1`, [co.id, name, sig]))).toBeTruthy();
    expect((await get('change_orders', co.id)).status).toBe('Sent');
  });

  it('[BUG] an empty signature image is not a drawn signature, in the database', async () => {
    const p = await newProject();
    const co = await newCo(p.id);
    expect(await refused(approve(co.id, 'pm', 'Client', 'data:image/png;base64,'))).toBeTruthy();
  });

  it('an empty signature image is not a drawn signature, at the route', () => {
    expect(SignatureImage.safeParse('data:image/png;base64,').success).toBe(false);
  });

  it('an oversized signature is refused', async () => {
    const p = await newProject();
    const co = await newCo(p.id);
    expect(await refused(approve(co.id, 'pm', 'Client', `data:image/png;base64,${'A'.repeat(300_000)}`))).toBeTruthy();
  });

  it('a price too big for the column is refused and leaves the record alone', async () => {
    const co = await newCo(null);
    expect(await refused(t.as('pm', 'update public.change_orders set material_cost = 999999999999.99, markup_pct = 500 where id = $1', [co.id]))).toBeTruthy();
    expect(Number((await get('change_orders', co.id)).price)).toBe(100);
  });
});

describe('status changes out of order: change orders', () => {
  const place = async (status: string) => {
    const p = await newProject();
    const co = await newCo(p.id);
    if (status === 'Sent' || status === 'Rejected') await t.as('pm', `update public.change_orders set status = 'Sent' where id = $1`, [co.id]);
    if (status === 'Rejected') await t.as('pm', `update public.change_orders set status = 'Rejected' where id = $1`, [co.id]);
    if (status === 'Approved') {
      await t.as('pm', `update public.change_orders set status = 'Sent' where id = $1`, [co.id]);
      await approve(co.id);
    }
    return co.id as string;
  };
  const move = (coId: string, status: string) => {
    const signing = status === 'Approved';
    return refused(t.as('pm', `update public.change_orders set status = $2, approved_by = $3, signature = $4 where id = $1`, [coId, status, signing ? 'Client' : null, signing ? SIG : null]));
  };

  it.each([
    ['Draft', 'Sent'],
    ['Sent', 'Approved'],
    ['Sent', 'Rejected'],
    ['Sent', 'Draft'],
    ['Rejected', 'Draft'],
  ])('%s to %s is allowed', async (from, to) => {
    const coId = await place(from);
    expect(await move(coId, to)).toBeNull();
    expect((await get('change_orders', coId)).status).toBe(to);
  });

  it.each([
    ['Rejected', 'Approved'],
    ['Approved', 'Sent'],
    ['Approved', 'Rejected'],
  ])('%s to %s is refused', async (from, to) => {
    const coId = await place(from);
    expect(await move(coId, to)).toBeTruthy();
    expect((await get('change_orders', coId)).status).toBe(from);
  });

  it.each([
    ['Draft', 'Approved'],
    ['Draft', 'Rejected'],
    ['Rejected', 'Sent'],
  ])('[BUG] %s to %s skips Draft > Sent > Approved/Rejected and is refused', async (from, to) => {
    const coId = await place(from);
    expect(await move(coId, to)).toBeTruthy();
    expect((await get('change_orders', coId)).status).toBe(from);
  });

  it('[BUG] a new change order cannot start out Rejected', async () => {
    expect(await refused(newCo(null, { status: 'Rejected' }))).toBeTruthy();
  });

  it('an unknown status is refused', async () => {
    const coId = await place('Draft');
    expect(await move(coId, 'Invoiced')).toBeTruthy();
    expect(await refused(newCo(null, { status: 'Paid' }))).toBeTruthy();
  });
});

describe('status changes out of order: invoices', () => {
  const statuses = ['Draft', 'Sent', 'Paid', 'Overdue', 'Void'];
  const allowed = new Set(['Draft>Sent', 'Draft>Void', 'Sent>Draft', 'Sent>Paid', 'Sent>Void', 'Paid>Sent', 'Overdue>Draft', 'Overdue>Sent', 'Overdue>Paid', 'Overdue>Void']);
  const pairs = statuses.flatMap((from) => statuses.filter((to) => to !== from).map((to) => [from, to]));

  it.each(pairs)('person moving %s to %s', async (from, to) => {
    const inv = await newInvoice(null, [free(100)]);
    if (from !== 'Draft') await t.asService('update public.invoices set status = $2 where id = $1', [inv.id, from]);
    const message = await refused(setInvoice(inv.id, to));
    if (allowed.has(`${from}>${to}`)) {
      expect(message).toBeNull();
      expect((await get('invoices', inv.id)).status).toBe(to);
    } else {
      expect(message).toBeTruthy();
      expect((await get('invoices', inv.id)).status).toBe(from);
    }
  });

  it('a new invoice starts as a draft, whichever status is asked for', async () => {
    for (const status of ['Sent', 'Paid', 'Overdue', 'Void']) {
      expect(await refused(newInvoice(null, [free(1)], { status }))).toBeTruthy();
    }
    expect(await refused(newInvoice(null, [free(1)], { status: 'Partly Paid' }))).toBeTruthy();
  });

  it('status and edit in one write are refused once it has left draft', async () => {
    const inv = await newInvoice(null, [free(100)]);
    await setInvoice(inv.id, 'Sent');
    expect(await refused(t.as('owner', `update public.invoices set status = 'Paid', title = 'x' where id = $1`, [inv.id]))).toMatch(/draft/i);
    expect(await refused(t.as('owner', `update public.invoices set status = 'Void', lines = '[]' where id = $1`, [inv.id]))).toMatch(/draft/i);
    expect(await refused(t.as('owner', `update public.invoices set status = 'Draft', tax_pct = 0 where id = $1`, [inv.id]))).toMatch(/draft/i);
    expect((await get('invoices', inv.id)).status).toBe('Sent');
  });

  it('a Sent invoice keeps its money, number and paid date, whatever a client writes', async () => {
    const inv = await newInvoice(null, [free(100)]);
    await setInvoice(inv.id, 'Sent');
    const [u] = await t.as<Row>('owner', `update public.invoices set total = 1, amount = 1, gst = 1, holdback_amount = 1, invoice_number = '1', paid_at = '2000-01-01' where id = $1 returning *`, [inv.id]);
    expect(Number(u.total)).toBe(Number(inv.total));
    expect(Number(u.amount)).toBe(100);
    expect(u.invoice_number).toBe(inv.invoice_number);
    expect(u.paid_at).toBeNull();
    expect(Number((await receivableOf(inv.id))[0].amount)).toBe(Number(inv.total));
  });

  it('voiding a draft on its own keeps what it said', async () => {
    const inv = await newInvoice(null, [free(100)]);
    const row = await setInvoice(inv.id, 'Void');
    expect(row.status).toBe('Void');
    expect(row.lines).toEqual(inv.lines);
    expect(Number(row.total)).toBe(Number(inv.total));
  });

  it('[BUG] voiding a draft cannot rewrite its lines or totals in the same write', async () => {
    const inv = await newInvoice(null, [free(100)]);
    const message = await refused(t.as('owner', `update public.invoices set status = 'Void', lines = $2 where id = $1`, [inv.id, JSON.stringify([{ type: 'percent', amount: 987654321, percent: 5000, description: 'never validated' }])]));
    const row = await get('invoices', inv.id);
    if (message === null) {
      expect(row.lines, 'the void invoice now carries lines no rule ever checked').toEqual([{ type: 'free', description: 'Work', amount: 100 }]);
      expect(Number(row.amount), 'and its subtotal came from them').toBe(100);
    }
  });
});

describe('bypassing the UI: invoice lines', () => {
  it('[BUG] a NaN free line is refused, not stored as a NaN invoice total', async () => {
    const message = await refused(newInvoice(null, [free('NaN')]));
    expect(message).toBeTruthy();
  });

  it('[BUG] a NaN draw amount is refused before it reaches an invoice', async () => {
    const p = await newProject();
    expect(await refused(ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 'NaN' }))).toBeTruthy();
  });

  it('[BUG] a NaN contract value cannot price a percent line', async () => {
    expect(await refused(newProject('NaN'))).toBeTruthy();
    const p = await newProject(1000);
    expect(await refused(t.as('pm', `update public.projects set contract_value = 'NaN' where id = $1`, [p.id]))).toBeTruthy();
    // One already there, from before the rule: triggers off, the way only a migration could write it
    await t.asSystem('alter table public.projects disable trigger user');
    await t.asSystem(`update public.projects set contract_value = 'NaN' where id = $1`, [p.id]);
    await t.asSystem('alter table public.projects enable trigger user');
    const message = await refused(newInvoice(p.id, [{ type: 'percent', percent: 10 }]));
    await t.asSystem('alter table public.projects disable trigger user');
    await t.asSystem(`update public.projects set contract_value = 1000 where id = $1`, [p.id]);
    await t.asSystem('alter table public.projects enable trigger user');
    expect(message).toBeTruthy();
  });

  it.each([
    ['text', free('1,000')],
    ['an object', free({ a: 1 })],
    ['a boolean', free(true)],
    ['null', free(null)],
    ['Infinity', free('Infinity')],
    ['a huge exponent', free('1e400')],
    ['a percent of NaN', { type: 'percent', percent: 'NaN' }],
    ['a percent of Infinity', { type: 'percent', percent: 'Infinity' }],
    ['a percent as an array', { type: 'percent', percent: [50] }],
    ['a bad change order id', { type: 'change_order', change_order_id: 'not-a-uuid' }],
    ['no change order id', { type: 'change_order' }],
    ['a bad draw id', { type: 'draw', progress_billing_id: '1' }],
    ['an unknown type', { type: 'bonus', amount: 1, description: 'x' }],
    ['a capitalised type', { type: 'Free', amount: 1, description: 'x' }],
    ['a scalar', 7],
    ['a nested array', [free(1)]],
    ['no description', { type: 'free', amount: 1 }],
    ['a blank description', { type: 'free', amount: 1, description: '   ' }],
  ])('refuses a line of %s', async (_name, line) => {
    const p = await newProject();
    expect(await refused(newInvoice(p.id, [line]))).toBeTruthy();
  });

  it.each([['a scalar', '5'], ['an object', '{}'], ['null', 'null'], ['a string', '"x"']])('refuses lines that are %s', async (_name, lines) => {
    expect(await refused(t.as('owner', `insert into public.invoices (title, status, lines) values ('x', 'Draft', $1)`, [lines]))).toBeTruthy();
  });

  it('keeps nothing a client adds to a line, and prices it itself', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id, { material_cost: 250 });
    const inv = await newInvoice(p.id, [
      { type: 'change_order', change_order_id: co.id, amount: 1, percent: 100 },
      { type: 'percent', percent: 10, amount: 1, change_order_id: co.id },
      { type: 'free', description: 'x', amount: 5, percent: 90, change_order_id: co.id, progress_billing_id: co.id },
    ]);
    expect(inv.lines.map((l: Row) => Number(l.amount))).toEqual([250, 10000, 5]);
    expect(inv.lines[2]).toEqual({ type: 'free', description: 'x', amount: 5 });
    // The free line's stray 90 does not count on the cap
    const other = await newInvoice(p.id, [{ type: 'percent', percent: 90 }]);
    expect(Number(other.amount)).toBe(90000);
  });

  it('200 lines pass and 201 are refused', async () => {
    const lines = Array.from({ length: 200 }, () => free(1));
    expect(Number((await newInvoice(null, lines)).amount)).toBe(200);
    expect(await refused(newInvoice(null, [...lines, free(1)]))).toMatch(/200/);
  });

  it('an invoice too big for the column is refused and leaves it alone', async () => {
    const inv = await newInvoice(null, [free(1)]);
    expect(await refused(save('owner', inv.id, {}, [free(999999999999.99), free(999999999999.99)]))).toBeTruthy();
    expect(Number((await get('invoices', inv.id)).amount)).toBe(1);
  });

  it('save_invoice takes no status, money or number, and no tax or holdback out of range', async () => {
    const inv = await newInvoice(null, [free(100)]);
    const after = await save('owner', inv.id, { status: 'Paid', total: 1, amount: 1, gst: 1, invoice_number: '1', company_id: rivalCompany, paid_at: '2000-01-01' }, null);
    expect(after.status).toBe('Draft');
    expect(after.invoice_number).toBe(inv.invoice_number);
    expect(after.company_id).toBe(company);
    expect(Number(after.total)).toBe(Number(inv.total));
    for (const f of [{ tax_pct: 100.01 }, { tax_pct: -0.01 }, { holdback_pct: 100.01 }, { holdback_pct: -1 }, { tax_pct: 'NaN' }, { holdback_pct: 'NaN' }]) {
      expect(await refused(save('owner', inv.id, f, null)), JSON.stringify(f)).toBeTruthy();
    }
  });

  it('save_invoice cannot edit anything but a draft', async () => {
    const inv = await newInvoice(null, [free(100)]);
    await setInvoice(inv.id, 'Sent');
    expect(await refused(save('owner', inv.id, { title: 'x' }, null))).toMatch(/draft/i);
    expect(await refused(save('owner', inv.id, {}, [free(1)]))).toMatch(/draft/i);
    await setInvoice(inv.id, 'Void');
    expect(await refused(save('owner', inv.id, {}, [free(1)]))).toMatch(/draft/i);
  });

  it('[BUG] a percent line is repriced when the contract moved before the invoice is sent', async () => {
    const p = await newProject(100000);
    const inv = await newInvoice(p.id, [{ type: 'percent', percent: 10 }]);
    expect(Number(inv.amount)).toBe(10000);
    await t.as('pm', 'update public.projects set contract_value = 200000 where id = $1', [p.id]);
    const sent = await setInvoice(inv.id, 'Sent');
    expect(Number(sent.amount), `the invoice went out saying 10% of the contract is ${sent.amount}`).toBe(20000);
  });
});

describe('percent cap boundaries', () => {
  it('exactly 100 across invoices passes, a ten-thousandth more does not', async () => {
    const p = await newProject(10000);
    await newInvoice(p.id, [{ type: 'percent', percent: 99.9999 }]);
    expect(await refused(newInvoice(p.id, [{ type: 'percent', percent: 0.0002 }]))).toMatch(/billed/);
    expect(Number((await newInvoice(p.id, [{ type: 'percent', percent: 0.0001 }])).amount)).toBe(0.01);
  });

  it('rounding to four places cannot sneak past the cap', async () => {
    const p = await newProject(10000);
    const a = await newInvoice(p.id, [{ type: 'percent', percent: 100.00004 }]);
    expect(Number(a.lines[0].percent)).toBe(100);
    expect(await refused(newInvoice(p.id, [{ type: 'percent', percent: 0.0001 }]))).toBeTruthy();
    expect(await refused(newInvoice(p.id, [{ type: 'percent', percent: 0.00001 }]))).toMatch(/above 0/);
  });

  it('within one invoice, in percent written as text or exponent, the cap holds', async () => {
    const p = await newProject(10000);
    expect(await refused(newInvoice(p.id, [{ type: 'percent', percent: '60' }, { type: 'percent', percent: '6e1' }]))).toMatch(/billed/);
  });

  it('a draft counts on the cap, a void one does not, and a void one cannot come back', async () => {
    const p = await newProject(10000);
    const a = await newInvoice(p.id, [{ type: 'percent', percent: 100 }]);
    expect(await refused(newInvoice(p.id, [{ type: 'percent', percent: 1 }]))).toBeTruthy();
    await setInvoice(a.id, 'Void');
    await newInvoice(p.id, [{ type: 'percent', percent: 100 }]);
    expect(await refused(setInvoice(a.id, 'Draft'))).toBeTruthy();
  });

  it('[BUG] two 50% invoices cannot bill more dollars than the contract', async () => {
    const p = await newProject(100.01);
    const a = await newInvoice(p.id, [{ type: 'percent', percent: 50 }]);
    const b = await newInvoice(p.id, [{ type: 'percent', percent: 50 }]);
    expect(Number(a.amount) + Number(b.amount)).toBeLessThanOrEqual(100.01);
    expect(Number(b.amount)).toBe(50);
    expect(pricePercentLines([{ type: 'percent', percent: 50, amount: 0 }], 100.01, 50.01, 1)[0].amount, 'the preview comes off the same cent').toBe(50);
  });

  it('within one invoice the last percent line takes the cent, and the preview agrees', async () => {
    const p = await newProject(100.01);
    const lines: { type: string; percent?: number; description?: string; amount?: number }[] = [{ type: 'percent', percent: 50 }, { type: 'free', description: 'x', amount: 5 }, { type: 'percent', percent: 50 }];
    const inv = await newInvoice(p.id, lines);
    expect(inv.lines.map((l: Row) => Number(l.amount))).toEqual([50.01, 5, 50]);
    expect(pricePercentLines(lines, 100.01, 0, 0).map((l) => Number(l.amount))).toEqual([50.01, 5, 50]);
  });

  it('percents under the cap are refused when the contract came down too far for the dollars already billed', async () => {
    const p = await newProject(100000);
    await newInvoice(p.id, [{ type: 'percent', percent: 50 }]);
    await t.as('pm', 'update public.projects set contract_value = 60000 where id = $1', [p.id]);
    expect(await refused(newInvoice(p.id, [{ type: 'percent', percent: 50 }]))).toMatch(/too much/);
    expect(pricePercentLines([{ type: 'percent', percent: 50, amount: 0 }], 60000, 50000, 1)[0].amount).toBe(30000);
  });
});

describe('double submit', () => {
  it('approving twice keeps the first stamp, and a second signer is refused', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    const [again] = await approve(co.id);
    expect(again.approved_at).toEqual(co.approved_at);
    expect(Number((await get('projects', p.id)).approved_changes)).toBe(100);
    expect(await refused(approve(co.id, 'pm', 'Someone Else'))).toMatch(/locked/);
  });

  it('reopening twice does nothing more', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]);
    expect(await refused(t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]))).toBeNull();
    expect(Number((await get('projects', p.id)).approved_changes)).toBe(0);
  });

  it('saving an invoice twice with one change order line keeps one claim and one set of totals', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    const inv = await newInvoice(p.id);
    const lines = [{ type: 'change_order', change_order_id: co.id }];
    const first = await save('owner', inv.id, {}, lines);
    const second = await save('owner', inv.id, {}, lines);
    expect(second.total).toEqual(first.total);
    expect(second.invoice_number).toBe(inv.invoice_number);
    expect((await get('change_orders', co.id)).invoice_id).toBe(inv.id);
  });

  it('Create invoice twice gives one invoice and burns one number', async () => {
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 100 });
    const before = await counter(company, 'invoice');
    const a = await fromDraw('owner', draw.id);
    const b = await fromDraw('owner', draw.id);
    expect(b).toBe(a);
    expect(await counter(company, 'invoice')).toBe(before + 1);
    expect(await t.asSystem(`select id from public.invoices where lines @> $1::jsonb`, [JSON.stringify([{ progress_billing_id: draw.id }])])).toHaveLength(1);
  });

  it('sending or paying twice keeps one receivable', async () => {
    const inv = await newInvoice(null, [free(100)]);
    await setInvoice(inv.id, 'Sent');
    await setInvoice(inv.id, 'Sent');
    expect(await receivableOf(inv.id)).toHaveLength(1);
    await setInvoice(inv.id, 'Paid');
    await setInvoice(inv.id, 'Paid');
    const recs = await receivableOf(inv.id);
    expect(recs).toHaveLength(1);
    expect(recs[0].status).toBe('Collected');
  });

  it('a refused save burns no number', async () => {
    const before = await counter(company, 'invoice');
    expect(await refused(newInvoice(null, [free('oops')]))).toBeTruthy();
    expect(await counter(company, 'invoice')).toBe(before);
    const a = await newInvoice(null);
    expect(Number(a.invoice_number)).toBe(before + 1);
  });

  it('one change order on two invoices, whichever path', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    const line = { type: 'change_order', change_order_id: co.id };
    const a = await newInvoice(p.id, [line]);
    expect(await refused(newInvoice(p.id, [line]))).toMatch(/another invoice/);
    const b = await newInvoice(p.id);
    expect(await refused(save('owner', b.id, {}, [line]))).toMatch(/another invoice/);
    await setInvoice(a.id, 'Sent');
    expect(await refused(save('owner', b.id, {}, [line]))).toMatch(/another invoice/);
    await setInvoice(a.id, 'Void');
    expect((await get('change_orders', co.id)).invoice_id).toBeNull();
    await save('owner', b.id, {}, [line]);
    expect((await get('change_orders', co.id)).invoice_id).toBe(b.id);
    // The void one keeps its history but cannot steal it back
    expect(await refused(setInvoice(a.id, 'Sent'))).toBeTruthy();
    expect((await get('change_orders', co.id)).invoice_id).toBe(b.id);
  });

  it('one draw on two invoices is refused', async () => {
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 100 });
    await fromDraw('owner', draw.id);
    expect(await refused(newInvoice(p.id, [{ type: 'draw', progress_billing_id: draw.id }]))).toMatch(/another invoice/);
  });

  it('an invoice cannot claim a change order by moving project around it', async () => {
    const p = await newProject();
    const p2 = await newProject();
    const co = await approvedCo(p.id);
    const inv = await newInvoice(p.id, [{ type: 'change_order', change_order_id: co.id }]);
    expect(await refused(save('owner', inv.id, { project_id: p2.id }, null))).toMatch(/different project/);
    expect((await get('invoices', inv.id)).project_id).toBe(p.id);
  });
});

describe('deleting referenced records', () => {
  it('an approved change order cannot go, on an invoice or not', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    expect(await refused(t.as('pm', 'delete from public.change_orders where id = $1', [co.id]))).toMatch(/approved/);
    expect(await refused(t.as('owner', 'delete from public.change_orders where id = $1', [co.id]))).toMatch(/approved/);
    expect(Number((await get('projects', p.id)).approved_changes)).toBe(100);
  });

  it('a billed change order cannot be reopened and deleted around its invoice', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    const inv = await newInvoice(p.id, [{ type: 'change_order', change_order_id: co.id }]);
    expect(await refused(t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]))).toMatch(/invoice/);
    await setInvoice(inv.id, 'Sent');
    await setInvoice(inv.id, 'Draft');
    expect(await refused(t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]))).toMatch(/invoice/);
    expect(await get('change_orders', co.id)).toBeTruthy();
  });

  it('a project with a billing record cannot be deleted out from under it', async () => {
    for (const make of [
      async (pid: string) => approvedCo(pid),
      async (pid: string) => newCo(pid),
      async (pid: string) => newInvoice(pid, [{ type: 'percent', percent: 1 }]),
      async (pid: string) => ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: pid }),
    ]) {
      const p = await newProject();
      await make(p.id);
      expect(await refused(t.as('owner', 'delete from public.projects where id = $1', [p.id]))).toBeTruthy();
      expect(await get('projects', p.id)).toBeTruthy();
    }
  });

  it('a client on an invoice cannot be deleted out from under it', async () => {
    const [{ id: client }] = await t.as<{ id: string }>('owner', `insert into public.crm (title, status) values ('Client', 'Lead') returning id`);
    const inv = await newInvoice(null, [free(1)], { client_id: client });
    await setInvoice(inv.id, 'Sent');
    expect(await refused(t.as('owner', 'delete from public.crm where id = $1', [client]))).toBeTruthy();
    expect((await get('invoices', inv.id)).client_id).toBe(client);
  });

  it('a draw on an invoice cannot go, and goes once the invoice is void', async () => {
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 100 });
    const invId = await fromDraw('owner', draw.id);
    expect(await refused(t.as('owner', 'delete from public.progress_billing where id = $1', [draw.id]))).toMatch(/invoice/);
    await setInvoice(invId, 'Void');
    expect(await t.as('owner', 'delete from public.progress_billing where id = $1 returning id', [draw.id])).toHaveLength(1);
  });

  it('a receivable from an invoice cannot go; a Sent or Paid or Void invoice cannot go', async () => {
    const inv = await newInvoice(null, [free(1)]);
    await setInvoice(inv.id, 'Sent');
    const [rec] = await receivableOf(inv.id);
    expect(await refused(t.as('owner', 'delete from public.receivables where id = $1', [rec.id]))).toMatch(/follows/);
    expect(await refused(t.as('owner', 'delete from public.invoices where id = $1', [inv.id]))).toMatch(/draft/i);
    await setInvoice(inv.id, 'Paid');
    expect(await refused(t.as('owner', 'delete from public.invoices where id = $1', [inv.id]))).toMatch(/draft/i);
    await setInvoice(inv.id, 'Sent');
    await setInvoice(inv.id, 'Void');
    expect(await refused(t.as('owner', 'delete from public.invoices where id = $1', [inv.id]))).toMatch(/draft/i);
  });

  it('deleting a draft that came back from Sent releases everything it held', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 100 });
    const inv = await newInvoice(p.id, [{ type: 'change_order', change_order_id: co.id }, { type: 'draw', progress_billing_id: draw.id }]);
    await setInvoice(inv.id, 'Sent');
    await setInvoice(inv.id, 'Draft');
    expect(await receivableOf(inv.id)).toEqual([]);
    await t.as('owner', 'delete from public.invoices where id = $1', [inv.id]);
    expect((await get('change_orders', co.id)).invoice_id).toBeNull();
    const d = await get('progress_billing', draw.id);
    expect(d.invoice_id).toBeNull();
    expect(d.status).toBe('Draft');
  });

  it('a deleted draft\'s number is not reused', async () => {
    const a = await newInvoice(null);
    await t.as('owner', 'delete from public.invoices where id = $1', [a.id]);
    const b = await newInvoice(null);
    expect(Number(b.invoice_number)).toBe(Number(a.invoice_number) + 1);
  });
});

describe('receivables and draws, directly', () => {
  it('a client cannot change, relink or reprice a receivable from an invoice, or mark it collected', async () => {
    const inv = await newInvoice(null, [free(100)]);
    await setInvoice(inv.id, 'Sent');
    const [rec] = await receivableOf(inv.id);
    for (const set of [`status = 'Collected'`, 'amount = 1', 'invoice_id = null', `due_date = '2000-01-01'`, `title = 'x'`]) {
      expect(await refused(t.as('owner', `update public.receivables set ${set} where id = $1`, [rec.id])), set).toMatch(/follows/);
    }
  });

  it('a client cannot link a hand-made receivable to an invoice, and picks no aged status', async () => {
    const inv = await newInvoice(null, [free(100)]);
    const r = await ins('owner', 'receivables', { title: 'R', status: '90+ Days', invoice_id: inv.id, due_date: '2099-01-01' });
    expect(r.invoice_id).toBeNull();
    expect(r.status).toBe('Current');
    const [u] = await t.as<Row>('owner', `update public.receivables set invoice_id = $2, status = '90+ Days' where id = $1 returning *`, [r.id, inv.id]);
    expect(u.invoice_id).toBeNull();
    expect(u.status).toBe('Current');
  });

  it('holds the right money through Sent, Draft, edit and Sent again', async () => {
    const inv = await newInvoice(null, [free(1000)]);
    await setInvoice(inv.id, 'Sent');
    expect(Number((await receivableOf(inv.id))[0].amount)).toBe(950); // 1000 + 50 tax - 100 holdback
    await setInvoice(inv.id, 'Draft');
    expect(await receivableOf(inv.id)).toEqual([]);
    await save('owner', inv.id, {}, [free(2000)]);
    await setInvoice(inv.id, 'Sent');
    const recs = await receivableOf(inv.id);
    expect(recs).toHaveLength(1);
    expect(Number(recs[0].amount)).toBe(1900);
  });

  it('a 300 character title does not break the receivable', async () => {
    const inv = await newInvoice(null, [free(1)], { title: 'T'.repeat(300) });
    expect(await refused(setInvoice(inv.id, 'Sent'))).toBeNull();
    expect((await receivableOf(inv.id))[0].title).toHaveLength(300);
  });

  it('Paid sets it collected and undoing reverses, with a draw following along', async () => {
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 1000, holdback_percent: 10 });
    const invId = await fromDraw('owner', draw.id);
    await setInvoice(invId, 'Sent');
    await setInvoice(invId, 'Paid');
    expect((await get('progress_billing', draw.id)).status).toBe('Paid');
    expect((await receivableOf(invId))[0].status).toBe('Collected');
    expect((await get('invoices', invId)).paid_at).toBeTruthy();
    await setInvoice(invId, 'Sent');
    expect((await get('progress_billing', draw.id)).status).toBe('Invoiced');
    expect((await receivableOf(invId))[0].status).toBe('Current');
    expect((await get('invoices', invId)).paid_at).toBeNull();
  });

  it('a draw invoice: tax from the company, holdback from the draw, withheld once from pre-tax', async () => {
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 1000.05, holdback_percent: 10 });
    const inv = await get('invoices', await fromDraw('owner', draw.id));
    expect(Number(inv.tax_pct)).toBe(11);
    expect(Number(inv.amount)).toBe(1000.05);
    expect(Number(inv.gst)).toBe(110.01);
    expect(Number(inv.holdback_amount)).toBe(100.01);
    expect(Number(inv.total)).toBe(1010.05);
    expect(inv.status).toBe('Draft');
    expect(await receivableOf(inv.id)).toEqual([]);
  });

  it('a draw held 0% stays 0%, not the company default', async () => {
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 100, holdback_percent: 0 });
    const inv = await get('invoices', await fromDraw('owner', draw.id));
    expect(Number(inv.holdback_pct)).toBe(0);
  });

  it('a client cannot set a draw Paid or Invoiced, or link or relink one', async () => {
    const p = await newProject();
    const p2 = await newProject();
    const inv = await newInvoice(p.id);
    expect(await refused(ins('pm', 'progress_billing', { title: 'D', status: 'Paid', project_id: p.id }))).toBeTruthy();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 100, invoice_id: inv.id });
    expect(draw.invoice_id).toBeNull();
    expect(await refused(t.as('pm', `update public.progress_billing set status = 'Invoiced' where id = $1`, [draw.id]))).toBeTruthy();
    const [u] = await t.as<Row>('pm', 'update public.progress_billing set invoice_id = $2 where id = $1 returning *', [draw.id, inv.id]);
    expect(u.invoice_id).toBeNull();
    const invId = await fromDraw('owner', draw.id);
    expect(await refused(t.as('pm', 'update public.progress_billing set amount_billed = 1 where id = $1', [draw.id]))).toBeTruthy();
    expect(await refused(t.as('pm', 'update public.progress_billing set project_id = $2 where id = $1', [draw.id, p2.id]))).toBeTruthy();
    expect((await get('progress_billing', draw.id)).invoice_id).toBe(invId);
  });
});

describe('the contract rollup', () => {
  it('cannot be written by hand and survives every direction of change', async () => {
    const p = await newProject(1000, 'pm', { end_date: '2027-01-10' });
    const a = await approvedCo(p.id, { material_cost: 100.1, days_impact: 2.5 });
    await approvedCo(p.id, { material_cost: 200.2, days_impact: -1 });
    let row = await get('projects', p.id);
    expect(Number(row.approved_changes)).toBe(300.3);
    expect(Number(row.revised_contract)).toBe(1300.3);
    expect(Number(row.approved_days)).toBe(2); // 3 - 1
    await t.as('pm', `update public.projects set approved_changes = 9, revised_contract = 9, approved_days = 9, revised_end_date = '2000-01-01' where id = $1`, [p.id]);
    const forged = await get('projects', p.id);
    expect(Number(forged.revised_contract)).toBe(1300.3);
    expect(String(forged.revised_end_date)).not.toContain('2000');
    await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [a.id]);
    row = await get('projects', p.id);
    expect(Number(row.approved_changes)).toBe(200.2);
    expect(Number(row.approved_days)).toBe(-1);
    await t.as('pm', 'delete from public.change_orders where id = $1', [a.id]);
    expect(Number((await get('projects', p.id)).approved_changes)).toBe(200.2);
  });

  it('a project with no contract value still adds up, and one with no end date has no revised end', async () => {
    const p = await newProject(null);
    await approvedCo(p.id, { material_cost: 75, days_impact: 3 });
    const row = await get('projects', p.id);
    expect(Number(row.revised_contract)).toBe(75);
    expect(row.revised_end_date).toBeNull();
  });

  it('budget cost is frozen while approved even if the company rate moves', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id, { material_cost: 0, labour_hours: 10, labour_rate: 100 });
    expect(Number(co.budget_cost)).toBe(600);
    await t.as('owner', 'update public.companies set default_labour_rate = 70');
    const [noop] = await approve(co.id);
    expect(Number(noop.budget_cost)).toBe(600);
    await t.as('owner', 'update public.companies set default_labour_rate = 60');
  });
});

describe('rounding: the preview and the database agree to the cent', () => {
  function rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }
  const round = (x: number, dp: number) => Number(x.toFixed(dp));

  it('on change orders', async () => {
    const r = rng(42);
    const misses: unknown[] = [];
    for (let i = 0; i < 120; i++) {
      const scale = [10, 1000, 100000, 1000000][i % 4];
      const input = {
        material_cost: round(r() * scale - (i % 7 === 0 ? scale / 2 : 0), 2),
        labour_hours: round(r() * 500, 3),
        labour_rate: round(r() * 200, 2),
        markup_pct: round(r() * 40, 3),
        tax_pct: [0, 5, 6, 7.25, 11, 12.5, 13, 14.975, 15][i % 9],
      };
      const [{ id: rowId }] = await t.as<Row>('pm', `insert into public.change_orders (title, status, material_cost, labour_hours, labour_rate, markup_pct, tax_pct) values ('f', 'Draft', $1, $2, $3, $4, $5) returning id`, [input.material_cost, input.labour_hours, input.labour_rate, input.markup_pct, input.tax_pct]);
      const row = await get('change_orders', rowId as string);
      const js = changeOrderTotals(input);
      const budget = changeOrderBudgetCost(input, 60);
      if (js.price !== Number(row.price) || js.tax !== Number(row.tax) || js.total !== Number(row.total) || budget !== Number(row.budget_cost)) misses.push({ input, js, budget, row });
    }
    expect(misses).toEqual([]);
  }, 120_000);

  it('on half-cent traps', async () => {
    const traps = [
      { material_cost: 0.5, labour_hours: 0, labour_rate: 0, markup_pct: 1, tax_pct: 0 },
      { material_cost: 1.5, labour_hours: 0, labour_rate: 0, markup_pct: 1, tax_pct: 0 },
      { material_cost: 1000.1, labour_hours: 0, labour_rate: 0, markup_pct: 0, tax_pct: 0.05 },
      { material_cost: 0, labour_hours: 1.005, labour_rate: 1, markup_pct: 0, tax_pct: 0 },
      { material_cost: 0, labour_hours: 2.675, labour_rate: 1, markup_pct: 0, tax_pct: 0 },
      { material_cost: -0.5, labour_hours: 0, labour_rate: 0, markup_pct: 1, tax_pct: 0 },
      { material_cost: -1.5, labour_hours: 0, labour_rate: 0, markup_pct: 1, tax_pct: 5 },
      { material_cost: 8.35, labour_hours: 0, labour_rate: 0, markup_pct: 10, tax_pct: 10 },
      { material_cost: 1234567.89, labour_hours: 0, labour_rate: 0, markup_pct: 12.5, tax_pct: 14.975 },
      { material_cost: 99999999.99, labour_hours: 0, labour_rate: 0, markup_pct: 0.5, tax_pct: 0.5 },
    ];
    for (const input of traps) {
      const [{ id: rowId }] = await t.as<Row>('pm', `insert into public.change_orders (title, status, material_cost, labour_hours, labour_rate, markup_pct, tax_pct) values ('f', 'Draft', $1, $2, $3, $4, $5) returning id`, [input.material_cost, input.labour_hours, input.labour_rate, input.markup_pct, input.tax_pct]);
      const row = await get('change_orders', rowId as string);
      const js = changeOrderTotals(input);
      expect({ input, price: js.price, tax: js.tax, total: js.total }).toEqual({ input, price: Number(row.price), tax: Number(row.tax), total: Number(row.total) });
    }
  });

  it('on invoices with credits', async () => {
    const r = rng(7);
    const misses: unknown[] = [];
    for (let i = 0; i < 120; i++) {
      const lines = Array.from({ length: 1 + (i % 5) }, () => ({ type: 'free', description: 'x', amount: round((r() - 0.3) * [1, 100, 10000, 1000000][i % 4], 3) }));
      const tax = [0, 5, 6, 7.25, 11, 12.5, 13, 14.975, 15][i % 9];
      const holdback = [0, 2.5, 5, 7.5, 10, 12.345, 100][i % 7];
      const row = await newInvoice(null, lines, { tax_pct: tax, holdback_pct: holdback });
      const js = invoiceTotals(lines, tax, holdback);
      if (js.subtotal !== Number(row.amount) || js.tax !== Number(row.gst) || js.holdback !== Number(row.holdback_amount) || js.total !== Number(row.total)) misses.push({ lines, tax, holdback, js, row: [row.amount, row.gst, row.holdback_amount, row.total] });
    }
    expect(misses).toEqual([]);
  }, 120_000);

  it('total is always subtotal + tax - holdback, exactly', async () => {
    const inv = await newInvoice(null, [free(0.05)], { tax_pct: 5, holdback_pct: 10 });
    expect([Number(inv.amount), Number(inv.gst), Number(inv.holdback_amount), Number(inv.total)]).toEqual([0.05, 0, 0.01, 0.04]);
    const credit = await newInvoice(null, [free(-0.05)], { tax_pct: 5, holdback_pct: 10 });
    expect([Number(credit.amount), Number(credit.gst), Number(credit.holdback_amount), Number(credit.total)]).toEqual([-0.05, 0, -0.01, -0.04]);
    const half = await newInvoice(null, [free(1.005), free(-1.005)], { tax_pct: 0, holdback_pct: 0 });
    expect(Number(half.total)).toBe(0);
  });

  it.each([[10000, 33.3333], [123456.78, 33.33], [100.01, 50], [1234567.89, 12.5], [0.03, 50], [9999999.99, 0.0001]])('percent line on %s at %s%%', async (contract, percent) => {
    const p = await newProject(contract);
    const inv = await newInvoice(p.id, [{ type: 'percent', percent }]);
    expect(percentAmount(contract, percent)).toBe(Number(inv.lines[0].amount));
  });

  it('[BUG] percent line previewed at more than four places matches what the database charges', async () => {
    const p = await newProject(1000000);
    const inv = await newInvoice(p.id, [{ type: 'percent', percent: 33.33335 }]);
    expect(percentAmount(1000000, 33.33335)).toBe(Number(inv.lines[0].amount));
    expect(InvoiceLinesSchema.parse([{ type: 'percent', percent: 33.33335 }])[0]).toMatchObject({ percent: 33.3334 });
    expect(InvoiceLinesSchema.safeParse([{ type: 'percent', percent: 0.00001 }]).success, 'rounds to nothing, as it does in the database').toBe(false);
    expect(InvoiceLinesSchema.parse([{ type: 'percent', percent: 100.00004 }])[0]).toMatchObject({ percent: 100 });
  });

  it.each([[-1, 'Current'], [0, 'Current'], [29, 'Current'], [30, '30 Days'], [59, '30 Days'], [60, '60 Days'], [89, '60 Days'], [90, '90+ Days'], [91, '90+ Days']])('receivable age at %s days past due', async (days, want) => {
    const [row] = await t.as<{ s: string }>('owner', 'select public.receivable_age_status((current_date - $1::integer)::date) as s', [days]);
    expect(row.s).toBe(want);
    expect(receivableAge(days as number)).toBe(want);
  });
});

describe('a database with records from before this engine', () => {
  const OWNER = id(50);
  const COMPANY = '11111111-1111-4111-8111-111111111150';
  const PROJECT = '33333333-3333-4333-8333-333333333350';
  let old: TestDb<never>;

  const asOwner = async <T = Row>(sql: string, params: unknown[] = []): Promise<T[]> => {
    await old.pg.exec('reset role');
    await old.pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
    await old.pg.exec('set role authenticated');
    try {
      return (await old.pg.query<T>(sql, params)).rows;
    } finally {
      await old.pg.exec('reset role');
    }
  };

  beforeAll(async () => {
    const photos = '20261101000100_job_photos_storage.sql';
    old = (await bootDb({}, { include: (f) => f === BASELINE_FILE || f === photos, baselineSql: readFileSync(OLD_BASELINE_FIXTURE, 'utf8') })) as unknown as TestDb<never>;
    await old.pg.exec(`
      insert into auth.users (id, email) values ('${OWNER}', 'owner@old.ca');
      insert into public.companies (id, name, province, subscription_status, trial_ends_at) values ('${COMPANY}', 'Old', 'SK', 'active', now() + interval '1 year');
      insert into public.company_users (user_id, company_id, role) values ('${OWNER}', '${COMPANY}', 'owner');
      insert into public.projects (id, company_id, title, status, contract_value) values ('${PROJECT}', '${COMPANY}', 'Old Job', 'Active', 5000);
      insert into public.change_orders (company_id, title, status, project_name, cost_impact) values
        ('${COMPANY}', 'No price', 'Approved', 'Old Job', null),
        ('${COMPANY}', 'Billed by the old app', 'Invoiced', 'Old Job', 500),
        ('${COMPANY}', 'Waiting', 'Pending Approval', 'Old Job', 200);
      insert into public.invoices (company_id, title, status, amount, gst) values
        ('${COMPANY}', 'Old sent', 'Sent', 1000, 50),
        ('${COMPANY}', 'Old draft', 'Draft', 100000, 5004),
        ('${COMPANY}', 'Old typed', 'Sent', 700, 35);
      insert into public.receivables (company_id, title, status, amount) values
        ('${COMPANY}', 'Old typed', 'Current', 735),
        ('${COMPANY}', 'Unrelated, same money', 'Current', 1050);
      insert into public.progress_billing (company_id, title, status, amount_billed) values
        ('${COMPANY}', 'Already invoiced by hand', 'Invoiced', 1000),
        ('${COMPANY}', 'Marked by mistake', 'Invoiced', 10);
    `);
    for (const f of migrationFiles()) if (f !== BASELINE_FILE && f !== photos) await old.pg.exec(readMigration(f));
  }, 180_000);

  it('[BUG] an approved change order that never had a price cannot be billed for nothing', async () => {
    const [co] = (await old.pg.query<Row>(`select id, status, price, project_id from public.change_orders where title = 'No price'`)).rows;
    expect(co.status).toBe('Approved');
    expect(co.price).toBeNull();
    await old.pg.query('update public.change_orders set project_id = $1 where id = $2', [PROJECT, co.id]);
    const message = await asOwner(
      `insert into public.invoices (title, status, project_id, lines) values ('New', 'Draft', $1, $2) returning id, amount, lines`,
      [PROJECT, JSON.stringify([{ type: 'change_order', change_order_id: co.id }])],
    ).then(
      (rows) => rows,
      () => null,
    );
    expect(message, `it was billed: ${JSON.stringify(message)}`).toBeNull();
  });

  it('[BUG] a draw the old app already marked Invoiced is not invoiced a second time', async () => {
    const [draw] = (await old.pg.query<Row>(`select id, status, invoice_id from public.progress_billing where title like 'Already%'`)).rows;
    expect(draw.status).toBe('Invoiced');
    expect(draw.invoice_id).toBeNull();
    const result = await asOwner<{ id: string }>('select public.create_invoice_from_draw($1) as id', [draw.id]).then(
      (rows) => rows[0]?.id ?? null,
      () => null,
    );
    expect(result, 'a second invoice was created for it').toBeNull();
  });

  it('old statuses and links land where the spec says, and old approved change orders count on the contract', async () => {
    const rows = (await old.pg.query<Row>('select title, status, project_id, price, co_number from public.change_orders order by title')).rows;
    expect(rows.find((r) => r.title === 'Waiting')!.status).toBe('Sent');
    expect(rows.find((r) => r.title === 'Billed by the old app')!.status).toBe('Approved');
    expect(rows.find((r) => r.title === 'Billed by the old app')!.project_id).toBe(PROJECT);
    expect(rows.every((r) => r.co_number)).toBe(true);
    const [p] = (await old.pg.query<Row>('select approved_changes, revised_contract from public.projects where id = $1', [PROJECT])).rows;
    expect(Number(p.approved_changes)).toBe(500);
    expect(Number(p.revised_contract)).toBe(5500);
    const invoices = (await old.pg.query<Row>('select invoice_number from public.invoices order by invoice_number')).rows;
    expect(invoices.slice(0, 2).map((r) => r.invoice_number)).toEqual(['1001', '1002']);
  });

  it('[BUG] a change order the old app marked Invoiced cannot be billed a second time', async () => {
    const [co] = (await old.pg.query<Row>(`select id from public.change_orders where title = 'Billed by the old app'`)).rows;
    const billed = await asOwner<Row>(
      `insert into public.invoices (title, status, project_id, lines) values ('Second billing', 'Draft', $1, $2) returning id, amount`,
      [PROJECT, JSON.stringify([{ type: 'change_order', change_order_id: co.id }])],
    ).then(
      (rows) => rows[0],
      () => null,
    );
    expect(billed, `the old app already invoiced this change order, and it billed again for ${billed?.amount}`).toBeNull();
  });

  it('[BUG] an invoice the old app had Sent shows up in receivables', async () => {
    const [inv] = (await old.pg.query<Row>(`select id, status from public.invoices where title = 'Old sent'`)).rows;
    expect(inv.status).toBe('Sent');
    const recs = (await old.pg.query<Row>('select id, title from public.receivables where invoice_id = $1', [inv.id])).rows;
    expect(recs).toHaveLength(1);
    expect(recs[0].title, 'a receivable that only shares the amount is not this invoice').toContain('Old sent');
  });

  it('a receivable typed by hand for a sent invoice is linked, not doubled', async () => {
    const [inv] = (await old.pg.query<Row>(`select id from public.invoices where title = 'Old typed'`)).rows;
    const linked = (await old.pg.query<Row>('select title from public.receivables where invoice_id = $1', [inv.id])).rows;
    expect(linked.map((r) => r.title)).toEqual(['Old typed']);
    expect((await old.pg.query<Row>(`select id from public.receivables where title like '%Old typed%'`)).rows).toHaveLength(1);
  });

  it('a change order the old app invoiced stays approved: no reopening it, and no one can clear the mark', async () => {
    const [co] = (await old.pg.query<Row>(`select id from public.change_orders where title = 'Billed by the old app'`)).rows;
    await expect(asOwner(`update public.change_orders set status = 'Draft' where id = $1`, [co.id])).rejects.toThrow(/stays approved/);
    await expect(asOwner(`update public.change_orders set billed_in_old_app = false, status = 'Draft' where id = $1`, [co.id])).rejects.toThrow(/stays approved/);
    const [row] = await asOwner<Row>('update public.change_orders set billed_in_old_app = false where id = $1 returning billed_in_old_app', [co.id]);
    expect(row.billed_in_old_app).toBe(true);
  });

  it('an old invoiced draw can be set back to Draft by someone who knows better, then billed', async () => {
    const [draw] = (await old.pg.query<Row>(`select id from public.progress_billing where title = 'Marked by mistake'`)).rows;
    await asOwner(`update public.progress_billing set status = 'Draft' where id = $1`, [draw.id]);
    const [{ id: invoice }] = await asOwner<{ id: string }>('select public.create_invoice_from_draw($1) as id', [draw.id]);
    expect(invoice).toBeTruthy();
  });

  it('[BUG] editing only the title of an old draft does not change its hand-typed tax', async () => {
    const [before] = (await old.pg.query<Row>(`select id, gst, total from public.invoices where title = 'Old draft'`)).rows;
    expect(Number(before.gst)).toBe(5004);
    const [after] = await asOwner<Row>(`update public.invoices set title = 'Old draft, renamed' where id = $1 returning gst, total`, [before.id]);
    expect(Number(after.gst), 'renaming the invoice moved its tax').toBe(5004);
    expect(Number(after.total)).toBe(Number(before.total));
  });

  it('changing the lines of an old draft does recompute its tax', async () => {
    const [before] = (await old.pg.query<Row>(`select id, lines from public.invoices where title like 'Old draft%'`)).rows;
    const [after] = await asOwner<Row>('update public.invoices set lines = $2 where id = $1 returning amount, gst', [before.id, JSON.stringify([{ type: 'free', description: 'x', amount: 1000 }])]);
    expect(Number(after.amount)).toBe(1000);
    expect(Number(after.gst)).toBe(50);
  });

  it('running the migration a second time changes no money, marks or receivables', async () => {
    const snapshot = async () => ({
      receivables: (await old.pg.query<Row>('select id, invoice_id, amount from public.receivables order by id')).rows,
      changeOrders: (await old.pg.query<Row>('select id, status, price, billed_in_old_app, co_number from public.change_orders order by id')).rows,
      invoices: (await old.pg.query<Row>('select id, status, amount, gst, total, invoice_number from public.invoices order by id')).rows,
    });
    await old.pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
    const before = await snapshot();
    await old.pg.exec(readMigration('20261104000110_billing.sql'));
    expect(await snapshot()).toEqual(before);
  });
});

describe('second pass: PostgREST upserts', () => {
  const upsert = (who: U, table: string, row: Row) => {
    const keys = Object.keys(row);
    return t.as<Row>(who, `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) on conflict (id) do update set ${keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(', ')} returning ${table === 'change_orders' ? 'id' : '*'}`, Object.values(row));
  };

  it('cannot rewrite a Sent invoice', async () => {
    const inv = await newInvoice(null, [free(100)]);
    await setInvoice(inv.id, 'Sent');
    expect(await refused(upsert('owner', 'invoices', { id: inv.id, title: 'INV', status: 'Draft', lines: JSON.stringify([free(1)]) }))).toBeTruthy();
    expect(await refused(upsert('owner', 'invoices', { id: inv.id, title: 'INV', status: 'Sent', lines: JSON.stringify([free(1)]) }))).toBeTruthy();
    const row = await get('invoices', inv.id);
    expect(row.status).toBe('Sent');
    expect(Number(row.amount)).toBe(100);
  });

  it('cannot rewrite a Draft invoice past its rules, or change its number', async () => {
    const inv = await newInvoice(null, [free(100)]);
    const [u] = await upsert('owner', 'invoices', { id: inv.id, title: 'INV', status: 'Draft', invoice_number: '1', total: 1, lines: JSON.stringify([free(5)]) });
    expect(u.invoice_number).toBe(inv.invoice_number);
    expect(Number(u.amount)).toBe(5);
    expect(Number(u.total)).not.toBe(1);
  });

  it('cannot rewrite or unlock an approved change order', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    expect(await refused(upsert('pm', 'change_orders', { id: co.id, title: 'Rewritten', status: 'Draft', project_id: p.id }))).toMatch(/locked/);
    // An upsert reads what it sends, and nobody signed in can read a change order's money
    expect(await refused(upsert('pm', 'change_orders', { id: co.id, title: 'Change', status: 'Draft', project_id: p.id, material_cost: 1 }))).toMatch(/permission denied/);
    expect(await refused(upsert('pm', 'change_orders', { id: co.id, title: 'Change', status: 'Approved', project_id: p.id, material_cost: 1 }))).toBeTruthy();
    expect(Number((await get('change_orders', co.id)).price)).toBe(100);
  });

  it('another company cannot upsert over my row by guessing its id', async () => {
    const inv = await newInvoice(null, [free(100)]);
    const co = await newCo(null);
    expect(await refused(upsert('rival', 'invoices', { id: inv.id, title: 'hacked', status: 'Draft' }))).toBeTruthy();
    expect(await refused(upsert('rival', 'change_orders', { id: co.id, title: 'hacked', status: 'Draft' }))).toBeTruthy();
    expect((await get('invoices', inv.id)).title).toBe('INV');
    expect((await get('change_orders', co.id)).title).toBe('Change');
  });
});

describe('second pass: approval by direct write', () => {
  it.each([
    ['a tab', '\t'],
    ['a newline', '\n'],
    ['a no-break space', ' '],
  ])('[BUG] a name of only %s is not a name', async (_name, blank) => {
    const p = await newProject();
    const co = await newCo(p.id);
    expect(await refused(approve(co.id, 'pm', blank))).toBeTruthy();
  });

  it('a name with no-break spaces around it is stored without them', async () => {
    const p = await newProject();
    const [co] = await approve((await newCo(p.id)).id, 'pm', '\u00a0\tSam Client\u3000\n');
    expect(co.approved_by).toBe('Sam Client');
  });

  it('[BUG] a signature that is not an image is refused by the database', async () => {
    const p = await newProject();
    const co = await newCo(p.id);
    expect(await refused(approve(co.id, 'pm', 'Client', 'data:image/png;base64,not an image at all!!'))).toBeTruthy();
  });

  it('the forms and the route refuse those too', () => {
    expect(SignatureImage.safeParse('data:image/png;base64,not an image at all!!').success).toBe(false);
    expect(SignerName.safeParse('\t').success).toBe(false);
    expect(SignerName.safeParse(' ').success).toBe(false);
  });

  it('moving a change order to another project in the same write as approving it fixes both contracts', async () => {
    const a = await newProject(1000);
    const b = await newProject(1000);
    const co = await newCo(a.id, { material_cost: 40, status: 'Sent' });
    await t.as('pm', `update public.change_orders set status = 'Approved', project_id = $2, approved_by = 'Client', signature = $3 where id = $1`, [co.id, b.id, SIG]);
    expect(Number((await get('projects', a.id)).approved_changes)).toBe(0);
    expect(Number((await get('projects', b.id)).approved_changes)).toBe(40);
  });

  it('a null status is refused on all four tables', async () => {
    const co = await newCo(null);
    const inv = await newInvoice(null);
    expect(await refused(t.as('pm', 'update public.change_orders set status = null where id = $1', [co.id]))).toBeTruthy();
    expect(await refused(t.as('owner', 'update public.invoices set status = null where id = $1', [inv.id]))).toBeTruthy();
    expect(await refused(ins('pm', 'progress_billing', { title: 'D', status: null }))).toBeTruthy();
    expect(await refused(ins('owner', 'receivables', { title: 'R', status: null }))).toBeTruthy();
  });

  it('a foreman cannot create a change order; an electrician gets nothing from the RPCs', async () => {
    expect(await refused(newCo(null, {}, 'foreman'))).toBeTruthy();
    const inv = await newInvoice(null, [free(1)]);
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 5 });
    for (const who of ['elec', 'foreman'] as U[]) {
      expect(await refused(save(who, inv.id, { title: 'x' }, null))).toMatch(/not found/i);
      expect(await refused(fromDraw(who, draw.id))).toMatch(/not found/i);
    }
  });
});

describe('second pass: schedule impact', () => {
  it('[BUG] a schedule impact too big for a date is refused when it is saved, not left to break the project later', async () => {
    const p = await newProject(1000);
    expect(await refused(newCo(p.id, { days_impact: 3_000_000_000 }))).toBeTruthy();
    expect(await refused(newCo(p.id, { days_impact: 36501 }))).toBeTruthy();
    expect(await refused(newCo(p.id, { days_impact: -36501 }))).toBeTruthy();
    const co = await newCo(p.id, { days_impact: 36500 });
    await approve(co.id);
    expect(await refused(t.as('pm', `update public.projects set end_date = '2027-01-01' where id = $1`, [p.id])), 'the project can no longer be given an end date').toBeNull();
    // Enough of them to overflow a date still leaves the project saveable, with no revised end to show
    const [{ d }] = await t.asSystem<{ d: string | null }>(`select public.revised_end_date('2027-01-01', 3000000000) as d`);
    expect(d).toBeNull();
  });

  it('[BUG] an infinite schedule impact is refused', async () => {
    expect(await refused(newCo(null, { days_impact: 'Infinity' }))).toBeTruthy();
  });

  it('the form refuses the first of those, so it takes a direct write; a billion days, which it allows, still fits a date', () => {
    const parsed = parseRecord(getModule('change-orders')!, { title: 'x', status: 'Draft', days_impact: 3_000_000_000 }, 'create');
    expect(parsed.ok).toBe(false);
  });
});

describe('second pass: invoice rules', () => {
  it.each([
    ['title', `title = 'x'`],
    ['notes', `notes = 'x'`],
    ['client name', `client_name = 'x'`],
    ['client address', `client_address = 'x'`],
    ['due date', `due_date = '2000-01-01'`],
    ['issue date', `issue_date = '2000-01-01'`],
    ['tax', 'tax_pct = 0'],
    ['holdback', 'holdback_pct = 0'],
    ['lines', `lines = '[]'`],
    ['project', 'project_id = null'],
  ])('%s is locked on Sent, Paid, Overdue and Void', async (_name, set) => {
    const p = await newProject();
    const inv = await newInvoice(p.id, [free(100)], { due_date: '2030-01-01', issue_date: '2029-01-01' });
    await setInvoice(inv.id, 'Sent');
    expect(await refused(t.as('owner', `update public.invoices set ${set} where id = $1`, [inv.id]))).toMatch(/draft/i);
    await setInvoice(inv.id, 'Paid');
    expect(await refused(t.as('owner', `update public.invoices set ${set} where id = $1`, [inv.id]))).toMatch(/draft/i);
    await setInvoice(inv.id, 'Sent');
    await t.asService(`update public.invoices set status = 'Overdue' where id = $1`, [inv.id]);
    expect(await refused(t.as('owner', `update public.invoices set ${set} where id = $1`, [inv.id]))).toMatch(/draft/i);
    await setInvoice(inv.id, 'Void');
    expect(await refused(t.as('owner', `update public.invoices set ${set} where id = $1`, [inv.id]))).toMatch(/draft/i);
  });

  it('sending in the same write as adding a claimed change order is refused', async () => {
    const p = await newProject();
    const co = await approvedCo(p.id);
    await newInvoice(p.id, [{ type: 'change_order', change_order_id: co.id }]);
    const b = await newInvoice(p.id, [free(1)]);
    expect(await refused(t.as('owner', `update public.invoices set status = 'Sent', lines = $2 where id = $1`, [b.id, JSON.stringify([{ type: 'change_order', change_order_id: co.id }])]))).toMatch(/another invoice/);
    expect((await get('invoices', b.id)).status).toBe('Draft');
    expect(await receivableOf(b.id)).toEqual([]);
  });

  it('sending with the lines emptied in the same write is refused', async () => {
    const b = await newInvoice(null, [free(1)]);
    expect(await refused(t.as('owner', `update public.invoices set status = 'Sent', lines = '[]' where id = $1`, [b.id]))).toMatch(/at least one line/);
  });

  it('moving an invoice with percent lines onto a job already billed to 100% is refused', async () => {
    const full = await newProject(1000);
    await newInvoice(full.id, [{ type: 'percent', percent: 100 }]);
    const open = await newProject(2000);
    const inv = await newInvoice(open.id, [{ type: 'percent', percent: 10 }]);
    expect(await refused(save('owner', inv.id, { project_id: full.id }, null))).toMatch(/billed/);
    expect(await refused(t.as('owner', 'update public.invoices set project_id = $2 where id = $1', [inv.id, full.id]))).toMatch(/billed/);
    expect((await get('invoices', inv.id)).project_id).toBe(open.id);
  });

  it('a repriced percent line follows the project it moved to', async () => {
    const a = await newProject(1000);
    const b = await newProject(3000);
    const inv = await newInvoice(a.id, [{ type: 'percent', percent: 10 }]);
    const moved = await save('owner', inv.id, { project_id: b.id }, null);
    expect(Number(moved.amount)).toBe(300);
  });

  it('deleting or voiding a draft frees the cap', async () => {
    const p = await newProject(1000);
    const a = await newInvoice(p.id, [{ type: 'percent', percent: 100 }]);
    await t.as('owner', 'delete from public.invoices where id = $1', [a.id]);
    const b = await newInvoice(p.id, [{ type: 'percent', percent: 100 }]);
    await setInvoice(b.id, 'Void');
    expect(Number((await newInvoice(p.id, [{ type: 'percent', percent: 100 }])).amount)).toBe(1000);
  });

  it('after a void, a reopened and repriced change order bills at its new price', async () => {
    const p = await newProject(1000);
    const co = await approvedCo(p.id, { material_cost: 100 });
    const a = await newInvoice(p.id, [{ type: 'change_order', change_order_id: co.id }]);
    await setInvoice(a.id, 'Void');
    await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]);
    await t.as('pm', 'update public.change_orders set material_cost = 250 where id = $1', [co.id]);
    await approve(co.id);
    const b = await newInvoice(p.id, [{ type: 'change_order', change_order_id: co.id }]);
    expect(Number(b.amount)).toBe(250);
    expect(Number((await get('invoices', a.id)).amount)).toBe(100);
    expect(Number((await get('projects', p.id)).approved_changes)).toBe(250);
  });

  it('after a void, a draw can change and be invoiced again at its new amount', async () => {
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 100 });
    const a = await fromDraw('owner', draw.id);
    await setInvoice(a, 'Void');
    await t.as('pm', 'update public.progress_billing set amount_billed = 300 where id = $1', [draw.id]);
    const b = await fromDraw('owner', draw.id);
    expect(b).not.toBe(a);
    expect(Number((await get('invoices', b)).amount)).toBe(300);
    expect(Number((await get('invoices', a)).amount)).toBe(100);
  });

  it('a draw with nothing to bill burns no number, and a bad draw is refused', async () => {
    const p = await newProject();
    const before = await counter(company, 'invoice');
    const blank = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id });
    expect(await refused(fromDraw('owner', blank.id))).toMatch(/amount billed/);
    const zero = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 0 });
    expect(await refused(fromDraw('owner', zero.id))).toMatch(/amount billed/);
    expect(await counter(company, 'invoice')).toBe(before);
    for (const bad of [{ amount_billed: -1 }, { holdback_percent: 100.01 }, { holdback_percent: -0.01 }, { holdback_percent: 'NaN' }]) {
      expect(await refused(ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, ...bad })), JSON.stringify(bad)).toBeTruthy();
    }
  });

  it('the overdue job, then a person: one receivable that ends up Collected and can be undone', async () => {
    const p = await newProject();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p.id, amount_billed: 100 });
    const inv = await fromDraw('owner', draw.id);
    await t.as('owner', `update public.invoices set due_date = current_date - 45 where id = $1`, [inv]);
    await setInvoice(inv, 'Sent');
    expect((await receivableOf(inv))[0].status).toBe('30 Days');
    await t.asService(`update public.invoices set status = 'Overdue' where id = $1`, [inv]);
    expect(await receivableOf(inv)).toHaveLength(1);
    expect((await get('progress_billing', draw.id)).status).toBe('Invoiced');
    await setInvoice(inv, 'Paid');
    expect((await receivableOf(inv))[0].status).toBe('Collected');
    expect((await get('progress_billing', draw.id)).status).toBe('Paid');
    await setInvoice(inv, 'Sent');
    expect((await receivableOf(inv))[0].status).toBe('30 Days');
    expect(await refused(t.as('owner', `update public.receivables set status = 'Current' where invoice_id = $1`, [inv]))).toMatch(/follows/);
  });

  it('a credit invoice goes through as money owed back', async () => {
    const inv = await newInvoice(null, [free(-100)], { tax_pct: 5, holdback_pct: 10 });
    expect([Number(inv.amount), Number(inv.gst), Number(inv.holdback_amount), Number(inv.total)]).toEqual([-100, -5, -10, -95]);
    await setInvoice(inv.id, 'Sent');
    expect(Number((await receivableOf(inv.id))[0].amount)).toBe(-95);
  });
});

describe('second pass: numbers and company defaults', () => {
  it('a new company starts invoices at 1001 and change orders at 1, by itself', async () => {
    const fresh = await t.createCompany('fresh', 'Fresh');
    const a = await ins('fresh', 'invoices', { title: 'A', status: 'Draft', invoice_number: '7' });
    const b = await ins('fresh', 'invoices', { title: 'B', status: 'Draft' });
    expect([a.invoice_number, b.invoice_number]).toEqual(['1001', '1002']);
    const c = await ins('fresh', 'change_orders', { title: 'C', status: 'Draft', co_number: '500' });
    const d = await ins('fresh', 'change_orders', { title: 'D', status: 'Draft' });
    expect([c.co_number, d.co_number]).toEqual(['1', '2']);
    expect(await counter(fresh, 'invoice')).toBe(1002);
  });

  it('what is left blank comes from the company', async () => {
    const co = await ins('pm', 'change_orders', { title: 'C', status: 'Draft', material_cost: 100, labour_hours: 1 });
    expect([Number(co.labour_rate), Number(co.markup_pct), Number(co.tax_pct)]).toEqual([60, 20, 11]);
    expect(Number(co.price)).toBe(192); // (100 + 60) x 1.2
    expect(Number(co.tax)).toBe(21.12);
    const inv = await ins('owner', 'invoices', { title: 'I', status: 'Draft', lines: JSON.stringify([free(1000)]), issue_date: '2027-03-01' });
    expect([Number(inv.tax_pct), Number(inv.holdback_pct)]).toEqual([11, 7.5]);
    expect([Number(inv.gst), Number(inv.holdback_amount), Number(inv.total)]).toEqual([110, 75, 1035]);
    expect(new Date(inv.due_date).toISOString().slice(0, 10)).toBe('2027-03-31');
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft' });
    expect(Number(draw.holdback_percent)).toBe(7.5);
  });
});

describe('second pass: the API form', () => {
  it.each([
    ['change-orders', { status: 'Approved' }],
    ['invoices', { status: 'Overdue' }],
    ['progress-billing', { status: 'Invoiced' }],
    ['progress-billing', { status: 'Paid' }],
    ['receivables', { status: '30 Days' }],
    ['receivables', { status: '90+ Days' }],
  ])('%s refuses the system status %j', (slug, body) => {
    expect(parseRecord(getModule(slug)!, { title: 'x', ...body }, 'create').ok).toBe(false);
    expect(parseRecord(getModule(slug)!, body, 'update').ok).toBe(false);
  });

  it('drops money, numbers, links and signatures a client sends', () => {
    const co = parseRecord(getModule('change-orders')!, { title: 'x', status: 'Draft', price: 1, tax: 1, total: 1, cost_impact: 1, budget_cost: 1, co_number: '9', invoice_id: id(1), approved_by: 'x', approved_at: '2020-01-01', signature: SIG, company_id: id(1) }, 'create');
    expect(co.ok).toBe(true);
    if (co.ok) for (const k of ['price', 'tax', 'total', 'cost_impact', 'budget_cost', 'co_number', 'invoice_id', 'approved_by', 'approved_at', 'signature', 'company_id']) expect(co.data, k).not.toHaveProperty(k);
    const inv = parseRecord(getModule('invoices')!, { title: 'x', status: 'Draft', amount: 1, gst: 1, total: 1, holdback_amount: 1, invoice_number: '1', paid_at: '2020-01-01', lines: [], company_id: id(1) }, 'create');
    expect(inv.ok).toBe(true);
    if (inv.ok) for (const k of ['amount', 'gst', 'total', 'holdback_amount', 'invoice_number', 'paid_at', 'lines', 'company_id']) expect(inv.data, k).not.toHaveProperty(k);
  });

  it('the lines schema refuses NaN, Infinity and over 100, and sends no amount for a priced line', () => {
    for (const bad of [{ type: 'free', description: 'x', amount: 'NaN' }, { type: 'free', description: 'x', amount: 'Infinity' }, { type: 'free', description: '  ', amount: 1 }, { type: 'percent', percent: 100.01 }, { type: 'percent', percent: 'NaN' }, { type: 'percent', percent: 0 }, { type: 'change_order', change_order_id: 'x' }, { type: 'bonus' }]) {
      expect(InvoiceLinesSchema.safeParse([bad]).success, JSON.stringify(bad)).toBe(false);
    }
    const ok = InvoiceLinesSchema.parse([{ type: 'percent', percent: 10, amount: 999 }, { type: 'change_order', change_order_id: id(1), amount: 999 }]);
    expect(ok[0]).not.toHaveProperty('amount');
    expect(ok[1]).not.toHaveProperty('amount');
    expect(InvoiceLinesSchema.safeParse(Array.from({ length: 201 }, () => ({ type: 'percent', percent: 1 }))).success).toBe(false);
  });
});

describe('second pass: rounding at scale', () => {
  function rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it('percent lines, fuzzed: preview and database agree', async () => {
    const r = rng(99);
    const misses: unknown[] = [];
    for (let i = 0; i < 80; i++) {
      const contract = Number((r() * [1000, 100000, 10000000, 99999999][i % 4] + 0.01).toFixed(2));
      const pct = Math.min(Number((r() * 100 + 0.0001).toFixed(4)), 100);
      const p = await newProject(contract);
      const inv = await newInvoice(p.id, [{ type: 'percent', percent: pct }], { tax_pct: 0, holdback_pct: 0 });
      if (percentAmount(contract, pct) !== Number(inv.lines[0].amount)) misses.push({ contract, pct, js: percentAmount(contract, pct), db: inv.lines[0].amount });
    }
    expect(misses).toEqual([]);
  }, 120_000);

  it('big invoices, fuzzed: preview and database agree', async () => {
    const r = rng(1234);
    const misses: unknown[] = [];
    for (let i = 0; i < 80; i++) {
      const lines = Array.from({ length: 1 + (i % 3) }, () => ({ type: 'free', description: 'x', amount: Number(((r() - 0.1) * 80000000).toFixed(2)) }));
      const tax = [5, 6, 7.25, 11, 12.5, 13, 14.975, 15][i % 8];
      const holdback = [2.5, 5, 7.5, 10, 12.345, 33.333][i % 6];
      const row = await newInvoice(null, lines, { tax_pct: tax, holdback_pct: holdback });
      const js = invoiceTotals(lines, tax, holdback);
      if (js.subtotal !== Number(row.amount) || js.tax !== Number(row.gst) || js.holdback !== Number(row.holdback_amount) || js.total !== Number(row.total)) misses.push({ lines, tax, holdback, js, db: [row.amount, row.gst, row.holdback_amount, row.total] });
    }
    expect(misses).toEqual([]);
  }, 120_000);
});
