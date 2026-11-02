create extension if not exists pgcrypto;

create table if not exists companies (

    id uuid primary key default gen_random_uuid(),

    created_at timestamptz default now(),

    company_name text not null,

    subscription_plan text default 'free',

    active boolean default true

);

create table if not exists company_users (

    id uuid primary key default gen_random_uuid(),

    created_at timestamptz default now(),

    user_id uuid not null,

    company_id uuid not null references companies(id),

    role text not null default 'employee'

);


alter table crm
add column if not exists company_id uuid;

create index if not exists idx_crm_company
on crm(company_id);


alter table estimates
add column if not exists company_id uuid;

create index if not exists idx_estimates_company
on estimates(company_id);


alter table proposals
add column if not exists company_id uuid;

create index if not exists idx_proposals_company
on proposals(company_id);


alter table vendors
add column if not exists company_id uuid;

create index if not exists idx_vendors_company
on vendors(company_id);


alter table warehouse_inventory
add column if not exists company_id uuid;

create index if not exists idx_warehouse_inventory_company
on warehouse_inventory(company_id);


alter table warranty
add column if not exists company_id uuid;

create index if not exists idx_warranty_company
on warranty(company_id);


alter table projects
add column if not exists company_id uuid;

create index if not exists idx_projects_company
on projects(company_id);


alter table employees
add column if not exists company_id uuid;

create index if not exists idx_employees_company
on employees(company_id);


alter table customers
add column if not exists company_id uuid;

create index if not exists idx_customers_company
on customers(company_id);


alter table tasks
add column if not exists company_id uuid;

create index if not exists idx_tasks_company
on tasks(company_id);


alter table purchase_orders
add column if not exists company_id uuid;

create index if not exists idx_purchase_orders_company
on purchase_orders(company_id);


alter table invoices
add column if not exists company_id uuid;

create index if not exists idx_invoices_company
on invoices(company_id);


alter table receivables
add column if not exists company_id uuid;

create index if not exists idx_receivables_company
on receivables(company_id);


alter table payables
add column if not exists company_id uuid;

create index if not exists idx_payables_company
on payables(company_id);


alter table inventory
add column if not exists company_id uuid;

create index if not exists idx_inventory_company
on inventory(company_id);


alter table equipment
add column if not exists company_id uuid;

create index if not exists idx_equipment_company
on equipment(company_id);

