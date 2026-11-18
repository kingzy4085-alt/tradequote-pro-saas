// Partial payments on invoices and the bookkeeping export: the CSV rules, the form's checks, and
// the database keeping each invoice in step with the money recorded against it.
import { beforeAll, describe, expect, it } from 'vitest';
import { csvCell, csvResponse, toCsv } from '@/lib/csv';
import { invoiceExportRows, paymentExportRows } from '@/lib/exports';
import { parsePayment, paymentTotals } from '@/lib/payments';
import { bootDb, type TestDb } from './helpers/db';

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks, and doubles inner quotes', () => {
    expect(csvCell('Smith, Dana')).toBe('"Smith, Dana"');
    expect(csvCell('5" conduit')).toBe('"5"" conduit"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('never lets typed text run as a formula in a spreadsheet', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '  =1+1', '＝1+1', '\t=1']) {
      expect(csvCell(evil).replace(/^"/, '').startsWith("'"), evil).toBe(true);
    }
    expect(csvCell('Dana = boss')).toBe('Dana = boss');
  });

  it('writes numbers the export worked out as numbers, a credit keeping its minus sign', () => {
    expect(csvCell(-125.5)).toBe('-125.5');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('a file has a byte order mark, a header and CRLF line ends', () => {
    expect(toCsv(['A', 'B'], [[1, 'x,y']])).toBe('﻿A,B\r\n1,"x,y"\r\n');
  });

  it('is sent as a download that is never cached, with a safe file name', async () => {
    const res = csvResponse('a\r\n', 'invoices 2026/11.csv');
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="invoices-2026-11.csv"');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('a\r\n');
  });
});

describe('export rows', () => {
  it('invoices show what is paid and what is left, from their payments', () => {
    const rows = invoiceExportRows([
      { invoice_number: 'INV-1', client_name: 'Cargill', issue_date: '2026-11-01', due_date: '2026-12-01', amount: 1000, gst: 50, holdback_amount: 0, total: 1050, status: 'Sent', invoice_payments: [{ amount: 300 }, { amount: '200.10' }] },
    ] as never);
    expect(rows[0]).toEqual(['INV-1', 'Cargill', '2026-11-01', '2026-12-01', 1000, 50, 0, 1050, 500.1, 549.9, 'Sent']);
  });

  it('payments name their invoice whether it arrives as one row or a list of one', () => {
    const base = { paid_on: '2026-11-05', amount: 300, method: 'Cheque', reference: '1042', note: null };
    expect(paymentExportRows([{ ...base, invoice: { invoice_number: 'INV-1', client_name: 'Cargill' } }])[0]).toEqual(['2026-11-05', 'INV-1', 'Cargill', 300, 'Cheque', '1042', null]);
    expect(paymentExportRows([{ ...base, invoice: [{ invoice_number: 'INV-2', client_name: 'Bravo' }] }])[0].slice(1, 3)).toEqual(['INV-2', 'Bravo']);
    expect(paymentExportRows([{ ...base, invoice: null }])[0].slice(1, 3)).toEqual([undefined, undefined]);
  });
});

describe('the payment form', () => {
  it('takes an amount to the cent and a real date', () => {
    const ok = parsePayment({ amount: '1250.255', paid_on: '2026-11-05', method: 'EFT' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.amount).toBe(1250.26);
  });

  it('refuses no amount, zero, a negative, an impossible date or an unknown method', () => {
    for (const bad of [{ amount: '', paid_on: '2026-11-05', method: 'EFT' }, { amount: 0, paid_on: '2026-11-05', method: 'EFT' }, { amount: -5, paid_on: '2026-11-05', method: 'EFT' }, { amount: 5, paid_on: '2026-02-30', method: 'EFT' }, { amount: 5, paid_on: '2026-11-05', method: 'Bitcoin' }]) {
      expect(parsePayment(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('works out paid and balance the same way the database does', () => {
    expect(paymentTotals({ status: 'Sent', total: 1000 }, [{ amount: 300 }, { amount: 200 }])).toMatchObject({ paid: 500, balance: 500, room: 500, byHand: false });
    expect(paymentTotals({ status: 'Paid', total: 1000 }, [{ amount: 300 }])).toMatchObject({ paid: 1000, balance: 0, byHand: true });
    expect(paymentTotals({ status: 'Draft', total: 1000 }, [])).toMatchObject({ balance: 0, room: 0 });
  });
});

const users = {
  ownerA: { id: '00000000-0000-4000-8000-0000000000a1', email: 'owner@alpha.ca' },
  adminA: { id: '00000000-0000-4000-8000-0000000000a2', email: 'admin@alpha.ca' },
  pmA: { id: '00000000-0000-4000-8000-0000000000a3', email: 'pm@alpha.ca' },
  ownerB: { id: '00000000-0000-4000-8000-0000000000b1', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

describe('payments in the database', () => {
  let t: TestDb<U>;
  let alpha: string;
  const TODAY = new Date().toISOString().slice(0, 10);

  /** A sent invoice of company A for exactly $1,000, no tax or holdback. */
  async function sentInvoice(amount = 1000): Promise<string> {
    const [inv] = await t.as<{ id: string }>('ownerA', `insert into public.invoices (title, status, tax_pct, holdback_pct, lines) values ('INV', 'Draft', 0, 0, $1) returning id`, [JSON.stringify([{ type: 'free', description: 'Work', amount }])]);
    await t.as('ownerA', `update public.invoices set status = 'Sent' where id = $1`, [inv.id]);
    return inv.id;
  }
  const pay = (who: U, invoice: string, amount: number, paidOn = TODAY) =>
    t.as<{ id: string }>(who, `insert into public.invoice_payments (invoice_id, amount, paid_on, method) values ($1, $2, $3, 'Cheque') returning id`, [invoice, amount, paidOn]);
  const invoice = async (id: string) => (await t.asSystem<{ status: string; paid_at: string | null; total: string }>('select status, paid_at::text, total from public.invoices where id = $1', [id]))[0];

  beforeAll(async () => {
    t = await bootDb(users);
    alpha = await t.createCompany('ownerA', 'Alpha Electric');
    await t.createCompany('ownerB', 'Bravo Power');
    await t.join('ownerA', 'adminA', 'admin');
    await t.join('ownerA', 'pmA', 'project_manager');
  });

  it('a part payment leaves the invoice sent; the last one makes it paid, dated when that money came in', async () => {
    const id = await sentInvoice();
    expect(Number((await invoice(id)).total)).toBe(1000);
    await pay('ownerA', id, 400, '2026-11-01');
    expect(await invoice(id)).toMatchObject({ status: 'Sent', paid_at: null });
    await pay('adminA', id, 600, '2026-11-03');
    expect(await invoice(id)).toMatchObject({ status: 'Paid', paid_at: '2026-11-03' });
  });

  it('refuses a payment past the total, to the cent, and says how much is left', async () => {
    const id = await sentInvoice();
    await pay('ownerA', id, 999.99);
    expect(await t.fails('ownerA', `insert into public.invoice_payments (invoice_id, amount, paid_on, method) values ($1, 0.02, $2, 'Cash')`, [id, TODAY])).toMatch(/more than is left.*0\.01 is left/);
    await pay('ownerA', id, 0.01);
    expect((await invoice(id)).status).toBe('Paid');
    expect(await t.fails('ownerA', `insert into public.invoice_payments (invoice_id, amount, paid_on, method) values ($1, 1, $2, 'Cash')`, [id, TODAY])).toMatch(/Nothing is left to pay/);
  });

  it('refuses a payment on a draft or void invoice, or dated in the future', async () => {
    const [draft] = await t.as<{ id: string }>('ownerA', `insert into public.invoices (title, status, tax_pct, holdback_pct, lines) values ('D', 'Draft', 0, 0, $1) returning id`, [JSON.stringify([{ type: 'free', description: 'Work', amount: 100 }])]);
    expect(await t.fails('ownerA', `insert into public.invoice_payments (invoice_id, amount, paid_on, method) values ($1, 10, $2, 'Cash')`, [draft.id, TODAY])).toMatch(/Mark this invoice as sent/);
    const voided = await sentInvoice();
    await t.as('ownerA', `update public.invoices set status = 'Void' where id = $1`, [voided]);
    expect(await t.fails('ownerA', `insert into public.invoice_payments (invoice_id, amount, paid_on, method) values ($1, 10, $2, 'Cash')`, [voided, TODAY])).toMatch(/void/);
    const open = await sentInvoice();
    expect(await t.fails('ownerA', `insert into public.invoice_payments (invoice_id, amount, paid_on, method) values ($1, 10, (current_date + 5), 'Cash')`, [open])).toMatch(/future/);
  });

  it('deleting a payment that made it paid reopens the invoice; one marked paid by hand stays paid', async () => {
    const id = await sentInvoice();
    await pay('ownerA', id, 500);
    const [last] = await pay('ownerA', id, 500);
    expect((await invoice(id)).status).toBe('Paid');
    await t.as('ownerA', 'delete from public.invoice_payments where id = $1', [last.id]);
    expect(await invoice(id)).toMatchObject({ status: 'Sent', paid_at: null });

    const byHand = await sentInvoice();
    const [part] = await pay('ownerA', byHand, 200);
    await t.as('ownerA', `update public.invoices set status = 'Paid' where id = $1`, [byHand]);
    await t.as('ownerA', 'delete from public.invoice_payments where id = $1', [part.id]);
    expect((await invoice(byHand)).status).toBe('Paid');
  });

  it('an invoice with payments cannot go back to draft or be voided, and a paid-up one cannot be reopened by hand', async () => {
    const part = await sentInvoice();
    await pay('ownerA', part, 100);
    expect(await t.fails('ownerA', `update public.invoices set status = 'Draft' where id = $1`, [part])).toMatch(/Delete them first, then set it back to Draft/);
    expect(await t.fails('ownerA', `update public.invoices set status = 'Void' where id = $1`, [part])).toMatch(/Delete them first, then void it/);
    const full = await sentInvoice();
    await pay('ownerA', full, 1000);
    expect(await t.fails('ownerA', `update public.invoices set status = 'Sent' where id = $1`, [full])).toMatch(/Delete one of them to reopen it/);
  });

  it('a recorded payment cannot be changed: it is deleted and recorded again', async () => {
    const id = await sentInvoice();
    const [p] = await pay('ownerA', id, 100);
    expect(await t.fails('ownerA', 'update public.invoice_payments set amount = 1 where id = $1', [p.id])).toMatch(/permission denied/);
  });

  it('a project manager cannot see or record payments; another company cannot either', async () => {
    const id = await sentInvoice();
    await pay('ownerA', id, 100);
    expect(await t.as('pmA', 'select 1 from public.invoice_payments')).toEqual([]);
    expect(await t.fails('pmA', `insert into public.invoice_payments (invoice_id, amount, paid_on, method) values ($1, 10, $2, 'Cash')`, [id, TODAY])).toMatch(/permission/);
    expect(await t.as('ownerB', 'select 1 from public.invoice_payments')).toEqual([]);
    expect(await t.fails('ownerB', `insert into public.invoice_payments (invoice_id, amount, paid_on, method) values ($1, 10, $2, 'Cash')`, [id, TODAY])).toMatch(/could not be found|row-level security|permission/);
    expect(await t.fails('ownerB', `insert into public.invoice_payments (company_id, invoice_id, amount, paid_on, method) values ($1, $2, 10, $3, 'Cash')`, [alpha, id, TODAY])).toMatch(/permission|row-level security/);
    expect(await t.as('ownerB', `delete from public.invoice_payments returning id`)).toEqual([]);
    expect(await t.fails(null, 'select 1 from public.invoice_payments')).toMatch(/permission denied/);
  });

  it('a lapsed company can read its payments but not record new ones', async () => {
    const id = await sentInvoice();
    await pay('ownerA', id, 100);
    await t.setLapsed(alpha, true);
    expect((await t.as('ownerA', 'select 1 from public.invoice_payments where invoice_id = $1', [id])).length).toBe(1);
    expect(await t.fails('ownerA', `insert into public.invoice_payments (invoice_id, amount, paid_on, method) values ($1, 10, $2, 'Cash')`, [id, TODAY])).toMatch(/permission/);
    await t.setLapsed(alpha, false);
  });

  it('deleting the invoice takes its payments with it', async () => {
    const [draft] = await t.as<{ id: string }>('ownerA', `insert into public.invoices (title, status, tax_pct, holdback_pct, lines) values ('Gone', 'Draft', 0, 0, $1) returning id`, [JSON.stringify([{ type: 'free', description: 'Work', amount: 100 }])]);
    await t.as('ownerA', `update public.invoices set status = 'Sent' where id = $1`, [draft.id]);
    await pay('ownerA', draft.id, 50);
    // A sent invoice's receivable holds on to it; once that is gone the invoice can go, and its payments with it
    await t.asSystem('delete from public.receivables where invoice_id = $1', [draft.id]);
    await t.asSystem('delete from public.invoices where id = $1', [draft.id]);
    expect(await t.asSystem('select 1 from public.invoice_payments where invoice_id = $1', [draft.id])).toEqual([]);
  });
});
