'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Label } from '@/components/ui';
import { CalcResultView, CalculatorFields, useCalculator } from '@/components/calc/calculator-form';
import { CALCULATORS } from '@/lib/calc/registry';
import { getRegion, type CompanyPrice } from '@/lib/costbook';
import type { EstimateLine } from '@/lib/estimate-math';
import { TRADE_LABEL, addedNote, buildEstimateLines } from '@/lib/estimate-helpers';

function CalculatorBody({ calcId, region, prices, onAdd }: { calcId: string; region: string; prices: CompanyPrice[]; onAdd: (lines: EstimateLine[], note: string) => void }) {
  const { calc, input, setInput, result } = useCalculator(calcId);
  if (!calc || !result) return null;
  const built = buildEstimateLines(result.takeoff, region, prices);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">{calc.summary}</p>
      <CalculatorFields calcId={calcId} input={input} onChange={setInput} />
      <CalcResultView result={result} />
      <Button disabled={built.lines.length === 0} onClick={() => onAdd(built.lines, addedNote(built, getRegion(region).name, calc.name))}>
        Add {built.lines.length} {built.lines.length === 1 ? 'line' : 'lines'} to the estimate
      </Button>
    </div>
  );
}

export default function CalculatorPanel({
  region,
  prices,
  onNeedPrices,
  onAdd,
}: {
  region: string;
  prices: CompanyPrice[];
  onNeedPrices: () => void;
  onAdd: (lines: EstimateLine[], note: string) => void;
}) {
  const [calcId, setCalcId] = useState('');
  const groups = useMemo(() => {
    const by = new Map<string, typeof CALCULATORS[number][]>();
    for (const c of CALCULATORS) by.set(c.trade, [...(by.get(c.trade) ?? []), c]);
    return [...by.entries()];
  }, []);
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="calc-pick">Calculator</Label>
        <select
          id="calc-pick"
          value={calcId}
          onChange={(e) => {
            setCalcId(e.target.value);
            if (e.target.value) onNeedPrices();
          }}
          className="w-full min-h-[48px] lg:min-h-0 bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-amber-500 outline-none"
        >
          <option value="">Choose a calculator</option>
          {groups.map(([trade, list]) => (
            <optgroup key={trade} label={TRADE_LABEL[trade as keyof typeof TRADE_LABEL] ?? trade}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {calcId ? <CalculatorBody key={calcId} calcId={calcId} region={region} prices={prices} onAdd={onAdd} /> : <Alert tone="info">Pick a calculator to work out quantities, then add them as priced lines.</Alert>}
    </div>
  );
}
