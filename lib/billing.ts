import Stripe from 'stripe';
import { env } from '@/lib/env';

let stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (!stripe) stripe = new Stripe(env.stripeSecretKey(), { apiVersion: '2023-10-16', typescript: true });
  return stripe;
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
