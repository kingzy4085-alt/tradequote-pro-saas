import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { ASSEMBLY_COLUMNS, ASSEMBLY_LIST_LIMIT, parseAssembly, toAssembly } from '@/lib/assemblies';
import { getModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

// Assemblies feed estimates, so whoever may read or write estimates may read or write these
const estimates = getModule('estimates')!;

export async function GET() {
  const ctx = await requireApi({ minRank: estimates.read });
  if (ctx instanceof Response) return ctx;
  const { data, error } = await ctx.supabase.from('assemblies').select(ASSEMBLY_COLUMNS).order('name').order('id').limit(ASSEMBLY_LIST_LIMIT);
  if (error) return dbError(error, 'loading assemblies');
  return NextResponse.json({ data: (data ?? []).map((row) => toAssembly(row as unknown as Parameters<typeof toAssembly>[0])) });
}

export async function POST(request: Request) {
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

  // company_id comes from a database default tied to the session, never from the client
  const { data: id, error } = await ctx.supabase.rpc('save_assembly', { p_id: null, p_name: parsed.data.name, p_category: parsed.data.category, p_lines: parsed.data.lines });
  if (error) return error.code === '23505' ? jsonError(409, 'You already have an assembly with that name') : dbError(error, 'saving the assembly');
  return NextResponse.json({ data: { id, ...parsed.data } }, { status: 201 });
}
