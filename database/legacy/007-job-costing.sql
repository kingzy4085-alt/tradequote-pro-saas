
create table if not exists job_costing (

 id uuid primary key default gen_random_uuid(),

 company_id uuid,

 project_id uuid,

 budget_hours numeric,

 actual_hours numeric,

 budget_labour numeric,

 actual_labour numeric,

 budget_material numeric,

 actual_material numeric

);

