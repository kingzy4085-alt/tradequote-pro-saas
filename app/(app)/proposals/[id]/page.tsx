import { notFound } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import ProposalEditor, { type Proposal } from './proposal-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Proposal · TradeQuote PRO' };

export default async function ProposalPage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const mod = getModule('proposals')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const { data, error } = await ctx.supabase.from(mod.table).select('*').eq('id', params.id).maybeSingle();
  if (error) throw new Error('Could not load this proposal.');
  if (!data) notFound();

  // Linked to a job is not the same as having made one: only a project made from this proposal locks it as accepted
  const { data: made, error: madeError } = await ctx.supabase.from('projects').select('id').eq('proposal_id', params.id).maybeSingle();
  if (madeError) throw new Error('Could not load this proposal.');

  return <ProposalEditor initial={data as Proposal} madeProject={!!made} statuses={mod.statuses} canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)} canCreateProject={ctx.canWrite && hasRank(ctx.role, getModule('projects')!.write)} />;
}
