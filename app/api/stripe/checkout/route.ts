import { supabase, supabaseAdmin } from '@/lib/supabase';
import { fail, ok } from '@/lib/api-helpers';
import { TIERS, lookupKey, stripe, type Tier } from '@/lib/stripe';

// Starts Stripe Checkout for the signed-in company's subscription
export async function POST(request: Request) {
  if (!stripe || !supabase || !supabaseAdmin) return fail('Billing is not set up yet.', 503);
  const body = await request.json().catch(() => ({}));
  const tier = body.tier as Tier;
  const interval = body.interval === 'annual' ? 'annual' : 'monthly';
  if (!TIERS.includes(tier)) return fail('Choose a plan.', 400);

  const { data: { user } } = await supabase.auth.getUser();
  const { data: companyId } = await supabase.rpc('current_company_id');
  if (!user || !companyId) return fail('Sign in first.', 401);
  const { data: company } = await supabase.from('companies').select('id, company_name, email, stripe_customer_id, subscription_status').eq('id', companyId).maybeSingle();
  if (!company) return fail('Company not found.', 404);
  if (['active', 'trialing', 'past_due'].includes(company.subscription_status) && company.stripe_customer_id)
    return fail('You already have a subscription. Use Manage billing to change plans.', 409);

  const prices = await stripe.prices.list({ lookup_keys: [lookupKey(tier, interval)], limit: 1 });
  if (!prices.data[0]) return fail('That plan isn\'t available yet.', 503);

  let customer = company.stripe_customer_id as string | null;
  if (!customer) {
    customer = (await stripe.customers.create({ name: company.company_name, email: company.email || user.email, metadata: { company_id: company.id } })).id;
    // Customer id is written with the service client: members can't edit billing fields directly
    await supabaseAdmin.from('companies').update({ stripe_customer_id: customer }).eq('id', company.id);
  }

  const origin = new URL(request.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: company.id,
    line_items: [{ price: prices.data[0].id, quantity: 1 }],
    subscription_data: { metadata: { company_id: company.id, tier } },
    metadata: { company_id: company.id, tier },
    allow_promotion_codes: true,
    automatic_tax: { enabled: false },
    success_url: `${origin}/billing?checkout=success`,
    cancel_url: `${origin}/billing?checkout=cancelled`,
  });
  return ok({ url: session.url });
}
