import { dbError, jsonError, requireApi } from '@/lib/api';
import { csvResponse } from '@/lib/csv';
import { paymentsCsv, tooManyToExport } from '@/lib/exports';
import { getModule } from '@/lib/modules';
import { companyDate } from '@/lib/timecards';

export const dynamic = 'force-dynamic';

/** Every payment recorded against an invoice, oldest first, as a CSV download. Reading only, so it stays open to a lapsed company. */
export async function GET() {
  const ctx = await requireApi({ minRank: getModule('invoices')!.read });
  if (ctx instanceof Response) return ctx;

  const result = await paymentsCsv(ctx.supabase);
  if ('error' in result) return dbError(result.error, 'exporting the payments');
  if ('tooMany' in result) return jsonError(413, tooManyToExport('payments'));
  return csvResponse(result.csv, `payments-${companyDate(ctx.company.province)}.csv`);
}
