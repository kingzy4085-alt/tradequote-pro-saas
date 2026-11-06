import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, ButtonLink, PageHeader, Panel } from '@/components/ui';
import { getPageContext } from '@/lib/context';
import { listColumns, recordColumns } from '@/lib/crud';
import { detailHref } from '@/lib/detail-pages';
import { formatMoney, formatValue } from '@/lib/format';
import { barPercent, hubTabs, loadRollup, statusTone } from '@/lib/job-cost';
import { getModule, type ModuleDef } from '@/lib/modules';
import { withProjectMoney } from '@/lib/project-money';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import ProjectActions from './project-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Project · TradeQuote PRO' };

const TAB_ROWS = 25;
type Row = Record<string, unknown> & { id: string; title: string; status: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as loose as the select('*') this replaced
type ProjectRow = Record<string, any> & { id: string };

/** The couple of details worth showing under a record's name. */
const rowDetails = (mod: ModuleDef) => mod.fields.filter((f) => !f.hidden && !f.legacy && !['project', 'client', 'textarea'].includes(f.type)).slice(0, 3);

const newRecordHref = (slug: string, project: string) => (slug === 'timecards' ? `/timecards?project=${project}` : `/${slug}?project=${project}&new=1`);

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</dt>
      <dd className="text-white mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function Bar({ label, value, of, tone }: { label: string; value: unknown; of: unknown; tone: string }) {
  return (
    <div>
      <div className="flex justify-between gap-3 text-sm mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold text-white">{formatMoney(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${barPercent(value, of)}%` }} />
      </div>
    </div>
  );
}

export default async function ProjectPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string | string[] } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const mod = getModule('projects')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const { data: found, error } = await ctx.supabase.from(mod.table).select(recordColumns(mod)).eq('id', params.id).maybeSingle();
  if (error) throw new Error('Could not load this project.');
  if (!found) notFound();
  const withMoney = await withProjectMoney(ctx.supabase, ctx.role, [found as unknown as ProjectRow]);
  if ('error' in withMoney) throw new Error('Could not load this project.');
  const project = withMoney.rows[0];

  const tabs = hubTabs(ctx.role);
  const active = tabs.find((t) => t.slug === searchParams.tab) ?? tabs[0];
  const activeMod = getModule(active.slug)!;
  const seesCost = hasRank(ctx.role, getModule('job-costing')!.read);

  const [jobs, counts, rows] = await Promise.all([
    seesCost ? loadRollup(ctx.supabase, params.id) : Promise.resolve([]),
    Promise.all(
      tabs.map(async (t) => {
        const { count } = await ctx.supabase.from(getModule(t.slug)!.table).select('id', { count: 'exact', head: true }).eq('project_id', params.id);
        return [t.slug as string, count] as const;
      })
    ),
    ctx.supabase.from(activeMod.table).select(listColumns(activeMod)).eq('project_id', params.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(TAB_ROWS),
  ]);
  if (rows.error) throw new Error(`Could not load ${activeMod.label.toLowerCase()}.`);
  const records = (rows.data ?? []) as unknown as Row[];
  const countOf = new Map(counts);
  const job = jobs[0];
  const activeCount = countOf.get(active.slug) ?? records.length;
  const canCreate = ctx.canWrite && hasRank(ctx.role, activeMod.write);
  const details = rowDetails(activeMod);

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={[project.client_name, project.site].filter(Boolean).join(' · ') || undefined}
        back={{ href: '/projects', label: 'Back to Projects' }}
        actions={
          <ProjectActions
            projectId={project.id}
            canInvoice={ctx.canWrite && hasRank(ctx.role, getModule('invoices')!.write)}
            canDraw={ctx.canWrite && hasRank(ctx.role, getModule('progress-billing')!.write)}
            canStart={project.status === 'Planning' && ctx.canWrite && hasRank(ctx.role, mod.write)}
          />
        }
      />

      <div className="space-y-6">
        <Panel>
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <Detail label="Status">
              <Badge>{project.status}</Badge>
            </Detail>
            <Detail label="Client">{project.client_name || '—'}</Detail>
            <Detail label="Site">{project.site || '—'}</Detail>
            <Detail label="Dates">
              {project.start_date || project.revised_end_date || project.end_date
                ? `${formatValue('date', project.start_date)} to ${formatValue('date', project.revised_end_date ?? project.end_date)}`
                : 'Not set'}
            </Detail>
            {/* What the job is worth is for the people who see its costs, not the whole crew */}
            {seesCost && (
              <>
                <Detail label="Contract">{formatMoney(project.contract_value ?? 0)}</Detail>
                <Detail label="Approved changes">{formatMoney(project.approved_changes ?? 0)}</Detail>
                <Detail label="Revised contract">
                  <span className="font-bold">{formatMoney(project.revised_contract ?? 0)}</span>
                </Detail>
              </>
            )}
            {Number(project.approved_days) !== 0 && project.approved_days !== null && <Detail label="Schedule change">{Number(project.approved_days)} days</Detail>}
          </dl>
        </Panel>

        {job && (
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <h2 className="text-lg font-bold text-white">Budget, actual and billed</h2>
              <div className="flex items-center gap-3">
                <span className={`inline-block border px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusTone(job.status)}`}>{job.status}</span>
                <Link href={`/job-costing/${project.id}`} className="text-sm font-semibold text-amber-400 hover:underline">
                  Job cost detail
                </Link>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
              <Bar label="Budget" value={job.budget} of={Math.max(Number(job.budget), Number(job.actual_cost))} tone="bg-slate-500" />
              <Bar label="Actual cost" value={job.actual_cost} of={Math.max(Number(job.budget), Number(job.actual_cost))} tone={job.status === 'Over Budget' ? 'bg-red-500' : job.status === 'At Risk' ? 'bg-amber-500' : 'bg-emerald-500'} />
              <Bar label="Revised contract" value={job.revised_contract} of={job.revised_contract} tone="bg-slate-500" />
              <Bar label="Billed (before tax)" value={job.billed_amount} of={job.revised_contract} tone="bg-amber-500" />
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-slate-800 text-sm">
              <Detail label="Committed on POs">{formatMoney(job.committed)}</Detail>
              <Detail label="Paid">{formatMoney(job.paid_amount)}</Detail>
              <Detail label="Margin">
                {formatMoney(job.margin)}
                {job.margin_pct !== null && <span className="text-slate-400"> ({Number(job.margin_pct)}%)</span>}
              </Detail>
              <Detail label="Budget used">{job.cost_used_pct === null ? 'No budget set' : `${Number(job.cost_used_pct)}%`}</Detail>
            </dl>
          </Panel>
        )}

        <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          <nav aria-label="Records on this project" className="flex overflow-x-auto border-b border-slate-800">
            {tabs.map((t) => (
              <Link
                key={t.slug}
                href={`/projects/${project.id}?tab=${t.slug}`}
                scroll={false}
                aria-current={t.slug === active.slug ? 'page' : undefined}
                className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${t.slug === active.slug ? 'border-amber-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                {t.label}
                <span className="ml-1.5 text-xs text-slate-500">{countOf.get(t.slug) ?? '–'}</span>
              </Link>
            ))}
          </nav>

          <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-800">
            <Link href={`/${active.slug}?project=${project.id}`} className="text-sm font-semibold text-amber-400 hover:underline">
              {activeCount > records.length ? `See all ${activeCount}` : `Open ${activeMod.label}`}
            </Link>
            {canCreate && (
              <ButtonLink size="sm" href={newRecordHref(active.slug, project.id)}>
                + New {activeMod.recordLabel ?? activeMod.titleLabel}
              </ButtonLink>
            )}
          </div>

          {records.length === 0 ? (
            <p className="p-8 text-center text-slate-400">No {activeMod.label.toLowerCase()} on this project yet.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {records.map((r) => {
                const href = detailHref(active.slug, r.id) ?? `/${active.slug}?project=${project.id}`;
                return (
                  <li key={r.id}>
                    <Link href={href} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 hover:bg-slate-800/50 transition-colors">
                      <div className="min-w-0">
                        <p className="font-medium text-white break-words">{r.title}</p>
                        <p className="text-xs text-slate-400 mt-0.5 break-words">
                          {details
                            .filter((d) => r[d.key] !== null && r[d.key] !== undefined && r[d.key] !== '')
                            .map((d) => `${d.label}: ${formatValue(d.type, r[d.key])}`)
                            .join(' · ')}
                        </p>
                      </div>
                      <span className="shrink-0">
                        <Badge>{r.status}</Badge>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
