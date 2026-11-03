'use client';

import { useEffect, useState } from 'react';
import { estimateTotals, money, type EstimateItem } from '@/lib/estimate-math';

const DEFAULT_TERMS = 'Pricing valid for 30 days. Work outside the scope above will be quoted as a change order. Payment due 30 days from invoice.';

export default function ProposalPage({ params }: { params: { id: string } }) {
  const [est, setEst] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([fetch(`/api/estimates/${params.id}`).then((r) => r.json()), fetch('/api/company').then((r) => r.json())])
      .then(([e, c]) => {
        if (!e.success) return setError(e.error || 'Could not load this estimate.');
        setEst(e.data);
        setCompany(c.data || {});
      })
      .catch(() => setError('Could not load this proposal.'));
  }, [params.id]);

  if (error) return <main className="min-h-screen bg-slate-950 text-red-400 p-8">{error}</main>;
  if (!est) return <main className="min-h-screen bg-slate-950 text-slate-400 p-8">Loading proposal…</main>;

  const items: EstimateItem[] = est.items || [];
  const t = estimateTotals(items, est.labourRate, est.markupPercentage, est.taxPercentage);
  const factor = t.subtotal ? t.beforeTax / t.subtotal : 1;
  const lineSell = (i: number) => (t.lines[i].material + t.lines[i].hours * (Number(est.labourRate) || 0)) * factor;
  const fmt = (d: Date) => d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const today = fmt(new Date());
  const validUntil = fmt(new Date(Date.now() + 30 * 86400000));

  return (
    <main className="min-h-screen bg-slate-950 p-4 sm:p-8 print:p-0 print:bg-white">
      <div className="max-w-[8.5in] mx-auto mb-4 flex justify-end gap-3 print:hidden">
        <button onClick={() => window.print()} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">Print / Save PDF</button>
      </div>
      <article className="proposal-paper max-w-[8.5in] mx-auto bg-white text-gray-700 p-10 sm:p-14 shadow-2xl print:shadow-none print:p-0 text-sm leading-relaxed">
        <header className="flex justify-between gap-6 border-b-2 border-black pb-5">
          <div>
            <h1 className="text-2xl font-bold text-black">{company?.company_name || 'Your Company'}</h1>
            <p>{company?.address}{company?.province ? `, ${company.province}` : ''}</p>
            <p>{[company?.phone, company?.email].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-black uppercase tracking-wide">Proposal</p>
            <p>{today}</p>
            <p>Estimate #{est.id}</p>
            <p>Valid until {validUntil}</p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase text-black">Prepared for</p>
            <p className="text-black font-semibold">{est.clientName}</p>
            <p>{est.clientAddress}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-black">Project</p>
            <p className="text-black font-semibold">{est.projectName}</p>
          </div>
        </section>

        {est.scope && (
          <section className="pb-5">
            <h2 className="text-xs font-bold uppercase text-black mb-1">Scope of work</h2>
            <p className="whitespace-pre-line">{est.scope}</p>
          </section>
        )}

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
            {items.map((it, i) => (
              <tr key={i} className="border-b border-gray-300 break-inside-avoid">
                <td className="py-2">{it.description}</td>
                <td className="py-2 text-right">{Number(it.quantity)}</td>
                <td className="py-2 pl-3">{it.unit}</td>
                <td className="py-2 text-right">{money(lineSell(i))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto w-64 space-y-1 break-inside-avoid">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(t.beforeTax)}</dd></div>
          <div className="flex justify-between"><dt>Tax ({Number(est.taxPercentage) || 0}%)</dt><dd>{money(t.tax)}</dd></div>
          <div className="flex justify-between text-black font-bold text-base border-t border-black pt-1"><dt>Total (CAD)</dt><dd>{money(t.total)}</dd></div>
        </dl>

        <section className="pt-6 break-inside-avoid">
          <h2 className="text-xs font-bold uppercase text-black mb-1">Terms</h2>
          <p className="whitespace-pre-line">{est.terms || company?.default_terms || DEFAULT_TERMS}</p>
        </section>

        <section className="grid grid-cols-2 gap-10 pt-14 break-inside-avoid">
          {['Accepted by (client)', `For ${company?.company_name || 'contractor'}`].map((l) => (
            <div key={l}>
              <div className="border-b border-black h-10" />
              <p className="text-xs mt-1">{l} — signature &amp; date</p>
            </div>
          ))}
        </section>
      </article>
    </main>
  );
}
