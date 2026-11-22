// Small product pictures for the landing page. They are drawn from the real engine (the same
// buildQuote the quote builder uses), so a figure here is a figure the product would show.
// Where a picture needs numbers the engine cannot know (progress to date), it says "sample".
import { Check, FileSignature, ShieldCheck } from 'lucide-react';
import { COSTBOOK_AS_OF, getRegion, salesTax } from '@/lib/costbook';
import { buildQuote } from './quote-math';
import { money, money0 } from './ui';

const card = 'rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5 shadow-xl shadow-black/30';
const tag = 'rounded-md bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300';

/** Slow quoting: the same job priced in several regions, instantly. */
export function RegionCompare() {
  const regions = ['ON', 'AB', 'BC', 'QC'].map((c) => getRegion(c)).filter((r, i, a) => a.findIndex((x) => x.code === r.code) === i);
  const rows = regions.map((r) => ({ r, q: buildQuote({ templateId: 'pot-light-retrofit', region: r.code, markupPct: 20 }) }));
  const max = Math.max(...rows.map((x) => x.q.totals.total), 1);
  return (
    <div className={card}>
      <p className="text-sm font-semibold text-white">Pot-light retrofit, 10 lights</p>
      <p className="text-xs text-slate-400">The same job, priced for each region with its own tax and labour rate.</p>
      <ul className="mt-4 space-y-3">
        {rows.map(({ r, q }) => (
          <li key={r.code}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-slate-200">{r.name} <span className="text-xs text-slate-500">tax {q.taxPct}%</span></span>
              <span className="font-semibold tabular-nums text-white">{money0(q.totals.total)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-800">
              <div className="h-2 rounded-full bg-amber-500" style={{ width: `${Math.max(4, (q.totals.total / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Missed items: the small parts a calculator lists and a hand-built takeoff forgets. */
export function MissedItems() {
  const q = buildQuote({ templateId: 'service-200a', region: 'ON', markupPct: 15 });
  const small = q.priced.filter((l) => l.unit === 'ea' && l.quantity >= 2).slice(0, 5);
  return (
    <div className={card}>
      <p className="text-sm font-semibold text-white">200 A service upgrade</p>
      <p className="text-xs text-slate-400">What you wrote down is the panel and the meter. The takeoff also lists:</p>
      <ul className="mt-3 divide-y divide-slate-800">
        {small.map((l) => (
          <li key={l.code ?? l.description} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-slate-200">
              <Check className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
              <span className="truncate">{l.description}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-400">{l.quantity} {l.unit}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">Priced from the cost book, {COSTBOOK_AS_OF} baseline.</p>
    </div>
  );
}

/** Unsigned proposals and change orders: a proposal with its signature and an approved change order. */
export function ProposalSigned() {
  const base = buildQuote({ templateId: 'ev-charger', region: 'ON', markupPct: 20 });
  const extra = buildQuote({ templateId: 'ev-charger', region: 'ON', markupPct: 20, size: 6 });
  return (
    <div className="relative rounded-2xl border border-slate-300 bg-slate-50 p-4 sm:p-5 text-slate-800 shadow-xl shadow-black/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">Proposal for Sample Client</p>
          <p className="text-base font-bold text-slate-900">EV charger install</p>
        </div>
        <p className="text-xl font-extrabold tabular-nums text-slate-900">{money0(base.totals.total)}</p>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-300 pt-3">
        <div>
          <p className="font-[cursive] text-xl text-slate-700">Sample Client</p>
          <p className="text-[11px] text-slate-500">Signed on the client&apos;s phone</p>
        </div>
        <span className="tq-stamp inline-flex items-center gap-1 rounded-md border-2 border-emerald-600 px-2 py-1 text-xs font-extrabold text-emerald-700 -rotate-[8deg]">
          <FileSignature className="h-3.5 w-3.5" aria-hidden /> SIGNED
        </span>
      </div>
      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
        <p className="font-semibold text-amber-900">Change order 1: second charger circuit</p>
        <p className="text-amber-800 tabular-nums">Adds {money0(extra.totals.total)}. Approved by the client, contract updated.</p>
      </div>
    </div>
  );
}

/** Cash tied up in holdbacks: a progress billing schedule where the holdback is shown, not lost. */
export function HoldbackLedger() {
  const q = buildQuote({ templateId: 'basement-finish', region: 'ON', markupPct: 18 });
  const total = q.totals.beforeTax;
  const rate = salesTax(q.province).total;
  const draws = [
    { name: 'Draw 1, framing and rough-in', pct: 40 },
    { name: 'Draw 2, drywall and finish', pct: 40 },
    { name: 'Final draw', pct: 20 },
  ];
  return (
    <div className={card}>
      <p className="text-sm font-semibold text-white">Basement finish, progress billing</p>
      <p className="text-xs text-slate-400">Sample schedule on this quote with 10% holdback. Set your own.</p>
      <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-sm">
        <span className="text-xs font-semibold text-slate-500">Draw</span>
        <span className="text-right text-xs font-semibold text-slate-500">Holdback</span>
        <span className="text-right text-xs font-semibold text-slate-500">Due with tax</span>
        {draws.map((d) => {
          const gross = (total * d.pct) / 100;
          const hold = gross * 0.1;
          return (
            <div key={d.name} className="contents">
              <span className="text-slate-200">{d.name}</span>
              <span className="text-right tabular-nums text-amber-300">{money0(hold)}</span>
              <span className="text-right tabular-nums text-white">{money0((gross - hold) * (1 + rate / 100))}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">Holdback you are owed stays on the books until it is released, so it is never forgotten.</p>
    </div>
  );
}

/** Not knowing if a job makes money: budget against actual while the job runs. Percentages only. */
export function MarginBars() {
  const rows = [
    { label: 'Materials', budget: 100, actual: 58, hot: false },
    { label: 'Labour hours', budget: 100, actual: 74, hot: true },
    { label: 'Subs and rentals', budget: 100, actual: 31, hot: false },
  ];
  return (
    <div className={card}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Job costing, 60% complete</p>
        <span className={tag}>Sample job</span>
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex justify-between text-sm">
              <span className="text-slate-200">{r.label}</span>
              <span className={`tabular-nums ${r.hot ? 'font-semibold text-amber-300' : 'text-slate-400'}`}>{r.actual}% of budget spent</span>
            </div>
            <div className="relative mt-1 h-2.5 rounded-full bg-slate-800">
              <div className={`h-2.5 rounded-full ${r.hot ? 'bg-amber-500' : 'bg-slate-500'}`} style={{ width: `${r.actual}%` }} />
              <div className="absolute -top-1 h-5 w-px bg-white/70" style={{ left: '60%' }} aria-hidden />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-400">The white mark is how far along the job is. Labour is running ahead of it, so you see it while there is still time to act, not at the final invoice.</p>
    </div>
  );
}

/** Paperwork and safety: records with their sign-offs. */
export function RecordList() {
  const rows = [
    ['LOTO permit', 'Isolation verified, 3 of 3 signed'],
    ['Tailgate meeting', 'Crew of 6 acknowledged'],
    ['Daily log with photos', 'Foreman signed'],
    ['Sub WCB clearance', 'Expires in 21 days, flagged'],
  ];
  return (
    <div className={card}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Field and safety records</p>
        <span className={tag}>Sample</span>
      </div>
      <ul className="mt-3 divide-y divide-slate-800">
        {rows.map(([a, b], i) => (
          <li key={a} className="flex items-center gap-3 py-2.5 text-sm">
            <ShieldCheck className={`h-4 w-4 shrink-0 ${i === 3 ? 'text-amber-400' : 'text-emerald-400'}`} aria-hidden />
            <span className="text-slate-100">{a}</span>
            <span className="ml-auto text-right text-xs text-slate-400">{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Too many disconnected tools: one record that carries the job from estimate to job cost. */
export function OneRecord() {
  const chain = ['Estimate', 'Proposal', 'Job', 'Change orders', 'Invoices', 'Job cost'];
  return (
    <div className={card}>
      <p className="text-sm font-semibold text-white">One record from first price to final margin</p>
      <ol className="mt-4 flex flex-wrap items-center gap-y-2 text-sm font-semibold">
        {chain.map((c, i) => (
          <li key={c} className="flex items-center">
            <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-amber-200">{c}</span>
            {i < chain.length - 1 && <span aria-hidden className="mx-1.5 h-px w-4 bg-amber-500/60" />}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-slate-400">Instead of</p>
      <ul className="mt-1.5 flex flex-wrap gap-2 text-xs text-slate-500">
        {['a spreadsheet', 'a PDF template', 'paper timecards', 'a texts-and-photos thread', 'a separate invoicing app'].map((x) => (
          <li key={x} className="rounded-md border border-slate-800 px-2 py-1 line-through decoration-slate-600">{x}</li>
        ))}
      </ul>
    </div>
  );
}
