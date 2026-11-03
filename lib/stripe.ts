import Stripe from 'stripe';

export const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export const TIERS = ['field', 'crew', 'contractor'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_NAMES: Record<Tier, string> = { field: 'Field', crew: 'Crew', contractor: 'Contractor' };
export const TIER_MONTHLY: Record<Tier, number> = { field: 99, crew: 299, contractor: 699 };

// Price lookup keys created by scripts/stripe-setup.mjs
export const lookupKey = (tier: Tier, interval: 'monthly' | 'annual') => `tq_${tier}_${interval}`;
