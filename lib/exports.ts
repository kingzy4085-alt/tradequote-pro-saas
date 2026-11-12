// The bookkeeping export: every invoice that has gone out, and every payment recorded against one, as
// CSV files a bookkeeper can open in a spreadsheet or import. Everything is read as the signed-in user,
// so row security decides what is in the file, the same as on screen.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cents } from './billing-math';
import { toCsv, type CsvValue } from './csv';
import { paymentTotals } from './payments';

/** A draft is not an invoice the client has seen yet, so it stays out of the books. Void ones stay in: their numbers are used. */
export const EXPORTED_STATUSES = ['Sent', 'Overdue', 'Paid', 'Void'];

export const INVOICE_EXPORT_HEADER = ['Invoice Number', 'Client', 'Issue Date', 'Due Date', 'Subtotal', 'Tax', 'Holdback', 'Total', 'Paid', 'Balance', 'Status'] as const;
export const PAYMENT_EXPORT_HEADER = ['Date', 'Invoice Number', 'Client', 'Amount', 'Method', 'Reference', 'Note'] as const;

export interface ExportInvoice {
  invoice_number: string | null;
  client_name: string | null;
  issue_date: string | null;
  due_date: string | null;
  amount: unknown;
  gst: unknown;
  holdback_amount: unknown;
  total: unknown;
  status: string;
  invoice_payments?: { amount: unknown }[] | null;
}

export interface ExportPayment {
  paid_on: string;
  amount: unknown;
  method: string;
  reference: string | null;
  note: string | null;
  /** The invoice it pays. PostgREST sends one row; untyped clients describe it as a list, so both are accepted. */
  invoice?: PaymentInvoice | PaymentInvoice[] | null;
}

type PaymentInvoice = { invoice_number: string | null; client_name: string | null };
const invoiceOf = (p: Pick<ExportPayment, 'invoice'>): PaymentInvoice | null => (Array.isArray(p.invoice) ? p.invoice[0] ?? null : p.invoice ?? null);

export function invoiceExportRows(invoices: readonly ExportInvoice[]): CsvValue[][] {
  return invoices.map((i) => {
    const { paid, balance } = paymentTotals(i, i.invoice_payments ?? []);
    return [i.invoice_number, i.client_name, i.issue_date, i.due_date, cents(i.amount), cents(i.gst), cents(i.holdback_amount), cents(i.total), paid, balance, i.status];
  });
}

export function paymentExportRows(payments: readonly ExportPayment[]): CsvValue[][] {
  return payments.map((p) => [p.paid_on, invoiceOf(p)?.invoice_number, invoiceOf(p)?.client_name, cents(p.amount), p.method, p.reference, p.note]);
}

/** Rows a request, the most PostgREST hands back in one. A file is made of pages of these. */
export const EXPORT_PAGE = 1000;
/** 100,000 rows. Past that the export says so, rather than handing over a file with some left out. */
export const EXPORT_MAX_PAGES = 100;

export const tooManyToExport = (noun: string) => `There are more than ${(EXPORT_PAGE * EXPORT_MAX_PAGES).toLocaleString('en-CA')} ${noun}, which is too many for one file.`;

type DbError = { code?: string; message: string };
type Page<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError | null }>;
export type ExportResult = { csv: string; rows: number } | { error: DbError } | { tooMany: true };

/** Reads every page in order. Stops at the first short page. */
export async function readAllPages<T>(page: Page<T>): Promise<{ rows: T[] } | { error: DbError } | { tooMany: true }> {
  const rows: T[] = [];
  for (let n = 0; n < EXPORT_MAX_PAGES; n++) {
    const { data, error } = await page(n * EXPORT_PAGE, (n + 1) * EXPORT_PAGE - 1);
    if (error) return { error };
    const got = data ?? [];
    rows.push(...got);
    if (got.length < EXPORT_PAGE) return { rows };
  }
  return { tooMany: true };
}

/** Oldest first. The id breaks ties, so a row can't move between pages while the file is read. */
export async function invoicesCsv(supabase: SupabaseClient): Promise<ExportResult> {
  const read = await readAllPages<ExportInvoice>((from, to) =>
    supabase
      .from('invoices')
      .select('invoice_number, client_name, issue_date, due_date, amount, gst, holdback_amount, total, status, invoice_payments(amount)')
      .in('status', EXPORTED_STATUSES)
      .order('issue_date', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  );
  if (!('rows' in read)) return read;
  return { csv: toCsv(INVOICE_EXPORT_HEADER, invoiceExportRows(read.rows)), rows: read.rows.length };
}

export async function paymentsCsv(supabase: SupabaseClient): Promise<ExportResult> {
  const read = await readAllPages<ExportPayment>((from, to) =>
    supabase
      .from('invoice_payments')
      .select('paid_on, amount, method, reference, note, invoice:invoices(invoice_number, client_name)')
      .order('paid_on', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  );
  if (!('rows' in read)) return read;
  return { csv: toCsv(PAYMENT_EXPORT_HEADER, paymentExportRows(read.rows)), rows: read.rows.length };
}
