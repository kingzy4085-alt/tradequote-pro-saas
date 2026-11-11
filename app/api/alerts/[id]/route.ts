import { NextResponse } from 'next/server';
import { z } from 'zod';
import { companyToday } from '@/lib/alerts';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('snooze'), days: z.number().int().min(1).max(30) }),
  z.object({ action: z.literal('dismiss') }),
]);

/** Snoozes or dismisses an alert for the person asking. Everyone else still sees it. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: 1, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 2_000);
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = Action.safeParse(body);
  if (!parsed.success) return jsonError(400, 'Choose snooze or dismiss');

  let error;
  if (parsed.data.action === 'snooze') {
    const until = new Date(`${companyToday(ctx.company.province)}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + parsed.data.days);
    ({ error } = await ctx.supabase.rpc('snooze_alert', { p_alert: params.id, p_until: until.toISOString().slice(0, 10) }));
  } else {
    ({ error } = await ctx.supabase.rpc('dismiss_alert', { p_alert: params.id }));
  }
  if (error) return dbError(error, 'updating the alert');
  return NextResponse.json({ ok: true });
}
