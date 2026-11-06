import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { EstimateLinesSchema, estimateTotals } from '@/lib/estimate-math';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const estimates = getModule('estimates')!;
type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: estimates.read });
  if (ctx instanceof Response) return ctx;
  const { data, error } = await ctx.supabase.from('estimate_items').select('*').eq('estimate_id', params.id).order('sort');
  if (error) return dbError(error, 'loading estimate lines');
  return NextResponse.json({ data });
}

// Replaces the lines. The database works out the stored total from them and the saved rates
export async function PUT(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: estimates.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 1_000_000);
  } catch (err) {
    return jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON');
  }
  const parsed = EstimateLinesSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const line = typeof issue?.path[1] === 'number' ? `Line ${issue.path[1] + 1}: ` : '';
    return jsonError(400, `${line}${issue?.message ?? 'Invalid lines'}`);
  }

  const { error: saveError } = await ctx.supabase.rpc('save_estimate_items', { p_estimate: params.id, p_items: parsed.data.items });
  if (saveError) return dbError(saveError, 'saving estimate lines');

  const { data: est, error } = await ctx.supabase.from('estimates').select('labour_rate, markup_percentage, tax_percentage, total_amount').eq('id', params.id).maybeSingle();
  if (error) return dbError(error, 'loading the estimate');
  if (!est) return jsonError(404, 'Not found');
  const totals = { ...estimateTotals(parsed.data.items, est.labour_rate, est.markup_percentage, est.tax_percentage), total: Number(est.total_amount) };
  return NextResponse.json({ data: { totals } });
}
