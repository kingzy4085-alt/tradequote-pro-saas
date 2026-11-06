import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { recordColumns } from '@/lib/crud';
import { getModule } from '@/lib/modules';
import { withChangeOrderMoney } from '@/lib/project-money';
import { SignatureImage, SignerName } from '@/lib/signature';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const changeOrders = getModule('change-orders')!;
type Params = { params: { id: string } };

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), approved_by: SignerName, signature: SignatureImage }),
  z.object({ action: z.literal('reopen') }),
]);

// Approving and reopening. Editing and the other status moves go through /api/modules/change-orders.
// The database decides whether either is allowed and works out the money: see guard_change_order.
export async function PUT(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: changeOrders.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 400_000);
  } catch (err) {
    return jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON');
  }
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? 'Invalid request');

  const update =
    parsed.data.action === 'approve'
      ? { status: 'Approved', approved_by: parsed.data.approved_by, signature: parsed.data.signature }
      : { status: 'Draft' };
  const { data, error } = await ctx.supabase.from(changeOrders.table).update(update).eq('id', params.id).select(recordColumns(changeOrders)).maybeSingle();
  const action = parsed.data.action === 'approve' ? 'approving the change order' : 'reopening the change order';
  if (error) return dbError(error, action);
  if (!data) return jsonError(404, 'Not found');
  const full = await withChangeOrderMoney(ctx.supabase, ctx.role, [data as unknown as { id: string }]);
  if ('error' in full) return dbError(full.error, action);
  return NextResponse.json({ data: full.rows[0] });
}
