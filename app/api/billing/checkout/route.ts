import { NextResponse } from 'next/server';
import { jsonError, requireApi } from '@/lib/api';
import { getStripe } from '@/lib/billing';
import { env } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Starts a Stripe Checkout subscription for the caller's company (owner/admin only).
export async function POST() {
  const ctx = await requireApi({ minRank: 4 });
  if (ctx instanceof Response) return ctx;
  if (ctx.company.subscription_status === 'active') return jsonError(409, 'Your subscription is already active');

  try {
    const stripe = getStripe();
    let customerId = ctx.company.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: ctx.company.name,
        email: ctx.user.email,
        address: { country: 'CA', state: ctx.company.province },
        metadata: { company_id: ctx.company.id },
      });
      customerId = customer.id;
      const { error } = await createSupabaseAdminClient().from('companies').update({ stripe_customer_id: customerId }).eq('id', ctx.company.id);
      if (error) throw error;
    }

    const site = env.siteUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: ctx.company.id,
      line_items: [{ price: env.stripePriceId(), quantity: 1 }],
      subscription_data: { metadata: { company_id: ctx.company.id } },
      // GST/HST/PST via Stripe Tax — turn on in the Stripe dashboard, then set STRIPE_AUTOMATIC_TAX=true
      automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === 'true' },
      customer_update: { address: 'auto', name: 'auto' },
      tax_id_collection: { enabled: true },
      allow_promotion_codes: true,
      success_url: `${site}/settings/billing?checkout=success`,
      cancel_url: `${site}/settings/billing?checkout=cancelled`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Checkout failed', err);
    return jsonError(502, 'Could not start checkout. Try again shortly.');
  }
}
