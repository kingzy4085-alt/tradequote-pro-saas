import type { SupabaseClient, User } from '@supabase/supabase-js';
import * as React from 'react';
import { isTransientAuthError } from '@/lib/supabase/auth-error';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isRole, type Role } from '@/lib/roles';

export interface Company {
  id: string;
  name: string;
  province: string;
  subscription_status: string;
  trial_ends_at: string;
  current_period_end: string | null;
  /** Not on the context: nobody signed in can read these columns directly. withBillingIds fetches them for owners and admins. */
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
}

export interface AppContext {
  supabase: SupabaseClient;
  user: User;
  role: Role;
  company: Company;
  /** Subscription is active, or the trial hasn't ended. Mirrors public.company_can_write(). */
  canWrite: boolean;
}

export type ContextResult =
  | { status: 'ok'; ctx: AppContext }
  | { status: 'signed-out' }
  | { status: 'no-company'; supabase: SupabaseClient; user: User }
  /** Auth or the database could not answer. Says nothing about who this is, so don't redirect on it. */
  | { status: 'error' };

export function subscriptionAllowsWrite(company: Pick<Company, 'subscription_status' | 'trial_ends_at'>, now = new Date()): boolean {
  // past_due keeps working while Stripe retries the card
  if (company.subscription_status === 'active' || company.subscription_status === 'past_due') return true;
  return company.subscription_status === 'trialing' && new Date(company.trial_ends_at) > now;
}

/** The lookup behind getContext. Exported for tests; app code should call getContext. */
export async function resolveContext(): Promise<ContextResult> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (!user) {
    if (isTransientAuthError(authError)) {
      console.error('Could not reach Supabase Auth', authError);
      return { status: 'error' };
    }
    return { status: 'signed-out' };
  }

  const { data: membership, error } = await supabase
    .from('company_users')
    .select('role, company:companies(id, name, province, subscription_status, trial_ends_at, current_period_end)')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.error('Could not load company membership', error);
    return { status: 'error' };
  }

  const company = (membership?.company ?? null) as unknown as Company | null;
  if (!membership || !company || !isRole(membership.role)) {
    return { status: 'no-company', supabase, user };
  }
  return {
    status: 'ok',
    ctx: { supabase, user, role: membership.role, company, canWrite: subscriptionAllowsWrite(company) },
  };
}

// React's cache() only exists in the server build Next provides; elsewhere (tests) it runs uncached.
const requestCache = ((React as unknown as { cache?: <T extends (...args: never[]) => unknown>(fn: T) => T }).cache ?? ((fn) => fn)) as <T extends (...args: never[]) => unknown>(fn: T) => T;

/**
 * Resolves who is calling and which company they belong to. Never trusts anything
 * sent by the client. A layout and page in the same request share one lookup.
 */
export const getContext = requestCache(resolveContext);

/** For server components: a failed lookup goes to the nearest error boundary, not to login or onboarding. */
export async function getPageContext(): Promise<Exclude<ContextResult, { status: 'error' }>> {
  const result = await getContext();
  if (result.status === 'error') throw new Error('Could not load your account. Try again in a moment.');
  return result;
}
