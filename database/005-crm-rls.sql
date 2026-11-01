
alter table crm
enable row level security;

create policy crm_company_policy

on crm

for all

using (

 company_id in (

   select company_id

   from company_users

   where user_id =
   auth.uid()

 )

);

