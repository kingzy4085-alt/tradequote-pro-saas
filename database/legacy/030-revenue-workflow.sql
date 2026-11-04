
create table if not exists customers (

 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,

 name text not null,
 contact_name text,
 email text,
 phone text,

 created_at timestamptz default now()

);

create table if not exists projects (

 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,

 customer_id uuid,
 project_number text,
 project_name text,

 status text default 'active',

 created_at timestamptz default now()

);

create table if not exists estimate_headers (

 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,

 customer_id uuid,

 estimate_number text,

 status text default 'draft',

 created_at timestamptz default now()

);

create table if not exists proposal_headers (

 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,

 estimate_id uuid,

 proposal_number text,

 status text default 'pending',

 created_at timestamptz default now()

);

