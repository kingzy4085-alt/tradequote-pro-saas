'use client';

// One form for every calculator, drawn from its fields. Used by the public /tools pages and by the
// estimate editor's calculator panel, so a calculator looks and behaves the same everywhere.
import { useId, useMemo, useState } from 'react';
import { Input, Label, Select } from '@/components/ui';
import { defaultInput, getCalculator } from '@/lib/calc/registry';
import type { CalcInput, CalcResult } from '@/lib/calc/types';

export function useCalculator(calcId: string, initial?: CalcInput) {
  const calc = getCalculator(calcId);
  const [input, setInput] = useState<CalcInput>(() => (calc ? { ...defaultInput(calc), ...initial } : {}));
  // Pure and fast, so it reruns on every keystroke: the answer is always live
  const result = useMemo<CalcResult | null>(() => (calc ? calc.run(input) : null), [calc, input]);
  return { calc, input, setInput, result };
}

export function CalculatorFields({ calcId, input, onChange, disabled }: { calcId: string; input: CalcInput; onChange: (next: CalcInput) => void; disabled?: boolean }) {
  const calc = getCalculator(calcId);
  const base = useId();
  if (!calc) return null;
  const set = (key: string, value: CalcInput[string]) => onChange({ ...input, [key]: value });
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {calc.fields.map((f) => {
        const id = `${base}-${f.key}`;
        const label = f.unit ? `${f.label} (${f.unit})` : f.label;
        if (f.type === 'boolean') {
          return (
            <label key={f.key} htmlFor={id} className="flex items-center gap-3 min-h-[48px] lg:min-h-0 text-sm text-slate-300 cursor-pointer sm:col-span-2">
              <input id={id} type="checkbox" className="h-5 w-5 accent-amber-500" checked={Boolean(input[f.key])} disabled={disabled} onChange={(e) => set(f.key, e.target.checked)} />
              <span>{f.label}</span>
              {f.help && <span className="text-xs text-slate-500">{f.help}</span>}
            </label>
          );
        }
        return (
          <div key={f.key}>
            <Label htmlFor={id}>{label}</Label>
            {f.type === 'select' ? (
              <Select id={id} options={f.options ?? []} value={String(input[f.key] ?? f.default)} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                step={f.step ?? 'any'}
                min={f.min}
                max={f.max}
                value={input[f.key] === undefined ? '' : String(input[f.key])}
                disabled={disabled}
                onChange={(e) => set(f.key, e.target.value === '' ? '' : Number(e.target.value))}
              />
            )}
            {f.help && <p className="text-xs text-slate-500 mt-1">{f.help}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function CalcResultView({ result, showTakeoff = true }: { result: CalcResult; showTakeoff?: boolean }) {
  return (
    <div className="space-y-4">
      <dl className="grid sm:grid-cols-2 gap-3">
        {result.summary.map((s) => (
          <div key={s.label} className={s.emphasis ? 'sm:col-span-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4' : 'bg-slate-950/60 border border-slate-800 rounded-xl p-3'}>
            <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{s.label}</dt>
            <dd className={s.emphasis ? 'text-2xl font-bold text-amber-300 mt-1' : 'text-white font-semibold mt-1'}>{s.value}</dd>
          </div>
        ))}
      </dl>
      {result.warnings.length > 0 && (
        <ul className="text-sm text-amber-200 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-1 list-disc list-inside">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {showTakeoff && result.takeoff.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-3">Material and labour</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2">Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {result.takeoff.map((t, i) => (
                <tr key={`${t.code ?? t.description}-${i}`}>
                  <td className="py-2 pr-3 text-slate-200">{t.description}</td>
                  <td className="py-2 pr-3 text-right text-slate-300">{t.quantity}</td>
                  <td className="py-2 text-slate-400">{t.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.references.length > 0 && <p className="text-xs text-slate-500">Method: {result.references.join('; ')}</p>}
    </div>
  );
}
