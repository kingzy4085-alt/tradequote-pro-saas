'use client';

// The live quote builder on the landing page: pick a job, a region, a labour rate and a markup, and the
// estimate updates as you type. Every figure comes from buildQuote, which uses the real cost engine.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, BatteryCharging, Home, Lightbulb, PlugZap, Hammer, LayoutGrid } from 'lucide-react';
import { COSTBOOK_AS_OF, REGIONS } from '@/lib/costbook';
import { JOB_TEMPLATES, getTemplate, type JobTemplate } from './job-templates';
import { buildQuote } from './quote-math';
import { BTN_PRIMARY, money } from './ui';

export const TEMPLATE_ICONS: Record<JobTemplate['icon'], typeof PlugZap> = {
  plug: PlugZap,
  battery: BatteryCharging,
  home: Home,
  bulb: Lightbulb,
  panel: LayoutGrid,
  roof: Hammer,
};

const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 min-h-[48px] lg:min-h-0';
const lab = 'block text-xs font-semibold text-slate-400 mb-1';

export default function QuoteBuilder({ initialTemplate = JOB_TEMPLATES[0].id, compact = false }: { initialTemplate?: string; compact?: boolean }) {
  const [templateId, setTemplateId] = useState(initialTemplate);
  const template = getTemplate(templateId);
  const [region, setRegion] = useState(template.defaultRegion);
  const [markup, setMarkup] = useState(template.defaultMarkup);
  const [size, setSize] = useState(template.scale.default);
  const [rate, setRate] = useState<number | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [showAll, setShowAll] = useState(false);

  const quote = useMemo(
    () => buildQuote({ templateId, region, markupPct: markup, size, labourRate: rate ?? undefined, qty }),
    [templateId, region, markup, size, rate, qty]
  );
  const t = quote.totals;
  const rows = showAll ? quote.rows : quote.rows.slice(0, compact ? 5 : 6);
  const calcName = quote.parts.find((p) => p.calcName)?.calcName;

  function pick(id: string) {
    const next = getTemplate(id);
    setTemplateId(id);
    setMarkup(next.defaultMarkup);
    setSize(next.scale.default);
    setRate(null);
    setQty({});
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/40 overflow-hidden" data-testid="quote-builder">
      <div className="tq-hazard h-1.5" aria-hidden />
      <div className="p-4 sm:p-5">
        <p className="text-sm font-semibold text-white">Build a quote. Change anything.</p>
        <div role="radiogroup" aria-label="Job" className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {JOB_TEMPLATES.map((j) => {
            const Icon = TEMPLATE_ICONS[j.icon];
            const on = j.id === templateId;
            return (
              <button
                key={j.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(j.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs sm:text-sm font-semibold min-h-[48px] lg:min-h-0 transition-colors ${on ? 'border-amber-500 bg-amber-500/10 text-amber-200' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="leading-tight">{j.name}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div className="col-span-2 sm:col-span-3">
            <label className={lab} htmlFor="qb-size">
              {template.scale.label}: <span className="text-amber-300">{size} {template.scale.unit}</span>
            </label>
            <input id="qb-size" type="range" className="tq-range" min={template.scale.min} max={template.scale.max} step={template.scale.step} value={size} onChange={(e) => { setSize(Number(e.target.value)); setQty({}); }} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={lab} htmlFor="qb-region">Region</label>
            <select id="qb-region" className={field} value={region} onChange={(e) => { setRegion(e.target.value); setRate(null); }}>
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={lab} htmlFor="qb-rate">Labour $/h</label>
            <input id="qb-rate" className={field} inputMode="decimal" type="number" min={0} step={1} value={rate ?? quote.suggestedRate} onChange={(e) => setRate(e.target.value === '' ? 0 : Number(e.target.value))} />
          </div>
          <div>
            <label className={lab} htmlFor="qb-markup">Markup %</label>
            <input id="qb-markup" className={field} inputMode="decimal" type="number" min={0} max={100} step={1} value={markup} onChange={(e) => setMarkup(e.target.value === '' ? 0 : Number(e.target.value))} />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800 text-xs text-slate-400">
            <span>{calcName ? `Sized by the ${calcName}` : 'Typical scope. Edit any quantity.'}</span>
            <span>{quote.rows.length} lines</span>
          </div>
          <ul className="divide-y divide-slate-800/70" data-testid="qb-lines">
            {rows.map(({ line: l, sell }, i) => (
              <li key={`${l.code}-${i}`} className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-3 py-1.5 text-sm">
                <span className="min-w-0 truncate text-slate-200">{l.description}</span>
                <span className="flex items-center gap-2 justify-self-end">
                  <input
                    aria-label={`Quantity: ${l.description}`}
                    type="number"
                    min={0}
                    value={l.quantity}
                    onChange={(e) => setQty({ ...qty, [i]: e.target.value === '' ? 0 : Number(e.target.value) })}
                    className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-right text-xs text-white min-h-[48px] lg:min-h-0"
                  />
                  <span className="w-8 text-xs text-slate-500">{l.unit}</span>
                  <span className="w-20 text-right font-medium tabular-nums text-slate-100">{money(sell)}</span>
                </span>
              </li>
            ))}
          </ul>
          {quote.rows.length > rows.length && (
            <button type="button" onClick={() => setShowAll(true)} className="w-full border-t border-slate-800 px-3 py-2 text-xs font-semibold text-amber-300 hover:text-amber-200 min-h-[48px] lg:min-h-0">
              Show the other {quote.rows.length - rows.length} lines
            </button>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm" data-testid="qb-totals">
          <dt className="text-slate-400">Materials</dt>
          <dd className="text-right tabular-nums text-slate-200">{money(t.material)}</dd>
          <dt className="text-slate-400">Labour, {t.labourHours} h at {money(quote.labourRate)}</dt>
          <dd className="text-right tabular-nums text-slate-200">{money(t.labour)}</dd>
          <dt className="text-slate-400">Markup {quote.markupPct}%</dt>
          <dd className="text-right tabular-nums text-slate-200">{money(t.markup)}</dd>
          <dt className="text-slate-400">Tax {quote.taxPct}% ({quote.province})</dt>
          <dd className="text-right tabular-nums text-slate-200">{money(t.tax)}</dd>
        </dl>
        <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-700 pt-3">
          <span className="text-sm font-semibold text-slate-300">Total to the client</span>
          <span key={Math.round(t.total * 100)} className="tq-flash text-3xl sm:text-4xl font-extrabold tabular-nums text-amber-400" data-testid="qb-total">
            {money(t.total)}
          </span>
        </div>
        {quote.unpriced && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">Reference prices for this job are not loaded yet, so the figures read zero until they are. Quantities and the rate still work.</p>}
        {quote.taxNote && <p className="mt-2 text-xs text-slate-500">{quote.taxNote}</p>}
        <p className="mt-3 text-xs text-slate-500">Reference prices are dated baselines ({COSTBOOK_AS_OF}) for {quote.regionName}. Confirm with your supplier before you send it.</p>
        <Link href="/signup" className={`${BTN_PRIMARY} mt-4 w-full`}>
          Build this quote in TradeQuote PRO <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
