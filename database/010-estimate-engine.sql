
create table if not exists labour_rates (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null,

 classification text not null,

 hourly_rate numeric(12,2) not null,

 burden_rate numeric(12,2) default 0

);

create table if not exists material_catalog (

 id uuid primary key default gen_random_uuid(),

 company_id uuid not null,

 sku text,

 description text,

 cost numeric(12,2),

 sell_price numeric(12,2)

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

