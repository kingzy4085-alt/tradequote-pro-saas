-- The money loop: estimate totals, estimate > proposal > project conversions, and job costing.
-- The module columns come from lib/modules.ts through the registry sync; this file holds the
-- rules. Safe to run more than once, on a fresh database and on one with old rows.

-- Estimate totals -----------------------------------------------------------------
-- The one place an estimate's money is added up. Mirrors estimateTotals in lib/estimate-math.ts.
-- Runs as the caller, so it only sees lines row security lets them see.
drop function if exists public.estimate_totals(uuid, numeric, numeric, numeric);
create function public.estimate_totals(p_estimate uuid, p_rate numeric, p_markup numeric, p_tax numeric)
returns table (material numeric, labour_hours numeric, labour numeric, subtotal numeric, markup numeric, before_tax numeric, tax numeric, total numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  select coalesce(sum(round(i.quantity * i.material_unit_cost, 2)), 0), round(coalesce(sum(i.quantity * i.labour_hours_per_unit), 0), 2)
  into material, labour_hours
  from public.estimate_items i where i.estimate_id = p_estimate;
  labour := round(labour_hours * coalesce(p_rate, 0), 2);
  subtotal := round(material + labour, 2);
  markup := round(subtotal * coalesce(p_markup, 0) / 100, 2);
  before_tax := round(subtotal + markup, 2);
  tax := round(before_tax * coalesce(p_tax, 0) / 100, 2);
  total := round(before_tax + tax, 2);
  return next;
end $$;
revoke execute on function public.estimate_totals(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.estimate_totals(uuid, numeric, numeric, numeric) to authenticated, service_role;

-- A Sent or Accepted proposal prints this estimate's lines, so what the client was shown can't
-- move under them. Setting the proposal back to Draft frees it.
create or replace function public.estimate_is_with_client(p_estimate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.proposals p where p.estimate_id = p_estimate and p.status in ('Sent', 'Accepted'))
$$;
revoke execute on function public.estimate_is_with_client(uuid) from public, anon, authenticated;

-- Runs on every estimate write, so a client can't set total_amount and a rate change can't leave it stale.
create or replace function public.guard_estimate_total() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_finite_number(new.labour_rate) and public.is_finite_number(new.markup_percentage) and public.is_finite_number(new.tax_percentage)) then
    raise exception 'Rates and percentages must be real numbers.' using errcode = '22023';
  end if;
  select t.total into new.total_amount from public.estimate_totals(new.id, new.labour_rate, new.markup_percentage, new.tax_percentage) t;
  -- Any write to a line lands here too, so this is what stops a NaN line reaching the total, the proposal and the contract
  if not public.is_finite_number(new.total_amount) then
    raise exception 'Line quantities, costs and hours must be real numbers.' using errcode = '22023';
  end if;
  -- The rate and percentages count as well as the total: moving markup into tax leaves the total
  -- alone but changes the printed subtotal and tax, and the contract, which is the price before tax.
  if tg_op = 'UPDATE'
     and (new.total_amount is distinct from old.total_amount
          or coalesce(new.labour_rate, 0) <> coalesce(old.labour_rate, 0)
          or coalesce(new.markup_percentage, 0) <> coalesce(old.markup_percentage, 0)
          or coalesce(new.tax_percentage, 0) <> coalesce(old.tax_percentage, 0))
     and public.estimate_is_with_client(new.id) then
    raise exception 'This estimate''s proposal is with the client, so its price is locked. Set the proposal back to Draft to change it.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- A proposal that isn't with the client follows its estimate's price. Any proposal follows its
-- estimate's job until a project has been made from it, so conversion can't make a second job.
create or replace function public.sync_estimate_proposals() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.total_amount is distinct from old.total_amount then
    update public.proposals p set total_amount = new.total_amount
    where p.estimate_id = new.id and p.status not in ('Sent', 'Accepted');
  end if;
  if new.project_id is distinct from old.project_id then
    update public.proposals p set project_id = new.project_id
    where p.estimate_id = new.id and p.project_id is distinct from new.project_id
      and not exists (select 1 from public.projects pr where pr.proposal_id = p.id);
  end if;
  return null;
end $$;

-- After any change to lines, one recount per estimate touched. Statement-level because saving
-- replaces every line at once, and an estimate can have 1000.
create or replace function public.estimate_items_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.estimate_id) into v_ids from n;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.estimate_id) into v_ids from o;
  else
    select array_agg(distinct x.estimate_id) into v_ids
    from (select n.estimate_id from n union select o.estimate_id from o) x;
  end if;
  if exists (select 1 from public.estimates e where e.id = any(v_ids) and public.estimate_is_with_client(e.id)) then
    raise exception 'This estimate''s proposal is with the client, so its lines are locked. Set the proposal back to Draft to change them.' using errcode = 'P0001';
  end if;
  -- The value is thrown away: guard_estimate_total works out the real one
  update public.estimates e set total_amount = 0 where e.id = any(v_ids);
  return null;
end $$;

-- Replaces an estimate's lines, as the caller (row security applies). The total comes from
-- the triggers above; p_total stays in the signature only so a page still open from the last
-- release keeps saving, and is ignored.
create or replace function public.save_estimate_items(p_estimate uuid, p_items jsonb, p_total numeric default null)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 1000 then
    raise exception 'An estimate can have up to 1000 lines' using errcode = '22023';
  end if;
  perform 1 from public.estimates where id = p_estimate for update;
  if not found then raise exception 'Estimate not found' using errcode = 'P0002'; end if;
  delete from public.estimate_items where estimate_id = p_estimate;
  insert into public.estimate_items (estimate_id, sort, description, quantity, unit, material_unit_cost, labour_hours_per_unit)
  select p_estimate, (t.ord - 1)::integer,
         coalesce(t.x ->> 'description', ''), coalesce((t.x ->> 'quantity')::numeric, 0), coalesce(t.x ->> 'unit', 'ea'),
         coalesce((t.x ->> 'material_unit_cost')::numeric, 0), coalesce((t.x ->> 'labour_hours_per_unit')::numeric, 0)
  from jsonb_array_elements(p_items) with ordinality as t(x, ord);
end $$;
revoke execute on function public.save_estimate_items(uuid, jsonb, numeric) from public, anon;
grant execute on function public.save_estimate_items(uuid, jsonb, numeric) to authenticated;

-- Old rows. An estimate with a typed total and no lines keeps its price as one lump-sum line, with
-- markup and tax cleared so the total stays what was typed. Then every total is recounted. Triggers
-- are off so the updated_at printed on a proposal doesn't move.
alter table public.estimates disable trigger user;
alter table public.estimate_items disable trigger user;
update public.estimates set labour_rate = null where not public.is_finite_number(labour_rate);
update public.estimates set markup_percentage = null where not public.is_finite_number(markup_percentage);
update public.estimates set tax_percentage = null where not public.is_finite_number(tax_percentage);
update public.estimates set total_amount = null where not public.is_finite_number(total_amount);
update public.estimate_items set quantity = 0 where not public.is_finite_number(quantity);
update public.estimate_items set material_unit_cost = 0 where not public.is_finite_number(material_unit_cost);
update public.estimate_items set labour_hours_per_unit = 0 where not public.is_finite_number(labour_hours_per_unit);
with lump as (
  select e.id, e.company_id, e.total_amount from public.estimates e
  where coalesce(e.total_amount, 0) > 0 and not exists (select 1 from public.estimate_items i where i.estimate_id = e.id)
), lines as (
  insert into public.estimate_items (company_id, estimate_id, sort, description, quantity, unit, material_unit_cost, labour_hours_per_unit)
  select l.company_id, l.id, 0, 'Lump sum (total entered before line items)', 1, 'ls', l.total_amount, 0 from lump l
)
update public.estimates e set markup_percentage = 0, tax_percentage = 0 from lump l where e.id = l.id;
update public.estimates e set total_amount = t.total
from public.estimates src
cross join lateral public.estimate_totals(src.id, src.labour_rate, src.markup_percentage, src.tax_percentage) t
where e.id = src.id and e.total_amount is distinct from t.total;
alter table public.estimate_items enable trigger user;
alter table public.estimates enable trigger user;
-- An old NaN proposal total would refuse every later save of that row. One built from an estimate
-- takes the estimate's price; one typed by hand goes blank for a person to retype.
alter table public.proposals disable trigger user;
update public.proposals p set total_amount = (select e.total_amount from public.estimates e where e.id = p.estimate_id)
where not public.is_finite_number(p.total_amount);
alter table public.proposals enable trigger user;

drop trigger if exists estimates_total on public.estimates;
create trigger estimates_total before insert or update on public.estimates
  for each row execute function public.guard_estimate_total();
drop trigger if exists estimates_sync_proposals on public.estimates;
create trigger estimates_sync_proposals after update on public.estimates
  for each row execute function public.sync_estimate_proposals();

drop trigger if exists estimate_items_inserted on public.estimate_items;
create trigger estimate_items_inserted after insert on public.estimate_items
  referencing new table as n for each statement execute function public.estimate_items_changed();
drop trigger if exists estimate_items_updated on public.estimate_items;
create trigger estimate_items_updated after update on public.estimate_items
  referencing new table as n old table as o for each statement execute function public.estimate_items_changed();
drop trigger if exists estimate_items_deleted on public.estimate_items;
create trigger estimate_items_deleted after delete on public.estimate_items
  referencing old table as o for each statement execute function public.estimate_items_changed();

-- Proposals -----------------------------------------------------------------------
create or replace function public.guard_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_total numeric;
begin
  if not public.is_finite_number(new.total_amount) then
    raise exception 'The total must be a real number.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    new.estimate_id := old.estimate_id;
    if new.status is distinct from old.status and old.status = 'Accepted'
       and exists (select 1 from public.projects p where p.proposal_id = old.id) then
      raise exception 'A project was created from this proposal, so it stays accepted.' using errcode = 'P0001';
    end if;
    -- Typed by hand: the same lock an estimate's price has. Going back to Draft frees it, in the
    -- same write or an earlier one, and the check above stops that once a project exists.
    if new.estimate_id is null and new.total_amount is distinct from old.total_amount
       and old.status in ('Sent', 'Accepted') and new.status in ('Sent', 'Accepted') then
      raise exception 'This proposal is with the client, so its price is locked. Set it back to Draft to change it.' using errcode = 'P0001';
    end if;
  end if;
  -- Built from an estimate: the price is the estimate's, whatever was sent
  if new.estimate_id is not null then
    select e.total_amount into v_total from public.estimates e where e.id = new.estimate_id and e.company_id = new.company_id;
    if found then new.total_amount := v_total; end if;
  end if;
  return new;
end $$;
drop trigger if exists proposals_guard on public.proposals;
create trigger proposals_guard before insert or update on public.proposals
  for each row execute function public.guard_proposal();

-- What stops a repeat click or two people at once making a second one
create unique index if not exists proposals_estimate_unique on public.proposals(estimate_id) where estimate_id is not null;
create unique index if not exists projects_proposal_unique on public.projects(proposal_id) where proposal_id is not null;

-- Links back from a quote are not money. Deleting a project made by mistake frees its proposal
-- to make another, instead of leaving a job nobody can remove.
alter table public.proposals drop constraint if exists proposals_project_id_fkey;
alter table public.proposals add constraint proposals_project_id_fkey foreign key (project_id) references public.projects(id) on delete set null;
alter table public.estimates drop constraint if exists estimates_project_id_fkey;
alter table public.estimates add constraint estimates_project_id_fkey foreign key (project_id) references public.projects(id) on delete set null;

-- The button on an estimate: a draft proposal, or the one it already has. Nothing is sent.
-- Runs as the caller, so row security decides who can.
create or replace function public.create_proposal_from_estimate(p_estimate uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_est public.estimates;
  v_id uuid;
begin
  select e.* into v_est from public.estimates e where e.id = p_estimate for update;
  if not found then raise exception 'Estimate not found' using errcode = 'P0002'; end if;
  select p.id into v_id from public.proposals p where p.estimate_id = p_estimate;
  if found then return v_id; end if;

  insert into public.proposals (title, status, client_id, client_name, scope_of_work, terms, valid_until, project_id, estimate_id)
  values (v_est.title, 'Draft', v_est.client_id, v_est.client_name, v_est.scope, v_est.terms, current_date + 30, v_est.project_id, v_est.id)
  returning id into v_id;
  return v_id;
end $$;

-- The button on an accepted proposal: the project and its job cost row, or the project it already
-- has. The contract is the price before tax: tax is charged on each invoice, and a percent of
-- contract billed on a price with tax in it would tax it twice.
create or replace function public.create_project_from_proposal(p_proposal uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_prop public.proposals;
  v_est public.estimates;
  v_contract numeric;
  v_id uuid;
begin
  select p.* into v_prop from public.proposals p where p.id = p_proposal for update;
  if not found then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  select pr.id into v_id from public.projects pr where pr.proposal_id = p_proposal;
  if found then return v_id; end if;
  if v_prop.status <> 'Accepted' then
    raise exception 'Mark this proposal as accepted before creating the project.' using errcode = 'P0001';
  end if;

  v_contract := v_prop.total_amount;
  if v_prop.estimate_id is not null then
    select e.* into v_est from public.estimates e where e.id = v_prop.estimate_id for update;
    select t.before_tax into v_contract from public.estimate_totals(v_est.id, v_est.labour_rate, v_est.markup_percentage, v_est.tax_percentage) t;
  end if;

  v_id := coalesce(v_prop.project_id, v_est.project_id);
  if v_id is null then
    insert into public.projects (title, status, client_id, client_name, site, contract_value, estimate_id, proposal_id)
    values (v_prop.title, 'Planning', v_prop.client_id, v_prop.client_name, v_est.client_address, v_contract, v_prop.estimate_id, v_prop.id)
    returning id into v_id;
    update public.proposals p set project_id = v_id where p.id = p_proposal;
  else
    -- Quoted against a job that already exists: that job takes this quote's contract and budget
    -- only where it has none. A contract or budget someone already set is never overwritten.
    update public.projects p set
      proposal_id = v_prop.id,
      estimate_id = coalesce(p.estimate_id, v_prop.estimate_id),
      contract_value = case when coalesce(p.contract_value, 0) = 0 then v_contract else p.contract_value end,
      client_id = coalesce(p.client_id, v_prop.client_id),
      client_name = coalesce(p.client_name, v_prop.client_name),
      site = coalesce(p.site, v_est.client_address)
    where p.id = v_id and p.proposal_id is null;
    update public.proposals p set project_id = v_id where p.id = p_proposal and p.project_id is distinct from v_id;
    perform public.seed_job_budget_from_estimate(v_id);
  end if;
  if v_prop.estimate_id is not null then
    update public.estimates e set status = 'Won', project_id = v_id where e.id = v_prop.estimate_id;
  end if;
  return v_id;
end $$;

-- Manual cost entries -------------------------------------------------------------
-- A credit is a negative amount. Not a module: it only ever shows inside a job.
create table if not exists public.job_cost_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.user_company_id() references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id),
  category text not null check (category in ('Material', 'Equipment', 'Subcontract', 'Other')),
  description text not null check (char_length(description) between 1 and 300),
  amount numeric(14,2) not null,
  entry_date date not null default current_date,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_cost_entries_project_idx on public.job_cost_entries(project_id, entry_date desc);
create index if not exists job_cost_entries_company_idx on public.job_cost_entries(company_id);
alter table public.job_cost_entries enable row level security;
revoke all on public.job_cost_entries from anon;
grant select, insert, update, delete on public.job_cost_entries to authenticated;
drop policy if exists job_cost_entries_select on public.job_cost_entries;
create policy job_cost_entries_select on public.job_cost_entries for select to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3);
drop policy if exists job_cost_entries_insert on public.job_cost_entries;
create policy job_cost_entries_insert on public.job_cost_entries for insert to authenticated
  with check (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write());
drop policy if exists job_cost_entries_update on public.job_cost_entries;
create policy job_cost_entries_update on public.job_cost_entries for update to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write())
  with check (company_id = public.user_company_id());
drop policy if exists job_cost_entries_delete on public.job_cost_entries;
create policy job_cost_entries_delete on public.job_cost_entries for delete to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write());

create or replace function public.guard_job_cost_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_finite_number(new.amount) or new.amount is null or new.amount = 0 then
    raise exception 'Enter an amount. Use a negative amount for a credit.' using errcode = '22023';
  end if;
  new.description := public.trim_blank(new.description);
  if coalesce(new.description, '') = '' then
    raise exception 'Enter a description.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists job_cost_entries_guard on public.job_cost_entries;
create trigger job_cost_entries_guard before insert or update on public.job_cost_entries
  for each row execute function public.guard_job_cost_entry();
drop trigger if exists job_cost_entries_links on public.job_cost_entries;
create trigger job_cost_entries_links before insert or update of project_id on public.job_cost_entries
  for each row execute function public.guard_record_links('project_id', 'projects');
drop trigger if exists job_cost_entries_updated on public.job_cost_entries;
create trigger job_cost_entries_updated before update on public.job_cost_entries
  for each row execute function public.set_updated_at();

-- Employee pay ---------------------------------------------------------------------
-- A rate is frozen onto a card at approval and its cost goes into the job's totals, and a NaN
-- slips past the "rate <= 0" fallback there. So it stops at the employee record.
create or replace function public.guard_employee_pay() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_finite_number(new.hourly_cost) then
    raise exception 'The hourly cost must be a real number.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists employees_pay_guard on public.employees;
create trigger employees_pay_guard before insert or update of hourly_cost on public.employees
  for each row execute function public.guard_employee_pay();

-- Old rows: the bad rate goes, so the card falls back to the company rate as if none was set, and a
-- card that froze a NaN is worked out again. Triggers off so an approved card isn't refused.
alter table public.employees disable trigger user;
update public.employees set hourly_cost = null where not public.is_finite_number(hourly_cost);
alter table public.employees enable trigger user;
alter table public.timecards disable trigger user;
update public.timecards t
set hourly_cost = round(public.timecard_rate(t.company_id, t.employee_id, t.worker_user_id, t.employee_name), 2),
    labour_cost = round(public.timecard_rate(t.company_id, t.employee_id, t.worker_user_id, t.employee_name)
                        * (coalesce(t.regular_hours, 0) + coalesce(t.overtime_hours, 0) * coalesce(c.overtime_multiplier, 1.5)), 2)
from public.companies c
where c.id = t.company_id and t.status in ('Approved', 'Exported')
  and not (public.is_finite_number(t.hourly_cost) and public.is_finite_number(t.labour_cost));
alter table public.timecards enable trigger user;

-- The rollup ----------------------------------------------------------------------
-- Decision 9: Closed never changes; no budget stays On Track. Mirrors jobStatus in lib/job-cost.ts.
create or replace function public.job_cost_status(p_actual numeric, p_budget numeric, p_current text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_current = 'Closed' then 'Closed'
    when coalesce(p_budget, 0) <= 0 then 'On Track'
    when p_actual / p_budget >= 1 then 'Over Budget'
    when p_actual / p_budget >= 0.85 then 'At Risk'
    else 'On Track'
  end
$$;
revoke execute on function public.job_cost_status(numeric, numeric, text) from public, anon, authenticated;

-- Brings one project's job_costing row up to date, making it if the project doesn't have one
-- yet. Returns whether anything changed. A definer function because a project manager can't
-- read payables, and nobody signed in can read a timecard's cost. Never called by a client.
create or replace function public.recalc_job_cost(p_project uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_p public.projects;
  v_est public.estimates;
  v_hours numeric := 0;
  v_labour numeric := 0;
  v_material numeric := 0;
  v_co_revenue numeric;
  v_co_cost numeric;
  v_co_hours numeric;
  v_actual_hours numeric;
  v_actual_labour numeric;
  v_payables numeric;
  v_entry_material numeric;
  v_entry_other numeric;
  v_committed numeric;
  v_billed numeric;
  v_paid numeric;
  v_budget numeric;
  v_actual numeric;
  v_revenue numeric;
  v_margin numeric;
begin
  -- Two saves at once take turns here, and the second one's sums (each statement below takes a
  -- fresh look) include the first. Otherwise the last to finish would overwrite with stale totals.
  perform pg_advisory_xact_lock(hashtextextended('job_cost:' || p_project::text, 0));

  select p.* into v_p from public.projects p where p.id = p_project;
  if not found then return false; end if;

  if not exists (select 1 from public.job_costing j where j.project_id = p_project) then
    -- The budget a project starts with is what its estimate costed: material and labour, no markup
    if v_p.estimate_id is not null then
      select e.* into v_est from public.estimates e where e.id = v_p.estimate_id;
      select t.labour_hours, t.labour, t.material into v_hours, v_labour, v_material
      from public.estimate_totals(v_est.id, v_est.labour_rate, v_est.markup_percentage, v_est.tax_percentage) t;
    end if;
    insert into public.job_costing (company_id, created_by, title, status, project_id, budget_labour_hours, budget_labour, budget_material, budget_other)
    values (v_p.company_id, v_p.created_by, v_p.title, 'On Track', p_project, v_hours, v_labour, v_material, 0)
    on conflict (project_id) where project_id is not null do nothing;
  end if;

  select coalesce(sum(co.price), 0), coalesce(sum(co.budget_cost), 0), coalesce(sum(co.labour_hours), 0)
  into v_co_revenue, v_co_cost, v_co_hours
  from public.change_orders co where co.project_id = p_project and co.status = 'Approved';

  select coalesce(sum(coalesce(t.regular_hours, 0) + coalesce(t.overtime_hours, 0))
           filter (where public.is_finite_number(t.regular_hours) and public.is_finite_number(t.overtime_hours)), 0),
         coalesce(sum(t.labour_cost) filter (where public.is_finite_number(t.labour_cost)), 0)
  into v_actual_hours, v_actual_labour
  from public.timecards t where t.project_id = p_project and t.status in ('Approved', 'Exported');

  select coalesce(sum(b.amount), 0) into v_payables
  from public.payables b
  where b.project_id = p_project and b.status in ('Approved', 'Paid') and public.is_finite_number(b.amount);

  select coalesce(sum(x.amount) filter (where x.category = 'Material'), 0), coalesce(sum(x.amount) filter (where x.category <> 'Material'), 0)
  into v_entry_material, v_entry_other
  from public.job_cost_entries x where x.project_id = p_project;

  select coalesce(sum(po.amount), 0) into v_committed
  from public.purchase_orders po
  where po.project_id = p_project and po.status in ('Issued', 'Partially Received', 'Received')
    and public.is_finite_number(po.amount)
    and not exists (select 1 from public.payables b where b.purchase_order_id = po.id);

  -- Before tax and holdback, so billed compares with the contract
  select coalesce(sum(i.amount) filter (where i.status in ('Sent', 'Overdue', 'Paid')), 0), coalesce(sum(i.amount) filter (where i.status = 'Paid'), 0)
  into v_billed, v_paid
  from public.invoices i where i.project_id = p_project;

  v_actual := round(v_actual_labour + v_payables + v_entry_material + v_entry_other, 2);
  v_revenue := coalesce(v_p.revised_contract, 0);
  v_margin := round(v_revenue - v_actual, 2);

  select round(coalesce(j.budget_labour, 0) + coalesce(j.budget_material, 0) + coalesce(j.budget_other, 0) + v_co_cost, 2)
  into v_budget from public.job_costing j where j.project_id = p_project;

  update public.job_costing j set
    title = v_p.title,
    budget = v_budget,
    actual_cost = v_actual,
    co_revenue = v_co_revenue,
    co_cost = v_co_cost,
    co_labour_hours = v_co_hours,
    actual_labour_hours = v_actual_hours,
    actual_labour = v_actual_labour,
    actual_material = round(v_payables + v_entry_material, 2),
    actual_other = v_entry_other,
    committed = v_committed,
    billed_amount = v_billed,
    paid_amount = v_paid,
    margin = v_margin,
    margin_pct = case when v_revenue > 0 then round(v_margin / v_revenue * 100, 2) end,
    cost_used_pct = case when v_budget > 0 then round(v_actual / v_budget * 100, 2) end,
    status = public.job_cost_status(v_actual, v_budget, j.status),
    rolled_up_at = now()
  where j.project_id = p_project
    -- Nothing moved, nothing written: a nightly run over a quiet job leaves no trace
    and (j.rolled_up_at is null
         or (j.title, j.budget, j.actual_cost, j.co_revenue, j.co_cost, j.co_labour_hours, j.actual_labour_hours, j.actual_labour,
             j.actual_material, j.actual_other, j.committed, j.billed_amount, j.paid_amount, j.margin, j.margin_pct, j.cost_used_pct, j.status)
         is distinct from
            (v_p.title, v_budget, v_actual, v_co_revenue, v_co_cost, v_co_hours, v_actual_hours, v_actual_labour,
             round(v_payables + v_entry_material, 2), v_entry_other, v_committed, v_billed, v_paid, v_margin,
             case when v_revenue > 0 then round(v_margin / v_revenue * 100, 2) end,
             case when v_budget > 0 then round(v_actual / v_budget * 100, 2) end,
             public.job_cost_status(v_actual, v_budget, j.status)));
  return found;
end $$;
revoke execute on function public.recalc_job_cost(uuid) from public, anon, authenticated;

-- In sorted order, so two statements touching the same jobs can't deadlock on each other's locks
create or replace function public.recalc_job_costs(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  for v_id in select distinct x from unnest(p_ids) as x where x is not null order by 1 loop
    perform public.recalc_job_cost(v_id);
  end loop;
end $$;
revoke execute on function public.recalc_job_costs(uuid[]) from public, anon, authenticated;

-- Statement-level with both sides, so exporting 500 cards is one recount per job, and a record
-- moved between projects recounts the one it left as well as the one it joined.
create or replace function public.job_cost_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(n.project_id) into v_ids from n;
  elsif tg_op = 'DELETE' then
    select array_agg(o.project_id) into v_ids from o;
  else
    select array_agg(x.project_id) into v_ids from (select n.project_id from n union select o.project_id from o) x;
  end if;
  perform public.recalc_job_costs(v_ids);
  return null;
end $$;

-- A bill also changes what its purchase order has committed, and that PO can be on another job
create or replace function public.job_cost_touch_payable() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(x.p) into v_ids from (
      select n.project_id as p from n
      union select po.project_id from public.purchase_orders po where po.id in (select n.purchase_order_id from n)) x;
  elsif tg_op = 'DELETE' then
    select array_agg(x.p) into v_ids from (
      select o.project_id as p from o
      union select po.project_id from public.purchase_orders po where po.id in (select o.purchase_order_id from o)) x;
  else
    select array_agg(x.p) into v_ids from (
      select n.project_id as p from n
      union select o.project_id from o
      union select po.project_id from public.purchase_orders po
      where po.id in (select n.purchase_order_id from n union select o.purchase_order_id from o)) x;
  end if;
  perform public.recalc_job_costs(v_ids);
  return null;
end $$;

-- A new project gets its row; a changed contract or name moves the margin and the title
create or replace function public.job_cost_touch_project() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select array_agg(n.id) into v_ids from n;
  perform public.recalc_job_costs(v_ids);
  return null;
end $$;

-- Linked rows follow their project and can't be deleted out from under it. An old row that was
-- never linked to a project is just history, and an admin can clear it.
create or replace function public.guard_job_costing_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.project_id is not null and exists (select 1 from public.projects p where p.id = old.project_id) then
    raise exception 'This job follows its project. Delete the project instead, or close the job.' using errcode = 'P0001';
  end if;
  return old;
end $$;

-- Budget: what a project manager sets. The rest of the row is worked out.
create or replace function public.set_job_budget(p_project uuid, p_hours numeric, p_labour numeric, p_material numeric, p_other numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.user_rank(), 0) < 3 then
    raise exception 'Only a project manager or above can change a job''s budget.' using errcode = '42501';
  end if;
  if not public.company_can_write() then
    raise exception 'Your trial or subscription has ended.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.company_id = public.user_company_id()) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if not (public.is_finite_number(p_hours) and public.is_finite_number(p_labour) and public.is_finite_number(p_material) and public.is_finite_number(p_other))
     or coalesce(p_hours, 0) < 0 or coalesce(p_labour, 0) < 0 or coalesce(p_material, 0) < 0 or coalesce(p_other, 0) < 0 then
    raise exception 'Budget figures must be numbers that are not negative.' using errcode = '22023';
  end if;
  perform public.recalc_job_cost(p_project);
  update public.job_costing j set
    budget_labour_hours = round(coalesce(p_hours, 0), 2),
    budget_labour = round(coalesce(p_labour, 0), 2),
    budget_material = round(coalesce(p_material, 0), 2),
    budget_other = round(coalesce(p_other, 0), 2)
  where j.project_id = p_project;
  perform public.recalc_job_cost(p_project);
end $$;

-- Closing a job freezes its status at Closed. Reopening puts it back on the numbers.
create or replace function public.set_job_closed(p_project uuid, p_closed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.user_rank(), 0) < 3 then
    raise exception 'Only a project manager or above can close a job.' using errcode = '42501';
  end if;
  if not public.company_can_write() then
    raise exception 'Your trial or subscription has ended.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.company_id = public.user_company_id()) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  perform public.recalc_job_cost(p_project);
  update public.job_costing j set status = case when p_closed then 'Closed' else 'On Track' end where j.project_id = p_project;
  perform public.recalc_job_cost(p_project);
end $$;

-- A project made before its estimate has an empty budget. This fills it from the estimate the
-- project now points at, and leaves any budget a person has set alone.
create or replace function public.seed_job_budget_from_estimate(p_project uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_estimate uuid;
  v_hours numeric;
  v_labour numeric;
  v_material numeric;
begin
  if coalesce(public.user_rank(), 0) < 3 then
    raise exception 'Only a project manager or above can change a job''s budget.' using errcode = '42501';
  end if;
  if not public.company_can_write() then
    raise exception 'Your trial or subscription has ended.' using errcode = '42501';
  end if;
  select p.estimate_id into v_estimate from public.projects p where p.id = p_project and p.company_id = public.user_company_id();
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if v_estimate is null then return; end if;

  select t.labour_hours, t.labour, t.material into v_hours, v_labour, v_material
  from public.estimates e
  cross join lateral public.estimate_totals(e.id, e.labour_rate, e.markup_percentage, e.tax_percentage) t
  where e.id = v_estimate;

  perform public.recalc_job_cost(p_project);
  update public.job_costing j set budget_labour_hours = coalesce(v_hours, 0), budget_labour = coalesce(v_labour, 0), budget_material = coalesce(v_material, 0)
  where j.project_id = p_project
    and coalesce(j.budget_labour_hours, 0) = 0 and coalesce(j.budget_labour, 0) = 0
    and coalesce(j.budget_material, 0) = 0 and coalesce(j.budget_other, 0) = 0;
  perform public.recalc_job_cost(p_project);
end $$;

-- What the pages read: every job, or one, as one JSON value. Gated here because this is the
-- only way a project manager sees labour and payables, and only ever as totals.
create or replace function public.job_cost_rollup(p_project uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.user_company_id();
  v_rows jsonb;
begin
  if coalesce(public.user_rank(), 0) < 3 then
    raise exception 'Only a project manager or above can see job costs.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(j) || jsonb_build_object(
           'project_title', p.title,
           'project_status', p.status,
           'client_name', p.client_name,
           'contract_value', coalesce(p.contract_value, 0),
           'approved_changes', coalesce(p.approved_changes, 0),
           'revised_contract', coalesce(p.revised_contract, 0),
           'entries', (select coalesce(jsonb_object_agg(e.category, e.total), '{}'::jsonb)
                       from (select x.category, sum(x.amount) as total from public.job_cost_entries x
                             where x.project_id = p.id group by x.category) e)
         ) order by p.title, p.id), '[]'::jsonb) into v_rows
  from public.job_costing j
  join public.projects p on p.id = j.project_id
  where j.company_id = v_company and p.company_id = v_company
    and (p_project is null or j.project_id = p_project);
  return v_rows;
end $$;

-- The safety net: recomputes every job of one company from scratch and returns how many had
-- drifted. Called by the nightly job, one company at a time. A second run changes nothing.
create or replace function public.reconcile_job_costs(p_company uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_changed integer := 0;
begin
  for v_id in select p.id from public.projects p where p.company_id = p_company order by p.id loop
    if public.recalc_job_cost(v_id) then v_changed := v_changed + 1; end if;
  end loop;
  return v_changed;
end $$;

-- From a project: a draft invoice or draw with its client, and the balance of the contract so
-- far as a starting amount for a person to change. Nothing is sent. A repeat click returns the
-- same untouched draft, at today's balance. Runs as the caller, so invoices stay admin-only and
-- draws project manager.
create or replace function public.project_balance(p_project uuid) returns numeric
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_revised numeric;
  v_billed numeric;
begin
  select p.revised_contract into v_revised from public.projects p where p.id = p_project;
  select j.billed_amount into v_billed from public.job_costing j where j.project_id = p_project;
  return greatest(round(coalesce(v_revised, 0) - coalesce(v_billed, 0), 2), 0);
end $$;

create or replace function public.create_invoice_from_project(p_project uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_p public.projects;
  v_address text;
  v_balance numeric;
  v_lines jsonb;
  v_amount numeric;
  v_id uuid;
begin
  select p.* into v_p from public.projects p where p.id = p_project for update;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  v_balance := public.project_balance(p_project);
  v_lines := case when v_balance > 0 then jsonb_build_array(jsonb_build_object('type', 'free', 'description', 'Balance of contract', 'amount', v_balance)) else '[]'::jsonb end;

  select i.id, coalesce(i.amount, 0) into v_id, v_amount from public.invoices i
  where i.project_id = p_project and i.status = 'Draft'
    and (jsonb_array_length(i.lines) = 0
         or (jsonb_array_length(i.lines) = 1 and i.lines -> 0 ->> 'type' = 'free' and i.lines -> 0 ->> 'description' = 'Balance of contract'))
  order by i.created_at, i.id limit 1;
  if found then
    -- Its one line says it is the balance, so it has to be: left at an old balance, sending it
    -- would bill past the contract. Same draft and number, no second one to send by mistake.
    if v_amount <> v_balance then
      update public.invoices i set lines = v_lines where i.id = v_id;
    end if;
    return v_id;
  end if;

  if v_p.estimate_id is not null then
    select e.client_address into v_address from public.estimates e where e.id = v_p.estimate_id;
  end if;
  insert into public.invoices (title, status, project_id, client_id, client_name, client_address, lines)
  values (v_p.title, 'Draft', p_project, v_p.client_id, v_p.client_name, v_address, v_lines)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.create_draw_from_project(p_project uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_p public.projects;
  v_balance numeric;
  v_number integer;
  v_id uuid;
begin
  select p.* into v_p from public.projects p where p.id = p_project for update;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  v_balance := public.project_balance(p_project);

  select d.id into v_id from public.progress_billing d
  where d.project_id = p_project and d.status = 'Draft' and d.invoice_id is null
    and d.title like 'Draw #%' and coalesce(d.amount_billed, 0) = v_balance
  order by d.created_at, d.id limit 1;
  if found then return v_id; end if;

  -- Past the highest number on the job, not the count: deleting a draw must not repeat a number
  select greatest(count(*), coalesce(max(substring(d.title from '^Draw #([0-9]{1,9})$')::integer), 0)) + 1 into v_number
  from public.progress_billing d where d.project_id = p_project;
  insert into public.progress_billing (title, status, project_id, amount_billed)
  values ('Draw #' || v_number, 'Draft', p_project, nullif(v_balance, 0))
  returning id into v_id;
  return v_id;
end $$;

-- One row per job from here on. Where an old database has several rows on one project the oldest
-- keeps the link, and the others stay as unlinked history. Their typed numbers aren't lost.
update public.job_costing j set project_id = null
where j.project_id is not null and exists (
  select 1 from public.job_costing k
  where k.project_id = j.project_id and (k.created_at, k.id) < (j.created_at, j.id));
create unique index if not exists job_costing_project_unique on public.job_costing(project_id) where project_id is not null;
create index if not exists payables_project_status_idx on public.payables(project_id, status) where project_id is not null;
create index if not exists timecards_project_status_idx on public.timecards(project_id, status) where project_id is not null;
create index if not exists invoices_project_status_idx on public.invoices(project_id, status) where project_id is not null;

-- The row goes with its project. Any other record on a project still stops the delete.
alter table public.job_costing drop constraint if exists job_costing_project_id_fkey;
alter table public.job_costing add constraint job_costing_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade;

-- A typed budget on an old linked row becomes the job's budget. A typed actual becomes a manual
-- entry the job can see and correct. rolled_up_at marks a row as done, so this runs once.
update public.job_costing j set budget_other = j.budget
where j.project_id is not null and j.rolled_up_at is null and public.is_finite_number(j.budget) and coalesce(j.budget, 0) > 0;
insert into public.job_cost_entries (company_id, project_id, category, description, amount, created_by)
select j.company_id, j.project_id, 'Other', 'Actual cost typed in before job costing', j.actual_cost, j.created_by
from public.job_costing j
where j.project_id is not null and j.rolled_up_at is null and public.is_finite_number(j.actual_cost) and coalesce(j.actual_cost, 0) <> 0;
update public.job_costing j set budget = 0 where not public.is_finite_number(j.budget);
update public.job_costing j set actual_cost = 0 where not public.is_finite_number(j.actual_cost);

drop trigger if exists job_costing_delete_guard on public.job_costing;
create trigger job_costing_delete_guard before delete on public.job_costing
  for each row execute function public.guard_job_costing_delete();

-- Every write the rollup depends on
do $$
declare
  t text;
begin
  foreach t in array array['timecards', 'purchase_orders', 'change_orders', 'invoices', 'job_cost_entries'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_cost_ins', t);
    execute format('create trigger %I after insert on public.%I referencing new table as n for each statement execute function public.job_cost_touch()', t || '_cost_ins', t);
    execute format('drop trigger if exists %I on public.%I', t || '_cost_upd', t);
    execute format('create trigger %I after update on public.%I referencing new table as n old table as o for each statement execute function public.job_cost_touch()', t || '_cost_upd', t);
    execute format('drop trigger if exists %I on public.%I', t || '_cost_del', t);
    execute format('create trigger %I after delete on public.%I referencing old table as o for each statement execute function public.job_cost_touch()', t || '_cost_del', t);
  end loop;
end $$;
drop trigger if exists payables_cost_ins on public.payables;
create trigger payables_cost_ins after insert on public.payables referencing new table as n for each statement execute function public.job_cost_touch_payable();
drop trigger if exists payables_cost_upd on public.payables;
create trigger payables_cost_upd after update on public.payables referencing new table as n old table as o for each statement execute function public.job_cost_touch_payable();
drop trigger if exists payables_cost_del on public.payables;
create trigger payables_cost_del after delete on public.payables referencing old table as o for each statement execute function public.job_cost_touch_payable();
drop trigger if exists projects_cost_ins on public.projects;
create trigger projects_cost_ins after insert on public.projects referencing new table as n for each statement execute function public.job_cost_touch_project();
drop trigger if exists projects_cost_upd on public.projects;
create trigger projects_cost_upd after update on public.projects referencing new table as n old table as o for each statement execute function public.job_cost_touch_project();

-- Numbers on this table only ever come from the functions above. Row security can't hold a
-- project manager to that, since they may read the row, so signed-in users don't get to write it.
-- Deleting stays, for old unlinked rows: the guard above and the policy decide.
revoke insert, update on public.job_costing from anon, authenticated;
revoke all on public.job_costing from anon;

do $$
declare
  c record;
begin
  for c in select distinct p.company_id from public.projects p loop
    perform public.reconcile_job_costs(c.company_id);
  end loop;
end $$;

revoke execute on function public.guard_estimate_total(), public.sync_estimate_proposals(), public.estimate_items_changed(),
  public.guard_proposal(), public.guard_job_cost_entry(), public.job_cost_touch(), public.job_cost_touch_payable(),
  public.job_cost_touch_project(), public.guard_job_costing_delete(), public.guard_employee_pay()
  from public, anon, authenticated;
revoke execute on function public.create_proposal_from_estimate(uuid), public.create_project_from_proposal(uuid),
  public.set_job_budget(uuid, numeric, numeric, numeric, numeric), public.set_job_closed(uuid, boolean), public.job_cost_rollup(uuid),
  public.project_balance(uuid), public.create_invoice_from_project(uuid), public.create_draw_from_project(uuid),
  public.seed_job_budget_from_estimate(uuid)
  from public, anon;
grant execute on function public.create_proposal_from_estimate(uuid), public.create_project_from_proposal(uuid),
  public.set_job_budget(uuid, numeric, numeric, numeric, numeric), public.set_job_closed(uuid, boolean), public.job_cost_rollup(uuid),
  public.project_balance(uuid), public.create_invoice_from_project(uuid), public.create_draw_from_project(uuid),
  public.seed_job_budget_from_estimate(uuid)
  to authenticated;
revoke execute on function public.reconcile_job_costs(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_job_costs(uuid) to service_role;
