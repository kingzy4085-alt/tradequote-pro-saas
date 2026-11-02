create table if not exists companies (

 id uuid primary key default gen_random_uuid(),

 company_name text not null,

 created_at timestamptz default now()

);

create table if not exists company_users (

 id uuid primary key default gen_random_uuid(),

 user_id uuid not null,

 company_id uuid references companies(id),

 role text not null

);
