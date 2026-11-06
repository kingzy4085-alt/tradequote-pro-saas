// What we sell: one plan, matching the single STRIPE_PRICE_ID that checkout uses. The pricing page
// and the billing page both read from here, so they can't disagree. The Stripe Price itself is
// set in the Stripe dashboard, and the figure below has to match it: this only sets what we show.

export const PLAN_NAME = 'TradeQuote PRO';

/** The owner's decision, still pending. Change it here, and create a Stripe Price to match. */
export const PLAN_PRICE_MONTHLY_CAD = 299;

/**
 * Honoured by a Stripe coupon (40% off, duration forever, 25 redemptions) with a promotion code,
 * which checkout already accepts. The owner has to create that coupon. Set enabled to false to
 * take every mention of the offer off the pricing page.
 */
export const FOUNDING_OFFER: { enabled: boolean; percentOff: number; spots: number } = { enabled: true, percentOff: 40, spots: 25 };

export const PLAN_FEATURES = [
  'Estimates and proposals from one record, printed with your letterhead',
  'Timecards with foreman approval, by job',
  'Priced change orders with client sign-off that update the contract',
  'Invoices and progress draws with holdback, tax and receivables',
  'Job costing: budget, actual cost and margin on every job',
  'LOTO permits, tailgate meetings and safety inspections with ordered sign-offs',
  'Daily alerts for overdue invoices, expiring insurance and open safety items',
  'Sub compliance: WCB clearance and insurance tracking',
  'Your whole crew on one price, with role-based access',
  'AI Assistant for Canadian code and construction questions (fair-use daily limit)',
  'Desktop, Android and iPhone install',
] as const;

/** "$299", for the page's own wording around it. */
export const planPriceLabel = () => `$${PLAN_PRICE_MONTHLY_CAD.toLocaleString('en-CA')}`;

/** The founding price, to the cent, if the discount leaves any. */
export function foundingPriceLabel(): string {
  const price = Math.round(PLAN_PRICE_MONTHLY_CAD * (100 - FOUNDING_OFFER.percentOff)) / 100;
  return `$${price.toLocaleString('en-CA', { minimumFractionDigits: Number.isInteger(price) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
