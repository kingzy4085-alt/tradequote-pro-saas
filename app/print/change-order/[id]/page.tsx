import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { recordColumns } from '@/lib/crud';
import { formatMoney, formatValue } from '@/lib/format';
import { getModule } from '@/lib/modules';
import { Letterhead, loadLetterhead } from '@/lib/print';
import { PROJECT_MONEY_RANK, withChangeOrderMoney } from '@/lib/project-money';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import PrintButton from '../../proposal/[id]/print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Change Order · TradeQuote PRO' };

// What the client signs: the scope and the price. Cost, labour and markup stay off the page.
export default async function PrintChangeOrder({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status === 'signed-out') redirect('/login');
  if (result.status !== 'ok') redirect('/onboarding');
  const { ctx } = result;
  const mod = getModule('change-orders')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const [{ data: found, error }, company] = await Promise.all([ctx.supabase.from(mod.table).select(recordColumns(mod)).eq('id', params.id).maybeSingle(), loadLetterhead(ctx)]);
  if (error) throw new Error('Could not load this change order.');
  if (!found) notFound();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as loose as the select('*') this replaced
  const withMoney = await withChangeOrderMoney(ctx.supabase, ctx.role, [found as unknown as Record<string, any> & { id: string }]);
  if ('error' in withMoney) throw new Error('Could not load this change order.');
  const co = withMoney.rows[0];
  // Below project manager the page is the scope and the signature lines, with no money on it
  const seesMoney = hasRank(ctx.role, PROJECT_MONEY_RANK);

  const { data: project } = co.project_id ? await ctx.supabase.from('projects').select('title, client_name, site').eq('id', co.project_id).maybeSingle() : { data: null };
  const days = Number(co.days_impact) || 0;

  return (
    <main className="min-h-screen bg-white text-gray-700">
      <article className="max-w-[8.5in] mx-auto p-6 sm:p-10 print:p-0 text-sm leading-relaxed">
        <Letterhead company={company} document={`Change Order #${co.co_number ?? ''}`}>
          <p>{formatValue('date', String(co.created_at).slice(0, 10))}</p>
          {co.status !== 'Approved' && <p>{co.status}</p>}
        </Letterhead>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase text-black">Project</p>
            <p className="text-black font-semibold">{project?.title ?? co.project_name ?? '—'}</p>
            {project?.site && <p>{project.site}</p>}
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-black">Client</p>
            <p className="text-black font-semibold">{project?.client_name ?? '—'}</p>
          </div>
        </section>

        <section className="pb-5">
          <h2 className="text-xs font-bold uppercase text-black mb-1">Change</h2>
          <p className="text-black font-semibold">{co.title}</p>
          {co.reason && <p>Reason: {co.reason}</p>}
          {co.scope && <p className="whitespace-pre-line mt-2">{co.scope}</p>}
        </section>

        {days !== 0 && (
          <section className="pb-5">
            <h2 className="text-xs font-bold uppercase text-black mb-1">Schedule</h2>
            <p>
              {days > 0 ? 'Adds' : 'Takes off'} {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'}.
            </p>
          </section>
        )}

        {seesMoney && (
        <dl className="ml-auto w-full sm:w-64 space-y-1 break-inside-avoid">
          <div className="flex justify-between">
            <dt>Price</dt>
            <dd>{formatMoney(co.price)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Tax ({Number(co.tax_pct) || 0}%)</dt>
            <dd>{formatMoney(co.tax)}</dd>
          </div>
          <div className="flex justify-between text-black font-bold text-base border-t border-black pt-1">
            <dt>Total (CAD)</dt>
            <dd>{formatMoney(co.total)}</dd>
          </div>
        </dl>
        )}

        <section className="pt-10 break-inside-avoid">
          {co.status === 'Approved' && co.signature ? (
            <div className="max-w-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={co.signature} alt={`Signature of ${co.approved_by ?? 'the approver'}`} className="h-20 object-contain" />
              <div className="border-t border-black pt-1 text-xs">
                Approved by {co.approved_by}
                {co.approved_at && `, ${formatValue('datetime', co.approved_at)}`}
              </div>
            </div>
          ) : co.status === 'Approved' ? (
            <p>Approved by {co.approved_by}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
              {['Approved by (client)', `For ${company.name}`].map((l) => (
                <div key={l}>
                  <div className="border-b border-black h-10" />
                  <p className="text-xs mt-1">{l}: signature and date</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-10 flex items-center justify-between gap-4 print:hidden">
          <Link href={`/change-orders/${params.id}`} className="underline">Back to the change order</Link>
          <PrintButton />
        </div>
      </article>
    </main>
  );
}
