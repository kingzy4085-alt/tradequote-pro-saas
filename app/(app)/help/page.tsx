import Link from 'next/link';
import { PageHeader, Panel } from '@/components/ui';

export const metadata = { title: 'How to Use · TradeQuote PRO' };

const STEPS = [
  { title: 'Set up your company', href: '/settings/company', link: 'Company Profile', text: 'Add your phone, address, default markup, sales tax, labour rate and proposal terms. Every new estimate starts with them.' },
  { title: 'Invite your team', href: '/settings/team', link: 'Team', text: 'Invite people by email and pick their role. Electricians see field tools and only their own timecards; project managers and up see estimates and money.' },
  { title: 'Add your client', href: '/crm', link: 'CRM', text: 'Add the company, contact and job site.' },
  { title: 'Build an estimate', href: '/estimates', link: 'Estimates', text: 'Press "+ New Estimate", then click the project name to open it. Add lines with quantity, material cost and labour hours — totals, markup and tax update as you type. Press Save.' },
  { title: 'Send the proposal', href: '/estimates', link: 'Estimates', text: 'In the estimate, press Proposal. It shows one price per line with your markup built in, your terms and signature lines. Print it or save it as a PDF.' },
  { title: 'Run the job', href: '/daily-logs', link: 'Daily Logs', text: 'Each day, open a daily log, fill in the crew, hours and work done, and add photos straight from the phone camera. Sign it on the screen to lock it.' },
  { title: 'Track changes and bill', href: '/change-orders', link: 'Change Orders', text: 'Log change orders and RFIs the moment they happen, then add progress bills as work is done.' },
];

const TIPS = [
  'Every module works the same way: press "+ New", fill in the form, press Save. Search and filter by status above the list.',
  'A signed daily log is locked. A foreman or above can reopen it, which removes the signature.',
  'Ask the AI Assistant about the Canadian Electrical Code, permits or your own records. Check its cited sources before relying on an answer.',
  'If a save fails you see the reason on screen — nothing fails silently.',
  'On a phone or tablet, install the app from your browser menu so it opens full-screen like any other app.',
];

export default function HelpPage() {
  return (
    <>
      <PageHeader title="How to Use TradeQuote PRO" subtitle="From first call to final bill." back={{ href: '/', label: 'Back to Command Center' }} />
      <ol className="space-y-4 max-w-4xl">
        {STEPS.map((s, i) => (
          <li key={s.title} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex gap-4">
            <span className="flex-none w-10 h-10 rounded-full bg-amber-500 text-slate-950 font-extrabold flex items-center justify-center">{i + 1}</span>
            <div>
              <h2 className="text-lg font-bold text-white">{s.title}</h2>
              <p className="text-slate-300 mt-1">{s.text}</p>
              <Link href={s.href} className="inline-block mt-3 text-xs font-semibold text-amber-500 hover:underline uppercase tracking-wider">
                Open {s.link} →
              </Link>
            </div>
          </li>
        ))}
      </ol>
      <Panel title="Good to know" className="mt-8 max-w-4xl">
        <ul className="space-y-3 text-slate-300">
          {TIPS.map((t) => (
            <li key={t} className="flex gap-3">
              <span className="text-amber-400">•</span>
              {t}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
