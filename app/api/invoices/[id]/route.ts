import { NextResponse } from 'next/server';
import { loadInvoiceOptions } from '@/app/(app)/invoices/[id]/options';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { InvoiceLinesSchema } from '@/lib/billing-math';
import { getModule } from '@/lib/modules';
import { parseRecord, uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const invoices = getModule('invoices')!;
type Params = { params: { id: string } };

// The invoice and what can go on it. ?project= previews the choices for a project not saved yet.
export async function GET(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: invoices.read });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.from(invoices.table).select('*').eq('id', params.id).maybeSingle();
  if (error) return dbError(error, 'loading the invoice');
  if (!data) return jsonError(404, 'Not found');

  const asked = new URL(request.url).searchParams.get('project');
  if (asked && !uuidSchema.safeParse(asked).success) return jsonError(400, 'Unknown project');
  try {
    return NextResponse.json({ data, options: await loadInvoiceOptions(ctx, params.id, asked ?? data.project_id) });
  } catch (err) {
    console.error(err);
    return jsonError(500, 'Could not load the invoice choices');
  }
}

// Saves the details and lines together. The client says what to bill; the database prices it,
// checks the rules and works out the totals in that one transaction (see guard_invoice).
// Status moves go through /api/modules/invoices.
export async function PUT(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: invoices.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: Record<string, unknown>;
  try {
    const raw = await readJson(request, 500_000);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return jsonError(400, 'Invalid request');
    body = raw as Record<string, unknown>;
  } catch (err) {
    return jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON');
  }

  // A status in here is left out on purpose: moving one is its own step
  const { lines: rawLines, status: _status, ...rawFields } = body;
  let lines = null;
  if (rawLines !== undefined) {
    const parsedLines = InvoiceLinesSchema.safeParse(rawLines);
    if (!parsedLines.success) {
      const issue = parsedLines.error.issues[0];
      const where = typeof issue?.path[0] === 'number' ? `Line ${issue.path[0] + 1}: ` : '';
      return jsonError(400, `${where}${issue?.message ?? 'Invalid lines'}`);
    }
    lines = parsedLines.data;
  }

  let fields: Record<string, unknown> = {};
  if (Object.keys(rawFields).length) {
    const parsed = parseRecord(invoices, rawFields, 'update');
    if (!parsed.ok) return jsonError(400, 'Please fix the highlighted fields', parsed.errors);
    fields = parsed.data;
  } else if (lines === null) {
    return jsonError(400, 'Nothing to update');
  }

  const { data, error } = await ctx.supabase.rpc('save_invoice', { p_invoice: params.id, p_fields: fields, p_lines: lines });
  if (error) return dbError(error, 'saving the invoice');
  const row = data as { project_id: string | null };
  try {
    return NextResponse.json({ data: row, options: await loadInvoiceOptions(ctx, params.id, row.project_id) });
  } catch (err) {
    // The save itself worked
    console.error(err);
    return NextResponse.json({ data: row });
  }
}
