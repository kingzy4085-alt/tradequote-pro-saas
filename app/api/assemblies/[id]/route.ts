import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { parseAssembly } from '@/lib/assemblies';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const estimates = getModule('estimates')!;
type Params = { params: { id: string } };

// Replaces the name, trade and lines together
export async function PUT(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: estimates.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    return jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON');
  }
  const parsed = parseAssembly(body);
  if (!parsed.ok) return jsonError(400, parsed.error);

  const { error } = await ctx.supabase.rpc('save_assembly', { p_id: params.id, p_name: parsed.data.name, p_category: parsed.data.category, p_lines: parsed.data.lines });
  if (error) return error.code === '23505' ? jsonError(409, 'You already have an assembly with that name') : dbError(error, 'saving the assembly');
  return NextResponse.json({ data: { id: params.id, ...parsed.data } });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: estimates.write, write: true });
  if (ctx instanceof Response) return ctx;
  // The lines go with it. Estimates that used it keep their own copies of the lines.
  const { data, error } = await ctx.supabase.from('assemblies').delete().eq('id', params.id).select('id');
  if (error) return dbError(error, 'deleting the assembly');
  if (!data?.length) return jsonError(404, 'Not found');
  return NextResponse.json({ ok: true });
}
