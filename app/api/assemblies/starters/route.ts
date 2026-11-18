import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { STARTER_ASSEMBLIES } from '@/lib/assemblies';
import { getModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

const estimates = getModule('estimates')!;

// Fills an empty library with the starter assemblies. Refused once the company has any of its own.
export async function POST() {
  const ctx = await requireApi({ minRank: estimates.write, write: true });
  if (ctx instanceof Response) return ctx;

  const { count, error: countError } = await ctx.supabase.from('assemblies').select('id', { count: 'exact', head: true });
  if (countError) return dbError(countError, 'loading assemblies');
  if (count) return jsonError(409, 'You already have assemblies, so the starters were not loaded.');

  for (const starter of STARTER_ASSEMBLIES) {
    const { error } = await ctx.supabase.rpc('save_assembly', { p_id: null, p_name: starter.name, p_category: starter.category, p_lines: starter.lines });
    // Two people pressing the button at once: the other one's copy is already there
    if (error && error.code !== '23505') return dbError(error, 'loading the starter assemblies');
  }
  return NextResponse.json({ ok: true, count: STARTER_ASSEMBLIES.length }, { status: 201 });
}
