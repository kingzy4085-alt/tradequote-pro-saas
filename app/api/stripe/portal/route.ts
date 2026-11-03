import { supabase } from '@/lib/supabase';
import { fail, ok } from '@/lib/api-helpers';
import { stripe } from '@/lib/stripe';

// Stripe's billing portal: change plan, update card, see invoices, cancel
export async function POST(request: Request) {
  if (!stripe || !supabase) return fail('Billing is not set up yet.', 503);
  const { data: companyId } = await supabase.rpc('current_company_id');
  const { data: company } = await supabase.from('companies').select('stripe_customer_id').eq('id', companyId).maybeSingle();
  if (!company?.stripe_customer_id) return fail('No subscription yet. Choose a plan first.', 400);
  const session = await stripe.billingPortal.sessions.create({ customer: company.stripe_customer_id, return_url: `${new URL(request.url).origin}/billing` });
  return ok({ url: session.url });
}
