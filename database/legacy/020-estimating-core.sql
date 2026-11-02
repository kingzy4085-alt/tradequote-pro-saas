
create table if not exists labour_rates (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 classification text not null,
 burden_rate numeric(12,2),
 hourly_rate numeric(12,2)
);

create table if not exists materials (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 sku text,
 description text,
 unit_cost numeric(12,2),
 unit_price numeric(12,2)
);

create table if not exists estimate_lines (
 id uuid primary key default gen_random_uuid(),
 estimate_id uuid not null,
 company_id uuid not null,
 description text,
 quantity numeric,
 labour_hours numeric,
 material_cost numeric,
 markup numeric,
 total numeric
);

