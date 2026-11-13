import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { TIERS, stripe } from '@/lib/stripe';

// Stripe → company plan and status. Always reads the current subscription, so retries and out-of-order events are safe.
async function sync(subscriptionId: string, companyHint?: string | null) {
  const sub = await stripe!.subscriptions.retrieve(subscriptionId);
  const companyId = sub.metadata.company_id || companyHint;
  if (!companyId) return;
  const tier = TIERS.find((t) => t === sub.metadata.tier) || ((sub.items.data[0] as any)?.price.lookup_key || '').split('_')[1] || 'free';
  const periodEnd = (sub as any).current_period_end ?? (sub.items.data[0] as any)?.current_period_end;
  const { error } = await supabaseAdmin!
    .from('companies')
    .update({
      subscription_plan: sub.status === 'canceled' ? 'free' : tier,
      subscription_status: sub.status,
      stripe_subscription_id: sub.id,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    })
    .eq('id', companyId);
  if (error) throw new Error(error.message);
}

export async function POST(request: Request) {
  if (!stripe || !supabaseAdmin || !process.env.STRIPE_WEBHOOK_SECRET) return NextResponse.json({ error: 'Billing not configured' }, { status: 503 });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), request.headers.get('stripe-signature') || '', process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 });
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === 'subscription' && s.subscription) await sync(String(s.subscription), s.client_reference_id);
    } else if (event.type.startsWith('customer.subscription.')) {
      await sync((event.data.object as Stripe.Subscription).id);
    }
  } catch (e: any) {
    // 500 makes Stripe retry later
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
