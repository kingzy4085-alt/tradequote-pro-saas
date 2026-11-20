import Link from 'next/link';
import { ArrowRight, Bot, Calculator, ClipboardCheck, FileSignature, HardHat, MapPin, Play, TrendingUp } from 'lucide-react';
import QuoteBuilder from '@/components/marketing/quote-builder';
import { HoldbackLedger, MarginBars, MissedItems, OneRecord, ProposalSigned, RecordList, RegionCompare } from '@/components/marketing/product-visuals';
import { SiteFooter, SiteShell } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { pageMeta } from '@/components/marketing/seo';
import { BTN_GHOST, BTN_PRIMARY, H, WRAP } from '@/components/marketing/ui';
import { CALCULATORS } from '@/lib/calc/registry';
import { CATALOG, COSTBOOK_AS_OF, REGIONS } from '@/lib/costbook';
import { FOUNDING_OFFER, PLAN_FEATURES, PLAN_NAME, foundingPriceLabel, planPriceLabel } from '@/lib/plan';

export const metadata = pageMeta({
  title: 'TradeQuote PRO: quotes that win, billing that pays, jobs you can measure',
  description: 'Estimating, signed proposals, change orders, progress billing with holdback and job costing for Canadian electrical, industrial and general contractors. Try the live demo, no signup.',
  path: '/',
});

const PAINS: { title: string; problem: string; fix: string; visual: React.ReactNode }[] = [
  {
    title: 'Quoting takes your evenings',
    problem: 'Every estimate starts from a blank sheet, a supplier flyer and a guess at the labour. By the time the number is ready, the client has called someone else.',
    fix: 'Pick the job, set the size, and get a priced estimate with regional material costs, a labour rate for your trade and province, your markup and the right tax. Change any line and the total follows.',
    visual: <RegionCompare />,
  },
  {
    title: 'The small parts eat your margin',
    problem: 'The panel and the meter are on the list. The connectors, the ground rods and the twelve breakers are not, and you eat them.',
    fix: 'Trade calculators build the whole takeoff, small parts included. Every price is a dated baseline, and your own supplier price always wins over it once you save it.',
    visual: <MissedItems />,
  },
  {
    title: 'Approved by text is not approved',
    problem: 'The client said yes in a message, then the scope grew, and nobody can show what was agreed or what the extra cost.',
    fix: 'The proposal comes from the same record as the estimate and the client signs it on their phone. Change orders are priced, signed the same way, and update the contract total.',
    visual: <ProposalSigned />,
  },
  {
    title: 'Your cash sits in holdbacks and late invoices',
    problem: 'Progress draws, holdback and tax are worked out by hand, and the invoice that is thirty days late is the one nobody remembers.',
    fix: 'Progress billing works out the draw, the holdback and the tax for you, and receivables flag overdue invoices every day, in the app and by email.',
    visual: <HoldbackLedger />,
  },
  {
    title: 'You learn if a job paid after it is over',
    problem: 'Timecards are on paper, supplier invoices are in a drawer, and the real margin shows up months later.',
    fix: 'Every job carries its budget from the estimate. Approved timecards and costs land against it as the work happens, so a drifting job shows while you can still fix it.',
    visual: <MarginBars />,
  },
  {
    title: 'Safety paperwork is a second job',
    problem: 'LOTO permits, tailgate meetings and inspections live in binders, and a sub’s insurance runs out without anyone noticing.',
    fix: 'Field and safety records are done on a phone with big buttons, signed off in order, and expiring insurance and WCB clearances are flagged before they lapse.',
    visual: <RecordList />,
  },
  {
    title: 'Five tools that do not talk to each other',
    problem: 'The estimate is in a spreadsheet, the proposal is a PDF, the hours are on paper and the invoice is in another app. Every handoff is a re-type.',
    fix: 'One record runs from the first price to the final margin. You enter things once, and each stage starts from the one before it.',
    visual: <OneRecord />,
  },
];

const ENGINES = [
  { icon: MapPin, title: 'Cost intelligence', text: `A cost book of ${CATALOG.length} priced items, adjusted for ${REGIONS.length} regions, with provincial tax and a burdened labour rate. Baselines are dated ${COSTBOOK_AS_OF}. Save your own price and it replaces ours.`, href: '/demo', cta: 'See it price a job' },
  { icon: Calculator, title: 'Trade calculators', text: `${CALCULATORS.length} calculators that return a quantity, a method and a takeoff you can price. They are free to use, no signup.`, href: '/tools', cta: 'Open the calculators' },
  { icon: Bot, title: 'AI estimator', text: 'Describe the job in your own words and get a draft takeoff built on the same calculators and cost book. You review and edit every line before anything goes to a client.', href: null, cta: '' },
  { icon: FileSignature, title: 'Proposals with e-signature', text: 'A clean, printable proposal from the estimate, a link the client opens on a phone, and a signature that is stored with the record.', href: '/demo?autoplay=1', cta: 'Watch a proposal get signed' },
  { icon: TrendingUp, title: 'Job costing', text: 'Budget, actual cost and margin on every job, fed by approved timecards and costs, with change orders folded into the contract.', href: null, cta: '' },
  { icon: HardHat, title: 'Field and safety', text: 'Timecards with foreman approval, daily logs with photos, LOTO permits, tailgate meetings and inspections with ordered sign-offs.', href: null, cta: '' },
];

const STEPS = [
  { title: 'Pick or describe the job', text: 'Start from a job template, a calculator or a plain-English description. Choose the region and the size.' },
  { title: 'Check the priced estimate', text: 'Materials, labour, markup and tax are worked out. Edit what you know better than the book does.' },
  { title: 'Send it, sign it, bill it', text: 'The client signs on their phone. Change orders, progress draws and holdback follow on the same record.' },
];

const FAQ = [
  ['Is the live demo really free?', 'Yes. The demo and the calculators need no account. Nothing you enter is saved or sent anywhere.'],
  ['Where do the prices come from?', `Reference prices are dated baselines (cost book ${COSTBOOK_AS_OF}) checked against public retailer and guide prices, adjusted by region. They are a starting point. Confirm them with your supplier, and save your own price to override ours.`],
  ['Does it handle Canadian tax and holdback?', 'Tax follows the province: GST, HST, PST and QST are set by region. In BC, Saskatchewan and Manitoba the client is charged GST while PST on installed materials sits in your cost. Progress billing carries holdback on every draw.'],
  ['Who is it for?', 'Electrical and industrial contractors first, and general trades such as drywall, roofing and carpentry. It is built around Canadian work, codes and paperwork.'],
  ['How many people can use it?', 'The price is for your company, not per person. Invite your crew and give each person a role.'],
  ['What happens after the trial?', 'Every account starts with a 14-day free trial and no credit card. If you do not subscribe, your records stay readable.'],
];

export default function WelcomePage() {
  return (
    <SiteShell>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-slate-800">
          <div className="tq-grid-bg absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
          <div className={`${WRAP} relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[1fr_minmax(0,34rem)] lg:gap-14 lg:py-20`}>
            <div className="tq-rise lg:self-start lg:pt-6">
              {FOUNDING_OFFER.enabled && (
                <Link href="/pricing#join" className="mb-5 inline-flex min-h-[48px] items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/15 lg:min-h-0">
                  Founding offer: {FOUNDING_OFFER.percentOff}% off for the first {FOUNDING_OFFER.spots} companies
                </Link>
              )}
              <h1 className={`${H} text-[3.1rem] text-white sm:text-7xl lg:text-[4.6rem]`}>
                Quote it once. Win it, bill it, and know it paid.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
                Estimating and job management for Canadian electrical, industrial and general contractors. Price from regional costs, send a proposal your client signs on a phone, bill with holdback, and watch the margin while the job is still running.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href="/signup" className={`${BTN_PRIMARY} text-base`}>
                  Start free trial <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/demo" className={`${BTN_GHOST} text-base`}>
                  <Play className="h-4 w-4 text-amber-400" aria-hidden /> Try the live demo
                </Link>
              </div>
              <p className="mt-4 text-sm text-slate-400">14-day free trial, no credit card. The demo needs no signup either.</p>
            </div>
            <div className="tq-rise tq-rise-2 min-w-0">
              <QuoteBuilder compact />
            </div>
          </div>
        </section>

        {/* Trades */}
        <section className="border-b border-slate-800 bg-slate-900/40">
          <div className={`${WRAP} flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between`}>
            <p className="text-sm font-semibold text-slate-200">Electrical and industrial first. General trades too.</p>
            <ul className="flex flex-wrap gap-2 text-sm text-slate-400">
              {['Electrical', 'Industrial shutdowns', 'Plumbing', 'HVAC', 'Carpentry', 'Drywall', 'Roofing'].map((t) => (
                <li key={t} className="rounded-full border border-slate-700 px-3 py-1">{t}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pains and fixes */}
        <section className={`${WRAP} py-16 sm:py-24`}>
          <h2 className={`${H} max-w-3xl text-4xl text-white sm:text-6xl`}>Seven places a good job quietly loses money.</h2>
          <p className="mt-5 max-w-2xl text-lg text-slate-400">Each one has a fix in the product. The pictures are drawn from the same engine you get in the trial.</p>
          <div className="mt-14 space-y-16 sm:space-y-24">
            {PAINS.map((p, i) => (
              <article key={p.title} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
                <div className={i % 2 ? 'lg:order-2' : ''}>
                  <h3 className={`${H} text-3xl text-white sm:text-4xl`}>{p.title}</h3>
                  <p className="mt-4 text-slate-400">{p.problem}</p>
                  <p className="mt-4 border-l-2 border-amber-500 pl-4 text-slate-100">{p.fix}</p>
                </div>
                <div className={`min-w-0 ${i % 2 ? 'lg:order-1' : ''}`}>{p.visual}</div>
              </article>
            ))}
          </div>
        </section>

        {/* Engines */}
        <section id="engines" className="scroll-mt-20 border-y border-slate-800 bg-slate-900/40">
          <div className={`${WRAP} py-16 sm:py-24`}>
            <h2 className={`${H} max-w-3xl text-4xl text-white sm:text-6xl`}>Six engines behind one quote.</h2>
            <div className="mt-12 grid gap-x-14 gap-y-0 lg:grid-cols-2">
              {ENGINES.map((e) => (
                <div key={e.title} className="flex gap-4 border-t border-slate-800 py-7">
                  <e.icon className="mt-1 h-6 w-6 shrink-0 text-amber-400" aria-hidden />
                  <div>
                    <h3 className="text-xl font-bold text-white">{e.title}</h3>
                    <p className="mt-2 text-slate-400">{e.text}</p>
                    {e.href && (
                      <Link href={e.href} className="mt-3 inline-flex min-h-[48px] items-center gap-1 text-sm font-semibold text-amber-300 hover:text-amber-200 lg:min-h-0">
                        {e.cta} <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className={`${WRAP} py-16 sm:py-24`}>
          <h2 className={`${H} text-4xl text-white sm:text-6xl`}>From the first call to the final invoice in three moves.</h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative border-t-2 border-amber-500 pt-5">
                <span className={`${H} text-5xl text-amber-400`}>{i + 1}</span>
                <h3 className="mt-3 text-xl font-bold text-white">{s.title}</h3>
                <p className="mt-2 text-slate-400">{s.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href="/demo?autoplay=1" className={BTN_GHOST}>
              <Play className="h-4 w-4 text-amber-400" aria-hidden /> Watch the 30-second walkthrough
            </Link>
            <Link href="/demo" className={BTN_GHOST}>
              <ClipboardCheck className="h-4 w-4 text-amber-400" aria-hidden /> Walk through it yourself
            </Link>
          </div>
        </section>

        {/* Pricing */}
        <section className="border-y border-slate-800 bg-slate-900/40">
          <div className={`${WRAP} grid gap-10 py-16 sm:py-24 lg:grid-cols-[1fr_minmax(0,30rem)]`}>
            <div>
              <h2 className={`${H} text-4xl text-white sm:text-6xl`}>One plan. Every module. Your whole crew.</h2>
              <p className="mt-5 max-w-xl text-lg text-slate-400">A flat monthly price in Canadian dollars for the company, not per person. Start with 14 days free and no credit card.</p>
              <ul className="mt-6 grid gap-2 text-slate-300 sm:grid-cols-2">
                {PLAN_FEATURES.slice(0, 8).map((f) => (
                  <li key={f} className="flex gap-2 text-sm"><span className="text-amber-400" aria-hidden>&#10003;</span>{f}</li>
                ))}
              </ul>
            </div>
            <div className="self-start rounded-2xl border border-amber-500 bg-slate-900 p-6 shadow-2xl shadow-black/40 sm:p-8">
              <p className="text-lg font-bold text-white">{PLAN_NAME}</p>
              <p className="mt-3 text-5xl font-extrabold text-white">{planPriceLabel()}</p>
              <p className="mt-1 text-sm text-slate-400">CAD / month, plus applicable tax</p>
              {FOUNDING_OFFER.enabled && (
                <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  Founding offer: {foundingPriceLabel()} a month for as long as you stay subscribed. {FOUNDING_OFFER.spots} spots.
                </p>
              )}
              <Link href="/signup" className={`${BTN_PRIMARY} mt-6 w-full`}>Start free trial</Link>
              <Link href="/pricing" className={`${BTN_GHOST} mt-3 w-full`}>See what is included</Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className={`${WRAP} py-16 sm:py-24`}>
          <h2 className={`${H} text-4xl text-white sm:text-5xl`}>Questions contractors ask first</h2>
          <div className="mt-10 max-w-3xl divide-y divide-slate-800 border-y border-slate-800">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-1">
                <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-white lg:min-h-0 [&::-webkit-details-marker]:hidden">
                  {q}
                  <span aria-hidden className="text-amber-400 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="pb-4 text-slate-400">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden border-t border-slate-800">
          <div className="tq-hazard absolute inset-x-0 top-0 h-1.5" aria-hidden />
          <div className={`${WRAP} py-20 text-center sm:py-28`}>
            <h2 className={`${H} mx-auto max-w-3xl text-4xl text-white sm:text-6xl`}>Your next quote can be the first one you build here.</h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-slate-400">Start the trial today, or run the demo first. Either way, you see a priced estimate before you sign up for anything.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/signup" className={`${BTN_PRIMARY} text-base`}>Start free trial <ArrowRight className="h-4 w-4" aria-hidden /></Link>
              <Link href="/demo" className={`${BTN_GHOST} text-base`}>Try the live demo</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
