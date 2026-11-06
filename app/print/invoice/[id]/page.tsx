import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { invoiceTaxLabel, type InvoiceLine } from '@/lib/billing-math';
import { getPageContext } from '@/lib/context';
import { formatMoney, formatValue } from '@/lib/format';
import { getModule } from '@/lib/modules';
import { Letterhead, loadLetterhead } from '@/lib/print';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import PrintButton from '../../proposal/[id]/print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoice · TradeQuote PRO' };

export default async function PrintInvoice({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status === 'signed-out') redirect('/login');
  if (result.status !== 'ok') redirect('/onboarding');
  const { ctx } = result;
  if (!hasRank(ctx.role, getModule('invoices')!.read)) notFound();

  const [{ data: invoice, error }, company] = await Promise.all([ctx.supabase.from('invoices').select('*').eq('id', params.id).maybeSingle(), loadLetterhead(ctx)]);
  if (error) throw new Error('Could not load this invoice.');
  if (!invoice) notFound();

  const { data: project } = invoice.project_id ? await ctx.supabase.from('projects').select('title, site').eq('id', invoice.project_id).maybeSingle() : { data: null };
  const lines = (invoice.lines ?? []) as InvoiceLine[];
  const holdback = Number(invoice.holdback_amount) || 0;

  return (
    <main className="min-h-screen bg-white text-gray-700">
      <article className="max-w-[8.5in] mx-auto p-6 sm:p-10 print:p-0 text-sm leading-relaxed">
        <Letterhead company={company} document={`Invoice ${invoice.invoice_number ?? ''}`}>
          {invoice.issue_date && <p>Issued {formatValue('date', invoice.issue_date)}</p>}
          {invoice.due_date && <p className="font-semibold text-black">Due {formatValue('date', invoice.due_date)}</p>}
          {invoice.status === 'Draft' && <p className="font-bold text-black">DRAFT</p>}
          {invoice.status === 'Void' && <p className="font-bold text-black">VOID</p>}
          {invoice.status === 'Paid' && <p className="font-bold text-black">PAID{invoice.paid_at ? ` ${formatValue('date', invoice.paid_at)}` : ''}</p>}
        </Letterhead>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase text-black">Bill to</p>
            <p className="text-black font-semibold">{invoice.client_name || '—'}</p>
            {invoice.client_address && <p>{invoice.client_address}</p>}
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-black">Project</p>
            <p className="text-black font-semibold">{project?.title ?? invoice.title}</p>
            {project?.site && <p>{project.site}</p>}
          </div>
        </section>

        <table className="w-full border-collapse mb-5">
          <thead>
            <tr className="border-b border-black text-left text-black text-xs uppercase">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-gray-300 break-inside-avoid">
                <td className="py-2 pr-4">{l.description}</td>
                <td className="py-2 text-right whitespace-nowrap">{formatMoney(l.amount)}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={2} className="py-3 text-center">
                  No lines on this invoice.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <dl className="ml-auto w-full sm:w-72 space-y-1 break-inside-avoid">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatMoney(invoice.amount)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{invoiceTaxLabel(lines, invoice.tax_pct)}</dt>
            <dd>{formatMoney(invoice.gst)}</dd>
          </div>
          {holdback !== 0 && (
            <div className="flex justify-between">
              <dt>Less holdback ({Number(invoice.holdback_pct) || 0}%)</dt>
              <dd>{formatMoney(-holdback)}</dd>
            </div>
          )}
          <div className="flex justify-between text-black font-bold text-base border-t border-black pt-1">
            <dt>Amount due (CAD)</dt>
            <dd>{formatMoney(invoice.total)}</dd>
          </div>
        </dl>

        {holdback !== 0 && (
          <p className="pt-5 text-xs break-inside-avoid">
            {holdback < 0 ? `This credit takes ${formatMoney(-holdback)} off the holdback withheld` : `Holdback of ${formatMoney(holdback)} is withheld from the amount before tax`}
            {invoice.holdback_release_date ? ` and is due for release on ${formatValue('date', invoice.holdback_release_date)}` : ''}.
          </p>
        )}
        {invoice.notes && <p className="pt-5 whitespace-pre-line break-inside-avoid">{invoice.notes}</p>}

        <div className="mt-10 flex items-center justify-between gap-4 print:hidden">
          <Link href={`/invoices/${params.id}`} className="underline">Back to the invoice</Link>
          <PrintButton />
        </div>
      </article>
    </main>
  );
}
