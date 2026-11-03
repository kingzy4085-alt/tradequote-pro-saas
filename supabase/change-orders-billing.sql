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
