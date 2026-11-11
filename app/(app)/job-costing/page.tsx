import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, ButtonLink, PageHeader, StatCard } from '@/components/ui';
import { getPageContext } from '@/lib/context';
import { formatMoney } from '@/lib/format';
import { loadRollup, statusTone, type JobCost } from '@/lib/job-cost';
import { getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';
import OldJobs, { type OldJob } from './old-jobs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job Costing · TradeQuote PRO' };

const FILTERS = ['On Track', 'At Risk', 'Over Budget', 'Closed'];
// The jobs that need a look come first
const URGENCY: Record<string, number> = { 'Over Budget': 0, 'At Risk': 1, 'On Track': 2, Closed: 3 };
const sum = (jobs: JobCost[], key: keyof JobCost) => jobs.reduce((total, j) => total + Number(j[key] ?? 0), 0);

function StatusPill({ status }: { status: string }) {
  return <span className={`inline-block border px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusTone(status)}`}>{status}</span>;
}

const used = (j: JobCost) => (j.cost_used_pct === null ? 'No budget' : `${Number(j.cost_used_pct)}%`);
const marginText = (j: JobCost) => `${formatMoney(j.margin)}${j.margin_pct === null ? '' : ` (${Number(j.margin_pct)}%)`}`;

export default async function JobCostingPage({ searchParams }: { searchParams: { status?: string | string[] } }) {
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const mod = getModule('job-costing')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const [all, old] = await Promise.all([loadRollup(ctx.supabase), ctx.supabase.from(mod.table).select('id, title, budget, actual_cost').is('project_id', null).order('created_at')]);
  const filter = typeof searchParams.status === 'string' && FILTERS.includes(searchParams.status) ? searchParams.status : '';
  const open = all.filter((j) => j.status !== 'Closed');
  const jobs = all.filter((j) => !filter || j.status === filter).sort((a, b) => (URGENCY[a.status] ?? 9) - (URGENCY[b.status] ?? 9));
  const needLook = open.filter((j) => j.status === 'Over Budget' || j.status === 'At Risk').length;

  return (
    <>
      <PageHeader title={mod.label} subtitle={mod.description} back={{ href: '/', label: 'Back to Command Center' }} />

      {all.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
          <p className="text-slate-300 mb-4">No jobs yet. Every project gets a job here. Win an estimate or add a project to start.</p>
          <ButtonLink href="/projects">Go to Projects</ButtonLink>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
            <StatCard label="Open contracts" value={formatMoney(sum(open, 'revised_contract'))} caption={`${open.length} open ${open.length === 1 ? 'job' : 'jobs'}`} />
            <StatCard label="Actual cost" value={formatMoney(sum(open, 'actual_cost'))} caption={`${formatMoney(sum(open, 'committed'))} more committed on POs`} />
            <StatCard label="Billed" value={formatMoney(sum(open, 'billed_amount'))} caption={`${formatMoney(sum(open, 'paid_amount'))} paid`} />
            <StatCard label="Margin" value={formatMoney(sum(open, 'margin'))} caption={needLook ? `${needLook} ${needLook === 1 ? 'job needs' : 'jobs need'} a look` : 'Nothing at risk'} />
          </div>

          <nav aria-label="Filter by status" className="flex flex-wrap gap-2 mb-4">
            {['', ...FILTERS].map((s) => (
              <Link
                key={s || 'all'}
                href={s ? `/job-costing?status=${encodeURIComponent(s)}` : '/job-costing'}
                aria-current={s === filter ? 'page' : undefined}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${s === filter ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
              >
                {s || 'All'}
              </Link>
            ))}
          </nav>

          {jobs.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">No jobs are {filter.toLowerCase()}.</div>
          ) : (
            <>
              {/* Cards on a phone, a table from a tablet up */}
              <ul className="md:hidden space-y-3">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <Link href={`/job-costing/${j.project_id}`} className="block bg-slate-900 border border-slate-800 rounded-2xl p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-white break-words">{j.project_title}</p>
                          {j.client_name && <p className="text-xs text-slate-400 break-words">{j.client_name}</p>}
                        </div>
                        <StatusPill status={j.status} />
                      </div>
                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        {[
                          ['Budget', formatMoney(j.budget)],
                          ['Actual', `${formatMoney(j.actual_cost)} · ${used(j)}`],
                          ['Billed', formatMoney(j.billed_amount)],
                          ['Margin', marginText(j)],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <dt className="text-xs text-slate-400">{k}</dt>
                            <dd className="text-white">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="p-4">Job</th>
                      <th className="p-4 text-right">Revised contract</th>
                      <th className="p-4 text-right">Budget</th>
                      <th className="p-4 text-right">Actual</th>
                      <th className="p-4 text-right">Used</th>
                      <th className="p-4 text-right">Committed</th>
                      <th className="p-4 text-right">Billed</th>
                      <th className="p-4 text-right">Margin</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {jobs.map((j) => (
                      <tr key={j.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-4">
                          <Link href={`/job-costing/${j.project_id}`} className="font-medium text-white hover:text-amber-400 hover:underline">
                            {j.project_title}
                          </Link>
                          {j.client_name && <p className="text-xs text-slate-400">{j.client_name}</p>}
                        </td>
                        <td className="p-4 text-right text-slate-300 whitespace-nowrap">{formatMoney(j.revised_contract)}</td>
                        <td className="p-4 text-right text-slate-300 whitespace-nowrap">{formatMoney(j.budget)}</td>
                        <td className="p-4 text-right text-slate-300 whitespace-nowrap">{formatMoney(j.actual_cost)}</td>
                        <td className="p-4 text-right text-slate-300 whitespace-nowrap">{used(j)}</td>
                        <td className="p-4 text-right text-slate-300 whitespace-nowrap">{formatMoney(j.committed)}</td>
                        <td className="p-4 text-right text-slate-300 whitespace-nowrap">{formatMoney(j.billed_amount)}</td>
                        <td className="p-4 text-right text-slate-300 whitespace-nowrap">{marginText(j)}</td>
                        <td className="p-4">
                          <StatusPill status={j.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {old.error ? (
        <div className="mt-8">
          <Alert>Older typed-in jobs could not be loaded.</Alert>
        </div>
      ) : (
        (old.data?.length ?? 0) > 0 && <OldJobs jobs={old.data as OldJob[]} canDelete={ctx.canWrite && hasRank(ctx.role, mod.remove)} />
      )}
    </>
  );
}
