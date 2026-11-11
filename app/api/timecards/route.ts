import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { ROLE_RANK } from '@/lib/roles';
import { CrewEntrySchema, crewRows, firstIssue, resolveWorker, type Worker } from '@/lib/timecards';

export const dynamic = 'force-dynamic';

/** Enters time for a whole crew in one step: all the cards are saved, or none are. */
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: 1, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    return err instanceof RangeError ? jsonError(413, 'Request too large') : jsonError(400, 'Invalid JSON');
  }
  const parsed = CrewEntrySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const entry = parsed.data;

  const rank = ROLE_RANK[ctx.role];
  const { data: workerRows, error: workersError } = await ctx.supabase.rpc('timecard_workers');
  if (workersError) return dbError(workersError, 'loading your crew');
  const workers = (workerRows ?? []) as Worker[];

  const resolved: Worker[] = [];
  for (const row of entry.entries) {
    const worker = resolveWorker(row, workers, rank);
    if (!worker) return jsonError(400, 'Pick each worker from the list, or type their name.');
    resolved.push(worker);
  }

  // The card keeps the job's name as it was, for the payroll file
  let title = entry.job;
  if (entry.project_id) {
    const { data: project, error } = await ctx.supabase.from('projects').select('title').eq('id', entry.project_id).maybeSingle();
    if (error) return dbError(error, 'loading the project');
    if (!project) return jsonError(400, 'Pick the project from the list.');
    title = project.title as string;
  }

  const { data, error } = await ctx.supabase.from('timecards').insert(crewRows(entry, title!, resolved)).select('id');
  if (error) return dbError(error, 'saving timecards');
  return NextResponse.json({ saved: data?.length ?? 0 }, { status: 201 });
}
