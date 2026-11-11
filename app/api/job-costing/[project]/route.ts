import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { BudgetSchema, ClosedSchema, firstIssue } from '@/lib/job-cost';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: { project: string } };

// Sets a job's budget, or closes and reopens it. The rest of the job is worked out by the database.
export async function PATCH(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.project).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: getModule('job-costing')!.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  if (body && typeof body === 'object' && 'closed' in body) {
    const parsed = ClosedSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const { error } = await ctx.supabase.rpc('set_job_closed', { p_project: params.project, p_closed: parsed.data.closed });
    if (error) return dbError(error, parsed.data.closed ? 'closing the job' : 'reopening the job');
    return NextResponse.json({ data: { ok: true } });
  }

  const parsed = BudgetSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { hours, labour, material, other } = parsed.data;
  const { error } = await ctx.supabase.rpc('set_job_budget', { p_project: params.project, p_hours: hours, p_labour: labour, p_material: material, p_other: other });
  if (error) return dbError(error, 'saving the budget');
  return NextResponse.json({ data: { ok: true } });
}
