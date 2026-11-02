import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isRole, type Role } from '@/lib/roles';

export interface Company {
  id: string;
  name: string;
  province: string;
  subscription_status: string;
  trial_ends_at: string;
  current_period_end: string | null;
  stripe_customer_id: string | null;
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
  | { status: 'no-company'; supabase: SupabaseClient; user: User };

export function subscriptionAllowsWrite(company: Pick<Company, 'subscription_status' | 'trial_ends_at'>, now = new Date()): boolean {
  // past_due keeps working while Stripe retries the card
  if (company.subscription_status === 'active' || company.subscription_status === 'past_due') return true;
  return company.subscription_status === 'trialing' && new Date(company.trial_ends_at) > now;
}

/** Resolves who is calling and which company they belong to. Never trusts anything sent by the client. */
export async function getContext(): Promise<ContextResult> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'signed-out' };

  const { data: membership } = await supabase
    .from('company_users')
    .select('role, company:companies(id, name, province, subscription_status, trial_ends_at, current_period_end, stripe_customer_id)')
    .eq('user_id', user.id)
    .maybeSingle();

  const company = (membership?.company ?? null) as Company | null;
  if (!membership || !company || !isRole(membership.role)) {
    return { status: 'no-company', supabase, user };
  }
  return {
    status: 'ok',
    ctx: { supabase, user, role: membership.role, company, canWrite: subscriptionAllowsWrite(company) },
  };
}
