// The sums behind change orders and invoices. The database does the real ones when a
// record is saved (20261104000110_billing.sql); these are the same sums for the live
// preview in the editors and must agree with it to the cent, which tests/billing.test.ts checks.
import { z } from 'zod';

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Rounds the way Postgres rounds numeric: half away from zero, on the decimal value.
 * Plain Math.round(x * 100) would turn 1.005 into 1.00 and -2.5 cents into -2.
 */
function roundTo(value: unknown, places: number): number {
  const x = n(value);
  // 15 significant digits clears binary noise such as 1.1 * 1.1 = 1.2100000000000002
  const abs = Number(Math.abs(x).toPrecision(15));
  const rounded = Number(`${Math.round(Number(`${abs.toFixed(places + 6)}e${places}`))}e-${places}`);
  return x < 0 && rounded !== 0 ? -rounded : rounded;
}

export const cents = (value: unknown): number => roundTo(value, 2);

/** A percent line keeps four decimal places. The database rounds to the same. */
export const percentPlaces = (value: unknown): number => roundTo(value, 4);

export interface ChangeOrderInput {
  material_cost: unknown;
  labour_hours: unknown;
  labour_rate: unknown;
  markup_pct: unknown;
  tax_pct: unknown;
}

/** Price is material and labour plus markup. Tax is on the price. Total is what the client signs for. */
export function changeOrderTotals(co: ChangeOrderInput) {
  const labour = cents(n(co.labour_hours) * n(co.labour_rate));
  const cost = cents(n(co.material_cost) + labour);
  const markup = cents((cost * n(co.markup_pct)) / 100);
  const price = cents(cost + markup);
  const tax = cents((price * n(co.tax_pct)) / 100);
  return { labour, cost, markup, price, tax, total: cents(price + tax) };
}

/** What a change order adds to the job's cost budget, at the company's own labour rate. Its price is revenue, not cost. */
export function changeOrderBudgetCost(co: Pick<ChangeOrderInput, 'material_cost' | 'labour_hours'>, companyLabourRate: unknown) {
  return cents(n(co.material_cost) + n(co.labour_hours) * n(companyLabourRate));
}

/**
 * A credit is a line with a negative amount. It lowers tax and holdback the same way a
 * charge raises them, so an invoice that is all credit comes out as money owed back.
 */
export function invoiceTotals(lines: { amount?: unknown; tax_pct?: unknown }[], taxPct: unknown, holdbackPct: unknown) {
  const subtotal = cents(lines.reduce<number>((sum, line) => sum + cents(line.amount), 0));
  // A change order line is taxed at the rate it was signed at, everything else at the invoice's rate
  const byRate = new Map<number, number>();
  for (const line of lines) {
    const rate = line.tax_pct === undefined || line.tax_pct === null ? n(taxPct) : n(line.tax_pct);
    byRate.set(rate, (byRate.get(rate) ?? 0) + cents(line.amount));
  }
  const tax = cents([...byRate].reduce<number>((sum, [rate, amount]) => sum + cents((cents(amount) * rate) / 100), 0));
  const holdback = cents((subtotal * n(holdbackPct)) / 100);
  return { subtotal, tax, holdback, total: cents(subtotal + tax - holdback) };
}

/** The dollar amount of a percent-of-contract line. */
export function percentAmount(contractValue: unknown, percent: unknown) {
  return cents((n(contractValue) * percentPlaces(percent)) / 100);
}

/**
 * Prices an invoice's percent lines for the preview, the way price_invoice_lines does. Percents
 * that add up to 100 can round to more dollars than the contract, by at most half a cent a
 * line, and that comes off the last one. More than that the database refuses, so it is left
 * showing here. They can also round to less, and given billedPercent, the line that takes the
 * contract to 100% picks up the stray cents.
 */
export function pricePercentLines<T extends { type: string; percent?: unknown; amount?: unknown }>(lines: T[], contractValue: unknown, billedDollars: unknown, billedLines: number, billedPercent?: unknown): T[] {
  const priced = lines.map((l) => (l.type === 'percent' ? { ...l, amount: percentAmount(contractValue, l.percent) } : l));
  const last = priced.map((l) => l.type).lastIndexOf('percent');
  if (last < 0) return priced;
  const percentLines = priced.filter((l) => l.type === 'percent');
  const excess = cents(n(billedDollars) + percentLines.reduce((sum, l) => sum + n(l.amount), 0) - n(contractValue));
  const lastAmount = n(priced[last].amount);
  if (excess > 0 && excess <= 0.005 * (billedLines + percentLines.length) + 1e-9 && excess <= lastAmount) {
    priced[last] = { ...priced[last], amount: cents(lastAmount - excess) };
  } else if (excess < 0 && billedPercent !== undefined && -excess <= 0.005 * (billedLines + percentLines.length) + 1e-9 && percentPlaces(n(billedPercent) + percentLines.reduce((sum, l) => sum + percentPlaces(l.percent), 0)) === 100) {
    priced[last] = { ...priced[last], amount: cents(lastAmount - excess) };
  }
  return priced;
}

/** How much of the contract can still be billed, given the percents already on other invoices. Never below 0. */
export function percentLeft(billedPercent: unknown) {
  return Math.max(0, Number((100 - n(billedPercent)).toFixed(4)));
}

/** What a draw's invoice comes to before tax, once holdback is withheld. */
export function drawNet(amountBilled: unknown, holdbackPct: unknown) {
  const holdback = cents((n(amountBilled) * n(holdbackPct)) / 100);
  return { holdback, net: cents(n(amountBilled) - holdback) };
}

/** Aging buckets for money owed, by days past due. The database applies the same ones. */
export function receivableAge(daysPastDue: number | null): 'Current' | '30 Days' | '60 Days' | '90+ Days' {
  if (daysPastDue === null || daysPastDue < 30) return 'Current';
  if (daysPastDue < 60) return '30 Days';
  if (daysPastDue < 90) return '60 Days';
  return '90+ Days';
}

const blankToZero = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? 0 : v);
const Description = z.string().trim().max(500);

/** What the editor sends for each line. The amount of anything but a free line is left to the database. */
export const InvoiceLineSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('free'),
    description: Description.min(1, 'Enter a description'),
    amount: z.preprocess(blankToZero, z.coerce.number().finite().min(-1e11).max(1e11)).transform(cents),
  }),
  z.object({
    type: z.literal('percent'),
    description: Description.optional(),
    percent: z.coerce.number().finite().transform(percentPlaces).pipe(z.number().gt(0, 'Enter a percent above 0').max(100, 'A line cannot bill more than 100%')),
  }),
  z.object({ type: z.literal('change_order'), description: Description.optional(), change_order_id: z.string().uuid('Pick a change order') }),
  z.object({ type: z.literal('draw'), description: Description.optional(), progress_billing_id: z.string().uuid('Pick a draw') }),
]);

export const InvoiceLinesSchema = z.array(InvoiceLineSchema).max(200, 'An invoice can have up to 200 lines');

export type InvoiceLineInput = z.infer<typeof InvoiceLineSchema>;

/** A line as the database stored it, or as the editor is holding it before a save. */
export interface InvoiceLine {
  type: 'free' | 'percent' | 'change_order' | 'draw';
  description: string;
  amount: number | string;
  percent?: number | string;
  /** On a change order line: the rate it was signed at. */
  tax_pct?: number | string;
  change_order_id?: string;
  progress_billing_id?: string;
}

/** The tax row's label. A change order signed at another rate means there is no one percent to show. */
export function invoiceTaxLabel(lines: { tax_pct?: unknown }[], taxPct: unknown): string {
  const rate = n(taxPct);
  return lines.some((l) => l.tax_pct !== undefined && l.tax_pct !== null && n(l.tax_pct) !== rate) ? 'Tax' : `Tax (${rate}%)`;
}

/** The word shown beside a line. */
export function lineKind(line: Pick<InvoiceLine, 'type' | 'percent'>): string {
  switch (line.type) {
    case 'change_order':
      return 'Change order';
    case 'percent':
      return `${Number(line.percent) || 0}% of contract`;
    case 'draw':
      return 'Progress draw';
    default:
      return 'Other';
  }
}
