import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

// "New draw" on a project: a draft with the balance of the contract, or the untouched draft from the last click.
export async function POST(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: getModule('progress-billing')!.write, write: true });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.rpc('create_draw_from_project', { p_project: params.id });
  if (error) return dbError(error, 'creating the draw');
  return NextResponse.json({ data: { id: data } }, { status: 201 });
}
