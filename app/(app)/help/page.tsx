import { IfNavLink } from '@/components/nav-links';
import { PageHeader, Panel } from '@/components/ui';

export const metadata = { title: 'How to Use · TradeQuote PRO' };

const STEPS = [
  { title: 'Set up your company', href: '/settings/company', link: 'Company Profile', text: 'Add your phone, address, default markup, sales tax, labour rate, overtime multiplier, holdback and proposal terms. New estimates, change orders and invoices start with them.' },
  { title: 'Invite your team', href: '/settings/team', link: 'Team', text: 'Invite people by email and pick their role. Electricians see field tools and only their own timecards; project managers and up see estimates and money.' },
  { title: 'Add your client', href: '/crm', link: 'Clients', text: 'Add the company, contact and job site.' },
  { title: 'Build an estimate', href: '/estimates', link: 'Estimates', text: 'Press "+ New Estimate", then click its name to open it. Add lines with quantity, material cost and labour hours — totals, markup and tax update as you type. Press Save.' },
  { title: 'Send the proposal', href: '/estimates', link: 'Estimates', text: 'In the saved estimate, press Create proposal. It shows one price per line with your markup built in, your terms and signature lines. Press Print and print it or save it as a PDF, then set its status to Sent and press Save. Nothing is emailed for you.' },
  { title: 'Start the job', href: '/proposals', link: 'Proposals', text: 'When the client accepts, set the proposal status to Accepted and press Save, then press Create project. The project takes the contract value, and job costing starts with a budget from the estimate.' },
  { title: 'Run the job', href: '/daily-logs', link: 'Daily Logs', text: 'Each day, open a daily log, fill in the crew, hours and work done, and add photos straight from the phone camera. Sign on the screen and press Sign & lock log.' },
  { title: 'Track the time', href: '/timecards', link: 'Timecards', text: 'Electricians enter their own hours. Foremen and above can add workers and enter hours for the crew. Press Save time. A foreman or above presses Approve, which locks the card and freezes its cost. Nobody below project manager approves their own card. Project managers and above press Export payroll to download approved cards.' },
  { title: 'Sign the safety records', href: '/loto-permits', link: 'LOTO Permits', text: 'LOTO permits, tailgate meetings and safety inspections are signed in order and lock on the final signature. A signed record can\'t be deleted, and only a project manager or above can reopen it.' },
  { title: 'Price the changes', href: '/change-orders', link: 'Change Orders', text: 'Price a change order and press Mark sent to client. The client signs on the phone or tablet, or you copy from a signed printout, then press Approve. Once approved, its price adds to the contract. Log RFIs the moment they come up.' },
  { title: 'Bill the work', href: '/invoices', link: 'Invoices', text: 'On the project, press New invoice or New draw. Both make a draft for you to check, and a draw has its own Create invoice button. Holdback and tax are worked out for you. Mark sent adds the invoice to Receivables, and Mark paid clears it.' },
  { title: 'Watch the margin', href: '/job-costing', link: 'Job Costing', text: 'Approved timecards, approved bills and cost entries roll up to each job, so you can see budget against actual cost and the margin as you go. Project managers and above can see this.' },
];

const TIPS = [
  'The Attention panel on the Command Center shows what is overdue or coming up for your role, with a date it last checked. It checks once a day. Snooze or dismiss only changes your own list.',
  'Every module works the same way: press "+ New", fill in the form, press Save. Search and filter by status above the list.',
  'A signed daily log is locked. A foreman or above can reopen it, which removes the signature.',
  'Ask the AI Assistant about the Canadian Electrical Code, permits or your own records. Check its cited sources before relying on an answer.',
  'If a save fails you see the reason on screen — nothing fails silently.',
  'If your trial or subscription lapses, nothing is deleted. You can still sign in and read everything, but editing stops until you subscribe.',
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
              <IfNavLink href={s.href} className="inline-block mt-3 text-xs font-semibold text-amber-500 hover:underline uppercase tracking-wider">
                Open {s.link} →
              </IfNavLink>
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
