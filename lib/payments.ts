// Partial payments on invoices: what a payment looks like, the rules for recording one, and what an
// invoice has been paid and still owes. The database holds the real rules
// (supabase/migrations/20261113000110_invoice_payments.sql): it refuses a payment on a draft or void
// invoice or past the total, to the cent, and marks the invoice paid once its payments reach the total.
// The figures here are the same ones, for the invoice page and the bookkeeping export.
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { cents } from './billing-math';
import { isCalendarDate } from './validation';

export const PAYMENT_METHODS = ['Cheque', 'EFT', 'Credit card', 'Cash', 'Other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface InvoicePayment {
  id: string;
  invoice_id: string;
  amount: number | string;
  paid_on: string;
  method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
}

/** What the page and the routes read of a payment. */
export const PAYMENT_COLUMNS = 'id, invoice_id, amount, paid_on, method, reference, note, created_at';

/** The invoice fields the payments panel needs, and what the routes send back after a change. */
export interface PaymentInvoice {
  id: string;
  status: string;
  total: number | string | null;
  paid_at: string | null;
}

export interface PaymentState {
  invoice: PaymentInvoice;
  payments: InvoicePayment[];
}

// A number, or a string of one. Anything else (true, an empty box, "12abc") is not an amount.
const toAmount = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN);
const optionalText = (max: number, label: string) =>
  z.preprocess(
    (v) => (v === undefined || v === null ? null : typeof v === 'string' ? v.trim() || null : v),
    z.string({ message: `Enter the ${label} as text.` }).max(max, `Keep the ${label} to ${max} characters.`).nullable()
  );

/** What the Record payment form sends. Anything else in the body, such as a company or an invoice, is dropped. */
export const PaymentSchema = z.object({
  amount: z.preprocess(
    toAmount,
    z
      .number({ message: 'Enter the amount paid.' })
      .finite('Enter the amount paid.')
      .max(1e11, 'That amount is too large.')
      .transform(cents)
      .refine((n) => n > 0, 'Enter an amount above zero.')
  ),
  paid_on: z.string({ message: 'Enter the date the payment came in.' }).refine(isCalendarDate, 'Enter the date the payment came in.'),
  method: z.enum(PAYMENT_METHODS, { message: 'Pick how it was paid.' }),
  reference: optionalText(100, 'reference'),
  note: optionalText(500, 'note'),
});

export type PaymentInput = z.infer<typeof PaymentSchema>;

export function parsePayment(input: unknown): { ok: true; data: PaymentInput } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Invalid request' };
  const parsed = PaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Some values were not valid.' };
  return { ok: true, data: parsed.data };
}

export interface PaymentTotals {
  /** The payments recorded on the invoice, added up. */
  recorded: number;
  /** What the books count as paid: the total once the invoice is Paid, the payments recorded until then. */
  paid: number;
  /** What the client still owes on it. */
  balance: number;
  /** How much more can be recorded before the payments reach the total. */
  room: number;
  /** Marked paid by hand, with payments that add up to less than the total. */
  byHand: boolean;
}

/**
 * What an invoice has been paid and what is still owed. A sent or overdue invoice owes its total less
 * the payments recorded. A paid one owes nothing, even when it was marked paid by hand without payments
 * to match. A draft is not owed yet and a void invoice never will be, so they owe nothing either.
 */
export function paymentTotals(invoice: { status: string; total: unknown }, payments: readonly { amount: unknown }[]): PaymentTotals {
  const recorded = cents(payments.reduce<number>((sum, p) => sum + cents(p.amount), 0));
  const total = cents(invoice.total);
  const takesPayments = invoice.status === 'Sent' || invoice.status === 'Overdue' || invoice.status === 'Paid';
  const room = takesPayments ? Math.max(0, cents(total - recorded)) : 0;
  if (invoice.status === 'Paid') return { recorded, paid: total, balance: 0, room, byHand: recorded < total };
  if (invoice.status === 'Sent' || invoice.status === 'Overdue') return { recorded, paid: recorded, balance: cents(total - recorded), room, byHand: false };
  return { recorded, paid: recorded, balance: 0, room, byHand: false };
}

type DbError = { code?: string; message: string };

/**
 * The invoice and its payments as the signed-in user may read them, oldest payment first. `state` is
 * null when the invoice is not there or not theirs to see.
 */
export async function loadPaymentState(supabase: SupabaseClient, invoiceId: string): Promise<{ state: PaymentState | null } | { error: DbError }> {
  const [invoice, payments] = await Promise.all([
    supabase.from('invoices').select('id, status, total, paid_at').eq('id', invoiceId).maybeSingle(),
    supabase.from('invoice_payments').select(PAYMENT_COLUMNS).eq('invoice_id', invoiceId).order('paid_on').order('created_at').order('id'),
  ]);
  const failure = invoice.error ?? payments.error;
  if (failure) return { error: failure };
  if (!invoice.data) return { state: null };
  return { state: { invoice: invoice.data as PaymentInvoice, payments: (payments.data ?? []) as InvoicePayment[] } };
}
