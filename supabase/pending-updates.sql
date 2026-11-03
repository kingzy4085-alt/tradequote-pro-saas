-- All pending TradeQuote PRO database updates in one file (change orders + invoices, field records + job costing,
-- billing guard). Safe to run more than once. Supabase: SQL Editor > New query > paste all > Run.

-- ===== change-orders-billing.sql =====
-- TradeQuote PRO Phase 3: priced change orders with client sign-off, and invoices that bill
-- approved change orders and progress percentages of estimates. Safe to run more than once.
-- Run in Supabase: SQL Editor > New query > paste all > Run.

alter table public."change-orders" add column if not exists co_number integer;
alter table public."change-orders" add column if not exists project text;
alter table public."change-orders" add column if not exists client_name text;
alter table public."change-orders" add column if not exists estimate_id bigint;
alter table public."change-orders" add column if not exists reason text;
alter table public."change-orders" add column if not exists scope text;
alter table public."change-orders" add column if not exists material_cost numeric default 0;
alter table public."change-orders" add column if not exists labour_hours numeric default 0;
alter table public."change-orders" add column if not exists labour_rate numeric default 0;
alter table public."change-orders" add column if not exists markup_pct numeric default 0;
alter table public."change-orders" add column if not exists tax_pct numeric default 0;
alter table public."change-orders" add column if not exists price numeric default 0;
alter table public."change-orders" add column if not exists tax numeric default 0;
alter table public."change-orders" add column if not exists total numeric default 0;
alter table public."change-orders" add column if not exists approved_by text;
alter table public."change-orders" add column if not exists approval_signature text;
alter table public."change-orders" add column if not exists approved_at timestamptz;
alter table public."change-orders" add column if not exists invoice_id uuid;
alter table public."change-orders" alter column status set default 'Draft';

alter table public.invoices add column if not exists invoice_number integer;
alter table public.invoices add column if not exists project text;
alter table public.invoices add column if not exists client_name text;
alter table public.invoices add column if not exists client_address text;
alter table public.invoices add column if not exists issue_date date default current_date;
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists lines jsonb not null default '[]';
alter table public.invoices add column if not exists tax_pct numeric default 5;
alter table public.invoices add column if not exists holdback_pct numeric default 0;
alter table public.invoices add column if not exists subtotal numeric default 0;
alter table public.invoices add column if not exists tax numeric default 0;
alter table public.invoices add column if not exists holdback numeric default 0;
alter table public.invoices add column if not exists total numeric default 0;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices alter column status set default 'Draft';

notify pgrst, 'reload schema';

-- ===== field-records-costing.sql =====
-- TradeQuote PRO: safety inspections, tailgate meetings and LOTO permits (fields, photos, sign-offs),
-- timecards by job, and job-cost entries. Safe to run more than once.
-- Run in Supabase: SQL Editor > New query > paste all > Run.

do $$
declare t text;
begin
  foreach t in array array['safety-logs', 'tailgate-logs', 'loto-permits'] loop
    execute format('alter table public.%I add column if not exists project text', t);
    execute format('alter table public.%I add column if not exists record_date date default current_date', t);
    execute format('alter table public.%I add column if not exists data jsonb not null default ''{}''', t);
    execute format('alter table public.%I add column if not exists signatures jsonb not null default ''[]''', t);
    execute format('alter table public.%I add column if not exists photos jsonb not null default ''[]''', t);
  end loop;
end $$;

alter table public.timecards add column if not exists project text;
alter table public.timecards add column if not exists task text;
alter table public.timecards alter column company_id set default public.current_company_id();
alter table public.companies add column if not exists overtime_multiplier numeric default 1.5;

alter table public."job-costing" add column if not exists project text;
alter table public."job-costing" add column if not exists category text;
alter table public."job-costing" add column if not exists vendor text;
alter table public."job-costing" add column if not exists amount numeric default 0;
alter table public."job-costing" add column if not exists cost_date date default current_date;

notify pgrst, 'reload schema';

-- ===== billing-guard.sql =====
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
