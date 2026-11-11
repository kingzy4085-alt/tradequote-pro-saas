// Change orders, invoices, draws and receivables: the sums in lib/billing-math.ts, the rules
// the database enforces in 20261104000110_billing.sql, and the routes in front of them.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';
import { BASELINE_FILE, OLD_BASELINE_FIXTURE, bootDb, migrationFiles, readMigration, type TestDb } from './helpers/db';

const mocks = vi.hoisted(() => ({ server: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mocks.server, createSupabaseServerClient: () => mocks.server }));

import { PUT as changeOrderAction } from '@/app/api/change-orders/[id]/route';
import { PUT as saveInvoice } from '@/app/api/invoices/[id]/route';
import { POST as createInvoice } from '@/app/api/progress-billing/[id]/invoice/route';
import { InvoiceLinesSchema, cents, changeOrderBudgetCost, changeOrderTotals, drawNet, invoiceTotals, lineKind, percentAmount, percentLeft, receivableAge } from '@/lib/billing-math';
import { DETAIL_PAGES } from '@/lib/detail-pages';
import { getModule } from '@/lib/modules';
import { parseRecord } from '@/lib/validation';

const SIGNATURE = 'data:image/png;base64,AAAA';
const users = {
  owner: { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' },
  admin: { id: '00000000-0000-4000-8000-00000000000b', email: 'admin@alpha.ca' },
  pm: { id: '00000000-0000-4000-8000-00000000000c', email: 'pm@alpha.ca' },
  foreman: { id: '00000000-0000-4000-8000-00000000000d', email: 'foreman@alpha.ca' },
  other: { id: '00000000-0000-4000-8000-00000000000e', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

describe('cents', () => {
  it.each([
    [1.005, 1.01],
    [1.004, 1],
    [2.675, 2.68],
    [1.1 * 1.1, 1.21],
    [0.1 + 0.2, 0.3],
    [-1.005, -1.01],
    [-0.004, 0],
    [1234567.895, 1234567.9],
    ['12.345', 12.35],
    [null, 0],
    ['nonsense', 0],
    [Infinity, 0],
  ])('%s rounds to %s', (input, want) => {
    expect(cents(input)).toBe(want);
    expect(Object.is(cents(input), -0)).toBe(false);
  });
});

describe('change order sums', () => {
  it('adds markup to material and labour, and tax to the price', () => {
    expect(changeOrderTotals({ material_cost: 1000, labour_hours: 10, labour_rate: 85, markup_pct: 15, tax_pct: 5 })).toEqual({
      labour: 850,
      cost: 1850,
      markup: 277.5,
      price: 2127.5,
      tax: 106.38,
      total: 2233.88,
    });
  });

  it('rounds each step to the cent', () => {
    const t = changeOrderTotals({ material_cost: 0.01, labour_hours: 1.333, labour_rate: 33.33, markup_pct: 12.5, tax_pct: 11 });
    expect(t.labour).toBe(44.43);
    expect(t.cost).toBe(44.44);
    expect(t.markup).toBe(5.56);
    expect(t.price).toBe(50);
    expect(t.tax).toBe(5.5);
    expect(t.total).toBe(55.5);
  });

  it('treats blanks as zero', () => {
    expect(changeOrderTotals({ material_cost: '', labour_hours: null, labour_rate: undefined, markup_pct: '', tax_pct: '' }).total).toBe(0);
  });

  it('carries a credit through as a negative price', () => {
    const t = changeOrderTotals({ material_cost: -100.05, labour_hours: 0, labour_rate: 0, markup_pct: 10, tax_pct: 5 });
    expect(t.markup).toBe(-10.01);
    expect(t.price).toBe(-110.06);
    expect(t.tax).toBe(-5.5);
    expect(t.total).toBe(-115.56);
  });

  it('costs labour at the company rate for the budget, not the billed rate', () => {
    expect(changeOrderBudgetCost({ material_cost: 1000, labour_hours: 10 }, 60)).toBe(1600);
    expect(changeOrderBudgetCost({ material_cost: 0, labour_hours: 3.333 }, 33.33)).toBe(111.09);
  });
});

describe('invoice sums', () => {
  it('takes holdback off the pre-tax amount and keeps tax on the whole of it', () => {
    expect(invoiceTotals([{ amount: 1000 }, { amount: '500.50' }], 5, 10)).toEqual({ subtotal: 1500.5, tax: 75.03, holdback: 150.05, total: 1425.48 });
  });

  it('adds float lines without drift', () => {
    expect(invoiceTotals([{ amount: 0.1 }, { amount: 0.2 }], 0, 0).subtotal).toBe(0.3);
  });

  it('a credit line lowers the subtotal, tax and holdback', () => {
    expect(invoiceTotals([{ amount: 1000 }, { amount: -250 }], 5, 10)).toEqual({ subtotal: 750, tax: 37.5, holdback: 75, total: 712.5 });
  });

  it('an invoice of only credits comes out negative', () => {
    expect(invoiceTotals([{ amount: -100 }], 5, 10)).toEqual({ subtotal: -100, tax: -5, holdback: -10, total: -95 });
  });

  it('an empty invoice is zero', () => {
    expect(invoiceTotals([], 5, 10).total).toBe(0);
  });

  it('prices a percent of the contract and reports what is left', () => {
    expect(percentAmount(123456.78, 33.33)).toBe(41148.14);
    expect(percentLeft(33.33)).toBe(66.67);
    expect(percentLeft(100)).toBe(0);
    expect(percentLeft(120)).toBe(0);
  });

  it('works out a draw net of holdback', () => {
    expect(drawNet(10000.05, 10)).toEqual({ holdback: 1000.01, net: 9000.04 });
  });

  it.each([
    [null, 'Current'],
    [-5, 'Current'],
    [29, 'Current'],
    [30, '30 Days'],
    [59, '30 Days'],
    [60, '60 Days'],
    [89, '60 Days'],
    [90, '90+ Days'],
  ])('a receivable %s days past due is %s', (days, want) => {
    expect(receivableAge(days as number | null)).toBe(want);
  });

  it('names each kind of line', () => {
    expect(lineKind({ type: 'percent', percent: 25 })).toBe('25% of contract');
    expect(lineKind({ type: 'change_order' })).toBe('Change order');
    expect(lineKind({ type: 'draw' })).toBe('Progress draw');
    expect(lineKind({ type: 'free' })).toBe('Other');
  });
});

describe('invoice line validation', () => {
  it('rounds a free line and keeps a credit', () => {
    expect(InvoiceLinesSchema.parse([{ type: 'free', description: 'Credit', amount: '-10.005' }])).toEqual([{ type: 'free', description: 'Credit', amount: -10.01 }]);
  });

  it('drops an amount sent for anything the database prices', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    expect(InvoiceLinesSchema.parse([{ type: 'change_order', change_order_id: id, amount: 1 }])[0]).not.toHaveProperty('amount');
    expect(InvoiceLinesSchema.parse([{ type: 'percent', percent: 10, amount: 1 }])[0]).not.toHaveProperty('amount');
    expect(InvoiceLinesSchema.parse([{ type: 'draw', progress_billing_id: id, amount: 1 }])[0]).not.toHaveProperty('amount');
  });

  it('refuses a percent out of range, a free line with no description and an unknown kind', () => {
    expect(InvoiceLinesSchema.safeParse([{ type: 'percent', percent: 0 }]).success).toBe(false);
    expect(InvoiceLinesSchema.safeParse([{ type: 'percent', percent: 100.01 }]).success).toBe(false);
    expect(InvoiceLinesSchema.safeParse([{ type: 'free', description: ' ', amount: 1 }]).success).toBe(false);
    expect(InvoiceLinesSchema.safeParse([{ type: 'bonus', amount: 1 }]).success).toBe(false);
  });
});

describe('the registry', () => {
  it('opens all three on their detail pages', () => {
    expect(DETAIL_PAGES['change-orders']).toBe('/change-orders');
    expect(DETAIL_PAGES.invoices).toBe('/invoices');
    expect(DETAIL_PAGES['progress-billing']).toBe('/invoices/draws');
  });

  it('drops money sent by a client', () => {
    const co = parseRecord(getModule('change-orders')!, { title: 'x', price: 1, total: 1, tax: 1, co_number: '9', invoice_id: users.owner.id, approved_by: 'me' }, 'create');
    expect(co.ok && Object.keys(co.data).sort()).toEqual(['status', 'title']);
    const inv = parseRecord(getModule('invoices')!, { title: 'x', amount: 1, gst: 1, total: 1, invoice_number: '9', lines: [] }, 'create');
    expect(inv.ok && Object.keys(inv.data).sort()).toEqual(['status', 'title']);
  });

  it('keeps Approved and the aged receivable statuses out of a person\'s hands', () => {
    expect(parseRecord(getModule('change-orders')!, { status: 'Approved' }, 'update').ok).toBe(false);
    expect(parseRecord(getModule('receivables')!, { status: '90+ Days' }, 'update').ok).toBe(false);
    expect(parseRecord(getModule('progress-billing')!, { status: 'Invoiced' }, 'update').ok).toBe(false);
  });
});

describe('in the database', () => {
  let t: TestDb<U>;
  let company: string;
  let other: string;
  let project: string;
  let project2: string;
  let otherProject: string;

  const readCo = async (id: string) => (await t.asSystem<Record<string, string>>('select * from public.change_orders where id = $1', [id]))[0];
  const newCo = async (over: Record<string, unknown> = {}, who: U = 'pm') => {
    const row = { title: 'Add VFD', status: 'Draft', project_id: project, material_cost: 1000, labour_hours: 10, labour_rate: 85, markup_pct: 15, tax_pct: 5, ...over };
    const keys = Object.keys(row);
    const [co] = await t.as<Record<string, string>>(who, `insert into public.change_orders (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(row));
    // Nobody signed in can read a change order's money columns, so no returning *
    return readCo(co.id);
  };
  // Sent first when it is still a draft: the database refuses Draft to Approved
  const approve = async (id: string, who: U = 'pm') => {
    await t.as(who, `update public.change_orders set status = 'Sent' where id = $1 and status = 'Draft'`, [id]);
    const moved = await t.as(who, `update public.change_orders set status = 'Approved', approved_by = 'Client Person', signature = $2 where id = $1 returning id`, [id, SIGNATURE]);
    return moved.length ? [await readCo(id)] : [];
  };
  const approvedCo = async (over: Record<string, unknown> = {}) => (await approve((await newCo(over)).id))[0];
  const projectRow = async (id = project) => (await t.asSystem<Record<string, string>>('select * from public.projects where id = $1', [id]))[0];
  const newInvoice = async (lines: unknown[] = [], over: Record<string, unknown> = {}, who: U = 'owner') => {
    const row = { title: 'INV', status: 'Draft', project_id: project, tax_pct: 5, holdback_pct: 10, lines: JSON.stringify(lines), ...over };
    const keys = Object.keys(row);
    const [inv] = await t.as<Record<string, any>>(who, `insert into public.invoices (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(row));
    return inv;
  };
  const setStatus = async (id: string, status: string, who: U = 'owner') =>
    (await t.as<Record<string, any>>(who, 'update public.invoices set status = $2 where id = $1 returning *', [id, status]))[0];
  const receivable = async (invoiceId: string) => (await t.asSystem<Record<string, any>>('select * from public.receivables where invoice_id = $1', [invoiceId]))[0];
  const free = (amount: number, description = 'Extra') => ({ type: 'free', description, amount });

  beforeAll(async () => {
    t = await bootDb(users);
    company = await t.createCompany('owner', 'Alpha');
    other = await t.createCompany('other', 'Bravo');
    await t.join('owner', 'admin', 'admin');
    await t.join('owner', 'pm', 'project_manager');
    await t.join('owner', 'foreman', 'foreman');
    await t.as('owner', 'update public.companies set default_labour_rate = 60, default_markup = 20, default_tax = 11, default_holdback_pct = 7.5');
    [{ id: project }] = await t.as<{ id: string }>('pm', `insert into public.projects (title, status, contract_value, end_date, client_name) values ('Job', 'Active', 100000, '2027-01-10', 'Cargill') returning id`);
    [{ id: project2 }] = await t.as<{ id: string }>('pm', `insert into public.projects (title, status, contract_value) values ('Job 2', 'Active', 50000) returning id`);
    [{ id: otherProject }] = await t.as<{ id: string }>('other', `insert into public.projects (title, status) values ('Theirs', 'Active') returning id`);
  }, 120_000);

  describe('change order numbers and money', () => {
    it('numbers per company, from 1', async () => {
      const first = await newCo();
      const second = await newCo();
      expect(Number(second.co_number)).toBe(Number(first.co_number) + 1);
      const [theirs] = await t.as<{ co_number: string }>('other', `insert into public.change_orders (title, status) values ('Theirs', 'Draft') returning co_number`);
      expect(theirs.co_number).toBe('1');
    });

    it('a client cannot pick its own number or keep the number from changing', async () => {
      const co = await newCo({ co_number: '999' });
      expect(co.co_number).not.toBe('999');
      const [after] = await t.as<{ co_number: string }>('pm', `update public.change_orders set co_number = '999' where id = $1 returning co_number`, [co.id]);
      expect(after.co_number).toBe(co.co_number);
    });

    it('works out the price itself, whatever the client sends', async () => {
      const co = await newCo({ price: 1, tax: 1, total: 1, budget_cost: 1 });
      expect(Number(co.price)).toBe(2127.5);
      expect(Number(co.tax)).toBe(106.38);
      expect(Number(co.total)).toBe(2233.88);
      expect(Number(co.cost_impact)).toBe(2127.5);
      // 1000 + 10 h at the company's 60, not the billed 85
      expect(Number(co.budget_cost)).toBe(1600);
      await t.as('pm', 'update public.change_orders set material_cost = 2000, price = 5 where id = $1', [co.id]);
      const changed = await readCo(co.id);
      expect(Number(changed.price)).toBe(3277.5);
    });

    it('starts blank rates from the company defaults', async () => {
      const [{ id: blank }] = await t.as<{ id: string }>('pm', `insert into public.change_orders (title, status, labour_hours) values ('x', 'Draft', 1) returning id`);
      const co = await readCo(blank);
      expect(Number(co.labour_rate)).toBe(60);
      expect(Number(co.markup_pct)).toBe(20);
      expect(Number(co.tax_pct)).toBe(11);
      expect(Number(co.price)).toBe(72);
    });

    it('agrees with lib/billing-math.ts to the cent', async () => {
      const cases = [
        { material_cost: 0.01, labour_hours: 1.333, labour_rate: 33.33, markup_pct: 12.5, tax_pct: 11 },
        { material_cost: 1.005, labour_hours: 0.1, labour_rate: 0.15, markup_pct: 33.33, tax_pct: 5 },
        { material_cost: -100.05, labour_hours: 0, labour_rate: 0, markup_pct: 10, tax_pct: 5 },
        { material_cost: 99999.99, labour_hours: 123.45, labour_rate: 87.65, markup_pct: 17.5, tax_pct: 14.975 },
        { material_cost: 10.075, labour_hours: 2.5, labour_rate: 41.01, markup_pct: 7.25, tax_pct: 13 },
      ];
      for (const c of cases) {
        const co = await newCo(c);
        const want = changeOrderTotals(c);
        expect([Number(co.price), Number(co.tax), Number(co.total)]).toEqual([want.price, want.tax, want.total]);
      }
    });

    it('refuses negative hours, rates and percentages from a direct write', async () => {
      expect(await t.fails('pm', `insert into public.change_orders (title, status, labour_hours) values ('x', 'Draft', -1)`)).toMatch(/cannot be negative/);
      expect(await t.fails('pm', `insert into public.change_orders (title, status, tax_pct) values ('x', 'Draft', 101)`)).toMatch(/over 100/);
    });

    it('a foreman reads but cannot write, and another company sees nothing', async () => {
      const co = await newCo();
      expect((await t.as('foreman', 'select id from public.change_orders where id = $1', [co.id])).length).toBe(1);
      expect(await t.fails('foreman', `insert into public.change_orders (title, status) values ('x', 'Draft')`)).toMatch(/row-level security/);
      expect((await t.as('foreman', `update public.change_orders set title = 'y' where id = $1 returning id`, [co.id])).length).toBe(0);
      expect((await t.as('other', 'select id from public.change_orders where id = $1', [co.id])).length).toBe(0);
    });

    it('cannot link to another company\'s project', async () => {
      expect(await t.fails('pm', `insert into public.change_orders (title, status, project_id) values ('x', 'Draft', $1)`, [otherProject])).toMatch(/could not be found/);
    });
  });

  describe('approving', () => {
    it('needs a name, a signature, a price and a project', async () => {
      const co = await newCo({ status: 'Sent' });
      expect(await t.fails('pm', `update public.change_orders set status = 'Approved', signature = $2 where id = $1`, [co.id, SIGNATURE])).toMatch(/Enter the name/);
      expect(await t.fails('pm', `update public.change_orders set status = 'Approved', approved_by = '  ', signature = $2 where id = $1`, [co.id, SIGNATURE])).toMatch(/Enter the name/);
      expect(await t.fails('pm', `update public.change_orders set status = 'Approved', approved_by = 'A' where id = $1`, [co.id])).toMatch(/draw their signature/);
      const free2 = await newCo({ material_cost: 0, labour_hours: 0, status: 'Sent' });
      expect(await t.fails('pm', `update public.change_orders set status = 'Approved', approved_by = 'A', signature = $2 where id = $1`, [free2.id, SIGNATURE])).toMatch(/price above zero/);
      const noProject = await newCo({ project_id: null, status: 'Sent' });
      expect(await t.fails('pm', `update public.change_orders set status = 'Approved', approved_by = 'A', signature = $2 where id = $1`, [noProject.id, SIGNATURE])).toMatch(/Pick the project/);
    });

    it('refuses a signature that is not a drawn PNG', async () => {
      const co = await newCo({ status: 'Sent' });
      expect(await t.fails('pm', `update public.change_orders set status = 'Approved', approved_by = 'A', signature = 'http://x' where id = $1`, [co.id])).toMatch(/check/);
    });

    it('cannot start out approved, and cannot jump from Rejected', async () => {
      expect(await t.fails('pm', `insert into public.change_orders (title, status, approved_by, signature, project_id, material_cost) values ('x', 'Approved', 'A', $1, $2, 5)`, [SIGNATURE, project])).toMatch(/Save the change order first/);
      expect(await t.fails('pm', `insert into public.change_orders (title, status) values ('x', 'Rejected')`)).toMatch(/starts as a draft/);
      const co = await newCo({ status: 'Sent' });
      await t.as('pm', `update public.change_orders set status = 'Rejected' where id = $1`, [co.id]);
      expect(await t.fails('pm', `update public.change_orders set status = 'Approved', approved_by = 'A', signature = $2 where id = $1`, [co.id, SIGNATURE])).toMatch(/back to Draft/);
    });

    it('stamps the time and locks the record', async () => {
      const [co] = await approve((await newCo()).id);
      expect(co.status).toBe('Approved');
      expect(co.approved_at).toBeTruthy();
      expect(await t.fails('pm', `update public.change_orders set material_cost = 1 where id = $1`, [co.id])).toMatch(/approved and locked/);
      expect(await t.fails('pm', `update public.change_orders set title = 'new' where id = $1`, [co.id])).toMatch(/approved and locked/);
      expect(await t.fails('pm', `update public.change_orders set approved_by = 'someone else' where id = $1`, [co.id])).toMatch(/approved and locked/);
      expect(await t.fails('pm', `update public.change_orders set status = 'Rejected' where id = $1`, [co.id])).toMatch(/only be reopened/);
    });

    it('cannot be deleted until it is reopened', async () => {
      const [co] = await approve((await newCo()).id);
      expect(await t.fails('pm', 'delete from public.change_orders where id = $1', [co.id])).toMatch(/cannot be deleted/);
      await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]);
      expect((await t.as('pm', 'delete from public.change_orders where id = $1 returning id', [co.id])).length).toBe(1);
    });

    it('reopening clears the signature and changes nothing else', async () => {
      const [co] = await approve((await newCo()).id);
      expect(await t.fails('pm', `update public.change_orders set status = 'Draft', material_cost = 1 where id = $1`, [co.id])).toMatch(/locked/);
      await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]);
      const open = await readCo(co.id);
      expect(open.signature).toBeNull();
      expect(open.approved_by).toBeNull();
      expect(open.approved_at).toBeNull();
      expect(Number(open.price)).toBe(2127.5);
    });

    it('a signature cannot be planted on a record that is not being approved', async () => {
      const co = await newCo({ approved_by: 'Sneaky', signature: SIGNATURE });
      expect(co.approved_by).toBeNull();
      expect(co.signature).toBeNull();
    });
  });

  describe('the contract', () => {
    const job = async () => {
      const [{ id }] = await t.as<{ id: string }>('pm', `insert into public.projects (title, status, contract_value, end_date) values ('Roll', 'Active', 1000, '2027-03-01') returning id`);
      return id;
    };

    it('moves with approve, reject, reopen, delete and a move between projects', async () => {
      const a = await job();
      const b = await job();
      const co = await newCo({ project_id: a, material_cost: 100, labour_hours: 0, markup_pct: 0, tax_pct: 5, days_impact: 3 });
      expect(Number((await projectRow(a)).approved_changes)).toBe(0);

      await approve(co.id);
      let row = await projectRow(a);
      // The price, not the total: tax isn't contract value
      expect(Number(row.approved_changes)).toBe(100);
      expect(Number(row.revised_contract)).toBe(1100);
      expect(Number(row.approved_days)).toBe(3);
      expect(row.revised_end_date).toEqual(new Date('2027-03-04T00:00:00.000Z'));

      await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]);
      row = await projectRow(a);
      expect(Number(row.approved_changes)).toBe(0);
      expect(Number(row.revised_contract)).toBe(1000);

      await t.as('pm', 'update public.change_orders set project_id = $2 where id = $1', [co.id, b]);
      await approve(co.id);
      expect(Number((await projectRow(a)).approved_changes)).toBe(0);
      expect(Number((await projectRow(b)).approved_changes)).toBe(100);

      await t.as('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id]);
      await t.as('pm', `update public.change_orders set status = 'Sent' where id = $1`, [co.id]);
      await t.as('pm', `update public.change_orders set status = 'Rejected' where id = $1`, [co.id]);
      expect(Number((await projectRow(b)).approved_changes)).toBe(0);
    });

    it('a rejected or draft change order adds nothing', async () => {
      const a = await job();
      const rejected = await newCo({ project_id: a, material_cost: 100, status: 'Sent' });
      await t.as('pm', `update public.change_orders set status = 'Rejected' where id = $1`, [rejected.id]);
      await newCo({ project_id: a, material_cost: 100, status: 'Sent' });
      expect(Number((await projectRow(a)).approved_changes)).toBe(0);
    });

    it('cannot be set by hand, and follows a new contract value', async () => {
      const a = await job();
      await approvedCo({ project_id: a, material_cost: 100, labour_hours: 0, markup_pct: 0 });
      await t.as('pm', 'update public.projects set approved_changes = 9999, revised_contract = 9999, contract_value = 2000 where id = $1', [a]);
      const row = await projectRow(a);
      expect(Number(row.approved_changes)).toBe(100);
      expect(Number(row.revised_contract)).toBe(2100);
      const [{ id: freshId }] = await t.as<{ id: string }>('pm', `insert into public.projects (title, status, approved_changes, revised_contract, contract_value) values ('P', 'Active', 5, 5, 10) returning id`);
      const fresh = await projectRow(freshId);
      expect(Number(fresh.approved_changes)).toBe(0);
      expect(Number(fresh.revised_contract)).toBe(10);
    });
  });

  describe('invoice numbers and totals', () => {
    it('numbers per company from 1001', async () => {
      const [{ invoice_number: first }] = await t.as<{ invoice_number: string }>('other', `insert into public.invoices (title, status) values ('A', 'Draft') returning invoice_number`);
      const [{ invoice_number: second }] = await t.as<{ invoice_number: string }>('other', `insert into public.invoices (title, status, invoice_number) values ('B', 'Draft', '5') returning invoice_number`);
      expect(first).toBe('1001');
      expect(second).toBe('1002');
    });

    it('gives no two saves the same number', async () => {
      const made = await Promise.all([newInvoice(), newInvoice(), newInvoice()]);
      expect(new Set(made.map((i) => i.invoice_number)).size).toBe(3);
    });

    it('starts tax and holdback from the company, and dates 30 days apart', async () => {
      const [inv] = await t.as<Record<string, any>>('owner', `insert into public.invoices (title, status, issue_date) values ('A', 'Draft', '2026-11-01') returning *`);
      expect(Number(inv.tax_pct)).toBe(11);
      expect(Number(inv.holdback_pct)).toBe(7.5);
      expect(inv.due_date).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    });

    it('works out totals itself: holdback from pre-tax, total = subtotal + tax - holdback', async () => {
      const inv = await newInvoice([free(1000), free(500.5)], { amount: 1, gst: 1, total: 1, holdback_amount: 1 });
      expect(Number(inv.amount)).toBe(1500.5);
      expect(Number(inv.gst)).toBe(75.03);
      expect(Number(inv.holdback_amount)).toBe(150.05);
      expect(Number(inv.total)).toBe(1425.48);
    });

    it('handles a credit line and agrees with lib/billing-math.ts', async () => {
      for (const [lines, tax, holdback] of [
        [[free(1000), free(-250)], 5, 10],
        [[free(-100)], 5, 10],
        [[free(10.05), free(0.015)], 14.975, 7.5],
        [[free(0.01)], 13, 10],
        [[free(1234.565), free(-0.005)], 12, 12.5],
      ] as const) {
        const inv = await newInvoice([...lines], { tax_pct: tax, holdback_pct: holdback });
        const want = invoiceTotals([...lines], tax, holdback);
        expect([Number(inv.amount), Number(inv.gst), Number(inv.holdback_amount), Number(inv.total)]).toEqual([want.subtotal, want.tax, want.holdback, want.total]);
      }
    });

    it('refuses a line it cannot read', async () => {
      expect(await t.fails('owner', `insert into public.invoices (title, status, lines) values ('A', 'Draft', '{"a":1}')`)).toMatch(/not valid/);
      expect(await t.fails('owner', `insert into public.invoices (title, status, lines) values ('A', 'Draft', '[{"type":"bonus"}]')`)).toMatch(/not a kind of line/);
      expect(await t.fails('owner', `insert into public.invoices (title, status, lines) values ('A', 'Draft', '[{"type":"free","amount":5}]')`)).toMatch(/description/);
      expect(await t.fails('owner', `insert into public.invoices (title, status, lines) values ('A', 'Draft', '[{"type":"free","description":"x"}]')`)).toMatch(/enter an amount/);
    });

    it('a PM cannot touch invoices', async () => {
      expect(await t.fails('pm', `insert into public.invoices (title, status) values ('A', 'Draft')`)).toMatch(/row-level security/);
    });

    it('only Draft is editable or deletable', async () => {
      const inv = await newInvoice([free(100)]);
      await setStatus(inv.id, 'Sent');
      expect(await t.fails('owner', `update public.invoices set title = 'x' where id = $1`, [inv.id])).toMatch(/Only a draft/);
      expect(await t.fails('owner', `update public.invoices set lines = '[]' where id = $1`, [inv.id])).toMatch(/Only a draft/);
      expect(await t.fails('owner', 'delete from public.invoices where id = $1', [inv.id])).toMatch(/Only a draft invoice can be deleted/);
      const [kept] = await t.as<Record<string, any>>('owner', 'update public.invoices set total = 1, amount = 1 where id = $1 returning *', [inv.id]);
      expect(Number(kept.total)).toBe(95);
      // The release date is often only known later
      const [dated] = await t.as<Record<string, any>>('owner', `update public.invoices set holdback_release_date = '2027-05-01' where id = $1 returning holdback_release_date`, [inv.id]);
      expect(dated.holdback_release_date).toEqual(new Date('2027-05-01T00:00:00.000Z'));
      await setStatus(inv.id, 'Draft');
      expect((await t.as('owner', 'delete from public.invoices where id = $1 returning id', [inv.id])).length).toBe(1);
    });

    it('allows only the moves that make sense', async () => {
      const inv = await newInvoice([free(100)]);
      expect(await t.fails('owner', `update public.invoices set status = 'Paid' where id = $1`, [inv.id])).toMatch(/sent before/);
      expect(await t.fails('owner', `update public.invoices set status = 'Overdue' where id = $1`, [inv.id])).toMatch(/worked out from the due date/);
      await setStatus(inv.id, 'Sent');
      await setStatus(inv.id, 'Paid');
      expect(await t.fails('owner', `update public.invoices set status = 'Void' where id = $1`, [inv.id])).toMatch(/Undo the payment/);
      await setStatus(inv.id, 'Sent');
      await setStatus(inv.id, 'Void');
      expect(await t.fails('owner', `update public.invoices set status = 'Draft' where id = $1`, [inv.id])).toMatch(/stays void/);
    });

    it('cannot be sent with no lines, or start out sent', async () => {
      const inv = await newInvoice();
      expect(await t.fails('owner', `update public.invoices set status = 'Sent' where id = $1`, [inv.id])).toMatch(/at least one line/);
      expect(await t.fails('owner', `insert into public.invoices (title, status) values ('A', 'Sent')`)).toMatch(/starts as a draft/);
    });

    it('the overdue job, as the service role, can flip it and the lines stay', async () => {
      const inv = await newInvoice([free(100)]);
      await setStatus(inv.id, 'Sent');
      await t.asService(`update public.invoices set status = 'Overdue' where id = $1`, [inv.id]);
      const [row] = await t.asSystem<Record<string, any>>('select * from public.invoices where id = $1', [inv.id]);
      expect(row.status).toBe('Overdue');
      expect(Number(row.total)).toBe(100 + 5 - 10);
      const paid = await setStatus(inv.id, 'Paid');
      expect(paid.paid_at).toBeTruthy();
    });
  });

  describe('change order lines', () => {
    const coLine = (id: string, extra: Record<string, unknown> = {}) => ({ type: 'change_order', change_order_id: id, ...extra });

    it('bills at the approved price, whatever the client says, and links back', async () => {
      const co = await approvedCo();
      const inv = await newInvoice([coLine(co.id, { amount: 1 })]);
      expect(Number(inv.lines[0].amount)).toBe(2127.5);
      expect(inv.lines[0].description).toContain(`#${co.co_number}`);
      expect(Number(inv.amount)).toBe(2127.5);
      const [after] = await t.asSystem<{ invoice_id: string }>('select invoice_id from public.change_orders where id = $1', [co.id]);
      expect(after.invoice_id).toBe(inv.id);
    });

    it('refuses one that is not approved, is elsewhere, or is from another project', async () => {
      const draft = await newCo();
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [project, JSON.stringify([coLine(draft.id)])])).toMatch(/not approved/);
      const co = await approvedCo();
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [project2, JSON.stringify([coLine(co.id)])])).toMatch(/different project/);
      const [theirs] = await t.as<{ id: string }>('other', `insert into public.change_orders (title, status) values ('T', 'Draft') returning id`);
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [project, JSON.stringify([coLine(theirs.id)])])).toMatch(/could not be found/);
    });

    it('bills one only once, also twice on the same invoice', async () => {
      const co = await approvedCo();
      await newInvoice([coLine(co.id)]);
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [project, JSON.stringify([coLine(co.id)])])).toMatch(/already on another invoice/);
      const co2 = await approvedCo();
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [project, JSON.stringify([coLine(co2.id), coLine(co2.id)])])).toMatch(/twice/);
    });

    it('a billed one cannot be reopened, and voiding, deleting or removing the line releases it', async () => {
      const claimed = async () => (await t.asSystem<{ invoice_id: string | null }>('select invoice_id from public.change_orders where id = $1', [co.id]))[0].invoice_id;
      const co = await approvedCo();
      const inv = await newInvoice([coLine(co.id)]);
      expect(await t.fails('pm', `update public.change_orders set status = 'Draft' where id = $1`, [co.id])).toMatch(/on an invoice/);

      await t.as('owner', `select public.save_invoice($1, '{}', '[]')`, [inv.id]);
      expect(await claimed()).toBeNull();

      await t.as('owner', 'select public.save_invoice($1, $2, $3)', [inv.id, '{}', JSON.stringify([coLine(co.id)])]);
      expect(await claimed()).toBe(inv.id);
      await t.as('owner', 'delete from public.invoices where id = $1', [inv.id]);
      expect(await claimed()).toBeNull();

      const second = await newInvoice([coLine(co.id)]);
      await setStatus(second.id, 'Sent');
      await setStatus(second.id, 'Void');
      expect(await claimed()).toBeNull();
      const third = await newInvoice([coLine(co.id)]);
      expect(await claimed()).toBe(third.id);
    });

    it('a client cannot write the link itself', async () => {
      const co = await approvedCo();
      const inv = await newInvoice();
      const [draftCo] = await t.as<{ invoice_id: string | null }>('pm', `insert into public.change_orders (title, status, invoice_id) values ('x', 'Draft', null) returning invoice_id`);
      expect(draftCo.invoice_id).toBeNull();
      await t.as('owner', 'update public.change_orders set invoice_id = $2 where id = $1', [co.id, inv.id]);
      const [row] = await t.asSystem<{ invoice_id: string | null }>('select invoice_id from public.change_orders where id = $1', [co.id]);
      expect(row.invoice_id).toBeNull();
    });
  });

  describe('percent of contract lines', () => {
    const job = async (value = 1000) => {
      const [{ id }] = await t.as<{ id: string }>('pm', `insert into public.projects (title, status, contract_value) values ('Cap', 'Active', $1) returning id`, [value]);
      return id;
    };
    const pct = (percent: number) => ({ type: 'percent', percent });

    it('prices it from the contract', async () => {
      const inv = await newInvoice([pct(33.33)], { project_id: await job(123456.78) });
      expect(Number(inv.lines[0].amount)).toBe(41148.14);
      expect(inv.lines[0].description).toBe('33.33% of contract');
    });

    it('caps it at 100% across invoices, ignoring void ones', async () => {
      const id = await job();
      const first = await newInvoice([pct(60)], { project_id: id });
      await newInvoice([pct(40)], { project_id: id });
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [id, JSON.stringify([pct(0.01)])])).toMatch(/only 0% is left/);
      await setStatus(first.id, 'Void');
      const again = await newInvoice([pct(60)], { project_id: id });
      expect(Number(again.amount)).toBe(600);
    });

    it('caps within one invoice, and on editing', async () => {
      const id = await job();
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [id, JSON.stringify([pct(60), pct(41)])])).toMatch(/asks for 101%/);
      const inv = await newInvoice([pct(100)], { project_id: id });
      // Saving the same line again doesn't count against itself
      await t.as('owner', 'select public.save_invoice($1, $2, $3)', [inv.id, '{"title":"same"}', JSON.stringify([pct(100)])]);
      const other2 = await newInvoice([], { project_id: id });
      expect(await t.fails('owner', 'select public.save_invoice($1, $2, $3)', [other2.id, '{}', JSON.stringify([pct(1)])])).toMatch(/only 0% is left/);
    });

    it('needs a project with a contract value', async () => {
      expect(await t.fails('owner', `insert into public.invoices (title, status, lines) values ('A', 'Draft', $1)`, [JSON.stringify([pct(10)])])).toMatch(/pick the project/);
      const [{ id }] = await t.as<{ id: string }>('pm', `insert into public.projects (title, status) values ('Blank', 'Active') returning id`);
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [id, JSON.stringify([pct(10)])])).toMatch(/contract value/);
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [await job(), JSON.stringify([pct(100.5)])])).toMatch(/up to 100/);
    });

    it('moving a saved percent line to a project over its cap is refused', async () => {
      const full = await job();
      await newInvoice([pct(100)], { project_id: full });
      const inv = await newInvoice([pct(10)], { project_id: await job() });
      expect(await t.fails('owner', 'update public.invoices set project_id = $2 where id = $1', [inv.id, full])).toMatch(/only 0% is left/);
    });
  });

  describe('draws', () => {
    const draw = async (over: Record<string, unknown> = {}) => {
      const row = { title: 'Draw #1', status: 'Draft', project_id: project, billing_period: 'October', amount_billed: 10000, holdback_percent: 10, holdback_release_date: '2027-02-01', ...over };
      const keys = Object.keys(row);
      const [d] = await t.as<Record<string, any>>('pm', `insert into public.progress_billing (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(row));
      return d;
    };
    const create = async (id: string, who: U = 'owner') => (await t.as<{ id: string }>(who, 'select public.create_invoice_from_draw($1) as id', [id]))[0].id;
    const drawRow = async (id: string) => (await t.asSystem<Record<string, any>>('select * from public.progress_billing where id = $1', [id]))[0];
    const invoiceRow = async (id: string) => (await t.asSystem<Record<string, any>>('select * from public.invoices where id = $1', [id]))[0];

    it('takes its holdback from the company when left blank', async () => {
      const d = await draw({ holdback_percent: null });
      expect(Number(d.holdback_percent)).toBe(7.5);
    });

    it('Create invoice makes a draft with its numbers and links it, and doing it twice does nothing', async () => {
      const d = await draw();
      const id = await create(d.id);
      const inv = await invoiceRow(id);
      expect(inv.status).toBe('Draft');
      expect(inv.title).toBe('Draw #1');
      expect(inv.client_name).toBe('Cargill');
      expect(Number(inv.holdback_pct)).toBe(10);
      expect(Number(inv.tax_pct)).toBe(11);
      expect(inv.holdback_release_date).toEqual(new Date('2027-02-01T00:00:00.000Z'));
      expect(inv.lines[0].type).toBe('draw');
      expect(inv.lines[0].description).toBe('Draw #1, October');
      expect(Number(inv.amount)).toBe(10000);
      expect(Number(inv.holdback_amount)).toBe(1000);
      expect(Number(inv.gst)).toBe(1100);
      expect(Number(inv.total)).toBe(10100);
      const after = await drawRow(d.id);
      expect(after.status).toBe('Invoiced');
      expect(after.invoice_id).toBe(id);
      expect(await create(d.id)).toBe(id);
      expect((await t.asSystem('select id from public.invoices where id = $1', [id])).length).toBe(1);
      expect((await t.asSystem(`select i.id from public.invoices i, jsonb_array_elements(i.lines) l where l ->> 'progress_billing_id' = $1`, [d.id])).length).toBe(1);
    });

    it('nothing is sent or owed by creating it', async () => {
      const id = await create((await draw()).id);
      expect(await receivable(id)).toBeUndefined();
    });

    it('only someone who can make invoices can press it', async () => {
      const d = await draw();
      expect(await t.fails('pm', 'select public.create_invoice_from_draw($1)', [d.id])).toMatch(/row-level security/);
      expect(await t.fails('other', 'select public.create_invoice_from_draw($1)', [d.id])).toMatch(/Draw not found/);
      expect(await t.fails(null, 'select public.create_invoice_from_draw($1)', [d.id])).toMatch(/permission denied/);
    });

    it('needs an amount', async () => {
      const d = await draw({ amount_billed: null });
      expect(await t.fails('owner', 'select public.create_invoice_from_draw($1)', [d.id])).toMatch(/enter the amount billed/);
    });

    it('follows its invoice to Paid and back, and goes back to Draft on void', async () => {
      const d = await draw();
      const id = await create(d.id);
      await setStatus(id, 'Sent');
      expect((await drawRow(d.id)).status).toBe('Invoiced');
      await setStatus(id, 'Paid');
      expect((await drawRow(d.id)).status).toBe('Paid');
      await setStatus(id, 'Sent');
      expect((await drawRow(d.id)).status).toBe('Invoiced');
      await setStatus(id, 'Void');
      const after = await drawRow(d.id);
      expect(after.status).toBe('Draft');
      expect(after.invoice_id).toBeNull();
      const next = await create(d.id);
      expect(next).not.toBe(id);
    });

    it('goes back to Draft if its draft invoice is deleted', async () => {
      const d = await draw();
      const id = await create(d.id);
      await t.as('owner', 'delete from public.invoices where id = $1', [id]);
      const after = await drawRow(d.id);
      expect(after.status).toBe('Draft');
      expect(after.invoice_id).toBeNull();
    });

    it('its money, status and link are not editable while on an invoice', async () => {
      const d = await draw();
      const id = await create(d.id);
      expect(await t.fails('pm', 'update public.progress_billing set amount_billed = 1 where id = $1', [d.id])).toMatch(/on an invoice/);
      expect(await t.fails('pm', `update public.progress_billing set status = 'Draft' where id = $1`, [d.id])).toMatch(/follows its invoice/);
      expect(await t.fails('owner', 'delete from public.progress_billing where id = $1', [d.id])).toMatch(/on an invoice/);
      const [row] = await t.as<Record<string, any>>('pm', `update public.progress_billing set invoice_id = null, notes = 'ok' where id = $1 returning *`, [d.id]);
      expect(row.invoice_id).toBe(id);
      expect(row.notes).toBe('ok');
    });

    it('a person cannot set the system statuses', async () => {
      expect(await t.fails('pm', `insert into public.progress_billing (title, status) values ('x', 'Paid')`)).toMatch(/starts as a draft/);
      const d = await draw();
      expect(await t.fails('pm', `update public.progress_billing set status = 'Invoiced' where id = $1`, [d.id])).toMatch(/follows its invoice/);
    });

    it('can also be added as a line from the invoice, once', async () => {
      const d = await draw();
      const inv = await newInvoice([{ type: 'draw', progress_billing_id: d.id, amount: 1 }]);
      expect(Number(inv.amount)).toBe(10000);
      expect((await drawRow(d.id)).invoice_id).toBe(inv.id);
      expect(await t.fails('owner', `insert into public.invoices (title, status, project_id, lines) values ('A', 'Draft', $1, $2)`, [project, JSON.stringify([{ type: 'draw', progress_billing_id: d.id }])])).toMatch(/already on another invoice/);
    });
  });

  describe('receivables', () => {
    it('are created on Sent, follow Paid both ways, and go on Draft or Void', async () => {
      const inv = await newInvoice([free(1000)], { title: 'October', client_name: 'Cargill', due_date: '2099-01-01' });
      expect(await receivable(inv.id)).toBeUndefined();

      await setStatus(inv.id, 'Sent');
      let r = await receivable(inv.id);
      expect(r.status).toBe('Current');
      expect(Number(r.amount)).toBe(950);
      expect(r.client_name).toBe('Cargill');
      expect(r.project_id).toBe(project);
      expect(r.title).toBe(`Invoice ${inv.invoice_number}: October`);
      expect(r.company_id).toBe(company);

      await setStatus(inv.id, 'Paid');
      r = await receivable(inv.id);
      expect(r.status).toBe('Collected');

      await setStatus(inv.id, 'Sent');
      expect((await receivable(inv.id)).status).toBe('Current');
      expect((await t.asSystem('select id from public.receivables where invoice_id = $1', [inv.id])).length).toBe(1);

      await setStatus(inv.id, 'Draft');
      expect(await receivable(inv.id)).toBeUndefined();
      await setStatus(inv.id, 'Sent');
      expect((await receivable(inv.id)).status).toBe('Current');
      await setStatus(inv.id, 'Void');
      expect(await receivable(inv.id)).toBeUndefined();
    });

    it('come back aged when a payment is undone on an old invoice', async () => {
      const inv = await newInvoice([free(100)], { due_date: new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10) });
      await setStatus(inv.id, 'Sent');
      expect((await receivable(inv.id)).status).toBe('30 Days');
    });

    it('one from an invoice cannot be changed or deleted by hand', async () => {
      const inv = await newInvoice([free(100)]);
      await setStatus(inv.id, 'Sent');
      const r = await receivable(inv.id);
      expect(await t.fails('owner', `update public.receivables set status = 'Collected' where id = $1`, [r.id])).toMatch(/follows its invoice/);
      expect(await t.fails('owner', 'update public.receivables set amount = 1 where id = $1', [r.id])).toMatch(/follows its invoice/);
      expect(await t.fails('owner', 'delete from public.receivables where id = $1', [r.id])).toMatch(/follows its invoice/);
    });

    it('a hand-entered one has its age worked out, and can be collected', async () => {
      const old = new Date(Date.now() - 95 * 86_400_000).toISOString().slice(0, 10);
      const [r] = await t.as<Record<string, any>>('owner', `insert into public.receivables (title, status, due_date, invoice_id) values ('Old', 'Current', $1, null) returning *`, [old]);
      expect(r.status).toBe('90+ Days');
      const [done] = await t.as<Record<string, any>>('owner', `update public.receivables set status = 'Collected' where id = $1 returning status`, [r.id]);
      expect(done.status).toBe('Collected');
      const [undone] = await t.as<Record<string, any>>('owner', `update public.receivables set status = 'Current' where id = $1 returning status`, [r.id]);
      expect(undone.status).toBe('90+ Days');
    });

    it('a client cannot link one to an invoice', async () => {
      const inv = await newInvoice([free(100)]);
      const [r] = await t.as<Record<string, any>>('owner', `insert into public.receivables (title, status, invoice_id) values ('Fake', 'Current', $1) returning invoice_id`, [inv.id]);
      expect(r.invoice_id).toBeNull();
    });

    it('the ageing job, as the service role, can change the status', async () => {
      const inv = await newInvoice([free(100)]);
      await setStatus(inv.id, 'Sent');
      const r = await receivable(inv.id);
      await t.asService(`update public.receivables set status = '60 Days' where id = $1`, [r.id]);
      expect((await receivable(inv.id)).status).toBe('60 Days');
    });
  });

  describe('saving', () => {
    it('saves fields and lines in one step, or neither', async () => {
      const inv = await newInvoice([free(100)]);
      const [saved] = await t.as<Record<string, any>>('owner', 'select * from public.save_invoice($1, $2, $3)', [inv.id, JSON.stringify({ title: 'New', tax_pct: 0, holdback_pct: 0, due_date: null }), JSON.stringify([free(250)])]);
      expect(saved.title).toBe('New');
      expect(Number(saved.total)).toBe(250);
      expect(saved.due_date).toBeNull();
      expect(await t.fails('owner', 'select public.save_invoice($1, $2, $3)', [inv.id, JSON.stringify({ title: 'Other' }), JSON.stringify([{ type: 'free', amount: 5 }])])).toMatch(/description/);
      const [row] = await t.asSystem<{ title: string }>('select title from public.invoices where id = $1', [inv.id]);
      expect(row.title).toBe('New');
    });

    it('as the caller: others find nothing, visitors are refused', async () => {
      const inv = await newInvoice([free(100)]);
      expect(await t.fails('other', `select public.save_invoice($1, '{}', '[]')`, [inv.id])).toMatch(/Invoice not found/);
      expect(await t.fails('pm', `select public.save_invoice($1, '{}', '[]')`, [inv.id])).toMatch(/Invoice not found/);
      expect(await t.fails(null, `select public.save_invoice($1, '{}', '[]')`, [inv.id])).toMatch(/permission denied/);
    });

    it('does nothing while a company is lapsed', async () => {
      const inv = await newInvoice([free(100)]);
      const [co] = [await newCo()];
      await t.setLapsed(company, true);
      try {
        expect(await t.fails('owner', `select public.save_invoice($1, '{}', '[]')`, [inv.id])).toMatch(/Invoice not found/);
        expect((await t.as('pm', `update public.change_orders set status = 'Sent' where id = $1 returning id`, [co.id])).length).toBe(0);
        expect((await t.as('owner', 'delete from public.invoices where id = $1 returning id', [inv.id])).length).toBe(0);
      } finally {
        await t.setLapsed(company, false);
      }
    });

    it('the helpers are not reachable from outside', async () => {
      expect(await t.fails('owner', `select public.next_company_number($1, 'invoice', 1)`, [company])).toMatch(/permission denied/);
      expect(await t.fails('owner', `select public.price_invoice_lines($1, $1, $1, '[]')`, [company])).toMatch(/permission denied/);
      expect(await t.fails('owner', 'select * from public.company_counters')).toMatch(/permission denied/);
    });
  });

  it('deleting a whole company takes its billing records with it', async () => {
    const co = await (async () => {
      const [{ id: p }] = await t.as<{ id: string }>('other', `insert into public.projects (title, status, contract_value) values ('Bye', 'Active', 100) returning id`);
      const [c] = await t.as<{ id: string }>('other', `insert into public.change_orders (title, status, project_id, material_cost) values ('c', 'Draft', $1, 5) returning id`, [p]);
      await t.as('other', `update public.change_orders set status = 'Sent' where id = $1`, [c.id]);
      await t.as('other', `update public.change_orders set status = 'Approved', approved_by = 'A', signature = $2 where id = $1`, [c.id, SIGNATURE]);
      const [i] = await t.as<{ id: string }>('other', `insert into public.invoices (title, status, project_id, lines) values ('i', 'Draft', $1, $2) returning id`, [p, JSON.stringify([{ type: 'change_order', change_order_id: c.id }])]);
      await t.as('other', `update public.invoices set status = 'Sent' where id = $1`, [i.id]);
      await t.as('other', `update public.invoices set status = 'Paid' where id = $1`, [i.id]);
      await t.as('other', `insert into public.progress_billing (title, status, project_id, amount_billed) values ('d', 'Draft', $1, 5)`, [p]);
      return c;
    })();
    await t.asService('delete from public.companies where id = $1', [other]);
    for (const table of ['change_orders', 'invoices', 'receivables', 'progress_billing', 'company_counters']) {
      expect((await t.asSystem(`select 1 from public.${table} where company_id = $1`, [other])).length).toBe(0);
    }
    expect((await t.asSystem('select 1 from public.change_orders where id = $1', [co.id])).length).toBe(0);
  });
});

describe('a database with records from before this engine', () => {
  const OLD = `
    insert into auth.users (id, email) values ('${users.owner.id}', '${users.owner.email}');
    insert into public.companies (id, name, province) values ('11111111-1111-4111-8111-111111111111', 'Alpha', 'SK');
    insert into public.company_users (user_id, company_id, role) values ('${users.owner.id}', '11111111-1111-4111-8111-111111111111', 'owner');
    insert into public.projects (id, company_id, title, status, contract_value, end_date) values
      ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Old Job', 'Active', 5000, '2027-01-01');
    insert into public.change_orders (company_id, title, status, project_name, cost_impact, days_impact) values
      ('11111111-1111-4111-8111-111111111111', 'Pending one', 'Pending Approval', 'Old Job', 100, 1),
      ('11111111-1111-4111-8111-111111111111', 'Approved one', 'Approved', 'Old Job', 250, 2),
      ('11111111-1111-4111-8111-111111111111', 'Invoiced one', 'Invoiced', 'Old Job', 50, 0);
    insert into public.invoices (company_id, title, status, client_name, amount, gst, created_at) values
      ('11111111-1111-4111-8111-111111111111', 'First', 'Sent', 'Cargill', 1000, 50, '2026-01-01'),
      ('11111111-1111-4111-8111-111111111111', 'Second', 'Paid', 'Cargill', 200, 0, '2026-02-01'),
      ('11111111-1111-4111-8111-111111111111', 'Empty', 'Draft', null, null, null, '2026-03-01');
  `;
  let t: TestDb<'owner'>;

  beforeAll(async () => {
    const file = '20261101000100_job_photos_storage.sql';
    t = await bootDb({}, { include: (f) => f === BASELINE_FILE || f === file, baselineSql: readFileSync(OLD_BASELINE_FIXTURE, 'utf8') }) as unknown as TestDb<'owner'>;
    await t.pg.exec(OLD);
    for (const f of migrationFiles()) if (f !== BASELINE_FILE && f !== file) await t.pg.exec(readMigration(f));
  }, 120_000);

  it('numbers old invoices from 1001 in the order they were made, and carries on from there', async () => {
    const rows = await t.asSystem<{ title: string; invoice_number: string }>('select title, invoice_number from public.invoices order by created_at');
    expect(rows.map((r) => r.invoice_number)).toEqual(['1001', '1002', '1003']);
    const [{ last_value }] = await t.asSystem<{ last_value: string }>(`select last_value from public.company_counters where kind = 'invoice'`);
    expect(Number(last_value)).toBe(1003);
  });

  it('turns hand-typed invoice amounts into a line and keeps the total', async () => {
    const [first] = await t.asSystem<Record<string, any>>(`select * from public.invoices where title = 'First'`);
    expect(Number(first.total)).toBe(1050);
    expect(Number(first.tax_pct)).toBe(5);
    expect(first.lines).toEqual([{ type: 'free', description: 'First', amount: 1000 }]);
    const [empty] = await t.asSystem<Record<string, any>>(`select * from public.invoices where title = 'Empty'`);
    expect(Number(empty.total)).toBe(0);
    expect(empty.lines).toEqual([]);
    const [second] = await t.asSystem<Record<string, any>>(`select * from public.invoices where title = 'Second'`);
    expect(second.paid_at).toBeTruthy();
  });

  it('maps old change order statuses and prices, and counts the approved ones on the contract', async () => {
    const rows = await t.asSystem<Record<string, any>>('select title, status, price, co_number, project_id from public.change_orders order by co_number');
    const by = Object.fromEntries(rows.map((r) => [r.title, r]));
    expect(by['Pending one'].status).toBe('Sent');
    expect(by['Approved one'].status).toBe('Approved');
    expect(by['Invoiced one'].status).toBe('Approved');
    expect(Number(by['Approved one'].price)).toBe(250);
    expect(new Set(rows.map((r) => r.co_number)).size).toBe(3);
    const [p] = await t.asSystem<Record<string, any>>('select * from public.projects');
    expect(Number(p.approved_changes)).toBe(300);
    expect(Number(p.revised_contract)).toBe(5300);
    expect(p.revised_end_date).toEqual(new Date('2027-01-03T00:00:00.000Z'));
  });

  it('can run again and changes nothing', async () => {
    const before = await t.asSystem('select id, invoice_number, total, lines from public.invoices order by id');
    const beforeCos = await t.asSystem('select id, co_number, price, status from public.change_orders order by id');
    await t.pg.exec(readMigration('20261104000110_billing.sql'));
    expect(await t.asSystem('select id, invoice_number, total, lines from public.invoices order by id')).toEqual(before);
    expect(await t.asSystem('select id, co_number, price, status from public.change_orders order by id')).toEqual(beforeCos);
  });
});

describe('the routes', () => {
  const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' };
  const COMPANY = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01T00:00:00Z', current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null };
  const ID = '44444444-4444-4444-8444-444444444444';
  const params = { params: { id: ID } };
  const put = (body: unknown) => new Request('http://test/x', { method: 'PUT', body: JSON.stringify(body) });

  function signedIn(role = 'owner', tables: Record<string, Record<string, unknown>[]> = {}, rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null }, company = COMPANY) {
    const fake = fakeSupabase({ company_users: [{ user_id: USER.id, role, company }], ...tables }, { rpc });
    mocks.server = Object.assign(fake, { auth: { getUser: async () => ({ data: { user: USER }, error: null }) } });
    return fake;
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  describe('PUT /api/change-orders/[id]', () => {
    it('approves with a name and signature', async () => {
      signedIn('project_manager', { change_orders: [{ id: ID, status: 'Sent' }] });
      const res = await changeOrderAction(put({ action: 'approve', approved_by: ' Sam ', signature: SIGNATURE }), params);
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data).toMatchObject({ status: 'Approved', approved_by: 'Sam', signature: SIGNATURE });
    });

    it('refuses a missing name or a signature that is not a drawn image', async () => {
      signedIn();
      expect((await changeOrderAction(put({ action: 'approve', approved_by: '', signature: SIGNATURE }), params)).status).toBe(400);
      const res = await changeOrderAction(put({ action: 'approve', approved_by: 'Sam', signature: 'http://x' }), params);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Draw a signature first');
    });

    it('reopens to Draft, and takes nothing else from the body', async () => {
      signedIn('owner', { change_orders: [{ id: ID, status: 'Approved', price: 5 }] });
      const res = await changeOrderAction(put({ action: 'reopen', price: 1 }), params);
      expect((await res.json()).data).toEqual({ id: ID, status: 'Draft', price: 5 });
    });

    it('refuses a foreman, a lapsed company, a bad id and an unknown action', async () => {
      signedIn('foreman');
      expect((await changeOrderAction(put({ action: 'reopen' }), params)).status).toBe(403);
      signedIn('owner', {}, undefined, { ...COMPANY, subscription_status: 'canceled' });
      expect((await changeOrderAction(put({ action: 'reopen' }), params)).status).toBe(402);
      signedIn();
      expect((await changeOrderAction(put({ action: 'reopen' }), { params: { id: 'nope' } })).status).toBe(404);
      expect((await changeOrderAction(put({ action: 'delete' }), params)).status).toBe(400);
    });

    it('answers 404 for a change order that is not there', async () => {
      signedIn('owner', { change_orders: [{ id: ID }] });
      const res = await changeOrderAction(put({ action: 'reopen' }), { params: { id: '55555555-5555-4555-8555-555555555555' } });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/invoices/[id]', () => {
    const saved = { id: ID, project_id: null };

    it('sends validated fields and lines to the one transaction', async () => {
      const calls: Record<string, unknown>[] = [];
      signedIn('owner', {}, (name, args) => {
        calls.push({ name, ...args });
        return { data: saved, error: null };
      });
      const res = await saveInvoice(put({ title: ' New ', status: 'Paid', total: 1, lines: [{ type: 'free', description: 'x', amount: '10.005' }, { type: 'percent', percent: 10, amount: 999 }] }), params);
      expect(res.status).toBe(200);
      expect(calls).toEqual([{ name: 'save_invoice', p_invoice: ID, p_fields: { title: 'New' }, p_lines: [{ type: 'free', description: 'x', amount: 10.01 }, { type: 'percent', percent: 10 }] }]);
    });

    it('says which line is wrong', async () => {
      signedIn();
      const res = await saveInvoice(put({ lines: [{ type: 'free', description: 'ok', amount: 1 }, { type: 'free', description: '', amount: 1 }] }), params);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Line 2: Enter a description');
    });

    it('returns the database\'s reason as a clear refusal', async () => {
      signedIn('owner', {}, () => ({ data: null, error: { code: '22023', message: 'Line 1: change order #3 is already on another invoice.' } }));
      const res = await saveInvoice(put({ lines: [] }), params);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/already on another invoice/);
      signedIn('owner', {}, () => ({ data: null, error: { code: 'P0001', message: 'Only a draft invoice can be edited. Set it back to Draft first.' } }));
      expect((await saveInvoice(put({ title: 'x' }), params)).status).toBe(409);
    });

    it('refuses a PM, an empty save and a bad body', async () => {
      signedIn('project_manager');
      expect((await saveInvoice(put({ title: 'x' }), params)).status).toBe(403);
      signedIn();
      expect((await saveInvoice(put({}), params)).status).toBe(400);
      expect((await saveInvoice(put([]), params)).status).toBe(400);
      expect((await saveInvoice(new Request('http://t/x', { method: 'PUT', body: '{' }), params)).status).toBe(400);
    });
  });

  describe('POST /api/progress-billing/[id]/invoice', () => {
    it('creates through the RPC and returns the invoice', async () => {
      const calls: unknown[] = [];
      signedIn('admin', {}, (name, args) => {
        calls.push([name, args]);
        return { data: 'invoice-id', error: null };
      });
      const res = await createInvoice(new Request('http://t/x', { method: 'POST' }), params);
      expect(res.status).toBe(201);
      expect((await res.json()).data.invoice_id).toBe('invoice-id');
      expect(calls).toEqual([['create_invoice_from_draw', { p_draw: ID }]]);
    });

    it('is for those who can make invoices, on a company that can write', async () => {
      signedIn('project_manager');
      expect((await createInvoice(new Request('http://t/x', { method: 'POST' }), params)).status).toBe(403);
      signedIn('owner', {}, undefined, { ...COMPANY, subscription_status: 'canceled' });
      expect((await createInvoice(new Request('http://t/x', { method: 'POST' }), params)).status).toBe(402);
      signedIn('owner', {}, () => ({ data: null, error: { code: 'P0002', message: 'Draw not found' } }));
      expect((await createInvoice(new Request('http://t/x', { method: 'POST' }), params)).status).toBe(404);
    });
  });
});
