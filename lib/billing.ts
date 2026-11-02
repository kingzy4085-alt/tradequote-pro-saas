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
