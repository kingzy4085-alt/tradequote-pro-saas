import { notFound, redirect } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { formatMoney, formatValue } from '@/lib/format';
import { getModule } from '@/lib/modules';
import { Letterhead, loadLetterhead } from '@/lib/print';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import PrintButton from '@/components/print-button';

export const dynamic = 'force-dynamic';

export default async function PrintProposal({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status === 'signed-out') redirect('/login');
  if (result.status !== 'ok') redirect('/onboarding');
  const { ctx } = result;
  if (!hasRank(ctx.role, getModule('proposals')!.read)) notFound();

  const [{ data: p }, company] = await Promise.all([ctx.supabase.from('proposals').select('*').eq('id', params.id).maybeSingle(), loadLetterhead(ctx)]);
  if (!p) notFound();

  const dates = [`Date: ${new Date(p.created_at).toLocaleDateString('en-CA')}`];
  if (p.valid_until) dates.push(`Prices valid until: ${formatValue('date', p.valid_until)}`);

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="max-w-4xl mx-auto p-8">
        <div className="mb-6 text-sm text-gray-600">
          <Letterhead company={company} title="Proposal" details={dates} tagline="Industrial & Commercial Electrical Contracting" />
        </div>

        <section className="mb-6">
          <p className="text-sm text-gray-500 uppercase tracking-wider">Prepared for</p>
          <p className="text-lg font-semibold">{p.client_name || '—'}</p>
          <p className="text-lg mt-2">{p.title}</p>
        </section>

        {p.scope_of_work && (
          <section className="mb-6">
            <h3 className="font-bold text-lg mb-2">Scope of Work</h3>
            <p className="text-gray-700 whitespace-pre-line">{p.scope_of_work}</p>
          </section>
        )}

        <section className="mb-6 border-t border-b border-gray-300 py-4 flex justify-between items-baseline">
          <span className="font-bold text-lg">Total (CAD, before applicable taxes)</span>
          <span className="text-2xl font-bold">{formatMoney(p.total_amount)}</span>
        </section>

        {p.terms && (
          <section className="mb-6">
            <h3 className="font-bold text-lg mb-2">Terms</h3>
            <p className="text-gray-700 whitespace-pre-line text-sm">{p.terms}</p>
          </section>
        )}

        <section className="grid grid-cols-2 gap-8 mt-16 text-sm">
          <div>
            <div className="border-t border-gray-400 pt-2">Accepted by (client signature)</div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-2">Date</div>
          </div>
        </section>

        <div className="mt-10 flex justify-end print:hidden">
          <PrintButton />
        </div>
      </div>
    </main>
  );
}
