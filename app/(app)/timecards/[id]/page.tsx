import { notFound } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { ROLE_RANK } from '@/lib/roles';
import { FOREMAN_RANK, PM_RANK, TIMECARD_COLUMNS, cardsWithPay, hidePay, loadProjects, loadWorkers, type Timecard } from '@/lib/timecards';
import { uuidSchema } from '@/lib/validation';
import TimecardEditor from './timecard-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Timecard · TradeQuote PRO' };

export default async function TimecardPage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const rank = ROLE_RANK[ctx.role];

  // Row security decides: an electrician gets nothing back for someone else's card
  const { data, error } = await ctx.supabase.from('timecards').select(TIMECARD_COLUMNS).eq('id', params.id).maybeSingle();
  if (error) throw new Error(`Could not load the timecard: ${error.message}`);
  if (!data) notFound();
  const card = hidePay(data as unknown as Timecard);

  const [[initial], workers, projects] = await Promise.all([rank >= PM_RANK ? cardsWithPay(ctx.supabase, [card]) : [card], loadWorkers(ctx.supabase), loadProjects(ctx.supabase)]);

  return (
    <TimecardEditor
      initial={initial}
      workers={workers}
      projects={projects}
      canWrite={ctx.canWrite}
      canApprove={ctx.canWrite && rank >= FOREMAN_RANK}
      isCrewLead={rank >= FOREMAN_RANK}
      canSeePay={rank >= PM_RANK}
      canReopen={ctx.canWrite && rank >= PM_RANK}
      canDelete={ctx.canWrite && (rank >= FOREMAN_RANK || card.created_by === ctx.user.id)}
    />
  );
}
