import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { EntrySchema, firstIssue } from '@/lib/job-cost';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

export async function PUT(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: getModule('job-costing')!.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = EntrySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));

  const { data, error } = await ctx.supabase.from('job_cost_entries').update(parsed.data).eq('id', params.id).select('id, project_id, category, description, amount, entry_date').maybeSingle();
  if (error) return dbError(error, 'saving the cost');
  if (!data) return jsonError(404, 'Not found');
  return NextResponse.json({ data });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: getModule('job-costing')!.write, write: true });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.from('job_cost_entries').delete().eq('id', params.id).select('id');
  if (error) return dbError(error, 'deleting the cost');
  if (!data?.length) return jsonError(404, 'Not found');
  return NextResponse.json({ data: { ok: true } });
}
