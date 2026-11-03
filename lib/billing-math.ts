const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const cents = (v: number) => Math.round(v * 100) / 100;

// Change order price: (material + labour) plus markup; tax on the marked-up price
export function changeOrderTotals(co: { material_cost: unknown; labour_hours: unknown; labour_rate: unknown; markup_pct: unknown; tax_pct: unknown }) {
  const labour = cents(n(co.labour_hours) * n(co.labour_rate));
  const cost = cents(n(co.material_cost) + labour);
  const markup = cents((cost * n(co.markup_pct)) / 100);
  const price = cents(cost + markup);
  const tax = cents((price * n(co.tax_pct)) / 100);
  return { labour, cost, markup, price, tax, total: cents(price + tax) };
}

export interface InvoiceLine {
  description: string;
  amount: number | string;
  change_order_id?: string | null;
  estimate_id?: string | number | null;
  percent?: number | string | null;
}

// Invoice: tax on the subtotal; lien holdback is withheld from the pre-tax amount
export function invoiceTotals(lines: InvoiceLine[], taxPct: unknown, holdbackPct: unknown) {
  const subtotal = cents(lines.reduce((s, l) => s + n(l.amount), 0));
  const tax = cents((subtotal * n(taxPct)) / 100);
  const holdback = cents((subtotal * n(holdbackPct)) / 100);
  return { subtotal, tax, holdback, total: cents(subtotal + tax - holdback) };
}
