import { notFound, redirect } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { ROLE_RANK } from '@/lib/roles';
import { FOREMAN_RANK, PM_RANK, addDays, companyDate, loadProjects, loadWeek, loadWorkers, resolveWeek } from '@/lib/timecards';
import { uuidSchema } from '@/lib/validation';
import TimecardBoard from './timecard-board';

const ADMIN_RANK = 4;

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Timecards · TradeQuote PRO' };

export default async function TimecardsPage({ searchParams }: { searchParams: { week?: string | string[]; project?: string | string[] } }) {
  const result = await getPageContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;
  const rank = ROLE_RANK[ctx.role];
  if (rank < 1) notFound();

  const today = companyDate(ctx.company.province);
  const week = resolveWeek(searchParams.week, today);
  const project = typeof searchParams.project === 'string' && uuidSchema.safeParse(searchParams.project).success ? searchParams.project : null;

  const [{ cards, partial }, workers, projects] = await Promise.all([
    loadWeek(ctx.supabase, week, addDays(week, 6), project, rank >= PM_RANK),
    loadWorkers(ctx.supabase),
    loadProjects(ctx.supabase),
  ]);

  return (
    <TimecardBoard
      week={week}
      today={today}
      project={project}
      cards={cards}
      partial={partial}
      workers={workers}
      projects={projects}
      canEnter={ctx.canWrite}
      canApprove={ctx.canWrite && rank >= FOREMAN_RANK}
      isCrewLead={rank >= FOREMAN_RANK}
      canSeePay={rank >= PM_RANK}
      canExport={rank >= PM_RANK}
      canWrite={ctx.canWrite}
      canManageBilling={rank >= ADMIN_RANK}
      canEditRates={rank >= ADMIN_RANK}
    />
  );
}
