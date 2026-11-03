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
