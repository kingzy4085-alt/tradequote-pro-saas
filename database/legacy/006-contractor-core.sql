
create table if not exists projects (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 project_number text,

 project_name text,

 customer_id uuid,

 status text default 'active',

 created_at timestamptz default now()

);

create table if not exists estimate_lines (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 estimate_id uuid,

 description text,

 quantity numeric,

 unit_cost numeric,

 markup numeric,

 total numeric

);

create table if not exists labour_rates (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 classification text,

 hourly_rate numeric(12,2)

);

create table if not exists material_catalog (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 sku text,

 description text,

 unit_cost numeric(12,2)

);

create table if not exists change_orders (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null references companies(id),

 project_id uuid,

 amount numeric(12,2),

 status text

);

