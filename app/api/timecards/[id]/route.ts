import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { TIMECARD_COLUMNS } from '@/lib/timecards';
import { parseRecord, uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const timecards = getModule('timecards')!;
type Params = { params: { id: string } };

/**
 * Saves edits to one card. It has its own route because the generic module one reads the whole
 * row back, and nobody signed in can read the pay columns. guard_timecard decides what sticks.
 */
export async function PUT(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: timecards.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    return err instanceof RangeError ? jsonError(413, 'Request too large') : jsonError(400, 'Invalid JSON');
  }
  const parsed = parseRecord(timecards, body, 'update');
  if (!parsed.ok) return jsonError(400, 'Please fix the highlighted fields', parsed.errors);

  const { data, error } = await ctx.supabase.from(timecards.table).update(parsed.data).eq('id', params.id).select(TIMECARD_COLUMNS).maybeSingle();
  if (error) return dbError(error, 'saving the timecard');
  if (!data) return jsonError(404, 'Not found');
  return NextResponse.json({ data });
}
