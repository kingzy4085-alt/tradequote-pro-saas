import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { ExportSchema, PM_RANK, firstIssue, payrollCsv, type Timecard } from '@/lib/timecards';

export const dynamic = 'force-dynamic';

/**
 * Moves the Approved cards in these dates to Exported and returns them as the payroll
 * file. With `again`, changes nothing and returns the cards already exported, so a lost
 * download can be recovered, including after a trial has ended.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    return err instanceof RangeError ? jsonError(413, 'Request too large') : jsonError(400, 'Invalid JSON');
  }
  const parsed = ExportSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { from, to, again = false } = parsed.data;

  const ctx = await requireApi({ minRank: PM_RANK, write: !again });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.rpc('export_timecards', { p_from: from, p_to: to, p_again: again });
  if (error) return dbError(error, 'exporting payroll');

  const cards = (data ?? []) as Timecard[];
  if (cards.length === 0) {
    return jsonError(404, again ? 'No exported timecards in those dates.' : 'No approved timecards in those dates. Approve them first.');
  }
  return new Response(payrollCsv(cards), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payroll-${from}-to-${to}.csv"`,
      'Cache-Control': 'no-store',
      'X-Timecard-Count': String(cards.length),
    },
  });
}
