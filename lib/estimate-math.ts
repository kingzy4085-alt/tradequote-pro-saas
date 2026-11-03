import { z } from 'zod';

export interface EstimateLine {
  description: string;
  quantity: number | string;
  unit: string;
  material_unit_cost: number | string;
  labour_hours_per_unit: number | string;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const cents = (v: number) => Math.round(v * 100) / 100;

/** Markup applies to material + labour; tax applies to the marked-up subtotal. */
export function estimateTotals(items: EstimateLine[], labourRate: unknown, markupPct: unknown, taxPct: unknown) {
  const lines = items.map((it) => ({
    material: cents(n(it.quantity) * n(it.material_unit_cost)),
    hours: n(it.quantity) * n(it.labour_hours_per_unit),
  }));
  const material = cents(lines.reduce((s, l) => s + l.material, 0));
  const labourHours = Math.round(lines.reduce((s, l) => s + l.hours, 0) * 100) / 100;
  const labour = cents(labourHours * n(labourRate));
  const subtotal = cents(material + labour);
  const markup = cents((subtotal * n(markupPct)) / 100);
  const beforeTax = cents(subtotal + markup);
  const tax = cents((beforeTax * n(taxPct)) / 100);
  return { lines, material, labourHours, labour, subtotal, markup, beforeTax, tax, total: cents(beforeTax + tax) };
}

/** Client-facing price of one line: its cost with the markup spread proportionally. */
export function lineSellPrice(totals: ReturnType<typeof estimateTotals>, index: number, labourRate: unknown) {
  const factor = totals.subtotal ? totals.beforeTax / totals.subtotal : 1;
  const line = totals.lines[index];
  return cents((line.material + line.hours * n(labourRate)) * factor);
}

const amount = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? 0 : v), z.coerce.number().finite().min(0, 'Must be 0 or more').max(max));

export const EstimateLineSchema = z.object({
  description: z.string().trim().max(500).default(''),
  quantity: amount(1e9),
  unit: z.string().trim().max(20).default('ea'),
  material_unit_cost: amount(1e9).transform(cents),
  labour_hours_per_unit: amount(1e6),
});

export const EstimateLinesSchema = z.object({ items: z.array(EstimateLineSchema).max(1000, 'An estimate can have up to 1000 lines') });
