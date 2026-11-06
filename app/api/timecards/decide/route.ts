import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { DecideSchema, FOREMAN_RANK, firstIssue } from '@/lib/timecards';

export const dynamic = 'force-dynamic';

/**
 * Approves, rejects, un-approves or reopens a batch. A card the caller can't decide
 * (their own, say) comes back in `skipped` with the reason; the rest still go through.
 */
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: FOREMAN_RANK, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    return err instanceof RangeError ? jsonError(413, 'Request too large') : jsonError(400, 'Invalid JSON');
  }
  const parsed = DecideSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));

  const { ids, action, reason } = parsed.data;
  const { data, error } = await ctx.supabase.rpc('decide_timecards', { p_ids: ids, p_action: action, p_reason: reason });
  if (error) return dbError(error, 'updating timecards');
  return NextResponse.json(data);
}
