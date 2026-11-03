export interface EstimateItem {
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

// Markup applies to material + labour; tax applies to the marked-up subtotal.
export function estimateTotals(items: EstimateItem[], labourRate: unknown, markupPct: unknown, taxPct: unknown) {
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

export const money = (v: number) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
