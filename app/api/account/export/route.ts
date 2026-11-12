import { jsonError, requireApi } from '@/lib/api';
import { buildCompanyExport, exportFileName } from '@/lib/company-export';

export const dynamic = 'force-dynamic';
// A large company takes a while to read
export const maxDuration = 60;

const CHUNK_BYTES = 64 * 1024;

/** Sends the file in pieces, so a large company doesn't hit a limit on one buffered response. */
function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
}

// The owner only: one JSON file with every row the company owns, read as the owner so row
// security decides. Reading stays open to a company whose trial or subscription has ended.
export async function GET() {
  const ctx = await requireApi({ minRank: 5 });
  if (ctx instanceof Response) return ctx;

  const now = new Date();
  const result = await buildCompanyExport(ctx.supabase, ctx.company, { exportedBy: ctx.user.email ?? null, now });
  if ('error' in result) {
    console.error(`Company export failed while reading ${result.table}`, result.error);
    return jsonError(500, 'Your data could not be read in full, so no file was made. Try again in a moment.');
  }

  return new Response(streamOf(JSON.stringify(result.data, null, 2)), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFileName(result.data.company_name, now)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
