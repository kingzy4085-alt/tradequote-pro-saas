import Link from 'next/link';

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

export const metadata = { title: 'About · TradeQuote PRO' };

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <Link href="/pricing" className="text-xs font-semibold text-amber-500 hover:underline uppercase tracking-wider">← TradeQuote PRO</Link>
        <h1 className="text-3xl font-bold tracking-tight text-white mt-1">About TradeQuote PRO</h1>
        <p className="text-slate-400 mt-1">Industrial Shutdown & Electrical Contracting Operations Hub</p>

        <div className="mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl text-slate-300 space-y-4">
          <p>TradeQuote PRO is one app for running an electrical or industrial contracting business — from the first client call to the final bill.</p>
          <p>It is built for Canadian contractors: estimators who are tired of re-typing spreadsheets, office staff chasing paperwork, and field crews who need big buttons that work with gloves on and in sunlight.</p>
        </div>

        <h2 className="text-xl font-bold text-white mt-10 mb-4">What&apos;s inside</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {AREAS.map(([t, d]) => (
            <div key={t} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">{t}</p>
              <p className="text-slate-300 mt-2 text-sm">{d}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl grid sm:grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Version</p><p className="text-white mt-1">1.0</p></div>
          <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Works on</p><p className="text-white mt-1">Windows, Android, iPhone, any browser</p></div>
          <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Data</p><p className="text-white mt-1">Encrypted cloud database; each company sees only its own records</p></div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-3 rounded-xl">Start free trial</Link>
          <Link href="/pricing" className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-5 py-3 rounded-xl border border-slate-700">Pricing</Link>
        </div>
      </div>
    </main>
  );
}
