import { notFound, redirect } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { estimateTotals, lineSellPrice } from '@/lib/estimate-math';
import { formatMoney } from '@/lib/format';
import { getModule } from '@/lib/modules';
import { Letterhead, loadLetterhead, printDate } from '@/lib/print';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import PrintButton from '@/components/print-button';

export const dynamic = 'force-dynamic';

const DEFAULT_TERMS = 'Pricing valid for 30 days. Work outside the scope above will be quoted as a change order. Payment due 30 days from invoice.';

// The client-facing proposal for an estimate: one price per line, markup folded in, costs hidden
export default async function PrintEstimate({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status === 'signed-out') redirect('/login');
  if (result.status !== 'ok') redirect('/onboarding');
  const { ctx } = result;
  if (!hasRank(ctx.role, getModule('estimates')!.read)) notFound();

  const [{ data: est }, { data: items }, company] = await Promise.all([
    ctx.supabase.from('estimates').select('*').eq('id', params.id).maybeSingle(),
    ctx.supabase.from('estimate_items').select('*').eq('estimate_id', params.id).order('sort'),
    loadLetterhead(ctx),
  ]);
  if (!est) notFound();

  const lines = items ?? [];
  const t = estimateTotals(lines, est.labour_rate, est.markup_percentage, est.tax_percentage);
  const name = company.name;
  const issued = new Date(est.updated_at ?? est.created_at);

  return (
    <main className="min-h-screen bg-white text-gray-700">
      <article className="max-w-[8.5in] mx-auto p-10 print:p-0 text-sm leading-relaxed">
        <Letterhead company={company} title="Proposal" details={[printDate(issued), `Valid until ${printDate(new Date(issued.getTime() + 30 * 86_400_000))}`]} />

        <section className="grid grid-cols-2 gap-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase text-black">Prepared for</p>
            <p className="text-black font-semibold">{est.client_name || '—'}</p>
            {est.client_address && <p>{est.client_address}</p>}
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-black">Project</p>
            <p className="text-black font-semibold">{est.title}</p>
          </div>
        </section>

        {est.scope && (
          <section className="pb-5">
            <h2 className="text-xs font-bold uppercase text-black mb-1">Scope of work</h2>
            <p className="whitespace-pre-line">{est.scope}</p>
          </section>
        )}

        {lines.length > 0 && (
          <table className="w-full border-collapse mb-5">
            <thead>
              <tr className="border-b border-black text-left text-black text-xs uppercase">
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 pl-3">Unit</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((it, i) => (
                <tr key={it.id} className="border-b border-gray-300 break-inside-avoid">
                  <td className="py-2">{it.description}</td>
                  <td className="py-2 text-right">{Number(it.quantity)}</td>
                  <td className="py-2 pl-3">{it.unit}</td>
                  <td className="py-2 text-right">{formatMoney(lineSellPrice(t, i, est.labour_rate))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <dl className="ml-auto w-64 space-y-1 break-inside-avoid">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatMoney(t.beforeTax)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Tax ({Number(est.tax_percentage) || 0}%)</dt>
            <dd>{formatMoney(t.tax)}</dd>
          </div>
          <div className="flex justify-between text-black font-bold text-base border-t border-black pt-1">
            <dt>Total (CAD)</dt>
            <dd>{formatMoney(t.total)}</dd>
          </div>
        </dl>

        <section className="pt-6 break-inside-avoid">
          <h2 className="text-xs font-bold uppercase text-black mb-1">Terms</h2>
          <p className="whitespace-pre-line">{est.terms || company.default_terms || DEFAULT_TERMS}</p>
        </section>

        <section className="grid grid-cols-2 gap-10 pt-14 break-inside-avoid">
          {['Accepted by (client)', `For ${name}`].map((l) => (
            <div key={l}>
              <div className="border-b border-black h-10" />
              <p className="text-xs mt-1">{l} — signature &amp; date</p>
            </div>
          ))}
        </section>

        <div className="mt-10 flex justify-end print:hidden">
          <PrintButton />
        </div>
      </article>
    </main>
  );
}
