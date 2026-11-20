import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SiteFooter, SiteShell } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { pageMeta } from '@/components/marketing/seo';
import type { ToolCard } from '@/components/marketing/tool-labels';
import { BTN_PRIMARY, H, WRAP } from '@/components/marketing/ui';
import { CALCULATORS } from '@/lib/calc/registry';
import ToolsIndex from './tools-index';

export const metadata = pageMeta({
  title: 'Free trade calculators for Canadian contractors',
  description: `${CALCULATORS.length} free calculators for electrical, plumbing, HVAC, framing, drywall, concrete and roofing work. Get quantities, a method and a priced takeoff by region. No signup.`,
  path: '/tools',
});

export default function ToolsPage() {
  const tools: ToolCard[] = CALCULATORS.map((c) => ({ id: c.id, name: c.name, trade: c.trade, category: c.category, summary: c.summary, keywords: c.keywords ?? [] }));
  return (
    <SiteShell>
      <SiteHeader />
      <main className={`${WRAP} py-12 sm:py-16`}>
        <h1 className={`${H} max-w-3xl text-5xl text-white sm:text-7xl`}>Free calculators for the work you actually price.</h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-300">Enter the job, get the quantities and the method, then price the takeoff for your region. No account, nothing saved.</p>
        <div className="mt-10">
          <ToolsIndex tools={tools} />
        </div>
        <div className="mt-16 flex flex-col items-start gap-4 rounded-2xl border border-amber-500/40 bg-slate-900 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xl font-bold text-white">Use them inside a real estimate</p>
            <p className="mt-1 text-slate-400">In TradeQuote PRO every calculator adds its takeoff to the estimate with your own prices and markup.</p>
          </div>
          <Link href="/signup" className={`${BTN_PRIMARY} shrink-0`}>Start free trial <ArrowRight className="h-4 w-4" aria-hidden /></Link>
        </div>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
