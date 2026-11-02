import Link from 'next/link';

const STEPS = [
  { n: 1, title: 'Add your client', where: '/crm', link: 'CRM', text: 'Type the company, contact, phone and job site. Press Save.' },
  { n: 2, title: 'Build an estimate', where: '/estimates', link: 'Estimates', text: 'Press "+ New Estimate". Enter the project, client and your markup %. Press Save Estimate.' },
  { n: 3, title: 'Send a proposal', where: '/proposals', link: 'Proposals', text: 'Enter the title, amount and scope of work. Press Issue. Use Print / Save PDF to send it.' },
  { n: 4, title: 'Run the job', where: '/daily-logs', link: 'Daily Logs', text: 'Each day your crew adds a daily log, safety log and timecards. LOTO permits and tailgate meetings live here too.' },
  { n: 5, title: 'Track changes', where: '/change-orders', link: 'Change Orders', text: 'Log every change order and RFI the moment it happens so nothing is lost at billing time.' },
  { n: 6, title: 'Bill and close out', where: '/progress-billing', link: 'Progress Billing', text: 'Add progress bills as work is done. Finish with warranty and commissioning records.' },
];

const TIPS = [
  'Every module works the same way: type a name, pick a status, press Add Record. Your list is below the form.',
  'To remove a record, press Delete on its row.',
  'The Dashboard counts everything at a glance. Click any module tile to jump straight to it.',
  'If a save fails you will see "Save failed" with the reason — nothing fails silently.',
  'On a phone or tablet, install the app (see Settings) so it opens full-screen like any other app.',
];

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight text-white">How to Use TradeQuote PRO</h1>
        <p className="text-slate-400 mt-1">Six steps from first call to final bill.</p>

        <ol className="mt-8 space-y-4">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex gap-4">
              <span className="flex-none w-10 h-10 rounded-full bg-amber-500 text-slate-950 font-extrabold flex items-center justify-center">{s.n}</span>
              <div>
                <h2 className="text-lg font-bold text-white">{s.title}</h2>
                <p className="text-slate-300 mt-1">{s.text}</p>
                <Link href={s.where} className="inline-block mt-3 text-xs font-semibold text-amber-500 hover:underline uppercase tracking-wider">Open {s.link} →</Link>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-lg font-bold text-white mb-4">Good to know</h2>
          <ul className="space-y-3 text-slate-300">
            {TIPS.map((t) => <li key={t} className="flex gap-3"><span className="text-amber-400">•</span>{t}</li>)}
          </ul>
        </div>
      </div>
    </main>
  );
}
