import { z } from 'zod';
import { cents } from './billing-math';

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

/**
 * Shares `target` across lines in proportion to their cost, in whole cents, so the shares add up to
 * it exactly. Each line gets its share rounded down, and the leftover cents go to the lines that
 * lost the most to rounding (the earlier line on a tie).
 */
function shareByCost(costs: number[], target: number): number[] {
  const totalCost = costs.reduce((s, c) => s + c, 0);
  if (!(totalCost > 0)) return costs.map(() => 0);
  const targetCents = Math.round(target * 100);
  const exact = costs.map((c) => (c / totalCost) * targetCents);
  const shares = exact.map((x) => Math.floor(x));
  const leftover = targetCents - shares.reduce((s, c) => s + c, 0);
  const order = exact.map((x, i) => ({ i, lost: x - Math.floor(x) })).sort((a, b) => b.lost - a.lost || a.i - b.i);
  for (const { i } of order.slice(0, leftover)) shares[i] += 1;
  return shares.map((c) => c / 100);
}

/**
 * Markup applies to material + labour; tax applies to the marked-up subtotal.
 * The database does the same sums for the stored total (public.estimate_totals) and must agree to the cent.
 */
export function estimateTotals(items: EstimateLine[], labourRate: unknown, markupPct: unknown, taxPct: unknown) {
  const lines = items.map((it) => ({
    material: cents(n(it.quantity) * n(it.material_unit_cost)),
    hours: n(it.quantity) * n(it.labour_hours_per_unit),
  }));
  const material = cents(lines.reduce((s, l) => s + l.material, 0));
  const labourHours = cents(lines.reduce((s, l) => s + l.hours, 0));
  const labour = cents(labourHours * n(labourRate));
  const subtotal = cents(material + labour);
  const markup = cents((subtotal * n(markupPct)) / 100);
  const beforeTax = cents(subtotal + markup);
  const tax = cents((beforeTax * n(taxPct)) / 100);
  const sell = shareByCost(lines.map((l) => l.material + l.hours * n(labourRate)), beforeTax);
  return { lines, sell, material, labourHours, labour, subtotal, markup, beforeTax, tax, total: cents(beforeTax + tax) };
}

/**
 * Client-facing price of one line: its cost with the markup spread proportionally. The printed lines
 * add up to the printed subtotal (beforeTax). The rate is already in `totals`; the third argument is ignored.
 */
export function lineSellPrice(totals: ReturnType<typeof estimateTotals>, index: number, _labourRate?: unknown) {
  return totals.sell[index];
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
