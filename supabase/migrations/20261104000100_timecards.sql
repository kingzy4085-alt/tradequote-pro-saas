-- Timecard engine. The columns come from lib/modules.ts through the registry sync;
-- this file holds the rules: who can approve what, the frozen pay rate, the locks.
-- Safe to run more than once.

-- The email a worker's login goes by. A removed member's company row is gone, but their
-- final cards still have to find them, so this falls back to the login itself.
create or replace function public.timecard_login_email(p_company uuid, p_user uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text;
begin
  select cu.email into v_email from public.company_users cu where cu.user_id = p_user and cu.company_id = p_company;
  if v_email is null then
    select u.email into v_email from auth.users u where u.id = p_user;
  end if;
  return v_email;
end $$;

-- The pay rate for a card: the employee's own rate, or the company's default labour rate.
-- The employee is the linked record, else the one sharing the worker's login email, else,
-- for a card with no login at all, the only one with exactly the typed name. A login is
-- never matched by name: people choose the name on their own login, so a name match would
-- let anyone claim a higher-paid colleague's rate.
-- A definer function because foremen can't read employees.
create or replace function public.timecard_rate(p_company uuid, p_employee uuid, p_user uuid, p_name text)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  v_rate numeric;
  v_matches integer;
begin
  if p_employee is not null then
    select e.hourly_cost into v_rate from public.employees e where e.id = p_employee and e.company_id = p_company;
  elsif p_user is not null then
    select e.hourly_cost into v_rate
    from public.employees e
    where e.company_id = p_company and e.hourly_cost is not null
      and lower(e.email) = lower(public.timecard_login_email(p_company, p_user))
    order by e.created_at limit 1;
  else
    select count(*), max(e.hourly_cost) into v_matches, v_rate
    from public.employees e
    where e.company_id = p_company and lower(btrim(e.title)) = lower(btrim(p_name));
    if v_matches <> 1 then v_rate := null; end if;
  end if;
  if v_rate is null or v_rate <= 0 then
    select c.default_labour_rate into v_rate from public.companies c where c.id = p_company;
  end if;
  return coalesce(v_rate, 0);
end $$;

-- Whether these card details point at this person: their login, their name, or an employee
-- record carrying their email or name. Names are fair here because a match only ever refuses.
create or replace function public.timecard_is_own(p_uid uuid, p_company uuid, p_worker uuid, p_employee uuid, p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_my_name text;
  v_my_email text := lower(public.timecard_login_email(p_company, p_uid));
begin
  if p_worker = p_uid then return true; end if;
  select lower(btrim(cu.full_name)) into v_my_name from public.company_users cu where cu.user_id = p_uid and cu.company_id = p_company;
  return coalesce(lower(btrim(p_name)) = v_my_name, false)
    or exists (select 1 from public.employees e
               where e.id = p_employee and e.company_id = p_company
                 and (lower(btrim(e.title)) = v_my_name or lower(e.email) = v_my_email));
end $$;

create or replace function public.guard_timecard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_rank integer := coalesce(public.user_rank(), 0);
  v_system boolean := auth.uid() is null;  -- the server's service role or a migration, not a person
  v_old_status text;
  v_was_final boolean;
  v_self boolean;
  v_name text;
  v_mult numeric;
  v_rate numeric;
  v_total numeric;
  v_elsewhere numeric;
  -- Everything the system itself may change on an approved card
  v_fixed text[] := array['status', 'reject_reason', 'hourly_cost', 'labour_cost', 'approved_by', 'approved_by_name', 'approved_at', 'exported_at', 'updated_at', 'created_by'];
begin
  if tg_op = 'DELETE' then
    if not v_system and old.status in ('Approved', 'Exported') then
      raise exception 'This timecard is approved. Un-approve it before deleting it.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- Everything below reads this company's rates, so it has to be the caller's own.
  -- This trigger also does set_updated_at's job for this table, see the note where that is dropped.
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.company_id := old.company_id;
    -- The author is fixed, unless the foreign key is clearing a login that has been deleted
    if new.created_by is not null or old.created_by is null
       or exists (select 1 from auth.users u where u.id = old.created_by) then
      new.created_by := old.created_by;
    end if;
  elsif not v_system and new.company_id is distinct from public.user_company_id() then
    raise exception 'That timecard belongs to another company.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and new.status is null then new.status := 'Submitted'; end if;
  if new.status not in ('Submitted', 'Approved', 'Rejected', 'Exported') then
    raise exception 'That is not a timecard status.' using errcode = '22023';
  end if;

  v_old_status := case when tg_op = 'INSERT' then 'Submitted' else old.status end;
  v_was_final := tg_op = 'UPDATE' and old.status in ('Approved', 'Exported');

  -- Approved and exported cards change only by moving their status
  if not v_system and v_was_final and (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
    raise exception 'This timecard is approved and locked. Un-approve it to make changes.' using errcode = 'P0001';
  end if;

  -- Who the card is for. An electrician's card is always their own.
  if not v_system and v_rank < 2 then
    if tg_op = 'INSERT' then
      new.worker_user_id := v_uid;
      new.employee_id := null;
    else
      new.worker_user_id := old.worker_user_id;
      new.employee_id := old.employee_id;
      new.employee_name := old.employee_name;
    end if;
  elsif not v_was_final then
    -- Moving a card to a different person takes it off the old one, whichever side was picked
    if tg_op = 'UPDATE' and new.employee_id is distinct from old.employee_id
       and new.worker_user_id is not distinct from old.worker_user_id then
      new.worker_user_id := null;
    elsif tg_op = 'UPDATE' and new.worker_user_id is distinct from old.worker_user_id
       and new.employee_id is not distinct from old.employee_id and new.worker_user_id is not null then
      new.employee_id := null;
    end if;
    if new.worker_user_id is null and new.employee_id is not null then
      select cu.user_id into new.worker_user_id
      from public.employees e
      join public.company_users cu on cu.company_id = e.company_id and lower(cu.email) = lower(e.email)
      where e.id = new.employee_id and e.company_id = new.company_id
      limit 1;
    elsif new.worker_user_id is not null and (tg_op = 'INSERT' or new.worker_user_id is distinct from old.worker_user_id)
      and not exists (select 1 from public.company_users cu where cu.user_id = new.worker_user_id and cu.company_id = new.company_id) then
      raise exception 'Pick the worker from the list.' using errcode = '22023';
    end if;
  end if;

  -- A picked worker's card carries their real name, so the board and the payroll file can't
  -- credit the hours to someone else. Only a card with nobody picked keeps a typed name.
  if not v_was_final and (tg_op = 'INSERT' or v_rank >= 2 or v_system) then
    if new.worker_user_id is not null then
      select coalesce(nullif(btrim(cu.full_name), ''), cu.email) into v_name
      from public.company_users cu where cu.user_id = new.worker_user_id and cu.company_id = new.company_id;
    elsif new.employee_id is not null then
      select e.title into v_name from public.employees e where e.id = new.employee_id and e.company_id = new.company_id;
    end if;
    new.employee_name := coalesce(v_name, new.employee_name);
  end if;

  -- A foreman can't write himself off a card that is his, in one update or in two
  if not v_system and v_rank = 2 and tg_op = 'UPDATE' and not v_was_final
     and (new.worker_user_id is distinct from old.worker_user_id
          or new.employee_id is distinct from old.employee_id
          or (new.worker_user_id is null and new.employee_id is null and new.employee_name is distinct from old.employee_name))
     and public.timecard_is_own(v_uid, old.company_id, old.worker_user_id, old.employee_id, old.employee_name) then
    raise exception 'This is your own timecard. Ask a project manager to change who it is for.' using errcode = 'P0001';
  end if;

  -- A date is what puts a card on the weekly board and in a payroll file
  if new.work_date is null then
    if tg_op = 'INSERT' then
      new.work_date := current_date;
    elsif old.work_date is null then
      new.work_date := old.created_at::date;
    else
      raise exception 'Pick a date for this timecard.' using errcode = '22023';
    end if;
  end if;

  -- Hours: checked when they could have changed and whenever a card is approved
  if tg_op = 'INSERT' or new.status in ('Approved', 'Exported') and not v_was_final
     or new.regular_hours is distinct from old.regular_hours or new.overtime_hours is distinct from old.overtime_hours then
    new.regular_hours := round(coalesce(new.regular_hours, 0), 2);
    new.overtime_hours := round(coalesce(new.overtime_hours, 0), 2);
    v_total := new.regular_hours + new.overtime_hours;
    if new.regular_hours < 0 or new.overtime_hours < 0 then
      raise exception 'Hours cannot be negative.' using errcode = '22023';
    elsif v_total <= 0 then
      raise exception 'Enter the hours worked.' using errcode = '22023';
    elsif v_total > 24 then
      raise exception 'A timecard cannot be more than 24 hours in one day.' using errcode = '22023';
    end if;
  end if;

  -- Status moves
  if not v_system and new.status is distinct from v_old_status then
    if new.status = 'Exported' then
      if v_old_status <> 'Approved' or v_rank < 3 then
        raise exception 'Only a project manager or above can export approved timecards.' using errcode = 'P0001';
      end if;
    elsif v_old_status = 'Exported' then
      if new.status <> 'Approved' or v_rank < 3 then
        raise exception 'Only a project manager or above can reopen an exported timecard, and it goes back to Approved.' using errcode = 'P0001';
      end if;
    elsif new.status in ('Approved', 'Rejected') or v_old_status = 'Approved' then
      if v_rank < 2 then
        raise exception 'Only a foreman or above can approve or reject timecards.' using errcode = 'P0001';
      end if;
      if v_rank < 3 then
        -- A card with no worker picked counts as its author's own
        v_self := (new.worker_user_id is null and new.employee_id is null and new.created_by = v_uid)
          or public.timecard_is_own(v_uid, new.company_id, new.worker_user_id, new.employee_id, new.employee_name);
        if coalesce(v_self, false) then
          raise exception 'You cannot approve your own timecard. Ask a project manager.' using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;

  -- The same limit across one person's cards for the day, so a repeated entry can't double
  -- their hours. Checked after the status rules, so a refused person hears why they were refused.
  -- A rejected card doesn't count. A typed name isn't a person we can identify:
  -- two different Mikes can both work a full day. The lock makes two saves at once take turns.
  if not v_system and not v_was_final and new.status <> 'Rejected'
     and (new.worker_user_id is not null or new.employee_id is not null)
     and (tg_op = 'INSERT' or old.status = 'Rejected' or new.status = 'Approved'
          or new.work_date is distinct from old.work_date
          or new.worker_user_id is distinct from old.worker_user_id
          or new.employee_id is distinct from old.employee_id
          or new.regular_hours is distinct from old.regular_hours
          or new.overtime_hours is distinct from old.overtime_hours) then
    perform pg_advisory_xact_lock(hashtextextended(new.company_id::text || new.work_date::text, 0));
    select coalesce(sum(coalesce(t.regular_hours, 0) + coalesce(t.overtime_hours, 0)), 0) into v_elsewhere
    from public.timecards t
    where t.company_id = new.company_id and t.work_date = new.work_date and t.status <> 'Rejected' and t.id <> new.id
      and (t.worker_user_id = new.worker_user_id or t.employee_id = new.employee_id);
    if v_elsewhere + coalesce(new.regular_hours, 0) + coalesce(new.overtime_hours, 0) > 24 then
      raise exception '% already has % hours on %. One person cannot have more than 24 hours in one day.',
        new.employee_name, trim_scale(v_elsewhere), new.work_date using errcode = '22023';
    end if;
  end if;

  -- The login and the employee record have to be one person, or nobody knows whose rate this
  -- is. Same email is the only proof: a name is whatever someone typed on their own login.
  if not v_system and new.status = 'Approved' and not v_was_final
     and new.worker_user_id is not null and new.employee_id is not null
     and not exists (select 1 from public.employees e
                     where e.id = new.employee_id and e.company_id = new.company_id
                       and lower(e.email) = lower(public.timecard_login_email(new.company_id, new.worker_user_id))) then
    raise exception 'The worker and the employee record on this timecard are different people. Pick the worker again.' using errcode = 'P0001';
  end if;

  -- What approval records. A client can't set any of this.
  if new.status in ('Approved', 'Exported') then
    if v_was_final then
      new.hourly_cost := old.hourly_cost;
      new.labour_cost := old.labour_cost;
      new.approved_by := old.approved_by;
      new.approved_by_name := old.approved_by_name;
      new.approved_at := old.approved_at;
    else
      select c.overtime_multiplier into v_mult from public.companies c where c.id = new.company_id;
      v_rate := public.timecard_rate(new.company_id, new.employee_id, new.worker_user_id, new.employee_name);
      new.hourly_cost := round(v_rate, 2);
      new.labour_cost := round(new.regular_hours * v_rate + new.overtime_hours * v_rate * coalesce(v_mult, 1.5), 2);
      new.approved_by := v_uid;
      select coalesce(cu.full_name, cu.email) into new.approved_by_name from public.company_users cu where cu.user_id = v_uid;
      new.approved_at := now();
    end if;
    new.exported_at := case when new.status = 'Approved' then null
                            when tg_op = 'UPDATE' and old.status = 'Exported' then old.exported_at
                            else now() end;
    new.reject_reason := null;
  else
    new.hourly_cost := null;
    new.labour_cost := null;
    new.approved_by := null;
    new.approved_by_name := null;
    new.approved_at := null;
    new.exported_at := null;
    new.reject_reason := case when new.status = 'Rejected' then left(nullif(btrim(new.reject_reason), ''), 500) end;
  end if;

  return new;
end $$;

drop trigger if exists timecards_guard on public.timecards;
create trigger timecards_guard before insert or update or delete on public.timecards
  for each row execute function public.guard_timecard();

-- set_updated_at keeps created_by for good, which undoes the foreign key's ON DELETE SET NULL
-- and leaves the card pointing at a deleted login. guard_timecard stamps updated_at instead.
drop trigger if exists timecards_updated on public.timecards;

-- Foremen and up see the whole crew's cards. Below that, a worker sees and edits the cards
-- that are theirs, whoever wrote them, and deletes only the ones they also wrote.
drop policy if exists timecards_select on public.timecards;
create policy timecards_select on public.timecards for select to authenticated
  using (company_id = public.user_company_id()
         and (public.user_rank() >= 2 or worker_user_id = auth.uid()));
drop policy if exists timecards_update on public.timecards;
create policy timecards_update on public.timecards for update to authenticated
  using (company_id = public.user_company_id() and public.company_can_write()
         and (public.user_rank() >= 2 or worker_user_id = auth.uid()))
  with check (company_id = public.user_company_id());
drop policy if exists timecards_delete on public.timecards;
create policy timecards_delete on public.timecards for delete to authenticated
  using (company_id = public.user_company_id() and public.company_can_write()
         and (public.user_rank() >= 2 or (created_by = auth.uid() and worker_user_id = auth.uid())));

-- Pay is for project managers and up, the same line the pages draw and the reason employees
-- is admin-read. Row security can't hide a column and every signed-in user is the same
-- database role, so nobody signed in reads these two directly: project managers get them
-- from timecard_pay and export_timecards. A column added to this table later needs granting.
revoke select on public.timecards from authenticated;
do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(c.column_name), ', ') into v_columns
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'timecards' and c.column_name not in ('hourly_cost', 'labour_cost');
  execute format('grant select (%s) on public.timecards to authenticated', v_columns);
end $$;

create index if not exists timecards_company_date_idx on public.timecards(company_id, work_date);
create index if not exists timecards_worker_idx on public.timecards(worker_user_id) where worker_user_id is not null;

-- Approve, reject, un-approve or reopen a batch. Runs as the caller, so row security and
-- the trigger decide. A card the caller can't decide (their own, say) is reported and
-- skipped, and the rest still go through.
create or replace function public.decide_timecards(p_ids uuid[], p_action text, p_reason text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_target text;
  v_from text[];
  v_card record;
  v_done integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  case p_action
    when 'approve' then v_target := 'Approved'; v_from := array['Submitted', 'Rejected'];
    when 'reject' then v_target := 'Rejected'; v_from := array['Submitted', 'Approved'];
    when 'unapprove' then v_target := 'Submitted'; v_from := array['Approved'];
    when 'reopen' then v_target := 'Approved'; v_from := array['Exported'];
    else raise exception 'Unknown action.' using errcode = '22023';
  end case;
  if coalesce(array_length(p_ids, 1), 0) > 500 then
    raise exception 'Up to 500 timecards at a time.' using errcode = '22023';
  end if;

  for v_card in
    select t.id, t.employee_name from public.timecards t where t.id = any(p_ids) and t.status = any(v_from)
  loop
    begin
      update public.timecards t
      set status = v_target, reject_reason = case when v_target = 'Rejected' then p_reason else t.reject_reason end
      where t.id = v_card.id;
      if found then v_done := v_done + 1; end if;
    exception when sqlstate 'P0001' or sqlstate '22023' then
      v_skipped := v_skipped || jsonb_build_object('id', v_card.id, 'worker', v_card.employee_name, 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('done', v_done, 'skipped', v_skipped);
end $$;

-- Moves a pay period's approved cards to Exported in one step and returns them, or with
-- p_again returns the ones already exported so a lost file can be downloaded again.
-- One JSON value rather than a set of rows: the API caps sets at its row limit, which would
-- mark every card Exported and leave the rest off the payroll file.
-- A definer function because the file holds pay, so the rank and company checks here are
-- the only ones. The guard still runs on every card it moves.
drop function if exists public.export_timecards(date, date, boolean);
create function public.export_timecards(p_from date, p_to date, p_again boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.user_company_id();
  v_rows jsonb;
begin
  if coalesce(public.user_rank(), 0) < 3 then
    raise exception 'Only a project manager or above can export payroll.' using errcode = '42501';
  end if;
  if p_again then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.employee_name, t.work_date), '[]'::jsonb) into v_rows
    from public.timecards t where t.company_id = v_company and t.status = 'Exported' and t.work_date between p_from and p_to;
  else
    if not public.company_can_write() then
      raise exception 'Your trial or subscription has ended.' using errcode = '42501';
    end if;
    with moved as (
      update public.timecards t set status = 'Exported'
      where t.company_id = v_company and t.status = 'Approved' and t.work_date between p_from and p_to
      returning t.*
    )
    select coalesce(jsonb_agg(to_jsonb(m) order by m.employee_name, m.work_date), '[]'::jsonb) into v_rows from moved m;
  end if;
  return v_rows;
end $$;

-- The frozen pay on these cards, for a project manager or above in this company.
-- One JSON value for the same reason as the export.
create or replace function public.timecard_pay(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  if coalesce(public.user_rank(), 0) < 3 then
    raise exception 'Only a project manager or above can see pay.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'hourly_cost', t.hourly_cost, 'labour_cost', t.labour_cost)), '[]'::jsonb) into v_rows
  from public.timecards t where t.company_id = public.user_company_id() and t.id = any(p_ids);
  return v_rows;
end $$;

-- The people a foreman can enter time for: logins and employee records, joined where they
-- are the same person, which takes the same email. Names and ids only, never rates. Below
-- foreman, only yourself.
create or replace function public.timecard_workers()
returns table (employee_id uuid, user_id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.user_company_id();
  v_rank integer := public.user_rank();
begin
  if v_company is null then return; end if;
  return query
  with members as (
    select cu.user_id as uid, coalesce(nullif(btrim(cu.full_name), ''), cu.email) as label,
           (select e.id from public.employees e
            where e.company_id = v_company and e.status <> 'Terminated'
              and lower(e.email) = lower(cu.email)
            order by e.created_at limit 1) as eid
    from public.company_users cu
    where cu.company_id = v_company and (v_rank >= 2 or cu.user_id = auth.uid())
  )
  select m.eid, m.uid, m.label from members m
  union all
  select e.id, null::uuid, e.title
  from public.employees e
  where v_rank >= 2 and e.company_id = v_company and e.status <> 'Terminated'
    and not exists (select 1 from members m where m.eid = e.id)
  order by 3;
end $$;

revoke execute on function public.timecard_rate(uuid, uuid, uuid, text), public.timecard_login_email(uuid, uuid), public.timecard_is_own(uuid, uuid, uuid, uuid, text), public.guard_timecard() from public, anon, authenticated;
revoke execute on function public.decide_timecards(uuid[], text, text), public.export_timecards(date, date, boolean), public.timecard_pay(uuid[]), public.timecard_workers() from public, anon;
grant execute on function public.decide_timecards(uuid[], text, text), public.export_timecards(date, date, boolean), public.timecard_pay(uuid[]), public.timecard_workers() to authenticated;

-- Older cards: give them a date so they show on a week, tie electricians' cards to them,
-- and freeze the pay on cards approved before this existed.
alter table public.timecards disable trigger user;
update public.timecards set work_date = created_at::date where work_date is null;
update public.timecards t set worker_user_id = t.created_by
from public.company_users cu
where t.worker_user_id is null and cu.user_id = t.created_by and cu.company_id = t.company_id and cu.role = 'electrician';
update public.timecards t
set hourly_cost = round(public.timecard_rate(t.company_id, t.employee_id, t.worker_user_id, t.employee_name), 2),
    labour_cost = round(public.timecard_rate(t.company_id, t.employee_id, t.worker_user_id, t.employee_name)
                        * (coalesce(t.regular_hours, 0) + coalesce(t.overtime_hours, 0) * c.overtime_multiplier), 2)
from public.companies c
where c.id = t.company_id and t.status in ('Approved', 'Exported') and t.labour_cost is null;
alter table public.timecards enable trigger user;
