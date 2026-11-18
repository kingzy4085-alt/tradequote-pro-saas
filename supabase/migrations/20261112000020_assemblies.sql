-- Saved assemblies: a company's library of reusable groups of estimate lines ("100A Service",
-- "EV Charger"). The lines have the same shape as estimate_items, so adding an assembly to an
-- estimate is a copy and the estimate's totals stay worked out by the database.
-- Seen and edited by project managers and above, the same as estimates. Safe to run more than once.

create table if not exists public.assemblies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.user_company_id() references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120 and name = btrim(name)),
  category text not null default '' check (char_length(category) <= 60),
  -- set_updated_at pins this and company_id on every update, as it does on the other tables
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists assemblies_company_name_idx on public.assemblies(company_id, lower(name));
drop trigger if exists assemblies_updated on public.assemblies;
create trigger assemblies_updated before update on public.assemblies for each row execute function public.set_updated_at();

alter table public.assemblies enable row level security;
drop policy if exists assemblies_select on public.assemblies;
create policy assemblies_select on public.assemblies for select to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3);
drop policy if exists assemblies_insert on public.assemblies;
create policy assemblies_insert on public.assemblies for insert to authenticated
  with check (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write());
drop policy if exists assemblies_update on public.assemblies;
create policy assemblies_update on public.assemblies for update to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write())
  with check (company_id = public.user_company_id());
drop policy if exists assemblies_delete on public.assemblies;
create policy assemblies_delete on public.assemblies for delete to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write());
revoke all on public.assemblies from anon, authenticated;
grant select, insert, update, delete on public.assemblies to authenticated;

create table if not exists public.assembly_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.user_company_id() references public.companies(id) on delete cascade,
  assembly_id uuid not null references public.assemblies(id) on delete cascade,
  sort integer not null default 0,
  description text not null default '' check (char_length(description) <= 500),
  quantity numeric(14,3) not null default 1 check (quantity >= 0),
  unit text not null default 'ea' check (char_length(unit) <= 20),
  material_unit_cost numeric(14,2) not null default 0 check (material_unit_cost >= 0),
  labour_hours_per_unit numeric(12,3) not null default 0 check (labour_hours_per_unit >= 0)
);
create index if not exists assembly_lines_assembly_idx on public.assembly_lines(assembly_id, sort);

alter table public.assembly_lines enable row level security;
drop policy if exists assembly_lines_select on public.assembly_lines;
create policy assembly_lines_select on public.assembly_lines for select to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3
         and exists (select 1 from public.assemblies a where a.id = assembly_id and a.company_id = assembly_lines.company_id));
drop policy if exists assembly_lines_insert on public.assembly_lines;
create policy assembly_lines_insert on public.assembly_lines for insert to authenticated
  with check (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write()
              and exists (select 1 from public.assemblies a where a.id = assembly_id and a.company_id = assembly_lines.company_id));
drop policy if exists assembly_lines_update on public.assembly_lines;
create policy assembly_lines_update on public.assembly_lines for update to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write())
  with check (company_id = public.user_company_id()
              and exists (select 1 from public.assemblies a where a.id = assembly_id and a.company_id = assembly_lines.company_id));
drop policy if exists assembly_lines_delete on public.assembly_lines;
create policy assembly_lines_delete on public.assembly_lines for delete to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write());
revoke all on public.assembly_lines from anon, authenticated;
grant select, insert, update, delete on public.assembly_lines to authenticated;

-- Creates an assembly (p_id null) or replaces one, with its lines, in one transaction.
-- Runs as the caller, so the policies above decide who may.
create or replace function public.save_assembly(p_id uuid, p_name text, p_category text, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'An assembly needs between 1 and 200 lines' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.assemblies (name, category) values (btrim(p_name), coalesce(btrim(p_category), '')) returning id into v_id;
  else
    update public.assemblies set name = btrim(p_name), category = coalesce(btrim(p_category), '') where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Assembly not found' using errcode = 'P0002'; end if;
    delete from public.assembly_lines where assembly_id = v_id;
  end if;
  insert into public.assembly_lines (assembly_id, sort, description, quantity, unit, material_unit_cost, labour_hours_per_unit)
  select v_id, (t.ord - 1)::integer,
         coalesce(t.x ->> 'description', ''), coalesce((t.x ->> 'quantity')::numeric, 0), coalesce(t.x ->> 'unit', 'ea'),
         coalesce((t.x ->> 'material_unit_cost')::numeric, 0), coalesce((t.x ->> 'labour_hours_per_unit')::numeric, 0)
  from jsonb_array_elements(p_lines) with ordinality as t(x, ord);
  return v_id;
end $$;
revoke execute on function public.save_assembly(uuid, text, text, jsonb) from public, anon;
grant execute on function public.save_assembly(uuid, text, text, jsonb) to authenticated;
