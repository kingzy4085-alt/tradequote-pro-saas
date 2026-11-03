// Creates the TradeQuote PRO plans in Stripe (monthly and annual = 10× monthly, CAD) and the webhook endpoint.
// Safe to re-run: prices are found by lookup key. Refuses to run with a live key unless ALLOW_LIVE=1.
// Usage: node scripts/stripe-setup.mjs [webhook-url]
import Stripe from 'stripe';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const key = env.STRIPE_SECRET_KEY;
if (!key) throw new Error('STRIPE_SECRET_KEY missing from .env.local');
if (!key.startsWith('sk_test_') && process.env.ALLOW_LIVE !== '1') throw new Error('Live Stripe key: re-run with ALLOW_LIVE=1 only after the owner approves.');
const stripe = new Stripe(key);

const PLANS = [
  { tier: 'field', name: 'TradeQuote PRO Field', monthly: 99 },
  { tier: 'crew', name: 'TradeQuote PRO Crew', monthly: 299 },
  { tier: 'contractor', name: 'TradeQuote PRO Contractor', monthly: 699 },
];

for (const p of PLANS) {
  const keys = [`tq_${p.tier}_monthly`, `tq_${p.tier}_annual`];
  const existing = await stripe.prices.list({ lookup_keys: keys, limit: 10 });
  const have = new Set(existing.data.map((x) => x.lookup_key));
  let product = existing.data[0]?.product;
  if (!product) {
    const found = await stripe.products.search({ query: `metadata['tier']:'${p.tier}'` });
    product = found.data[0]?.id || (await stripe.products.create({ name: p.name, metadata: { tier: p.tier } })).id;
  }
  for (const [interval, amount, lookup] of [['month', p.monthly, keys[0]], ['year', p.monthly * 10, keys[1]]]) {
    if (have.has(lookup)) { console.log(`${lookup}: exists`); continue; }
    await stripe.prices.create({ product, currency: 'cad', unit_amount: amount * 100, recurring: { interval }, lookup_key: lookup, metadata: { tier: p.tier } });
    console.log(`${lookup}: created $${amount} CAD / ${interval}`);
  }
}

// Billing portal: customers can switch between the three plans, update their card, and cancel
const products = {};
for (const p of (await stripe.prices.list({ lookup_keys: PLANS.flatMap((p) => [`tq_${p.tier}_monthly`, `tq_${p.tier}_annual`]), limit: 20 })).data) {
  (products[p.product] ||= []).push(p.id);
}
const portal = {
  business_profile: { headline: 'TradeQuote PRO billing' },
  features: {
    customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name'] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: Object.entries(products).map(([product, prices]) => ({ product, prices })) },
  },
};
const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
if (configs.data[0]) await stripe.billingPortal.configurations.update(configs.data[0].id, portal);
else await stripe.billingPortal.configurations.create(portal);
console.log('billing portal: plan switching enabled');

const url = process.argv[2];
if (url) {
  const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
  if (hooks.data.some((h) => h.url === url)) console.log('webhook: exists (its signing secret is only shown when created; delete it in Stripe to get a new one)');
  else {
    const h = await stripe.webhookEndpoints.create({
      url,
      enabled_events: ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'],
    });
    fs.appendFileSync('.env.local', `\nSTRIPE_WEBHOOK_SECRET=${h.secret}\n`);
    console.log('webhook: created; signing secret saved to .env.local as STRIPE_WEBHOOK_SECRET');
  }
}
