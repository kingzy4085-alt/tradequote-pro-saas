-- Small things left over once the money loop was in place. Safe to run more than once.

-- A deleted login no longer stays on the records it wrote --------------------------------
-- created_by is ON DELETE SET NULL, but set_updated_at put the old id straight back, so the row
-- kept pointing at a login that no longer exists. Timecards and the signed safety records worked
-- around that with triggers of their own. This fixes it for everything.
--
-- It clears only when the update comes from inside a trigger (the foreign key's own action) and
-- that person is truly gone. Anyone else trying to change or blank the author still can't.
-- Definer because signed-in users can't read auth.users. updated_at stays as it was: nobody
-- edited the record, and the automation's "no change in 14 days" rules read that column.
create or replace function public.set_updated_at() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.company_id := old.company_id;
  if new.created_by is null and old.created_by is not null and pg_trigger_depth() > 1
     and not exists (select 1 from auth.users u where u.id = old.created_by) then
    new.updated_at := old.updated_at;
    return new;
  end if;
  new.updated_at := now();
  new.created_by := old.created_by;
  return new;
end $$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Rows already left pointing at a deleted login. No guard or rollup needs to see this: only the
-- dead id changes. One statement, so a failure can't leave any table's triggers switched off.
do $$
declare
  r record;
  v_dangling boolean;
begin
  for r in
    select c.conrelid::regclass as tbl
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and a.attname = 'created_by'
      and c.connamespace = 'public'::regnamespace
  loop
    execute format('select exists (select 1 from %s t where t.created_by is not null and not exists (select 1 from auth.users u where u.id = t.created_by))', r.tbl)
    into v_dangling;
    if v_dangling then
      execute format('alter table %s disable trigger user', r.tbl);
      execute format('update %s t set created_by = null where t.created_by is not null and not exists (select 1 from auth.users u where u.id = t.created_by)', r.tbl);
      execute format('alter table %s enable trigger user', r.tbl);
    end if;
  end loop;
end $$;

-- The Command Center's figures ------------------------------------------------------------
-- Runs as the caller, so row security still decides which rows count: an electrician's hours are
-- their own. Each block is also left out by rank, so a figure below its rank isn't zero, it's
-- absent. Totals from job costing come from job_cost_rollup, which has its own gate.
-- p_today and p_zone are the company's local date and time zone, worked out by the page.
-- abs(x) < 1e15 leaves out NaN and infinity, which numeric columns can hold and sum would spread.
create or replace function public.dashboard_figures(p_today date, p_zone text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_rank integer := coalesce(public.user_rank(), 0);
  v_monday date;
  v_out jsonb;
  v_part jsonb;
begin
  if v_rank < 1 then
    raise exception 'Sign in to a company first.' using errcode = '42501';
  end if;
  if p_today is null or not isfinite(p_today) then
    raise exception 'A date is required.' using errcode = '22023';
  end if;
  v_monday := p_today - (extract(isodow from p_today)::integer - 1);

  -- Monday to Sunday, the same week the timecard board shows. Rejected hours aren't hours.
  select jsonb_build_object('labour', jsonb_build_object(
           'week_start', v_monday,
           'regular', coalesce(sum(t.regular_hours) filter (where abs(t.regular_hours) < 1e15), 0),
           'overtime', coalesce(sum(t.overtime_hours) filter (where abs(t.overtime_hours) < 1e15), 0),
           'cards', count(*)))
  into v_out
  from public.timecards t
  where t.status <> 'Rejected' and t.work_date between v_monday and v_monday + 6;

  if v_rank >= 2 then
    -- Age from the day it was entered, like the timecards.submitted alert, which starts at 4 days
    select jsonb_build_object(
             'total', count(*),
             'fresh', count(*) filter (where a.age <= 3),
             'waiting', count(*) filter (where a.age between 4 and 7),
             'old', count(*) filter (where a.age > 7),
             'oldest_work_date', min(a.work_date))
    into v_part
    from (select t.work_date, p_today - (t.created_at at time zone p_zone)::date as age
          from public.timecards t where t.status = 'Submitted') a;
    v_out := v_out || jsonb_build_object('timecards', v_part);
  end if;

  if v_rank >= 3 then
    -- Real quotes out with clients: sent proposals, and submitted estimates that have no proposal
    -- past Draft yet. One that has one is counted through it, or was declined, and isn't counted twice.
    select jsonb_build_object(
             'total', round(coalesce((select sum(p.total_amount) from public.proposals p where p.status = 'Sent' and abs(p.total_amount) < 1e15), 0)
                          + coalesce(sum(e.total_amount) filter (where abs(e.total_amount) < 1e15), 0), 2),
             'proposals', (select count(*) from public.proposals p where p.status = 'Sent'),
             'estimates', count(*))
    into v_part
    from public.estimates e
    where e.status = 'Submitted'
      and not exists (select 1 from public.proposals p where p.estimate_id = e.id and p.status <> 'Draft');
    v_out := v_out || jsonb_build_object('pipeline', v_part);
  end if;

  if v_rank >= 4 then
    -- From the due date, so it's right even if last night's automation run was missed
    select jsonb_build_object(
             'outstanding', round(coalesce(sum(r.amount), 0), 2),
             'overdue', round(coalesce(sum(r.amount) filter (where r.due_date < p_today), 0), 2),
             'overdue_count', count(*) filter (where r.due_date < p_today),
             'over_30', round(coalesce(sum(r.amount) filter (where p_today - r.due_date >= 30), 0), 2),
             'over_60', round(coalesce(sum(r.amount) filter (where p_today - r.due_date >= 60), 0), 2),
             'over_90', round(coalesce(sum(r.amount) filter (where p_today - r.due_date >= 90), 0), 2))
    into v_part
    from public.receivables r
    where r.status <> 'Collected' and abs(r.amount) < 1e15;
    v_out := v_out || jsonb_build_object('receivables', v_part);

    -- Withheld on invoices that have gone out. Nothing records a holdback being paid out yet, so
    -- this is everything withheld. The page says so rather than calling it a balance. A credit
    -- invoice's holdback is negative and nets, the way billed and receivables do.
    select jsonb_build_object(
             'total', round(coalesce(sum(i.holdback_amount), 0), 2),
             'invoices', count(*),
             'past_release', round(coalesce(sum(i.holdback_amount) filter (where i.holdback_release_date < p_today), 0), 2))
    into v_part
    from public.invoices i
    where i.status in ('Sent', 'Overdue', 'Paid') and i.holdback_amount <> 0 and abs(i.holdback_amount) < 1e15;
    v_out := v_out || jsonb_build_object('holdback', v_part);
  end if;

  return v_out;
end $$;
revoke execute on function public.dashboard_figures(date, text) from public, anon;
grant execute on function public.dashboard_figures(date, text) to authenticated;
