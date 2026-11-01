create extension if not exists pgcrypto;

create table companies (

 id uuid primary key default gen_random_uuid(),

 created_at timestamptz default now(),

 company_name text not null,

 subscription_plan text default 'free',

 active boolean default true

);

create table company_users (

 id uuid primary key default gen_random_uuid(),

 user_id uuid not null,

 company_id uuid not null references companies(id),

 role text not null default 'electrician',

 created_at timestamptz default now()

);

create table if not exists projects (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 created_at timestamptz default now(),

 name text,

 status text

);

create index if not exists idx_projects_company
on projects(company_id);


create table if not exists estimates (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 created_at timestamptz default now(),

 name text,

 status text

);

create index if not exists idx_estimates_company
on estimates(company_id);


create table if not exists estimate_lines (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 created_at timestamptz default now(),

 name text,

 status text

);

create index if not exists idx_estimate_lines_company
on estimate_lines(company_id);


create table if not exists proposals (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 created_at timestamptz default now(),

 name text,

 status text

);

create index if not exists idx_proposals_company
on proposals(company_id);


create table if not exists rfis (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 created_at timestamptz default now(),

 name text,

 status text

);

create index if not exists idx_rfis_company
on rfis(company_id);


create table if not exists timecards (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 created_at timestamptz default now(),

 name text,

 status text

);

create index if not exists idx_timecards_company
on timecards(company_id);


create table if not exists inventory (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 created_at timestamptz default now(),

 name text,

 status text

);

create index if not exists idx_inventory_company
on inventory(company_id);


create table if not exists job_costing (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 created_at timestamptz default now(),

 name text,

 status text

);

create index if not exists idx_job_costing_company
on job_costing(company_id);


alter table projects enable row level security;


alter table estimates enable row level security;


alter table proposals enable row level security;


alter table rfis enable row level security;


alter table timecards enable row level security;


alter table inventory enable row level security;


alter table job_costing enable row level security;

