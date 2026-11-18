import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { PAYMENT_COLUMNS, loadPaymentState, parsePayment } from '@/lib/payments';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const invoices = getModule('invoices')!;
type Params = { params: { id: string } };

// The invoice's payments, oldest first, with its status and total
export async function GET(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: invoices.read });
  if (ctx instanceof Response) return ctx;

  const loaded = await loadPaymentState(ctx.supabase, params.id);
  if ('error' in loaded) return dbError(loaded.error, 'loading the payments');
  if (!loaded.state) return jsonError(404, 'Not found');
  return NextResponse.json(loaded.state);
}

// Records a payment. The database checks the invoice takes it (sent, not past its total) and marks
// the invoice paid once its payments reach the total, in the same transaction (see guard_invoice_payment).
export async function POST(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: invoices.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    return err instanceof RangeError ? jsonError(413, 'Request too large') : jsonError(400, 'Invalid JSON');
  }
  const parsed = parsePayment(body);
  if (!parsed.ok) return jsonError(400, parsed.error);

  // Seen first as the caller, so an invoice that is not theirs is a plain 404
  const { data: invoice, error: readError } = await ctx.supabase.from(invoices.table).select('id').eq('id', params.id).maybeSingle();
  if (readError) return dbError(readError, 'recording the payment');
  if (!invoice) return jsonError(404, 'Not found');

  // The company and who recorded it are the database's defaults, never the client's
  const { data, error } = await ctx.supabase.from('invoice_payments').insert({ ...parsed.data, invoice_id: params.id }).select(PAYMENT_COLUMNS).single();
  if (error) return dbError(error, 'recording the payment');

  const loaded = await loadPaymentState(ctx.supabase, params.id);
  // The payment itself was recorded: a failed re-read only means the page reloads to show it
  if ('error' in loaded || !loaded.state) return NextResponse.json({ data }, { status: 201 });
  return NextResponse.json({ data, ...loaded.state }, { status: 201 });
}
