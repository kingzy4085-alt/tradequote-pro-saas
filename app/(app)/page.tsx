import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ButtonLink, Panel, StatCard } from '@/components/ui';
import { getContext, type AppContext } from '@/lib/context';
import { formatMoney } from '@/lib/format';
import { MODULE_GROUPS, MODULES, getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';

export const dynamic = 'force-dynamic';

interface Metric {
  label: string;
  slug: string;
  caption: string;
  statuses?: string[];
}

// Each metric counts rows in a module the user can read, filtered to "open" statuses.
const METRICS: Metric[] = [
  { label: 'Open Estimates', slug: 'estimates', caption: 'Draft or submitted bids', statuses: ['Draft', 'Submitted'] },
  { label: 'Proposals Out', slug: 'proposals', caption: 'Sent, awaiting decision', statuses: ['Sent'] },
  { label: 'Active Projects', slug: 'projects', caption: 'Jobs in progress', statuses: ['Active'] },
  { label: 'Open RFIs', slug: 'rfis', caption: 'Waiting on an answer', statuses: ['Open'] },
  { label: 'Pending Change Orders', slug: 'change-orders', caption: 'Awaiting client approval', statuses: ['Pending Approval'] },
  { label: 'Open Safety Items', slug: 'safety-logs', caption: 'Incidents not yet resolved', statuses: ['Open', 'Under Investigation'] },
  { label: 'Active LOTO Permits', slug: 'loto-permits', caption: 'Equipment currently locked out', statuses: ['Locked Out', 'Verified Zero Energy'] },
  { label: 'Timecards to Approve', slug: 'timecards', caption: 'Submitted this period', statuses: ['Submitted'] },
  { label: 'Open Punch Items', slug: 'punch-list', caption: 'Before turnover', statuses: ['Open', 'In Progress'] },
];

async function countOpen(ctx: AppContext, m: Metric): Promise<number | null> {
  const mod = getModule(m.slug)!;
  let q = ctx.supabase.from(mod.table).select('id', { count: 'exact', head: true });
  if (m.statuses) q = q.in('status', m.statuses);
  const { count, error } = await q;
  return error ? null : count ?? 0;
}

async function expiringSoon(ctx: AppContext) {
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const checks = [
    { slug: 'sub-compliance', column: 'liability_expiry', label: 'Sub liability insurance' },
    { slug: 'vendors', column: 'insurance_expiry', label: 'Vendor insurance' },
    { slug: 'employees', column: 'ticket_expiry', label: 'Employee tickets' },
    { slug: 'warranty', column: 'expiry_date', label: 'Warranty' },
  ].filter((c) => hasRank(ctx.role, getModule(c.slug)!.read));

  const results = await Promise.all(
    checks.map(async (c) => {
      const { data } = await ctx.supabase.from(getModule(c.slug)!.table).select(`id, title, ${c.column}`).gte(c.column, today).lte(c.column, in30).order(c.column).limit(5);
      return ((data ?? []) as unknown as Record<string, string>[]).map((r) => ({ id: r.id, title: r.title, date: r[c.column], label: c.label, slug: c.slug }));
    })
  );
  return results.flat().sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
}

async function pipelineValue(ctx: AppContext): Promise<number | null> {
  if (!hasRank(ctx.role, getModule('proposals')!.read)) return null;
  const { data, error } = await ctx.supabase.from('proposals').select('total_amount').eq('status', 'Sent');
  if (error) return null;
  return (data ?? []).reduce((sum, r: { total_amount: number | null }) => sum + Number(r.total_amount ?? 0), 0);
}

export default async function CommandCenter() {
  const result = await getContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;

  const visible = METRICS.filter((m) => hasRank(ctx.role, getModule(m.slug)!.read));
  const [counts, expiring, pipeline] = await Promise.all([Promise.all(visible.map((m) => countOpen(ctx, m))), expiringSoon(ctx), pipelineValue(ctx)]);

  const canCreateEstimate = ctx.canWrite && hasRank(ctx.role, getModule('estimates')!.write);

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Command Center</h1>
          <p className="text-slate-400 mt-1">{ctx.company.name} — what needs attention today.</p>
        </div>
        <div className="flex items-center gap-3">
          {canCreateEstimate && <ButtonLink href="/estimates">+ New Estimate</ButtonLink>}
          <ButtonLink href="/assistant" variant="secondary">
            Ask the AI Assistant
          </ButtonLink>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
        {pipeline !== null && <StatCard label="Proposals Pipeline" value={formatMoney(pipeline)} caption="Value of proposals sent" href="/proposals" />}
        {visible.map((m, i) => (
          <StatCard key={m.slug} label={m.label} value={counts[i] ?? '—'} caption={m.caption} href={`/${m.slug}`} />
        ))}
      </div>

      {expiring.length > 0 && (
        <Panel title="Expiring in the Next 30 Days" className="mb-8">
          <ul className="divide-y divide-slate-800">
            {expiring.map((e) => (
              <li key={`${e.slug}-${e.id}`} className="flex justify-between gap-4 py-3 text-sm">
                <Link href={`/${e.slug}`} className="text-white hover:text-amber-400">
                  <span className="text-xs uppercase tracking-wider text-slate-400 mr-2">{e.label}</span>
                  {e.title}
                </Link>
                <span className="text-amber-400 whitespace-nowrap">{e.date}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

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
