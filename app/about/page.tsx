import Link from 'next/link';
import { SiteFooter, SiteShell } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { pageMeta } from '@/components/marketing/seo';
import { BTN_GHOST, BTN_PRIMARY, H, WRAP } from '@/components/marketing/ui';

const AREAS = [
  ['Bidding', 'Clients, estimates, proposals from the same record, RFQs and bid opportunities'],
  ['Project controls', 'A hub for each project, priced change orders with client sign-off, RFIs, submittals, drawings, documents'],
  ['Field', 'Daily logs with photos and sign-off, timecards with foreman approval, LOTO permits, tailgate meetings and safety inspections with ordered sign-offs, punch list'],
  ['AI assistant', 'Canadian code and construction questions answered with sources, plus search across your own records'],
  ['Money', 'Invoices and progress draws with holdback, receivables, payables, and budget against actual cost on every job'],
  ['Resources', 'Crew schedule, tool crib, fleet, equipment rentals, warehouse inventory, vendors'],
  ['Close-out', 'Commissioning, cable testing, warranty, deficiencies, sub compliance'],
  ['Alerts', 'Overdue invoices, expiring insurance and open safety items flagged every day, in the app and by email'],
];

export const metadata = pageMeta({
  title: 'About TradeQuote PRO',
  description: 'TradeQuote PRO is one app for running an electrical, industrial or general contracting business in Canada, from the first client call to the final bill.',
  path: '/about',
});

export default function AboutPage() {
  return (
    <SiteShell>
      <SiteHeader />
      <main className={`${WRAP} max-w-5xl py-12 sm:py-16`}>
        <h1 className={`${H} text-5xl text-white sm:text-7xl`}>About TradeQuote PRO</h1>
        <p className="mt-3 text-lg text-slate-400">Industrial Shutdown &amp; Electrical Contracting Operations Hub</p>

        <div className="mt-8 max-w-3xl space-y-4 text-lg text-slate-300">
          <p>TradeQuote PRO is one app for running an electrical or industrial contracting business — from the first client call to the final bill.</p>
          <p>It is built for Canadian contractors: estimators who are tired of re-typing spreadsheets, office staff chasing paperwork, and field crews who need big buttons that work with gloves on and in sunlight.</p>
        </div>

        <h2 className={`${H} mt-14 text-3xl text-white sm:text-4xl`}>What&apos;s inside</h2>
        <dl className="mt-6 grid gap-x-12 sm:grid-cols-2">
          {AREAS.map(([t, d]) => (
            <div key={t} className="border-t border-slate-800 py-5">
              <dt className="font-bold text-amber-300">{t}</dt>
              <dd className="mt-1.5 text-sm text-slate-300">{d}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 grid gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm sm:grid-cols-3">
          <div><p className="font-semibold text-slate-400">Version</p><p className="mt-1 text-white">1.0</p></div>
          <div><p className="font-semibold text-slate-400">Works on</p><p className="mt-1 text-white">Windows, Android, iPhone, any browser</p></div>
          <div><p className="font-semibold text-slate-400">Data</p><p className="mt-1 text-white">Encrypted cloud database; each company sees only its own records</p></div>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/signup" className={BTN_PRIMARY}>Start free trial</Link>
          <Link href="/demo" className={BTN_GHOST}>Try the live demo</Link>
          <Link href="/pricing" className={BTN_GHOST}>Pricing</Link>
        </div>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
