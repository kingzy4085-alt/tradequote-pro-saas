import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Alert, ButtonLink, Panel, StatCard } from '@/components/ui';
import { alertHref, companyToday, lastCheckedLabel, moduleLabel, SEVERITY_LABEL, ALERT_SEVERITIES, type AlertRow, type AlertSummary } from '@/lib/alerts';
import { barPercent, loadRollup, statusTone, type JobCost } from '@/lib/job-cost';
import { getPageContext, type AppContext } from '@/lib/context';
import { alertCountsByModule, attentionOrder, checkIsStale, dashboardAccess, hoursLabel, isOverdueAlert, plural, summariseJobs, type DashboardFigures } from '@/lib/dashboard';
import { FOLLOW_UP_DAYS, WIN_RATE_DAYS, daysAgo, followUpsDue, winRateSince, type WinRate } from '@/lib/followups';
import { formatMoney, formatValue } from '@/lib/format';
import { PIPELINE_STAGES, toCard, type PipelineKind } from '@/lib/pipeline';
import { listViewFilter } from '@/lib/list-views';
import { MODULE_GROUPS, MODULES, getModule } from '@/lib/modules';
import { provinceTimeZone } from '@/lib/provinces';
import { ROLE_RANK, hasRank } from '@/lib/roles';
import { weekStart } from '@/lib/timecards';

export const dynamic = 'force-dynamic';

const ATTENTION_ROWS = 8;
const MARGIN_ROWS = 8;
const ALERTS_TO_SORT = 200;

interface Metric {
  label: string;
  slug: string;
  caption: string;
  statuses: string[];
}

// Each metric counts rows in a module the user can read, filtered to "open" statuses, and links to that same list.
const METRICS: Metric[] = [
  { label: 'Open Estimates', slug: 'estimates', caption: 'Draft or submitted bids', statuses: ['Draft', 'Submitted'] },
  { label: 'Proposals Out', slug: 'proposals', caption: 'Sent, awaiting decision', statuses: ['Sent'] },
  { label: 'Active Projects', slug: 'projects', caption: 'Jobs in progress', statuses: ['Active'] },
  { label: 'Open RFIs', slug: 'rfis', caption: 'Waiting on an answer', statuses: ['Open'] },
  { label: 'Pending Change Orders', slug: 'change-orders', caption: 'Awaiting client approval', statuses: ['Sent'] },
  { label: 'Open Safety Items', slug: 'safety-logs', caption: 'Incidents not yet resolved', statuses: ['Open', 'Under Investigation'] },
  { label: 'Active LOTO Permits', slug: 'loto-permits', caption: 'Equipment currently locked out', statuses: ['Locked Out', 'Verified Zero Energy'] },
  { label: 'Open Punch Items', slug: 'punch-list', caption: 'Before turnover', statuses: ['Open', 'In Progress'] },
];

const statusLink = (slug: string, statuses: string[]) => `/${slug}?${new URLSearchParams(statuses.map((s) => ['status', s]))}`;

async function countOpen(ctx: AppContext, m: Metric): Promise<number | null> {
  const mod = getModule(m.slug)!;
  const { count, error } = await ctx.supabase.from(mod.table).select('id', { count: 'exact', head: true }).in('status', m.statuses);
  return error ? null : count ?? 0;
}

/** Rows past their date, by the same rule the list's overdue view uses. */
async function countOverdue(ctx: AppContext, slug: string, today: string): Promise<number | null> {
  const mod = getModule(slug)!;
  if (!hasRank(ctx.role, mod.read)) return null;
  const { count, error } = await ctx.supabase.from(mod.table).select('id', { count: 'exact', head: true }).or(listViewFilter(slug, 'overdue', today)!);
  return error ? null : count ?? 0;
}

/** As the signed-in user: row security decides which alerts come back. */
async function loadAttention(ctx: AppContext, today: string): Promise<{ alerts: AlertRow[]; summary: AlertSummary } | null> {
  const [list, summary] = await Promise.all([ctx.supabase.rpc('list_my_alerts', { p_today: today, p_limit: ALERTS_TO_SORT }), ctx.supabase.rpc('my_alert_summary', { p_today: today })]);
  if (list.error || summary.error) return null;
  return { alerts: (list.data ?? []) as AlertRow[], summary: summary.data as AlertSummary };
}

async function loadFigures(ctx: AppContext, today: string): Promise<DashboardFigures | null> {
  const { data, error } = await ctx.supabase.rpc('dashboard_figures', { p_today: today, p_zone: provinceTimeZone(ctx.company.province) });
  return error ? null : (data as DashboardFigures);
}

// Only asked for at a rank that can have it: the database refuses anyone below project manager
async function loadJobs(ctx: AppContext): Promise<JobCost[] | null> {
  if (!dashboardAccess(ROLE_RANK[ctx.role]).jobMoney) return null;
  return loadRollup(ctx.supabase).catch(() => null);
}

const QUOTE_KINDS: PipelineKind[] = ['estimates', 'proposals'];
const QUOTE_ROWS = 500;
const stageStatus = (stage: string, kind: PipelineKind) => PIPELINE_STAGES.find((s) => s.key === stage)!.accepts[kind]!;

/** Win rate over the last 90 days and how many sent quotes are due a chase. Null if either could not be read. */
async function loadQuoteStats(ctx: AppContext, today: string): Promise<{ win: WinRate; followUps: number } | null> {
  if (!QUOTE_KINDS.every((kind) => hasRank(ctx.role, getModule(kind)!.read))) return null;
  const since = daysAgo(today, WIN_RATE_DAYS);
  const results = await Promise.all(
    QUOTE_KINDS.flatMap((kind) => {
      const table = getModule(kind)!.table;
      return [
        ctx.supabase.from(table).select('id, status, updated_at').in('status', [stageStatus('won', kind), stageStatus('lost', kind)]).gt('updated_at', since).limit(QUOTE_ROWS),
        ctx.supabase.from(table).select('id, title, status, notes, updated_at').eq('status', stageStatus('sent', kind)).lt('updated_at', daysAgo(today, FOLLOW_UP_DAYS - 1)).limit(QUOTE_ROWS),
      ];
    })
  );
  if (results.some((r) => r.error)) return null;
  const cards = (i: number, kind: PipelineKind) => ((results[i].data ?? []) as unknown as Record<string, unknown>[]).map((row) => toCard(kind, row));
  const decided = [...cards(0, 'estimates'), ...cards(2, 'proposals')];
  const waiting = [...cards(1, 'estimates'), ...cards(3, 'proposals')];
  return { win: winRateSince(decided, since), followUps: followUpsDue(waiting, today).length };
}

const SEVERITY_CHIP = {
  critical: 'border-red-500/40 text-red-300 hover:border-red-400',
  warning: 'border-amber-500/40 text-amber-300 hover:border-amber-400',
  info: 'border-slate-700 text-slate-300 hover:border-slate-500',
} as const;

function AttentionPanel({ attention, today }: { attention: Awaited<ReturnType<typeof loadAttention>>; today: string }) {
  if (!attention) {
    return (
      <Panel title="Attention" className="mb-8">
        <Alert>Your alerts could not be loaded. Reload the page to try again.</Alert>
      </Panel>
    );
  }
  const { alerts, summary } = attention;
  const ordered = attentionOrder(alerts, today);
  const overdue = alerts.filter((a) => isOverdueAlert(a, today)).length;
  const stale = checkIsStale(summary.last_checked);
  return (
    <Panel title="Attention" className="mb-8">
      {summary.total === 0 ? (
        <p className="text-slate-300">Nothing needs your attention right now. Overdue invoices, expiring insurance and open safety items show up here.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-2">
            {ALERT_SEVERITIES.filter((s) => summary[s] > 0).map((s) => (
              <Link key={s} href={`/alerts?severity=${s}`} className={`inline-flex items-center min-h-[40px] border rounded-full px-3 py-1 text-sm font-semibold transition-colors ${SEVERITY_CHIP[s]}`}>
                {SEVERITY_LABEL[s]}: {summary[s]}
              </Link>
            ))}
          </div>
          {overdue > 0 && <p className="text-sm text-red-300 mb-2">{plural(overdue, 'item is', 'items are')} past due.</p>}
          <ul className="divide-y divide-slate-800">
            {ordered.slice(0, ATTENTION_ROWS).map((a) => (
              <li key={a.id} className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-4 py-3 text-sm">
                <Link href={alertHref(a)} className="min-w-0 hover:text-amber-400">
                  <span className="block text-white font-medium break-words">{a.title}</span>
                  <span className="block text-slate-400 break-words">
                    {moduleLabel(a.module)} · {a.message}
                  </span>
                </Link>
                {a.due_on && <span className={`sm:text-right whitespace-nowrap ${isOverdueAlert(a, today) ? 'text-red-400 font-semibold' : 'text-amber-400'}`}>{formatValue('date', a.due_on)}</span>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-sm">
            {alertCountsByModule(alerts).map(({ module, count }) => (
              <Link key={module} href={`/alerts?module=${module}`} className="text-slate-300 hover:text-amber-400 underline-offset-2 hover:underline">
                {moduleLabel(module)} ({count})
              </Link>
            ))}
            <Link href="/alerts" className="font-semibold text-amber-400 hover:underline">
              See all {summary.total}, snooze or dismiss
            </Link>
          </div>
        </>
      )}
      <p className={`text-xs mt-4 ${stale ? 'text-amber-300' : 'text-slate-500'}`}>
        {lastCheckedLabel(summary.last_checked)}
        {stale ? '. The daily check looks to have been missed, so this list may be behind.' : ''}
      </p>
    </Panel>
  );
}

function MarginTable({ jobs }: { jobs: JobCost[] }) {
  return (
    <Panel title="Margin by Project" description="Active jobs, thinnest margin first. Contract less actual cost so far." className="mb-8">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
              <th className="py-2 pr-4">Job</th>
              <th className="py-2 pr-4 text-right">Contract</th>
              <th className="py-2 pr-4 text-right">Margin</th>
              <th className="py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {jobs.slice(0, MARGIN_ROWS).map((j) => (
              <tr key={j.project_id}>
                <td className="py-3 pr-4">
                  <Link href={`/job-costing/${j.project_id}`} className="text-white font-medium hover:text-amber-400">
                    {j.project_title}
                  </Link>
                </td>
                <td className="py-3 pr-4 text-right text-slate-300 whitespace-nowrap">{formatMoney(j.revised_contract)}</td>
                <td className="py-3 pr-4 text-right text-white whitespace-nowrap">
                  {formatMoney(j.margin)}
                  {j.margin_pct === null ? '' : ` (${Number(j.margin_pct)}%)`}
                </td>
                <td className="py-3 text-right">
                  <span className={`inline-block border px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusTone(j.status)}`}>{j.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {jobs.length > MARGIN_ROWS && (
        <Link href="/job-costing" className="inline-block mt-3 text-sm font-semibold text-amber-400 hover:underline">
          See all {jobs.length} jobs
        </Link>
      )}
    </Panel>
  );
}

export default async function CommandCenter() {
  const result = await getPageContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;

  // The company's date, not the server's: after 6pm in Regina the UTC date is already tomorrow
  const today = companyToday(ctx.company.province);
  const access = dashboardAccess(ROLE_RANK[ctx.role]);
  const visible = METRICS.filter((m) => hasRank(ctx.role, getModule(m.slug)!.read));
  const [counts, attention, figures, jobRows, overdueRfis, overdueTasks, quotes] = await Promise.all([
    Promise.all(visible.map((m) => countOpen(ctx, m))),
    loadAttention(ctx, today),
    loadFigures(ctx, today),
    loadJobs(ctx),
    countOverdue(ctx, 'rfis', today),
    countOverdue(ctx, 'tasks', today),
    access.jobMoney ? loadQuoteStats(ctx, today) : null,
  ]);

  const canCreateEstimate = ctx.canWrite && hasRank(ctx.role, getModule('estimates')!.write);
  const jobs = jobRows ? summariseJobs(jobRows) : null;
  const pipeline = figures?.pipeline;
  const receivables = figures?.receivables;
  const holdback = figures?.holdback;
  const cards = figures?.timecards;
  const labour = figures?.labour;
  // A figure that failed to load shows as a dash and this note, never as zero
  const someFailed = !figures || (access.jobMoney && (!jobs || !quotes));

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Command Center</h1>
          <p className="text-slate-400 mt-1">{ctx.company.name} — what needs attention today.</p>
        </div>
        <div className="flex items-center gap-3">
          {canCreateEstimate && <ButtonLink href="/estimates?new=1">+ New Estimate</ButtonLink>}
          <ButtonLink href="/assistant" variant="secondary">
            Ask the AI Assistant
          </ButtonLink>
        </div>
      </div>

      <AttentionPanel attention={attention} today={today} />

      {someFailed && (
        <div className="mb-6">
          <Alert>Some figures could not be loaded, so they show a dash. Reload the page to try again.</Alert>
        </div>
      )}

      {access.jobMoney && (
        <section aria-label="Money" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <StatCard
            label="Quotes Out"
            value={pipeline ? formatMoney(pipeline.total) : '—'}
            caption={pipeline ? `${plural(pipeline.proposals, 'sent proposal')}, ${plural(pipeline.estimates, 'submitted estimate')}` : undefined}
            href={statusLink('proposals', ['Sent'])}
          />
          <StatCard
            label="Win Rate"
            value={quotes ? (quotes.win.rate === null ? '—' : `${quotes.win.rate}%`) : '—'}
            caption={quotes ? (quotes.win.decided ? `${quotes.win.won} won of ${quotes.win.decided} decided in the last ${WIN_RATE_DAYS} days` : `Nothing won or lost in the last ${WIN_RATE_DAYS} days`) : undefined}
            href="/pipeline"
          />
          <StatCard
            label="Follow-ups Due"
            value={quotes ? quotes.followUps : '—'}
            caption={`Sent quotes with no answer in ${FOLLOW_UP_DAYS} days`}
            href="/pipeline#follow-up"
          />
          <StatCard label="Active Contract Value" value={jobs ? formatMoney(jobs.contract) : '—'} caption={jobs ? `${plural(jobs.activeJobs, 'active job')}, with approved changes` : undefined} href={statusLink('projects', ['Active'])} />
          <StatCard
            label="Billed vs Remaining"
            value={jobs ? formatMoney(jobs.billed) : '—'}
            caption={jobs ? `${formatMoney(jobs.remaining)} left to bill on active jobs` : undefined}
            meter={jobs ? barPercent(jobs.billed, jobs.billed + jobs.remaining) : undefined}
            href="/job-costing"
          />
          <StatCard label="Jobs Over Budget" value={jobs ? jobs.overBudget : '—'} caption="Actual cost at or past budget" href={`/job-costing?${new URLSearchParams({ status: 'Over Budget' })}`} />
          {access.finance && (
            <>
              <StatCard
                label="Receivables Overdue"
                value={receivables ? formatMoney(receivables.overdue) : '—'}
                caption={receivables ? `${plural(receivables.overdue_count, 'receivable')}. ${formatMoney(receivables.over_30)} over 30 days, ${formatMoney(receivables.over_60)} over 60, ${formatMoney(receivables.over_90)} over 90` : undefined}
                href="/receivables?view=overdue"
              />
              <StatCard
                label="Holdback Withheld"
                value={holdback ? formatMoney(holdback.total) : '—'}
                caption={holdback ? `On ${plural(holdback.invoices, 'invoice')} sent. ${formatMoney(holdback.past_release)} past its release date` : undefined}
                href="/invoices?view=holdback"
              />
            </>
          )}
        </section>
      )}

      {access.jobMoney && jobs && jobs.byMargin.length > 0 && <MarginTable jobs={jobs.byMargin} />}

      <section aria-label="Open work" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
        <StatCard
          label={access.crew ? 'Labour Hours This Week' : 'Your Hours This Week'}
          value={labour ? hoursLabel(Number(labour.regular) + Number(labour.overtime)) : '—'}
          caption={labour ? `${hoursLabel(Number(labour.regular))} regular, ${hoursLabel(Number(labour.overtime))} overtime, from ${formatValue('date', labour.week_start)}` : undefined}
          href="/timecards"
        />
        {access.crew && (
          <StatCard
            label="Timecards to Approve"
            value={cards ? cards.total : '—'}
            caption={cards ? (cards.total ? `${cards.fresh} under 4 days, ${cards.waiting} at 4 to 7 days, ${cards.old} over a week` : 'All caught up') : undefined}
            href={cards?.oldest_work_date ? `/timecards?week=${weekStart(cards.oldest_work_date)}` : '/timecards'}
          />
        )}
        <StatCard label="Overdue RFIs" value={overdueRfis ?? '—'} caption="Open, past the response date" href="/rfis?view=overdue" />
        <StatCard label="Overdue Tasks" value={overdueTasks ?? '—'} caption="Not done, past the due date" href="/tasks?view=overdue" />
        {visible.map((m, i) => (
          <StatCard key={m.slug} label={m.label} value={counts[i] ?? '—'} caption={m.caption} href={statusLink(m.slug, m.statuses)} />
        ))}
      </section>

      <Panel title="Modules" description="Everything your role has access to." roomy>
        <div className="space-y-6">
          {MODULE_GROUPS.map((group) => {
            const mods = MODULES.filter((m) => m.group === group && hasRank(ctx.role, m.read));
            if (!mods.length) return null;
            return (
              <div key={group}>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{group}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {mods.map((m) => (
                    <Link
                      key={m.slug}
                      href={`/${m.slug}`}
                      className="bg-slate-950 hover:bg-amber-500/10 hover:border-amber-500/50 border border-slate-800 rounded-xl p-3 text-center text-sm font-medium text-slate-300 hover:text-amber-400 transition-colors"
                    >
                      {m.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
