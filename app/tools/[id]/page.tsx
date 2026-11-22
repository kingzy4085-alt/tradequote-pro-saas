import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { SiteFooter, SiteShell } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { pageMeta } from '@/components/marketing/seo';
import { TRADE_LABEL } from '@/components/marketing/tool-labels';
import { BTN_PRIMARY, H, WRAP } from '@/components/marketing/ui';
import { CALCULATORS, defaultInput, getCalculator } from '@/lib/calc/registry';
import ToolWorkbench from './tool-workbench';

export const dynamicParams = false;

export function generateStaticParams() {
  return CALCULATORS.map((c) => ({ id: c.id }));
}

export function generateMetadata({ params }: { params: { id: string } }) {
  const calc = getCalculator(params.id);
  if (!calc) return {};
  return pageMeta({
    title: `${calc.name}: free, with a priced takeoff`,
    description: `${calc.summary} Free ${TRADE_LABEL[calc.trade].toLowerCase()} calculator for Canadian contractors, with materials priced by region. No signup.`,
    path: `/tools/${calc.id}`,
  });
}

export default function ToolPage({ params }: { params: { id: string } }) {
  const calc = getCalculator(params.id);
  if (!calc) notFound();
  const sample = calc.run(defaultInput(calc));
  const related = CALCULATORS.filter((c) => c.trade === calc.trade && c.id !== calc.id).slice(0, 4);
  return (
    <SiteShell>
      <SiteHeader />
      <main className={`${WRAP} py-10 sm:py-14`}>
        <nav aria-label="Breadcrumb" className="text-sm text-slate-400">
          <Link href="/tools" className="inline-flex min-h-[48px] items-center hover:text-white lg:min-h-0">Calculators</Link>
          <span aria-hidden className="mx-2">/</span>
          <span>{TRADE_LABEL[calc.trade]}</span>
        </nav>
        <h1 className={`${H} mt-2 max-w-4xl text-4xl text-white sm:text-6xl`}>{calc.name}</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">{calc.summary}</p>

        <div className="mt-10">
          <ToolWorkbench calcId={calc.id} />
        </div>

        <section className="mt-14 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-white">How it works</h2>
            <p className="mt-3 text-slate-300">You enter {calc.fields.length} inputs. The calculator returns the quantities, rounds them up the way the material is sold, and lists the takeoff so it can be priced.</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              {calc.fields.map((f) => (
                <li key={f.key}><span className="font-semibold text-white">{f.label}{f.unit ? ` (${f.unit})` : ''}.</span> {f.help ?? ''}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">The method</h2>
            {sample.references.length > 0 ? (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">{sample.references.map((r) => <li key={r}>{r}</li>)}</ul>
            ) : (
              <p className="mt-3 text-slate-300">The method is shown with every answer.</p>
            )}
            <p className="mt-4 text-sm text-slate-500">Check results against the code and manufacturer data that apply to your job. Prices are dated baselines to confirm with a supplier.</p>
          </div>
        </section>

        <section className="mt-14 flex flex-col items-start gap-4 rounded-2xl border border-amber-500/40 bg-slate-900 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xl font-bold text-white">Add this to a real estimate in TradeQuote PRO</p>
            <p className="mt-1 text-slate-400">The takeoff lands as estimate lines with your prices, markup and tax, then becomes a proposal the client signs.</p>
          </div>
          <Link href="/signup" className={`${BTN_PRIMARY} shrink-0`}>Start free trial <ArrowRight className="h-4 w-4" aria-hidden /></Link>
        </section>

        {related.length > 0 && (
          <section className="mt-14">
            <h2 className="text-2xl font-bold text-white">More {TRADE_LABEL[calc.trade].toLowerCase()} calculators</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((r) => (
                <li key={r.id}>
                  <Link href={`/tools/${r.id}`} className="flex h-full min-h-[48px] flex-col rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-amber-500/60 lg:min-h-0">
                    <span className="font-semibold text-white">{r.name}</span>
                    <span className="mt-1 text-sm text-slate-400">{r.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
