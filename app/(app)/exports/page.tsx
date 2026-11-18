import { notFound } from 'next/navigation';
import { PageHeader, Panel } from '@/components/ui';
import { getPageContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bookkeeping Export · TradeQuote PRO' };

// A plain link, not next/link: the browser downloads the file instead of the app trying to open it as a page
const DOWNLOAD =
  'min-h-[48px] lg:min-h-0 inline-flex items-center justify-center gap-2 transition-colors bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold shadow px-4 py-2.5 rounded-lg';

/** The two CSV files a bookkeeper asks for. Open to whoever can read invoices, and still open once a trial has ended. */
export default async function ExportsPage() {
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  if (!hasRank(result.ctx.role, getModule('invoices')!.read)) notFound();

  return (
    <>
      <PageHeader title="Bookkeeping export" subtitle="Spreadsheet files your bookkeeper can open or import." back={{ href: '/invoices', label: 'Back to Invoices' }} />
      <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
        <Panel title="Invoices">
          <p className="text-sm text-slate-300 mb-4">Every invoice you have sent, with its tax, holdback, what has been paid and what is still owed; drafts are left out.</p>
          <a href="/api/exports/invoices" download className={DOWNLOAD}>
            Download invoices (CSV)
          </a>
        </Panel>
        <Panel title="Payments">
          <p className="text-sm text-slate-300 mb-4">Every payment recorded against an invoice, with the date it came in, how it was paid and its reference.</p>
          <a href="/api/exports/payments" download className={DOWNLOAD}>
            Download payments (CSV)
          </a>
        </Panel>
      </div>
    </>
  );
}
