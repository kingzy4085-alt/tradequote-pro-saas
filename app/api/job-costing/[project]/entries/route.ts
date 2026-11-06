import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { EntrySchema, firstIssue } from '@/lib/job-cost';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: { project: string } };

// Adds a manual cost to a job. A negative amount is a credit. company_id and created_by come from the session.
export async function POST(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.project).success) return jsonError(404, 'Not found');
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

  const { data, error } = await ctx.supabase.from('job_cost_entries').insert({ ...parsed.data, project_id: params.project }).select('id, project_id, category, description, amount, entry_date').single();
  if (error) return dbError(error, 'saving the cost');
  return NextResponse.json({ data }, { status: 201 });
}
