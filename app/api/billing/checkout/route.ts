import { NextResponse } from 'next/server';
import { jsonError, requireApi } from '@/lib/api';
import { companyHasLiveSubscription, findLiveSubscription, getStripe, withBillingIds } from '@/lib/billing';
import { env } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;

const usePortal = (error: string) => NextResponse.json({ error, portal: true }, { status: 409 });

// Starts a Stripe Checkout subscription for the caller's company (owner/admin only).
export async function POST() {
  const ctx = await requireApi({ minRank: 4 });
  if (ctx instanceof Response) return ctx;
  const company = await withBillingIds(ctx);
  if (!company) return jsonError(503, 'Could not load your billing details. Try again in a moment.');
  if (companyHasLiveSubscription(company)) {
    return usePortal(
      company.subscription_status === 'past_due'
        ? 'Your payment is past due. Update your card in the billing portal.'
        : 'You already have a subscription. Manage it in the billing portal.'
    );
  }

  try {
    const stripe = getStripe();
    let customerId = company.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          name: ctx.company.name,
          email: ctx.user.email,
          address: { country: 'CA', state: ctx.company.province },
          metadata: { company_id: ctx.company.id },
        },
        { idempotencyKey: `customer:${ctx.company.id}:${ctx.user.id}` }
      );
      customerId = customer.id;
      const { error } = await createSupabaseAdminClient().from('companies').update({ stripe_customer_id: customerId }).eq('id', ctx.company.id);
      if (error) throw error;
    } else if (await findLiveSubscription(stripe, customerId)) {
      // Our copy can lag behind Stripe if a webhook is delayed; Stripe decides
      return usePortal('You already have a subscription. Manage it in the billing portal.');
    }

    const price = env.stripePriceId();
    const site = env.siteUrl();
    // A double click or quick retry gets the same session rather than a second one
    const bucket = Math.floor(Date.now() / IDEMPOTENCY_WINDOW_MS);
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: ctx.company.id,
        line_items: [{ price, quantity: 1 }],
        subscription_data: { metadata: { company_id: ctx.company.id } },
        // GST/HST/PST via Stripe Tax — turn on in the Stripe dashboard, then set STRIPE_AUTOMATIC_TAX=true
        automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === 'true' },
        customer_update: { address: 'auto', name: 'auto' },
        tax_id_collection: { enabled: true },
        allow_promotion_codes: true,
        success_url: `${site}/settings/billing?checkout=success`,
        cancel_url: `${site}/settings/billing?checkout=cancelled`,
      },
      { idempotencyKey: `checkout:${ctx.company.id}:${price}:${bucket}` }
    );
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Checkout failed', err);
    return NextResponse.json({ error: 'Could not start checkout. Try again shortly.' }, { status: 502 });
  }
}
