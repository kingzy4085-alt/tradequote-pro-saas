import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { findLiveSubscription, getStripe, subscriptionEnded, subscriptionLive, subscriptionUpdate } from '@/lib/billing';
import { env } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const HANDLED = new Set(['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);

interface CompanyBilling {
  id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}
const COMPANY_COLUMNS = 'id, stripe_customer_id, stripe_subscription_id';

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : (value?.id ?? null));

/** Stripe answers a missing object with resource_missing; anything else should be retried. */
async function retrieveOrNull(stripe: Stripe, id: string): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch (err) {
    if ((err as { code?: string }).code === 'resource_missing') return null;
    throw err;
  }
}

/** Which subscription an event is about, and the company id it carries if any. Only ids are read from the event. */
function subjectOf(event: Stripe.Event): { subscriptionId: string | null; companyId: string | null } {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== 'subscription') return { subscriptionId: null, companyId: null };
    return { subscriptionId: idOf(session.subscription), companyId: session.client_reference_id ?? session.metadata?.company_id ?? null };
  }
  return { subscriptionId: (event.data.object as Stripe.Subscription).id, companyId: null };
}

/** Finds the company by Stripe customer, then by the company id set at checkout. */
async function findCompany(admin: SupabaseClient, customerId: string, companyIds: (string | null | undefined)[]): Promise<CompanyBilling | null> {
  const byCustomer = await admin.from('companies').select(COMPANY_COLUMNS).eq('stripe_customer_id', customerId).maybeSingle();
  if (byCustomer.error) throw byCustomer.error;
  if (byCustomer.data) return byCustomer.data as CompanyBilling;

  for (const id of companyIds) {
    if (!id || !uuidSchema.safeParse(id).success) continue;
    const byId = await admin.from('companies').select(COMPANY_COLUMNS).eq('id', id).maybeSingle();
    if (byId.error) throw byId.error;
    const company = byId.data as CompanyBilling | null;
    if (!company) continue;
    // Metadata can't move a subscription onto a company that already bills through another customer
    if (company.stripe_customer_id && company.stripe_customer_id !== customerId) {
      console.warn(`Company ${company.id} bills through another customer; ignoring ${customerId}`);
      return null;
    }
    return company;
  }
  return null;
}

/**
 * Decides which subscription the company should now reflect, or null to change nothing.
 * Reads Stripe's current state, so the order events arrive in doesn't matter.
 */
async function subscriptionToApply(stripe: Stripe, company: CompanyBilling, incoming: Stripe.Subscription, customerId: string): Promise<Stripe.Subscription | null> {
  const currentId = company.stripe_subscription_id;
  if (currentId && currentId !== incoming.id) {
    const current = await retrieveOrNull(stripe, currentId);
    // An unfinished first payment shouldn't lock out a company paying on another subscription
    const unpaidAttempt = current?.status === 'incomplete' && subscriptionLive(incoming.status);
    if (current && !subscriptionEnded(current.status) && !unpaidAttempt) return null;
    // The current one is over: only a subscription still running can replace it
    if (subscriptionEnded(incoming.status)) return null;
    return incoming;
  }
  // The company's subscription ended, but it may have paid for another one (say, a duplicate)
  if (subscriptionEnded(incoming.status)) return (await findLiveSubscription(stripe, customerId, incoming.id)) ?? incoming;
  return incoming;
}

// Stripe → subscription state on the company. Signature-verified and safe to run more than once.
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  // A 500 makes Stripe retry, which is right for our own misconfiguration. A 400 means the sender is wrong.
  let stripe: Stripe;
  let webhookSecret: string;
  let admin: SupabaseClient;
  try {
    stripe = getStripe();
    webhookSecret = env.stripeWebhookSecret();
    admin = createSupabaseAdminClient();
  } catch (err) {
    console.error('Stripe webhook is not configured', err);
    return NextResponse.json({ error: 'Webhook is not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  if (!HANDLED.has(event.type)) return NextResponse.json({ received: true });

  // Only an event with processed_at is finished. A row without it is an attempt that
  // crashed or is still running; handling is idempotent, so running it again is safe.
  const { error: recordError } = await admin.from('stripe_events').insert({ id: event.id, type: event.type });
  if (recordError?.code === '23505') {
    const { data: seen, error: readError } = await admin.from('stripe_events').select('processed_at').eq('id', event.id).maybeSingle();
    if (readError) {
      console.error('Could not read Stripe event', readError);
      return NextResponse.json({ error: 'Storage error' }, { status: 500 });
    }
    if (seen?.processed_at) return NextResponse.json({ received: true, duplicate: true });
  } else if (recordError) {
    console.error('Could not record Stripe event', recordError);
    return NextResponse.json({ error: 'Storage error' }, { status: 500 });
  }

  try {
    const { subscriptionId, companyId } = subjectOf(event);
    const incoming = subscriptionId ? await retrieveOrNull(stripe, subscriptionId) : null;
    if (incoming) {
      const customerId = idOf(incoming.customer)!;
      const company = await findCompany(admin, customerId, [incoming.metadata?.company_id, companyId]);
      if (!company) {
        console.warn(`Stripe event ${event.id}: no company for customer ${customerId}`);
      } else {
        const apply = await subscriptionToApply(stripe, company, incoming, customerId);
        if (apply) {
          const { error } = await admin
            .from('companies')
            .update({ ...subscriptionUpdate(apply), stripe_customer_id: customerId })
            .eq('id', company.id);
          if (error) throw error;
        } else {
          console.warn(`Stripe event ${event.id}: ${incoming.id} is not company ${company.id}'s current subscription; ignored`);
        }
      }
    }
    const { error: doneError } = await admin.from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
    if (doneError) throw doneError;
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`Stripe webhook ${event.type} failed`, err);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }
}
