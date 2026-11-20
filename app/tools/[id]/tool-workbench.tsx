'use client';

// One calculator, live, with its takeoff priced for a region. The form and the answer come from the
// shared calculator components; pricing comes from the cost engine, so it matches a real estimate.
import { useMemo, useState } from 'react';
import { CalcResultView, CalculatorFields, useCalculator } from '@/components/calc/calculator-form';
import { money } from '@/components/marketing/ui';
import { COSTBOOK_AS_OF, REGIONS, billingRate, getRegion, priceTakeoff, toEstimateLines, type LabourClass } from '@/lib/costbook';
import { estimateTotals } from '@/lib/estimate-math';

const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:outline-none focus:border-amber-500 min-h-[48px] lg:min-h-0';

export default function ToolWorkbench({ calcId }: { calcId: string }) {
  const { calc, input, setInput, result } = useCalculator(calcId);
  const [region, setRegion] = useState('ON');
  const [rate, setRate] = useState<number | null>(null);

  const priced = useMemo(() => (result ? priceTakeoff(result.takeoff, { region }) : []), [result, region]);
  const province = getRegion(region).province;
  const labourClass: LabourClass = priced.find((l) => l.labourClass)?.labourClass ?? 'labourer';
  const suggested = billingRate(labourClass, province);
  const labourRate = rate ?? suggested;
  const totals = useMemo(() => estimateTotals(toEstimateLines(priced), labourRate, 0, 0), [priced, labourRate]);

  if (!calc || !result) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-5">
        <p className="mb-3 text-sm font-semibold text-white">Your job</p>
        <CalculatorFields calcId={calcId} input={input} onChange={setInput} />
      </div>

      <div className="min-w-0 space-y-6">
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-5" aria-live="polite">
          <p className="mb-3 text-sm font-semibold text-white">Answer</p>
          <CalcResultView result={result} showTakeoff={false} />
        </div>

        {result.takeoff.length > 0 && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="text-sm font-semibold text-white">Priced takeoff</p>
              <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-[14rem_8rem]">
                <div>
                  <label htmlFor="tool-region" className="mb-1 block text-xs font-semibold text-slate-400">Region</label>
                  <select id="tool-region" className={field} value={region} onChange={(e) => { setRegion(e.target.value); setRate(null); }}>
                    {REGIONS.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="tool-rate" className="mb-1 block text-xs font-semibold text-slate-400">Labour $/h</label>
                  <input id="tool-rate" type="number" min={0} className={field} value={labourRate} onChange={(e) => setRate(e.target.value === '' ? 0 : Number(e.target.value))} />
                </div>
              </div>
            </div>

            <ul className="mt-4 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/60" data-testid="priced-takeoff">
              {priced.map((l, i) => (
                <li key={`${l.code}-${i}`} className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-2 text-sm">
                  <span className="min-w-0 text-slate-200">{l.description}</span>
                  <span className="text-right font-semibold tabular-nums text-white">
                    {l.materialUnitCost > 0 ? money(l.quantity * l.materialUnitCost) : 'price pending'}
                  </span>
                  <span className="text-xs text-slate-500">{l.quantity} {l.unit}{l.materialUnitCost > 0 ? ` at ${money(l.materialUnitCost)}` : ''}</span>
                  <span className="text-right text-xs text-slate-500">{l.labourHoursPerUnit > 0 ? `${Math.round(l.quantity * l.labourHoursPerUnit * 100) / 100} h` : ''}</span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-slate-400">Materials</dt><dd className="text-right tabular-nums text-slate-100">{money(totals.material)}</dd>
              <dt className="text-slate-400">Labour, {totals.labourHours} h at {money(labourRate)}</dt><dd className="text-right tabular-nums text-slate-100">{money(totals.labour)}</dd>
              <dt className="font-semibold text-white">Your cost, before markup and tax</dt><dd className="text-right text-lg font-bold tabular-nums text-amber-400">{money(totals.subtotal)}</dd>
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Reference prices are dated baselines ({COSTBOOK_AS_OF}) for {getRegion(region).name}. Confirm them with your supplier. In TradeQuote PRO your own saved prices replace these.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

