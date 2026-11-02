create table if not exists labour_rates (

 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,

 classification text not null,

 hourly_rate numeric(12,2) not null,

 created_at timestamptz default now()

);

create table if not exists material_catalog (

 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,

 material_code text,

 description text,

 unit_cost numeric(12,2),

 supplier text

);

create table if not exists estimate_lines (

 id uuid primary key default gen_random_uuid(),

 estimate_id uuid,

 company_id uuid,

 item_type text,

 description text,

 quantity numeric,

 unit_cost numeric,

 markup numeric,

 total numeric

);

