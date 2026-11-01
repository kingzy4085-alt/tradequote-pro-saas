
create table if not exists customers (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null,

 name text not null,

 contact_name text,

 email text,

 phone text,

 created_at timestamptz default now()

);

create table if not exists estimate_headers (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null,

 customer_id uuid,

 estimate_number text,

 estimate_name text,

 status text default 'draft',

 total numeric(12,2) default 0,

 created_at timestamptz default now()

);

create table if not exists estimate_lines (

 id uuid primary key default gen_random_uuid(),

 estimate_id uuid,

 company_id uuid,

 description text,

 quantity numeric,

 unit_price numeric,

 total numeric

);

create table if not exists proposal_headers (

 id uuid primary key default gen_random_uuid(),

 company_id uuid,

 estimate_id uuid,

 proposal_number text,

 status text default 'draft',

 created_at timestamptz default now()

);

