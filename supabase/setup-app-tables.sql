-- TradeQuote PRO: creates every table the app saves to. Safe to run more than once.
-- Run in Supabase: SQL Editor > New query > paste all > Run.

create table if not exists public."ai_generate_proposal" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."ai_generate_proposal" enable row level security;

create table if not exists public."asset-tracking" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."asset-tracking" enable row level security;

create table if not exists public."cable-testing" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."cable-testing" enable row level security;

create table if not exists public."change-orders" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."change-orders" enable row level security;

create table if not exists public."commissioning" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."commissioning" enable row level security;

create table if not exists public."company_users" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."company_users" enable row level security;

create table if not exists public."crew-schedule" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."crew-schedule" enable row level security;

create table if not exists public."crm" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text,
  "clientName" text,
  "contactPerson" text,
  phone text,
  email text,
  "projectSite" text
);
alter table public."crm" add column if not exists "clientName" text;
alter table public."crm" add column if not exists "contactPerson" text;
alter table public."crm" add column if not exists phone text;
alter table public."crm" add column if not exists email text;
alter table public."crm" add column if not exists "projectSite" text;
alter table public."crm" enable row level security;

create table if not exists public."customers" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."customers" enable row level security;

create table if not exists public."daily-logs" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."daily-logs" enable row level security;

create table if not exists public."daily_logs" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."daily_logs" enable row level security;

create table if not exists public."defect-liability" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."defect-liability" enable row level security;

create table if not exists public."documents" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."documents" enable row level security;

create table if not exists public."drawings" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."drawings" enable row level security;

create table if not exists public."employees" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."employees" enable row level security;

create table if not exists public."equipment" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."equipment" enable row level security;

create table if not exists public."equipment-rentals" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."equipment-rentals" enable row level security;

create table if not exists public."field-logs" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."field-logs" enable row level security;

create table if not exists public."fleet" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."fleet" enable row level security;

create table if not exists public."hiring" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."hiring" enable row level security;

create table if not exists public."inspections" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."inspections" enable row level security;

create table if not exists public."inventory" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."inventory" enable row level security;

create table if not exists public."invoices" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."invoices" enable row level security;

create table if not exists public."job-costing" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."job-costing" enable row level security;

create table if not exists public."loto-permits" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."loto-permits" enable row level security;

create table if not exists public."maintenance" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."maintenance" enable row level security;

create table if not exists public."non-conformance" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."non-conformance" enable row level security;

create table if not exists public."payables" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."payables" enable row level security;

create table if not exists public."progress-billing" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."progress-billing" enable row level security;

create table if not exists public."purchase-orders" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."purchase-orders" enable row level security;

create table if not exists public."purchasing" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."purchasing" enable row level security;

create table if not exists public."quality-control" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."quality-control" enable row level security;

create table if not exists public."receivables" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."receivables" enable row level security;

create table if not exists public."rfi" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."rfi" enable row level security;

create table if not exists public."rfis" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."rfis" enable row level security;

create table if not exists public."rfp" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."rfp" enable row level security;

create table if not exists public."rfq" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."rfq" enable row level security;

create table if not exists public."safety-logs" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."safety-logs" enable row level security;

create table if not exists public."site-vault" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."site-vault" enable row level security;

create table if not exists public."submittals" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."submittals" enable row level security;

create table if not exists public."tailgate-logs" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."tailgate-logs" enable row level security;

create table if not exists public."tasks" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."tasks" enable row level security;

create table if not exists public."timecards" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."timecards" enable row level security;

create table if not exists public."tool-crib" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."tool-crib" enable row level security;

create table if not exists public."vehicles" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."vehicles" enable row level security;

create table if not exists public."vendors" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text,
  "vendorName" text,
  "tradeCategory" text,
  "contactPerson" text,
  phone text,
  email text,
  "wcbStatus" text,
  "insuranceExpiry" date
);
alter table public."vendors" add column if not exists "vendorName" text;
alter table public."vendors" add column if not exists "tradeCategory" text;
alter table public."vendors" add column if not exists "contactPerson" text;
alter table public."vendors" add column if not exists phone text;
alter table public."vendors" add column if not exists email text;
alter table public."vendors" add column if not exists "wcbStatus" text;
alter table public."vendors" add column if not exists "insuranceExpiry" date;
alter table public."vendors" enable row level security;

create table if not exists public."warehouse-inventory" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."warehouse-inventory" enable row level security;

create table if not exists public."warranty" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text
);
alter table public."warranty" enable row level security;

create table if not exists public."punch-list" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text,
  "itemTitle" text,
  "projectName" text,
  "assignedTrade" text,
  priority text,
  location text,
  "dueDate" date
);
alter table public."punch-list" add column if not exists "itemTitle" text;
alter table public."punch-list" add column if not exists "projectName" text;
alter table public."punch-list" add column if not exists "assignedTrade" text;
alter table public."punch-list" add column if not exists priority text;
alter table public."punch-list" add column if not exists location text;
alter table public."punch-list" add column if not exists "dueDate" date;
alter table public."punch-list" enable row level security;

create table if not exists public."sub-compliance" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  title text,
  status text default 'Active',
  description text,
  notes text,
  "companyName" text,
  "tradeType" text,
  "wcbAccountNumber" text,
  "generalLiabilityExpiry" date,
  "safetyCertVerified" boolean,
  "contactPerson" text
);
alter table public."sub-compliance" add column if not exists "companyName" text;
alter table public."sub-compliance" add column if not exists "tradeType" text;
alter table public."sub-compliance" add column if not exists "wcbAccountNumber" text;
alter table public."sub-compliance" add column if not exists "generalLiabilityExpiry" date;
alter table public."sub-compliance" add column if not exists "safetyCertVerified" boolean;
alter table public."sub-compliance" add column if not exists "contactPerson" text;
alter table public."sub-compliance" enable row level security;

alter table public."estimates" add column if not exists "projectName" text;
alter table public."estimates" add column if not exists "clientName" text;
alter table public."estimates" add column if not exists "markupPercentage" numeric;

alter table public."proposals" add column if not exists "proposalTitle" text;
alter table public."proposals" add column if not exists "clientName" text;
alter table public."proposals" add column if not exists "totalAmount" numeric;
alter table public."proposals" add column if not exists "scopeOfWork" text;
alter table public."proposals" add column if not exists terms text;
alter table public."proposals" add column if not exists "clientSignature" text;

alter table public."projects" add column if not exists title text;
alter table public."projects" add column if not exists description text;

-- Refresh the API so the new tables are visible immediately
notify pgrst, 'reload schema';
