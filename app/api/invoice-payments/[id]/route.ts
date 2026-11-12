import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { loadPaymentState } from '@/lib/payments';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const invoices = getModule('invoices')!;
type Params = { params: { id: string } };

// Deletes a payment recorded by mistake. If the invoice was paid through its payments and they no
// longer add up, the database puts it back to Sent in the same transaction (see sync_invoice_payments).
export async function DELETE(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: invoices.remove, write: true });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.from('invoice_payments').delete().eq('id', params.id).select('id, invoice_id');
  if (error) return dbError(error, 'deleting the payment');
  const removed = (data ?? [])[0] as { id: string; invoice_id: string } | undefined;
  if (!removed) return jsonError(404, 'Not found');

  const loaded = await loadPaymentState(ctx.supabase, removed.invoice_id);
  // The payment is gone either way: a failed re-read only means the page reloads to show it
  if ('error' in loaded || !loaded.state) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: true, ...loaded.state });
}
