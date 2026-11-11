import { NextResponse } from 'next/server';
import { companyToday } from '@/lib/alerts';
import { dbError, requireApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** The signed-in user's open alerts and counts. Row security decides what they can see. `?summary=1` is counts only, for the bell. */
export async function GET(request: Request) {
  const ctx = await requireApi({ minRank: 1 });
  if (ctx instanceof Response) return ctx;
  const today = companyToday(ctx.company.province);

  const { data: summary, error: summaryError } = await ctx.supabase.rpc('my_alert_summary', { p_today: today });
  if (summaryError) return dbError(summaryError, 'loading alerts');
  if (new URL(request.url).searchParams.get('summary')) return NextResponse.json({ summary, today });

  const { data, error } = await ctx.supabase.rpc('list_my_alerts', { p_today: today, p_limit: 200 });
  if (error) return dbError(error, 'loading alerts');
  return NextResponse.json({ data, summary, today });
}
