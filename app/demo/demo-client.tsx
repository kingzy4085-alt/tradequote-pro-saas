'use client';

// The guided demo. Manual mode lets a visitor click through and edit; /demo?autoplay=1 plays the same
// six steps by itself in about 26 seconds for screen recording, with big captions and a cursor.
// Every figure is buildQuote, which is the real cost engine and estimateTotals.
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, MousePointer2, Play, RotateCcw } from 'lucide-react';
import { TEMPLATE_ICONS } from '@/components/marketing/quote-builder';
import { JOB_TEMPLATES, getTemplate } from '@/components/marketing/job-templates';
import { buildQuote } from '@/components/marketing/quote-math';
import { Logo } from '@/components/marketing/site-header';
import { BTN_GHOST, BTN_PRIMARY, H, money } from '@/components/marketing/ui';
import { COSTBOOK_AS_OF, REGIONS, labourCost } from '@/lib/costbook';
import { estimateTotals } from '@/lib/estimate-math';

declare global {
  interface Window {
    __demoDone?: boolean;
  }
}

const STEPS = [
  { id: 'job', title: 'Choose the job', caption: 'Pick the job you are quoting.' },
  { id: 'size', title: 'Calculators size it', caption: 'Calculators size the work, small parts included.' },
  { id: 'price', title: 'Regional prices and labour', caption: 'Regional prices and your labour rate are applied.' },
  { id: 'estimate', title: 'Priced estimate', caption: 'Markup and tax are worked out. Edit anything.' },
  { id: 'proposal', title: 'Client proposal', caption: 'The client reads it and signs on their phone.' },
  { id: 'next', title: 'What happens next', caption: 'Change orders, invoices and job costing follow on the same record.' },
] as const;

/** When each step starts in autoplay, and when the closing card appears, in ms. Total about 26 s. */
const SCENE_START = [0, 3200, 7000, 10400, 14600, 18800];
const CTA_AT = 22000;
const DONE_AT = 26000;
const CTA = STEPS.length;

const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:outline-none focus:border-amber-500 min-h-[48px] lg:min-h-0';
const panel = 'rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-5';

interface Target {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function DemoClient() {
  const params = useSearchParams();
  const autoplay = params.get('autoplay') === '1';

  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState(JOB_TEMPLATES[0].id);
  const template = getTemplate(templateId);
  const [region, setRegion] = useState(template.defaultRegion);
  const [markup, setMarkup] = useState(template.defaultMarkup);
  const [size, setSize] = useState(template.scale.default);
  const [rate, setRate] = useState<number | null>(null);
  const [signName, setSignName] = useState('');
  const [signed, setSigned] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [clicking, setClicking] = useState(0);
  const [done, setDone] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const quote = useMemo(() => buildQuote({ templateId, region, markupPct: markup, size, labourRate: rate ?? undefined }), [templateId, region, markup, size, rate]);
  const t = quote.totals;

  const pick = useCallback((id: string) => {
    const next = getTemplate(id);
    setTemplateId(id);
    setRegion(next.defaultRegion);
    setMarkup(next.defaultMarkup);
    setSize(next.scale.default);
    setRate(null);
  }, []);

  const restart = useCallback(() => {
    pick(JOB_TEMPLATES[0].id);
    setSigned(false);
    setSignName('');
    setStep(0);
  }, [pick]);

  // Autoplay: one timeline, started once, cleared on unmount.
  useEffect(() => {
    if (!autoplay) return;
    window.__demoDone = false;
    const html = document.documentElement;
    const before = html.style.fontSize;
    // Scale everything with the shorter side so 1280x720 and 1080x1920 both fill the frame
    html.style.fontSize = window.innerHeight > window.innerWidth ? 'clamp(14px, 3vmin, 40px)' : 'clamp(14px, 2.5vmin, 34px)';
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const move = (selector: string, click = false) => {
      const el = document.querySelector<HTMLElement>(selector);
      const host = root.current;
      if (!el || !host) return;
      const a = el.getBoundingClientRect();
      const b = host.getBoundingClientRect();
      setTarget({ x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height });
      if (click) setClicking((c) => c + 1);
    };
    const abroad = REGIONS.find((r) => r.code === 'AB') ?? REGIONS[Math.min(1, REGIONS.length - 1)];
    const t0 = 900; // let the larger type settle before anything moves
    const go = (ms: number, fn: () => void) => at(t0 + ms, fn);

    at(t0, () => setStep(0));
    go(900, () => move('[data-cur="job-ev-charger"]'));
    go(1500, () => move('[data-cur="job-ev-charger"]', true));
    go(1700, () => pick('ev-charger'));

    SCENE_START.slice(1).forEach((ms, i) => go(ms, () => setStep(i + 1)));
    const ev = getTemplate('ev-charger').scale;
    go(SCENE_START[1] + 600, () => move('[data-cur="size"]'));
    [0.4, 0.65, 0.9].forEach((f, i) => go(SCENE_START[1] + 1100 + i * 450, () => setSize(Math.round(ev.min + (ev.max - ev.min) * f))));
    go(SCENE_START[2] + 600, () => move('[data-cur="region"]'));
    go(SCENE_START[2] + 1200, () => { move('[data-cur="region"]', true); setRegion(abroad.code); });
    go(SCENE_START[2] + 2300, () => move('[data-cur="rate"]'));
    go(SCENE_START[3] + 600, () => move('[data-cur="markup"]'));
    go(SCENE_START[3] + 1200, () => setMarkup(25));
    go(SCENE_START[3] + 1800, () => setMarkup(30));
    go(SCENE_START[3] + 2600, () => move('[data-cur="total"]'));
    go(SCENE_START[4] + 600, () => move('[data-cur="sign-name"]', true));
    'Sample Client'.split('').forEach((_, i, all) => go(SCENE_START[4] + 1000 + i * 90, () => setSignName(all.slice(0, i + 1).join(''))));
    go(SCENE_START[4] + 2500, () => move('[data-cur="sign-btn"]'));
    go(SCENE_START[4] + 3000, () => { move('[data-cur="sign-btn"]', true); setSigned(true); });
    go(SCENE_START[5] + 500, () => move('[data-cur="next-0"]'));
    go(SCENE_START[5] + 1400, () => move('[data-cur="next-1"]'));
    go(SCENE_START[5] + 2300, () => move('[data-cur="next-2"]'));
    go(CTA_AT, () => { setTarget(null); setStep(CTA); });
    go(DONE_AT, () => { setDone(true); window.__demoDone = true; });

    return () => {
      timers.forEach(clearTimeout);
      html.style.fontSize = before;
    };
  }, [autoplay, pick]);

  const current = STEPS[Math.min(step, STEPS.length - 1)];

  return (
    <div
      ref={root}
      data-testid="demo"
      data-autoplay={autoplay ? '1' : '0'}
      data-step={step}
      data-step-id={step >= CTA ? 'cta' : current.id}
      data-done={done ? '1' : '0'}
      className={`relative flex flex-col bg-slate-950 ${autoplay ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh]'}`}
    >
      {/* Top bar and progress */}
      <header className="flex items-center gap-4 px-4 py-2 sm:px-8 sm:py-3">
        <Logo />
        <ol className="flex flex-1 items-center gap-1.5" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800" aria-current={i === step ? 'step' : undefined}>
              {i < step || (step >= CTA && i < CTA) ? (
                <div className="h-full w-full bg-amber-500" />
              ) : i === step ? (
                autoplay ? (
                  <div key={step} className="tq-fill h-full bg-amber-500" style={{ ['--tq-dur' as string]: `${((SCENE_START[i + 1] ?? CTA_AT) - SCENE_START[i]) / 1000}s` }} />
                ) : (
                  <div className="h-full w-full bg-amber-500" />
                )
              ) : null}
            </li>
          ))}
        </ol>
        {!autoplay && (
          <Link href="/signup" className={`${BTN_PRIMARY} !px-4 !py-2.5 text-sm`}>Start free trial</Link>
        )}
      </header>

      <div className={`grid flex-1 gap-4 px-4 pb-4 sm:px-8 sm:pb-6 landscape:lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)] landscape:lg:gap-10 ${autoplay ? 'min-h-0 grid-rows-[auto_minmax(0,1fr)] landscape:lg:grid-rows-none' : ''}`}>
        {/* Caption */}
        <div className={`flex flex-col justify-center ${autoplay ? 'py-[2vmin] portrait:h-[32vmin]' : 'py-2 landscape:lg:py-8'}`}>
          {step < CTA ? (
            <>
              <p className="text-sm font-semibold text-amber-400" data-testid="step-count">Step {step + 1} of {STEPS.length}</p>
              <h1 key={step} className={`${H} mt-2 text-white tq-rise ${autoplay ? 'text-[clamp(2.4rem,7.4vmin,6rem)]' : 'text-4xl sm:text-5xl'}`}>{current.title}</h1>
              <p className={`mt-3 text-slate-300 ${autoplay ? 'text-[clamp(1.1rem,3.1vmin,2.4rem)] leading-snug' : 'text-lg'}`}>{current.caption}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-amber-400">That was one quote</p>
              <h1 className={`${H} mt-2 text-white tq-rise ${autoplay ? 'text-[clamp(2.4rem,7.4vmin,6rem)]' : 'text-4xl sm:text-5xl'}`}>Now do it with a real job.</h1>
            </>
          )}
          {!autoplay && (
            <div className="mt-6 hidden flex-col gap-1 landscape:lg:flex">
              {STEPS.map((s, i) => (
                <button key={s.id} type="button" onClick={() => setStep(i)} className={`rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${i === step ? 'bg-amber-500/10 text-amber-200' : 'text-slate-400 hover:text-white'}`}>
                  {i + 1}. {s.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stage */}
        <div className={`min-w-0 ${autoplay ? 'min-h-0 overflow-hidden' : 'min-h-[26rem]'} flex flex-col justify-center ${autoplay ? 'portrait:justify-start portrait:pt-[3vmin]' : ''}`}>
          <div key={step} className="tq-rise">
            {step === 0 && (
              <div className="grid grid-cols-2 gap-3 landscape:lg:grid-cols-3" data-step-panel="job">
                {JOB_TEMPLATES.map((j) => {
                  const Icon = TEMPLATE_ICONS[j.icon];
                  const on = j.id === templateId;
                  return (
                    <button key={j.id} type="button" data-cur={`job-${j.id}`} onClick={() => pick(j.id)} aria-pressed={on} className={`rounded-xl border p-4 text-left transition-colors min-h-[48px] lg:min-h-0 ${on ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 bg-slate-900 hover:border-slate-500'}`}>
                      <Icon className={`h-6 w-6 ${on ? 'text-amber-400' : 'text-slate-400'}`} aria-hidden />
                      <span className="mt-3 block font-bold text-white">{j.name}</span>
                      <span className="mt-1 block text-sm text-slate-400">{j.blurb}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {step === 1 && (
              <div className={panel} data-step-panel="size">
                <p className="text-sm text-slate-400">{quote.parts.find((p) => p.calcName) ? `Sized by the ${quote.parts.find((p) => p.calcName)!.calcName}` : 'Typical scope for this job. Edit the size.'}</p>
                <p className="text-xl font-bold text-white">{template.name}</p>
                <label htmlFor="demo-size" className="mt-4 flex items-baseline justify-between text-sm font-semibold text-slate-300">
                  {template.scale.label}
                  <span className="text-2xl font-extrabold tabular-nums text-amber-400">{size} {template.scale.unit}</span>
                </label>
                <input id="demo-size" data-cur="size" type="range" className="tq-range mt-2" min={template.scale.min} max={template.scale.max} step={template.scale.step} value={size} onChange={(e) => setSize(Number(e.target.value))} />
                <ul className="mt-4 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/60">
                  {quote.rows.slice(0, 8).map(({ line }, i) => (
                    <li key={`${line.code}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-slate-200">{line.description}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-white">{line.quantity} <span className="font-normal text-slate-500">{line.unit}</span></span>
                    </li>
                  ))}
                </ul>
                {quote.rows.length > 8 && <p className="mt-2 text-xs text-slate-500">and {quote.rows.length - 8} more lines</p>}
              </div>
            )}

            {step === 2 && (
              <div className={panel} data-step-panel="price">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor="demo-region" className="mb-1 block text-xs font-semibold text-slate-400">Region</label>
                    <select id="demo-region" data-cur="region" className={field} value={region} onChange={(e) => { setRegion(e.target.value); setRate(null); }}>
                      {REGIONS.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="demo-rate" className="mb-1 block text-xs font-semibold text-slate-400">Labour rate $/h</label>
                    <input id="demo-rate" data-cur="rate" type="number" min={0} className={field} value={rate ?? quote.suggestedRate} onChange={(e) => setRate(e.target.value === '' ? 0 : Number(e.target.value))} />
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><dt className="text-xs text-slate-400">Materials</dt><dd className="mt-1 text-lg font-bold text-white">x{quote.materialFactor.toFixed(2)}</dd></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><dt className="text-xs text-slate-400">Cost of an hour</dt><dd className="mt-1 text-lg font-bold text-white">{money(labourCost(template.labourClass, quote.province).total)}</dd></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><dt className="text-xs text-slate-400">Sales tax</dt><dd className="mt-1 text-lg font-bold text-white">{quote.taxPct}%</dd></div>
                </dl>
                <ul className="mt-4 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/60">
                  {quote.priced.slice(0, 5).map((l, i) => (
                    <li key={`${l.code}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-slate-200">{l.description}</span>
                      <span className="shrink-0 tabular-nums text-white">{l.materialUnitCost > 0 ? `${money(l.materialUnitCost)} / ${l.unit}` : 'price pending'}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">Reference prices are dated baselines ({COSTBOOK_AS_OF}) for {quote.regionName}. Confirm with your supplier.</p>
                {quote.taxNote && <p className="mt-1 text-xs text-slate-500">{quote.taxNote}</p>}
              </div>
            )}

            {step === 3 && (
              <div className={panel} data-step-panel="estimate">
                <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/60">
                  {quote.rows.slice(0, 6).map(({ line, sell }, i) => (
                    <li key={`${line.code}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-slate-200">{line.quantity} {line.unit} {line.description}</span>
                      <span className="shrink-0 tabular-nums text-white">{money(sell)}</span>
                    </li>
                  ))}
                </ul>
                {quote.rows.length > 6 && <p className="mt-1.5 text-xs text-slate-500">and {quote.rows.length - 6} more lines</p>}
                <div className="mt-4">
                  <label htmlFor="demo-markup" className="flex items-baseline justify-between text-sm font-semibold text-slate-300">
                    Markup <span className="text-xl font-extrabold tabular-nums text-amber-400">{markup}%</span>
                  </label>
                  <input id="demo-markup" data-cur="markup" type="range" className="tq-range mt-1" min={0} max={50} step={1} value={markup} onChange={(e) => setMarkup(Number(e.target.value))} />
                </div>
                <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                  <dt className="text-slate-400">Materials</dt><dd className="text-right tabular-nums text-slate-200">{money(t.material)}</dd>
                  <dt className="text-slate-400">Labour, {t.labourHours} h at {money(quote.labourRate)}</dt><dd className="text-right tabular-nums text-slate-200">{money(t.labour)}</dd>
                  <dt className="text-slate-400">Markup</dt><dd className="text-right tabular-nums text-slate-200">{money(t.markup)}</dd>
                  <dt className="text-slate-400">Tax {quote.taxPct}%</dt><dd className="text-right tabular-nums text-slate-200">{money(t.tax)}</dd>
                </dl>
                <div data-cur="total" className="mt-3 flex items-end justify-between border-t border-slate-700 pt-3">
                  <span className="font-semibold text-slate-300">Total</span>
                  <span key={Math.round(t.total * 100)} className="tq-flash text-4xl font-extrabold tabular-nums text-amber-400" data-testid="demo-total">{money(t.total)}</span>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5 text-slate-800 shadow-2xl" data-step-panel="proposal">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Proposal from Your Company Ltd.</p>
                    <p className="text-xl font-bold text-slate-900">{template.name}</p>
                    <p className="text-xs text-slate-500">Prepared for Sample Client, {quote.regionName}</p>
                  </div>
                  <p className="text-right text-xs text-slate-500">Total with tax<span className="block text-2xl font-extrabold tabular-nums text-slate-900">{money(t.total)}</span></p>
                </div>
                <ul className="mt-4 space-y-1.5 border-t border-slate-300 pt-3 text-sm">
                  {template.parts.map((p) => (
                    <li key={p.label} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />{p.label}</li>
                  ))}
                </ul>
                <div className="mt-4 grid items-end gap-3 border-t border-slate-300 pt-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <label htmlFor="demo-sign" className="mb-1 block text-xs font-semibold text-slate-500">Type your name to accept</label>
                    <input id="demo-sign" data-cur="sign-name" value={signName} disabled={signed} onChange={(e) => setSignName(e.target.value)} placeholder="Sample Client" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-[cursive] text-lg text-slate-800 min-h-[48px] lg:min-h-0 focus:outline-none focus:border-amber-500" />
                  </div>
                  <button type="button" data-cur="sign-btn" disabled={signed || signName.trim().length < 2} onClick={() => setSigned(true)} className="rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white min-h-[48px] lg:min-h-0 hover:bg-slate-700 disabled:opacity-50">
                    {signed ? 'Accepted' : 'Accept and sign'}
                  </button>
                </div>
                <div className="relative mt-3 h-8">
                  {signed ? (
                    <span className="tq-stamp absolute left-0 inline-flex items-center gap-1 rounded-md border-2 border-emerald-600 px-2 py-0.5 text-sm font-extrabold text-emerald-700" data-testid="signed">
                      <Check className="h-4 w-4" aria-hidden /> SIGNED by {signName}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">Sample proposal. Nothing is saved or sent.</span>
                  )}
                </div>
              </div>
            )}

            {step === 5 && <NextStep quote={quote} />}

            {step >= CTA && (
              <div className="rounded-2xl border border-amber-500 bg-slate-900 p-6 shadow-2xl sm:p-8" data-step-panel="cta">
                <p className={`${H} text-4xl text-white sm:text-5xl`}>Start your 14-day free trial.</p>
                <p className="mt-3 text-slate-300">Fourteen days free. No credit card. Prices in CAD.</p>
                <div className="mt-6 flex flex-col gap-3">
                  <Link href="/signup" className={`${BTN_PRIMARY} text-lg`}>Start free trial <ArrowRight className="h-5 w-5" aria-hidden /></Link>
                  {!autoplay && (
                    <>
                      <Link href="/tools" className={BTN_GHOST}>Open the free calculators</Link>
                      <button type="button" onClick={restart} className={BTN_GHOST}><RotateCcw className="h-4 w-4" aria-hidden /> Run the demo again</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Manual controls */}
      {!autoplay && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur sm:px-8">
          <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className={`${BTN_GHOST} disabled:opacity-40`}><ArrowLeft className="h-4 w-4" aria-hidden /> Back</button>
          <Link href="/demo?autoplay=1" className="hidden min-h-[48px] items-center gap-1.5 text-sm font-semibold text-slate-300 hover:text-white sm:inline-flex lg:min-h-0"><Play className="h-4 w-4 text-amber-400" aria-hidden /> Play the 30-second version</Link>
          <button type="button" disabled={step >= CTA} onClick={() => setStep(step + 1)} className={`${BTN_PRIMARY} disabled:opacity-40`}>{step === CTA - 1 ? 'Finish' : 'Next'} <ArrowRight className="h-4 w-4" aria-hidden /></button>
        </div>
      )}

      {/* Highlight and cursor (autoplay) */}
      {autoplay && target && (
        <>
          <div aria-hidden className="pointer-events-none absolute rounded-xl border-2 border-amber-400 shadow-[0_0_0_0.4rem_rgba(245,158,11,0.22)] transition-all duration-500 ease-out motion-reduce:transition-none" style={{ left: target.x - 6, top: target.y - 6, width: target.w + 12, height: target.h + 12 }} />
          <div aria-hidden className="pointer-events-none absolute transition-all duration-700 ease-out motion-reduce:transition-none" style={{ left: target.x + target.w * 0.62, top: target.y + target.h * 0.62 }}>
            <span key={clicking} className="tq-ring absolute -left-4 -top-4 h-8 w-8 rounded-full border-2 border-white/80" />
            <MousePointer2 className="relative h-9 w-9 fill-white text-slate-950 drop-shadow-lg" />
          </div>
        </>
      )}
    </div>
  );
}

/** Step 6: what the same record does next, worked out from this quote. */
function NextStep({ quote }: { quote: ReturnType<typeof buildQuote> }) {
  const t = quote.totals;
  const first = quote.estimateLines[0];
  const change = first ? estimateTotals([{ ...first, quantity: 1 }], quote.labourRate, quote.markupPct, quote.taxPct).total : 0;
  const draw = t.beforeTax * 0.4;
  const hold = draw * 0.1;
  const tiles = [
    {
      title: 'Change order',
      lines: [first ? `Client adds one more: ${first.description}` : 'Client adds work', `${money(change)} with tax`, 'Signed the same way, contract total updates'],
    },
    {
      title: 'Progress invoice',
      lines: ['Draw 1 at 40% of the contract', `Holdback held back: ${money(hold)} (10%, sample)`, `Due with tax: ${money((draw - hold) * (1 + quote.taxPct / 100))}`],
    },
    {
      title: 'Job costing',
      lines: [`Budget starts at ${money(t.subtotal)} of cost`, 'Approved timecards and costs land against it', 'Margin shown while the job runs'],
    },
  ];
  return (
    <div className="grid gap-3" data-step-panel="next">
      {tiles.map((tile, i) => (
        <div key={tile.title} data-cur={`next-${i}`} className={panel}>
          <p className="font-bold text-white">{tile.title}</p>
          <ul className="mt-1.5 space-y-0.5 text-sm text-slate-300">
            {tile.lines.map((l) => <li key={l} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />{l}</li>)}
          </ul>
        </div>
      ))}
      <p className="text-xs text-slate-500">Figures come from the quote you just built. Holdback and the draw split are samples you set per contract.</p>
    </div>
  );
}
