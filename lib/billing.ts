import Stripe from 'stripe';
import type { AppContext, Company } from '@/lib/context';
import { env } from '@/lib/env';

let stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (!stripe) stripe = new Stripe(env.stripeSecretKey(), { apiVersion: '2023-10-16', typescript: true });
  return stripe;
}

export type BilledCompany = Company & { stripe_customer_id: string | null; stripe_subscription_id: string | null };

/**
 * The company with its Stripe ids, for an owner or admin. Null if they could not be read: going on
 * without them would look like no subscription, and checkout would make a second Stripe customer.
 */
export async function withBillingIds(ctx: Pick<AppContext, 'supabase' | 'company'>): Promise<BilledCompany | null> {
  if (ctx.company.stripe_customer_id !== undefined) return { stripe_subscription_id: null, ...ctx.company, stripe_customer_id: ctx.company.stripe_customer_id };
  const { data, error } = await ctx.supabase.rpc('company_billing_ids');
  if (error) {
    console.error('Could not load company billing details', error);
    return null;
  }
  return { ...ctx.company, stripe_customer_id: null, stripe_subscription_id: null, ...(data && typeof data === 'object' ? data : {}) };
}

/** What we store on the company for a Stripe subscription state. Unknown states lock editing. */
export function companyStatusFromSubscription(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

/**
 * A company on its free trial keeps it until a subscription is actually running. A first payment
 * that failed, stalled, expired or was cancelled unpaid must not end the trial early.
 */
export function keepsFreeTrial(company: { subscription_status?: string | null; trial_ends_at?: string | null }, sub: Pick<Stripe.Subscription, 'status'>, now = new Date()): boolean {
  if (company.subscription_status !== 'trialing' || !company.trial_ends_at || !(new Date(company.trial_ends_at) > now)) return false;
  const next = companyStatusFromSubscription(sub.status);
  return next !== 'active' && next !== 'past_due';
}

/** Company columns to write for a subscription. past_due stays editable while Stripe retries the card. */
export function subscriptionUpdate(sub: Stripe.Subscription) {
  return {
    stripe_subscription_id: sub.id,
    subscription_status: companyStatusFromSubscription(sub.status),
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
  };
}

/** Stripe will never bill this subscription again. */
export function subscriptionEnded(status: Stripe.Subscription.Status): boolean {
  return status === 'canceled' || status === 'incomplete_expired';
}

/** Stripe is billing, or still trying to bill, this subscription; a second one would double-charge. */
export function subscriptionLive(status: Stripe.Subscription.Status): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due' || status === 'unpaid' || status === 'paused';
}

/** What this app already knows, before asking Stripe. A live company fixes billing in the portal, not by subscribing again. */
export function companyHasLiveSubscription(company: { subscription_status: string; stripe_subscription_id: string | null }): boolean {
  if (company.subscription_status === 'active' || company.subscription_status === 'past_due') return true;
  return !!company.stripe_subscription_id && company.subscription_status !== 'canceled' && company.subscription_status !== 'incomplete';
}

/** The newest live subscription for a customer, other than `exceptId`. */
export async function findLiveSubscription(client: Stripe, customerId: string, exceptId?: string): Promise<Stripe.Subscription | null> {
  const { data } = await client.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  const live = data.filter((s) => s.id !== exceptId && subscriptionLive(s.status)).sort((a, b) => b.created - a.created);
  return live[0] ?? null;
}
