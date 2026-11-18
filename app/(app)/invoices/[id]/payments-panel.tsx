'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Input, Label, Panel, Select } from '@/components/ui';
import { formatMoney, formatValue } from '@/lib/format';
import { PAYMENT_METHODS, paymentTotals, type InvoicePayment, type PaymentInvoice, type PaymentState } from '@/lib/payments';

async function call(url: string, method: string, body?: unknown) {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('Network error. Check your connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'That did not work. Try again.');
  return json;
}

const amountText = (n: number) => (n > 0 ? n.toFixed(2) : '');

/**
 * The payments on an invoice, what they add up to and what is still owed, with the form to record
 * one. The database decides what is allowed and moves the invoice to Paid or back to Sent; `onChange`
 * hands the invoice and payments it sent back to the editor.
 */
export default function PaymentsPanel({
  invoice,
  payments,
  today,
  canRecord,
  canDelete,
  onChange,
}: {
  invoice: PaymentInvoice;
  /** Null when they could not be loaded. */
  payments: InvoicePayment[] | null;
  /** The company's date, YYYY-MM-DD: the date a new payment starts with. */
  today: string;
  canRecord: boolean;
  canDelete: boolean;
  onChange: (state: PaymentState) => void;
}) {
  const totals = paymentTotals(invoice, payments ?? []);
  // Null until someone types: the amount then follows the balance, which moves with every payment
  const [typedAmount, setTypedAmount] = useState<string | null>(null);
  const amount = typedAmount ?? amountText(totals.room);
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const takesPayments = invoice.status === 'Sent' || invoice.status === 'Overdue' || invoice.status === 'Paid';
  const showForm = canRecord && payments !== null && takesPayments && totals.room > 0;
  const typed = Number(amount);
  const amountProblem = !(typed > 0) ? 'Enter an amount above zero.' : Math.round(typed * 100) > Math.round(totals.room * 100) ? `That is more than the ${formatMoney(totals.room)} left to pay.` : '';

  // The routes send back the invoice and its payments. Should that read fail, ask again.
  async function settle(json: Partial<PaymentState>): Promise<PaymentState | null> {
    if (json.invoice && json.payments) return json as PaymentState;
    try {
      return (await call(`/api/invoices/${invoice.id}/payments`, 'GET')) as PaymentState;
    } catch {
      return null;
    }
  }

  async function record() {
    if (amountProblem || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const json = await call(`/api/invoices/${invoice.id}/payments`, 'POST', { amount, paid_on: paidOn, method, reference, note });
      const state = await settle(json);
      setTypedAmount(null);
      setReference('');
      setNote('');
      setPaidOn(today);
      if (!state) {
        setNotice('Payment recorded. Reload the page to see it.');
        return;
      }
      onChange(state);
      setNotice(state.invoice.status === 'Paid' && invoice.status !== 'Paid' ? 'Payment recorded. The invoice is paid in full.' : 'Payment recorded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(payment: InvoicePayment) {
    // Paid through its payments: taking one away means the invoice is owed again
    const reopens = invoice.status === 'Paid' && !totals.byHand;
    const ask = `Delete the ${formatMoney(payment.amount)} payment from ${formatValue('date', payment.paid_on)}?${reopens ? ' The invoice goes back to Sent.' : ''}`;
    if (busy || !window.confirm(ask)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const json = await call(`/api/invoice-payments/${payment.id}`, 'DELETE');
      const state = await settle(json);
      setTypedAmount(null);
      if (!state) {
        setNotice('Payment deleted. Reload the page to see the invoice as it is now.');
        return;
      }
      onChange(state);
      setNotice(invoice.status === 'Paid' && state.invoice.status !== 'Paid' ? 'Payment deleted. The invoice is open again.' : 'Payment deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Payments">
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {payments === null ? (
          <p className="text-sm text-slate-400">The payments on this invoice could not be loaded. Reload the page to try again.</p>
        ) : invoice.status === 'Draft' ? (
          <p className="text-sm text-slate-400">Payments can be recorded once this invoice is marked sent.</p>
        ) : invoice.status === 'Void' ? (
          <p className="text-sm text-slate-400">This invoice is void, so it takes no payments.</p>
        ) : (
          <>
            {payments.length === 0 ? (
              <p className="text-sm text-slate-400">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {payments.map((p) => (
                  <li key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-slate-200">{[formatValue('date', p.paid_on), p.method, p.reference].filter(Boolean).join(' · ')}</p>
                      {p.note && <p className="text-xs text-slate-400 break-words">{p.note}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-white font-semibold whitespace-nowrap">{formatMoney(p.amount)}</span>
                      {canDelete && (
                        <Button variant="danger" size="sm" disabled={busy} aria-label={`Delete the ${formatMoney(p.amount)} payment from ${formatValue('date', p.paid_on)}`} onClick={() => remove(p)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <dl className="space-y-2 text-sm text-slate-300 border-t border-slate-800 pt-3">
              <div className="flex justify-between">
                <dt>Total paid</dt>
                <dd>{formatMoney(totals.recorded)}</dd>
              </div>
              <div className="flex justify-between text-white text-lg font-bold">
                <dt>Balance remaining</dt>
                <dd>{formatMoney(totals.balance)}</dd>
              </div>
            </dl>
            {totals.byHand && (
              <p className="text-xs text-slate-400">
                {`Marked paid${invoice.paid_at ? ` on ${formatValue('date', invoice.paid_at)}` : ''}. The payments recorded here add up to ${formatMoney(totals.recorded)} of ${formatMoney(invoice.total)}.`}
              </p>
            )}

            {showForm && (
              <form
                className="border-t border-slate-800 pt-4"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  record();
                }}
              >
                <h3 className="font-semibold text-white mb-3">Record payment</h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <Label htmlFor="payment-amount">Amount</Label>
                    <Input id="payment-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} aria-invalid={amount !== '' && !!amountProblem} onChange={(e) => setTypedAmount(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="payment-date">Date received</Label>
                    <Input id="payment-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="payment-method">Method</Label>
                    <Select id="payment-method" value={method} onChange={(e) => setMethod(e.target.value)} options={[...PAYMENT_METHODS]} />
                  </div>
                  <div>
                    <Label htmlFor="payment-reference">Reference</Label>
                    <Input id="payment-reference" maxLength={100} value={reference} placeholder="Cheque or transfer number" onChange={(e) => setReference(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <Label htmlFor="payment-note">Note</Label>
                    <Input id="payment-note" maxLength={500} value={note} placeholder="Anything your bookkeeper should know" onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <Button type="submit" disabled={busy || !!amountProblem || !paidOn}>
                    {busy ? 'Saving...' : 'Record payment'}
                  </Button>
                  {amount !== '' && amountProblem && <span className="text-sm text-red-400">{amountProblem}</span>}
                </div>
                <p className="text-xs text-slate-400 mt-3">Once the payments add up to the total, the invoice is marked paid on the date of the last one.</p>
              </form>
            )}
          </>
        )}

        <Link href="/exports" className="min-h-[48px] lg:min-h-0 inline-flex items-center text-sm text-amber-400 hover:underline">
          Download invoices and payments for your bookkeeper
        </Link>
      </div>
    </Panel>
  );
}
