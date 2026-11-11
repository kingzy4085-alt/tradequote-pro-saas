import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// Every job's budget, actuals, billing and margin, or one job's with ?project=
export async function GET(request: Request) {
  const project = new URL(request.url).searchParams.get('project');
  if (project && !uuidSchema.safeParse(project).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: getModule('job-costing')!.read });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.rpc('job_cost_rollup', project ? { p_project: project } : {});
  if (error) return dbError(error, 'loading job costs');
  return NextResponse.json({ data });
}
