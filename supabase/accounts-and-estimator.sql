-- TradeQuote PRO Phase 1: per-company data isolation for the app modules, and estimator line items.
-- Builds on the existing companies / company_users tables and the current_company_id() and
-- create_company(p_name) functions already in the database. Safe to run more than once.
-- Run in Supabase: SQL Editor > New query > paste all > Run.
-- Rows saved before this have no company and stop showing for everyone.

alter table public.companies add column if not exists province text default 'SK';
alter table public.companies add column if not exists contact text;
alter table public.companies add column if not exists default_markup numeric default 15;
alter table public.companies add column if not exists default_tax numeric default 5;
alter table public.companies add column if not exists default_labour_rate numeric default 0;

create table if not exists public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  estimate_id bigint not null,
  description text,
  quantity numeric default 1,
  unit text default 'ea',
  material_unit_cost numeric default 0,
  labour_hours_per_unit numeric default 0,
  sort integer default 0
);
-- estimates.id is a number; an earlier draft of this script used uuid
do $$ begin
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'estimate_items' and column_name = 'estimate_id') = 'uuid' then
    delete from public.estimate_items;
    alter table public.estimate_items alter column estimate_id type bigint using null;
  end if;
end $$;
alter table public.estimate_items enable row level security;
create index if not exists estimate_items_estimate on public.estimate_items(estimate_id);

alter table public.estimates add column if not exists "labourRate" numeric default 0;
alter table public.estimates add column if not exists "taxPercentage" numeric default 5;
alter table public.estimates add column if not exists scope text;
alter table public.estimates add column if not exists terms text;
alter table public.estimates add column if not exists "clientAddress" text;
alter table public.estimates add column if not exists status text default 'Draft';

-- App module tables without a company yet: company_id filled in automatically, and only your
-- company's rows are visible. Tables that already have company_id keep their existing rules.
do $$
declare t text; p record;
begin
  foreach t in array array[
    'ai_generate_proposal','asset-tracking','cable-testing','change-orders','commissioning','crew-schedule','crm',
    'daily-logs','daily_logs','defect-liability','documents','drawings','employees','equipment',
    'equipment-rentals','estimates','estimate_items','field-logs','fleet','hiring','inspections','inventory','invoices',
    'job-costing','loto-permits','maintenance','non-conformance','payables','progress-billing','proposals',
    'punch-list','purchase-orders','purchasing','quality-control','receivables','rfi','rfis','rfp','rfq','safety-logs',
    'site-vault','sub-compliance','submittals','tailgate-logs','tasks','tool-crib','vehicles','vendors',
    'warehouse-inventory','warranty'
  ] loop
    if to_regclass(format('public.%I', t)) is null then continue; end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'company_id')
       and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'company_select') then
      continue;
    end if;
    execute format('alter table public.%I add column if not exists company_id uuid default public.current_company_id() references public.companies(id) on delete cascade', t);
    execute format('create index if not exists %I on public.%I(company_id)', replace(t, '-', '_') || '_company', t);
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy company_select on public.%I for select to authenticated using (company_id = public.current_company_id())', t);
    execute format('create policy company_insert on public.%I for insert to authenticated with check (company_id = public.current_company_id())', t);
    execute format('create policy company_update on public.%I for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id())', t);
    execute format('create policy company_delete on public.%I for delete to authenticated using (company_id = public.current_company_id())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Company profile: members read it, owners and admins edit it (only if no such rules exist yet)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and cmd in ('SELECT', 'ALL')) then
    create policy company_read on public.companies for select to authenticated using (id = public.current_company_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and cmd in ('UPDATE', 'ALL')) then
    create policy company_update on public.companies for update to authenticated
      using (id = public.current_company_id() and public.has_company_role(array['owner','admin']));
  end if;
end $$;
grant select, update on public.companies to authenticated;

notify pgrst, 'reload schema';
