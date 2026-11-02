import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, subscriptionUpdate } from '@/lib/billing';
import { env } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const HANDLED = new Set(['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);

// Stripe → subscription state on the company. Signature-verified and idempotent.
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, env.stripeWebhookSecret());
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  if (!HANDLED.has(event.type)) return NextResponse.json({ received: true });

  const admin = createSupabaseAdminClient();
  const { error: dupError } = await admin.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dupError?.code === '23505') return NextResponse.json({ received: true, duplicate: true });
  if (dupError) {
    console.error('Could not record Stripe event', dupError);
    return NextResponse.json({ error: 'Storage error' }, { status: 500 });
  }

  try {
    let subscription: Stripe.Subscription | null = null;
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription' && typeof session.subscription === 'string') {
        subscription = await stripe.subscriptions.retrieve(session.subscription);
      }
    } else {
      subscription = event.data.object as Stripe.Subscription;
    }

    if (subscription) {
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
      const { data, error } = await admin.from('companies').update(subscriptionUpdate(subscription)).eq('stripe_customer_id', customerId).select('id');
      if (error) throw error;
      if (!data?.length) console.warn(`Stripe event ${event.id}: no company for customer ${customerId}`);
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`Stripe webhook ${event.type} failed`, err);
    // Let Stripe retry: forget the event so the retry isn't treated as a duplicate
    await admin.from('stripe_events').delete().eq('id', event.id);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }
}
