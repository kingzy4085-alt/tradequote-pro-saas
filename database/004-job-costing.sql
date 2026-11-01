
create table if not exists job_costing (

 id uuid primary key default gen_random_uuid(),

 company_id uuid,

 project_id uuid,

 budget_labour numeric default 0,
 actual_labour numeric default 0,

 budget_material numeric default 0,
 actual_material numeric default 0,

 budget_hours numeric default 0,
 actual_hours numeric default 0

);

