// What the fixes for the adversarial review added beyond the reproductions in tests/review.*.test.ts:
// the new rank gates, a rejected card reaching only its worker, credits, and mixed tax on one invoice.
import { beforeAll, describe, expect, it } from 'vitest';
import { bootDb, type TestDb } from './helpers/db';
import { fakeSupabase } from './helpers/fake-supabase';
import { alertsForMember, type AlertRow } from '@/lib/alerts';
import { invoiceTaxLabel, invoiceTotals, pricePercentLines } from '@/lib/billing-math';
import { withBillingIds } from '@/lib/billing';
import { parseRecord } from '@/lib/validation';
import { getModule } from '@/lib/modules';
import { withChangeOrderMoney, withCompanyRates } from '@/lib/project-money';
import type { AppContext } from '@/lib/context';

const uid = (n: number) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;
const USERS = {
  owner: { id: uid(1), email: 'owner@fix.ca' },
  pm: { id: uid(2), email: 'pm@fix.ca' },
  foreman: { id: uid(3), email: 'foreman@fix.ca' },
  elec: { id: uid(4), email: 'elec@fix.ca' },
  elec2: { id: uid(5), email: 'elec2@fix.ca' },
  rival: { id: uid(6), email: 'rival@other.ca' },
};
type U = keyof typeof USERS;
type Row = Record<string, any>;
const SIG = 'data:image/png;base64,AAAA';

let t: TestDb<U>;

const get = async (table: string, id: string) => (await t.asSystem<Row>(`select * from public.${table} where id = $1`, [id]))[0];
const ins = async (who: U, table: string, row: Row): Promise<Row> => {
  const keys = Object.keys(row);
  const [r] = await t.as<Row>(who, `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(row));
  return get(table, r.id);
};
const project = async (contract = 10000) => (await ins('owner', 'projects', { title: 'Job', status: 'Active', contract_value: contract })).id as string;
const approvedCo = async (p: string, over: Row = {}) => {
  const co = await ins('pm', 'change_orders', { title: 'CO', status: 'Draft', project_id: p, material_cost: 1000, labour_hours: 0, labour_rate: 0, markup_pct: 0, tax_pct: 5, ...over });
  await t.as('pm', `update public.change_orders set status = 'Sent' where id = $1`, [co.id]);
  await t.as('pm', `update public.change_orders set status = 'Approved', approved_by = 'Client', signature = $2 where id = $1`, [co.id, SIG]);
  return co.id as string;
};

beforeAll(async () => {
  t = await bootDb(USERS);
  await t.createCompany('owner', 'Fix Electric');
  await t.createCompany('rival', 'Rival');
  await t.join('owner', 'pm', 'project_manager');
  await t.join('owner', 'foreman', 'foreman');
  await t.join('owner', 'elec', 'electrician');
  await t.join('owner', 'elec2', 'electrician');
  await t.as('owner', 'update public.companies set default_labour_rate = 90, default_markup = 12, default_tax = 5, default_holdback_pct = 0');
}, 180_000);

describe('the functions that serve hidden columns', () => {
  it('company rates are for project managers and up, and only their own company', async () => {
    const [{ r }] = await t.as<Row>('pm', 'select public.company_rates() as r');
    expect([Number(r.default_labour_rate), Number(r.default_markup)]).toEqual([90, 12]);
    for (const who of ['foreman', 'elec'] as U[]) expect(await t.fails(who, 'select public.company_rates()')).toMatch(/project manager/);
    const [{ r: theirs }] = await t.as<Row>('rival', 'select public.company_rates() as r');
    expect(Number(theirs.default_labour_rate)).toBe(0);
  });

  it('a new estimate still starts from the rates its author cannot read directly', async () => {
    const e = await ins('pm', 'estimates', { title: 'E', status: 'Draft' });
    expect([Number(e.labour_rate), Number(e.markup_percentage)]).toEqual([90, 12]);
  });

  it('Stripe ids are for owners and admins', async () => {
    expect(await t.fails('owner', 'select stripe_customer_id from public.companies')).toMatch(/permission denied/);
    await t.as('owner', 'select public.company_billing_ids()');
    expect(await t.fails('pm', 'select public.company_billing_ids()')).toMatch(/owner or an admin/);
  });

  it('change order money is for project managers and up, and only their own company', async () => {
    const p = await project();
    const co = await approvedCo(p);
    const [{ r }] = await t.as<Row>('pm', 'select public.change_order_money($1) as r', [[co]]);
    expect(Number(r[0].price)).toBe(1000);
    expect(await t.fails('foreman', 'select public.change_order_money($1)', [[co]])).toMatch(/project manager/);
    const [{ r: theirs }] = await t.as<Row>('rival', 'select public.change_order_money($1) as r', [[co]]);
    expect(theirs).toEqual([]);
  });

  it('a project manager can still save a change order, and a foreman can read the rest of it', async () => {
    const p = await project();
    const co = await approvedCo(p, { reason: 'Client asked' });
    const [row] = await t.as<Row>('foreman', 'select title, reason, labour_hours, co_number from public.change_orders where id = $1', [co]);
    expect(row.reason).toBe('Client asked');
  });

  it('the helpers ask nothing below the rank, and pass the database refusal on', async () => {
    const below = fakeSupabase({}, { rpc: () => ({ data: null, error: { message: 'should not be called' } }) });
    expect(await withChangeOrderMoney(below, 'foreman', [{ id: 'a' }])).toEqual({ rows: [{ id: 'a' }] });
    expect(await withCompanyRates(below, 'foreman', { name: 'x' })).toEqual({ profile: { name: 'x' } });
    expect(await withCompanyRates(below, 'project_manager', { name: 'x' })).toHaveProperty('error');
  });

  it('billing ids that cannot be read stop the page, so nobody looks unsubscribed', async () => {
    const supabase = fakeSupabase({}, { rpc: () => ({ data: null, error: { message: 'no' } }) });
    const company = { id: 'c', name: 'C', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01', current_period_end: null };
    expect(await withBillingIds({ supabase, company } as unknown as AppContext)).toBeNull();
    const ok = fakeSupabase({}, { rpc: () => ({ data: { stripe_customer_id: 'cus', stripe_subscription_id: 'sub' }, error: null }) });
    expect(await withBillingIds({ supabase: ok, company } as unknown as AppContext)).toMatchObject({ stripe_customer_id: 'cus', stripe_subscription_id: 'sub' });
  });
});

describe('a rejected timecard', () => {
  it('tells its own worker, nobody else, and clears when it is fixed', async () => {
    const [worker] = await t.as<Row>('elec', 'select * from public.timecard_workers()');
    const [card] = await t.as<Row>('elec', `insert into public.timecards (title, status, work_date, regular_hours, employee_name, worker_user_id) values ('Unit 3', 'Submitted', '2026-11-03', 8, $1, $2) returning id`, [worker.name, worker.user_id]);
    await t.as('foreman', `select public.decide_timecards($1::uuid[], 'reject', 'Wrong day')`, [[card.id]]);
    const seen = (who: U) => t.as<Row>(who, `select message from public.alerts where rule_key = 'timecards.rejected' and record_id = $1 and resolved_at is null`, [card.id]);
    expect((await seen('elec'))[0].message).toContain('Wrong day');
    for (const who of ['elec2', 'foreman', 'owner', 'rival'] as U[]) expect(await seen(who)).toEqual([]);
    await t.as('elec', `update public.timecards set work_date = '2026-11-02', status = 'Submitted' where id = $1`, [card.id]);
    expect(await seen('elec')).toEqual([]);
  });

  it('is only in the digest of the worker it belongs to', () => {
    const alert = { id: 'a', rule_key: 'timecards.rejected', module: 'timecards', record_id: 'card', title: 'T', message: 'M', severity: 'warning', min_rank: 1, bucket: 'open', due_on: null, bucket_changed_at: '2026-11-03T00:00:00Z' } as AlertRow;
    const cardOwners = new Map([['card', 'worker']]);
    const opts = { today: '2026-11-04', cardOwners };
    expect(alertsForMember([alert], { userId: 'worker', rank: 1 }, opts)).toHaveLength(1);
    expect(alertsForMember([alert], { userId: 'someone', rank: 1 }, opts)).toEqual([]);
    expect(alertsForMember([alert], { userId: 'boss', rank: 5 }, opts)).toEqual([]);
    expect(alertsForMember([alert], { userId: 'worker', rank: 1 }, { today: '2026-11-04' })).toEqual([]);
  });
});

describe('credits and mixed tax', () => {
  it('a deduct change order bills as a credit, is offered no lock-up, and reopens freely', async () => {
    const p = await project();
    const co = await approvedCo(p, { material_cost: -500 });
    const inv = await ins('owner', 'invoices', { title: 'Credit', status: 'Draft', project_id: p, tax_pct: 5, holdback_pct: 0, lines: JSON.stringify([{ type: 'change_order', change_order_id: co }]) });
    expect([Number(inv.amount), Number(inv.gst), Number(inv.total)]).toEqual([-500, -25, -525]);
    await t.as('owner', `update public.invoices set status = 'Sent' where id = $1`, [inv.id]);
    expect((await get('change_orders', co)).invoice_id).toBe(inv.id);
  });

  it('one invoice taxes each change order at its signed rate and the rest at its own, as the preview does', async () => {
    const p = await project();
    const co = await approvedCo(p, { tax_pct: 13 });
    const inv = await ins('owner', 'invoices', { title: 'Mixed', status: 'Draft', project_id: p, tax_pct: 5, holdback_pct: 10, lines: JSON.stringify([{ type: 'percent', percent: 10 }, { type: 'change_order', change_order_id: co }]) });
    expect(Number(inv.gst)).toBe(50 + 130);
    const printed = invoiceTotals(inv.lines, 5, 10);
    expect([printed.subtotal, printed.tax, printed.holdback, printed.total]).toEqual([Number(inv.amount), Number(inv.gst), Number(inv.holdback_amount), Number(inv.total)]);
    expect(invoiceTaxLabel(inv.lines, 5)).toBe('Tax');
    expect(invoiceTaxLabel([{ tax_pct: 5 }], 5)).toBe('Tax (5%)');
  });

  it('a draft moved onto a job takes the rate quoted for it, and a rate picked by hand sticks', async () => {
    const est = await ins('pm', 'estimates', { title: 'Q', status: 'Submitted', labour_rate: 0, markup_percentage: 0, tax_percentage: 13 });
    await t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [est.id, JSON.stringify([{ description: 'x', quantity: 1, unit: 'ea', material_unit_cost: 100, labour_hours_per_unit: 0 }])]);
    const [{ id: prop }] = await t.as<Row>('pm', 'select public.create_proposal_from_estimate($1) as id', [est.id]);
    await t.as('pm', `update public.proposals set status = 'Sent' where id = $1`, [prop]);
    await t.as('pm', `update public.proposals set status = 'Accepted' where id = $1`, [prop]);
    const [{ id: job }] = await t.as<Row>('pm', 'select public.create_project_from_proposal($1) as id', [prop]);
    const inv = await ins('owner', 'invoices', { title: 'I', status: 'Draft', lines: '[]' });
    expect(Number(inv.tax_pct)).toBe(5);
    await t.as('owner', 'update public.invoices set project_id = $2 where id = $1', [inv.id, job]);
    expect(Number((await get('invoices', inv.id)).tax_pct)).toBe(13);
    await t.as('owner', 'update public.invoices set tax_pct = 6 where id = $1', [inv.id]);
    expect(Number((await get('invoices', inv.id)).tax_pct)).toBe(6);
  });

  it('a draw takes a later change of its invoice holdback terms', async () => {
    const p = await project();
    const draw = await ins('pm', 'progress_billing', { title: 'D', status: 'Draft', project_id: p, amount_billed: 100, holdback_percent: 10 });
    const [{ id }] = await t.as<Row>('owner', 'select public.create_invoice_from_draw($1) as id', [draw.id]);
    await t.as('owner', `update public.invoices set status = 'Sent' where id = $1`, [id]);
    await t.as('owner', `update public.invoices set holdback_release_date = '2027-03-01' where id = $1`, [id]);
    expect(String((await get('progress_billing', draw.id)).holdback_release_date)).toBe(String((await get('invoices', id)).holdback_release_date));
  });

  it('hand-typed charges do not stop a signed change order being billed', async () => {
    const p = await project(0);
    const typed = await ins('owner', 'invoices', { title: 'T and M', status: 'Draft', project_id: p, tax_pct: 5, holdback_pct: 0, lines: JSON.stringify([{ type: 'free', description: 'Call-out', amount: 5000 }]) });
    await t.as('owner', `update public.invoices set status = 'Sent' where id = $1`, [typed.id]);
    const co = await approvedCo(p);
    const inv = await ins('owner', 'invoices', { title: 'CO', status: 'Draft', project_id: p, tax_pct: 5, holdback_pct: 0, lines: JSON.stringify([{ type: 'change_order', change_order_id: co }]) });
    await t.as('owner', `update public.invoices set status = 'Sent' where id = $1`, [inv.id]);
    expect((await get('invoices', inv.id)).status).toBe('Sent');
  });

  it('the preview picks up the stray cent when percents reach 100, the way the database does', () => {
    const line = { type: 'percent', percent: 33.3334, amount: 0 };
    expect(pricePercentLines([line], 1000, 666.66, 2, 66.6666)[0].amount).toBe(333.34);
    // Short of 100 there is more to bill, so nothing moves
    expect(pricePercentLines([line], 1000, 333.33, 1, 33.3333)[0].amount).toBe(333.33);
  });
});

describe('plain messages', () => {
  it('turns the validator wording into words, and keeps what was written for a field', () => {
    const mod = getModule('payables')!;
    const bad = parseRecord(mod, { title: 'x', amount: 'not a number', purchase_order_id: 'nope' }, 'create');
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.amount).toBe('Amount must be a number');
    expect(bad.errors.purchase_order_id).toBe('Pick one from the list');
  });
});
