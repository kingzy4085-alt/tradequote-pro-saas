import { dbError, jsonError, requireApi } from '@/lib/api';
import { csvResponse } from '@/lib/csv';
import { invoicesCsv, tooManyToExport } from '@/lib/exports';
import { getModule } from '@/lib/modules';
import { companyDate } from '@/lib/timecards';

export const dynamic = 'force-dynamic';

/** Every invoice that has gone out, with what has been paid and what is still owed, as a CSV download. Reading only, so it stays open to a lapsed company. */
export async function GET() {
  const ctx = await requireApi({ minRank: getModule('invoices')!.read });
  if (ctx instanceof Response) return ctx;

  const result = await invoicesCsv(ctx.supabase);
  if ('error' in result) return dbError(result.error, 'exporting the invoices');
  if ('tooMany' in result) return jsonError(413, tooManyToExport('invoices'));
  return csvResponse(result.csv, `invoices-${companyDate(ctx.company.province)}.csv`);
}
