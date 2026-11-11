import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { estimateTotals, lineSellPrice } from '@/lib/estimate-math';
import { formatMoney, formatValue } from '@/lib/format';
import { getModule } from '@/lib/modules';
import { Letterhead, loadLetterhead } from '@/lib/print';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import PrintButton from './print-button';

export const dynamic = 'force-dynamic';

const heading = 'text-xs font-bold uppercase text-black mb-1';

// The document the client signs. One price per line with markup folded in: no cost, labour or markup detail.
export default async function PrintProposal({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status === 'signed-out') redirect('/login');
  if (result.status !== 'ok') redirect('/onboarding');
  const { ctx } = result;
  if (!hasRank(ctx.role, getModule('proposals')!.read)) notFound();

  const [{ data: p, error: readError }, company] = await Promise.all([ctx.supabase.from('proposals').select('*').eq('id', params.id).maybeSingle(), loadLetterhead(ctx)]);
  if (readError) throw new Error('Could not load this proposal.');
  if (!p) notFound();

  const [estimate, estimateLines] = p.estimate_id
    ? await Promise.all([
        ctx.supabase.from('estimates').select('client_address, labour_rate, markup_percentage, tax_percentage').eq('id', p.estimate_id).maybeSingle(),
        ctx.supabase.from('estimate_items').select('id, description, quantity, unit, material_unit_cost, labour_hours_per_unit').eq('estimate_id', p.estimate_id).order('sort'),
      ])
    : [null, null];
  // A failed read must not print a client document with its lines missing and the wrong tax wording
  if (estimate?.error || estimateLines?.error || (p.estimate_id && !estimate?.data)) throw new Error('Could not load this proposal.');

  const est = estimate?.data ?? null;
  const lines = estimateLines?.data ?? [];
  const t = est ? estimateTotals(lines, est.labour_rate, est.markup_percentage, est.tax_percentage) : null;
  const terms = p.terms || company.default_terms;

  return (
    <main className="min-h-screen bg-white text-gray-700">
      <article className="max-w-[8.5in] mx-auto p-6 sm:p-10 print:p-0 text-sm leading-relaxed">
        <Letterhead company={company} document="Proposal">
          <p>{formatValue('date', String(p.created_at).slice(0, 10))}</p>
          {p.valid_until && <p>Prices valid until {formatValue('date', p.valid_until)}</p>}
        </Letterhead>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-5">
          <div>
            <p className={heading}>Prepared for</p>
            <p className="text-black font-semibold">{p.client_name || '—'}</p>
            {est?.client_address && <p>{est.client_address}</p>}
          </div>
          <div>
            <p className={heading}>Project</p>
            <p className="text-black font-semibold">{p.title}</p>
          </div>
        </section>

        {p.scope_of_work && (
          <section className="pb-5">
            <h2 className={heading}>Scope of work</h2>
            <p className="whitespace-pre-line">{p.scope_of_work}</p>
          </section>
        )}

        {t && lines.length > 0 && (
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
                  <td className="py-2 text-right">{formatMoney(lineSellPrice(t, i, est?.labour_rate))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {t ? (
          <dl className="ml-auto w-full sm:w-64 space-y-1 break-inside-avoid">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatMoney(t.beforeTax)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Tax ({Number(est?.tax_percentage) || 0}%)</dt>
              <dd>{formatMoney(t.tax)}</dd>
            </div>
            <div className="flex justify-between text-black font-bold text-base border-t border-black pt-1">
              <dt>Total (CAD)</dt>
              <dd>{formatMoney(p.total_amount)}</dd>
            </div>
          </dl>
        ) : (
          // Typed by hand, with no estimate behind it
          <div className="flex justify-between items-baseline border-y border-black py-3 text-black font-bold break-inside-avoid">
            <span>Total (CAD, before applicable taxes)</span>
            <span className="text-xl">{formatMoney(p.total_amount)}</span>
          </div>
        )}

        {terms && (
          <section className="pt-6 break-inside-avoid">
            <h2 className={heading}>Terms</h2>
            <p className="whitespace-pre-line">{terms}</p>
          </section>
        )}

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-10 pt-14 break-inside-avoid">
          {['Accepted by (client)', `For ${company.name}`].map((l) => (
            <div key={l}>
              <div className="border-b border-black h-10" />
              <p className="text-xs mt-1">{l}, signature and date</p>
            </div>
          ))}
        </section>

        <div className="mt-10 flex items-center justify-between gap-4 print:hidden">
          <Link href={`/proposals/${params.id}`} className="underline">Back to the proposal</Link>
          <PrintButton />
        </div>
      </article>
    </main>
  );
}
