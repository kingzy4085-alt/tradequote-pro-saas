import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { DailyLogAction, photoFolder } from '@/lib/daily-log';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const dailyLogs = getModule('daily-logs')!;

// Photos, sign-off and reopening. Plain field edits go through /api/modules/daily-logs/[id].
// The database enforces the rules too: a signed log is locked, and only a foreman or above can reopen it.
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: dailyLogs.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 400_000);
  } catch (err) {
    return jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON');
  }
  const parsed = DailyLogAction.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? 'Invalid request');
  const action = parsed.data;

  let update: Record<string, unknown>;
  if (action.action === 'photos') {
    const folder = photoFolder(ctx.company.id, params.id);
    if (action.photos.some((p) => !p.startsWith(folder) || p.includes('..'))) return jsonError(400, 'Invalid photo');
    update = { photos: action.photos };
  } else if (action.action === 'sign') {
    update = { signed_by: action.signed_by, signature: action.signature, signed_at: new Date().toISOString() };
  } else {
    update = { signed_by: null, signature: null, signed_at: null };
  }

  const { data, error } = await ctx.supabase.from(dailyLogs.table).update(update).eq('id', params.id).select().maybeSingle();
  if (error) return dbError(error, 'updating the daily log');
  if (!data) return jsonError(404, 'Not found');
  return NextResponse.json({ data });
}
