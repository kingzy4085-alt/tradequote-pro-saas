import Link from 'next/link';
import { redirect } from 'next/navigation';
import AlertsPanel from '@/components/alerts-panel';
import { PageHeader } from '@/components/ui';
import { ALERT_SEVERITIES, SEVERITY_LABEL, moduleLabel, type AlertSeverity } from '@/lib/alerts';
import { getPageContext } from '@/lib/context';
import { getModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Alerts · TradeQuote PRO' };

const isSeverity = (value: unknown): value is AlertSeverity => ALERT_SEVERITIES.includes(value as AlertSeverity);

/** What the Command Center's Attention panel links to: the same alerts, filtered by severity or module. */
export default async function AlertsPage({ searchParams }: { searchParams: { severity?: string | string[]; module?: string | string[] } }) {
  const result = await getPageContext();
  if (result.status !== 'ok') redirect('/login');

  const severity = isSeverity(searchParams.severity) ? searchParams.severity : undefined;
  const mod = typeof searchParams.module === 'string' && getModule(searchParams.module) ? searchParams.module : undefined;
  const tab = (active: boolean) => `inline-flex items-center min-h-[40px] border rounded-full px-3 py-1 text-sm font-semibold transition-colors ${active ? 'bg-amber-500 border-amber-500 text-slate-950' : 'border-slate-700 text-slate-300 hover:border-amber-500/50'}`;

  return (
    <>
      <PageHeader title={mod ? `Alerts: ${moduleLabel(mod)}` : 'Alerts'} subtitle="Snoozing or dismissing only changes your own list." back={{ href: '/', label: 'Back to Command Center' }} />
      <nav aria-label="Filter alerts" className="flex flex-wrap gap-2 mb-6">
        <Link href="/alerts" className={tab(!severity && !mod)}>
          All
        </Link>
        {ALERT_SEVERITIES.map((s) => (
          <Link key={s} href={`/alerts?severity=${s}`} className={tab(severity === s)}>
            {SEVERITY_LABEL[s]}
          </Link>
        ))}
      </nav>
      <div className="max-w-3xl">
        <AlertsPanel key={`${severity ?? ''}-${mod ?? ''}`} canWrite={result.ctx.canWrite} severity={severity} module={mod} />
      </div>
    </>
  );
}
