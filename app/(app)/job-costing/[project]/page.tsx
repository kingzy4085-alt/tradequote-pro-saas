import { notFound } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { loadRollup, type CostEntry } from '@/lib/job-cost';
import { getModule } from '@/lib/modules';
import { companyDate } from '@/lib/timecards';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import JobEditor from './job-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job Cost · TradeQuote PRO' };

export default async function JobCostPage({ params }: { params: { project: string } }) {
  if (!uuidSchema.safeParse(params.project).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const mod = getModule('job-costing')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const [[job], entries] = await Promise.all([
    loadRollup(ctx.supabase, params.project),
    ctx.supabase.from('job_cost_entries').select('id, project_id, category, description, amount, entry_date').eq('project_id', params.project).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
  ]);
  if (!job) notFound();
  if (entries.error) throw new Error('Could not load the costs on this job.');

  return <JobEditor job={job} entries={(entries.data ?? []) as CostEntry[]} today={companyDate(ctx.company.province)} canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)} />;
}
