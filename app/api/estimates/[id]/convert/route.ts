import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

// The "Create proposal" button: makes a draft proposal, or returns the one this estimate already has.
export async function POST(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: getModule('proposals')!.write, write: true });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.rpc('create_proposal_from_estimate', { p_estimate: params.id });
  if (error) return dbError(error, 'creating the proposal');
  return NextResponse.json({ data: { id: data } }, { status: 201 });
}
