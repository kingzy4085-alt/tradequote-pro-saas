import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

// The "Create invoice" button on a draw: makes a draft invoice, or returns the one it already has.
export async function POST(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: getModule('invoices')!.write, write: true });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.rpc('create_invoice_from_draw', { p_draw: params.id });
  if (error) return dbError(error, 'creating the invoice');
  return NextResponse.json({ data: { invoice_id: data } }, { status: 201 });
}
