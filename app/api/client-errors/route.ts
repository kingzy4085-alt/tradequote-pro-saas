import { NextResponse } from 'next/server';
import { jsonError, readJson, requireApi } from '@/lib/api';
import { ClientErrorReport, MAX_REPORT_BYTES, clientErrorLogLine, takeReportAllowance } from '@/lib/client-errors';

export const dynamic = 'force-dynamic';

/**
 * An error screen reporting that a signed-in person hit a failure (components/error-view.tsx). Every
 * role may report, and so may a lapsed company: nothing is stored, the report is only logged. The
 * answer says whether it was taken and nothing more, so what was sent never comes back.
 */
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: 1 });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, MAX_REPORT_BYTES);
  } catch (err) {
    return err instanceof RangeError ? jsonError(413, 'That report is too large') : jsonError(400, 'That report could not be read');
  }
  const report = ClientErrorReport.safeParse(body);
  if (!report.success) return jsonError(400, 'That report could not be read');
  if (!takeReportAllowance(ctx.user.id)) return jsonError(429, 'Too many reports for now');

  console.error(clientErrorLogLine(ctx, report.data));
  return new NextResponse(null, { status: 204 });
}
