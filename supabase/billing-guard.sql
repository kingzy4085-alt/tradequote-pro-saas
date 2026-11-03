-- TradeQuote PRO: only the server (Stripe webhook, service role) may change a company's billing fields.
-- Signed-in users can still edit their company profile; billing columns silently keep their old values.
-- Safe to run more than once. Run in Supabase: SQL Editor > New query > paste all > Run.

create or replace function public.protect_company_billing() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    new.subscription_plan := old.subscription_plan;
    new.subscription_status := old.subscription_status;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.current_period_end := old.current_period_end;
    new.trial_ends_at := old.trial_ends_at;
  end if;
  return new;
end $$;

drop trigger if exists protect_company_billing on public.companies;
create trigger protect_company_billing before update on public.companies
  for each row execute function public.protect_company_billing();
