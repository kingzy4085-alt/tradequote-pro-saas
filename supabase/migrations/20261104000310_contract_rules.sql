-- Who can read what a job is worth, and what a stale draft can bill. Safe to run more than once.

-- Contract money is for project managers and up ---------------------------------------------
-- The same line job costing draws, and the same way timecards hide pay. Row security can't hide a
-- column and every signed-in user is the same database role, so nobody signed in reads these three
-- directly: project managers get them from project_money. A column added to this table later needs
-- granting. Writing is still row security's call: only a project manager or above can save a project.
revoke select on public.projects from authenticated;
do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(c.column_name), ', ') into v_columns
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'projects'
    and c.column_name not in ('contract_value', 'approved_changes', 'revised_contract');
  execute format('grant select (%s) on public.projects to authenticated', v_columns);
end $$;

-- One JSON value for the same reason as timecard_pay: the API caps sets at its row limit.
create or replace function public.project_money(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  if coalesce(public.user_rank(), 0) < 3 then
    raise exception 'Only a project manager or above can see contract amounts.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'contract_value', p.contract_value,
           'approved_changes', p.approved_changes,
           'revised_contract', p.revised_contract)), '[]'::jsonb) into v_rows
  from public.projects p
  where p.company_id = public.user_company_id() and p.id = any(p_ids);
  return v_rows;
end $$;
revoke execute on function public.project_money(uuid[]) from public, anon;
grant execute on function public.project_money(uuid[]) to authenticated;

-- These run as the caller, so they can't read the columns above directly either. What they need
-- comes through project_money, so crew are refused here rather than told a contract's balance.
create or replace function public.project_balance(p_project uuid) returns numeric
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_revised numeric;
  v_billed numeric;
begin
  v_revised := (public.project_money(array[p_project]) -> 0 ->> 'revised_contract')::numeric;
  select j.billed_amount into v_billed from public.job_costing j where j.project_id = p_project;
  return greatest(round(coalesce(v_revised, 0) - coalesce(v_billed, 0), 2), 0);
end $$;

create or replace function public.create_invoice_from_project(p_project uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_p record;
  v_address text;
  v_balance numeric;
  v_lines jsonb;
  v_amount numeric;
  v_id uuid;
begin
  select p.title, p.client_id, p.client_name, p.estimate_id into v_p from public.projects p where p.id = p_project for update;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  v_balance := public.project_balance(p_project);
  v_lines := case when v_balance > 0 then jsonb_build_array(jsonb_build_object('type', 'free', 'description', 'Balance of contract', 'amount', v_balance)) else '[]'::jsonb end;

  select i.id, coalesce(i.amount, 0) into v_id, v_amount from public.invoices i
  where i.project_id = p_project and i.status = 'Draft'
    and (jsonb_array_length(i.lines) = 0
         or (jsonb_array_length(i.lines) = 1 and i.lines -> 0 ->> 'type' = 'free' and i.lines -> 0 ->> 'description' = 'Balance of contract'))
  order by i.created_at, i.id limit 1;
  if found then
    -- Its one line says it is the balance, so it has to be. Same draft and number, no second one
    -- to send by mistake. A draft nobody clicks on again is held to the contract when it is sent.
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
  v_found uuid;
  v_balance numeric;
  v_number integer;
  v_id uuid;
begin
  select p.id into v_found from public.projects p where p.id = p_project for update;
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

create or replace function public.create_project_from_proposal(p_proposal uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_prop public.proposals;
  v_est public.estimates;
  v_contract numeric;
  v_current numeric;
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
    v_current := (public.project_money(array[v_id]) -> 0 ->> 'contract_value')::numeric;
    update public.projects p set
      proposal_id = v_prop.id,
      estimate_id = coalesce(p.estimate_id, v_prop.estimate_id),
      contract_value = case when coalesce(v_current, 0) = 0 then v_contract else v_current end,
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

-- A draft can't bill past the contract ------------------------------------------------------
-- A draft keeps the amounts it was saved with, and the contract and other invoices can move before
-- anyone sends it. guard_invoice has already repriced its percent lines at today's contract by the
-- time this runs (triggers fire in name order). Checked against the same sum as project_balance:
-- the revised contract less everything already sent, plus the change orders and draws on this
-- invoice. Hand-typed lines on this invoice aren't the contract, so they don't use it up here; once
-- sent they count, like any other billing.
--   A percent line can't be repriced without changing what it says, so one that goes past is refused.
--   A "Balance of contract" line comes down to what is left, and is refused if nothing is. One below
--   what is left stays as typed: nothing is billed for more than the person saw on the draft.
-- The project lock makes two drafts sent at once take turns. The service role is trusted, as in guard_invoice.
create or replace function public.guard_invoice_send() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_n integer;
  v_revised numeric;
  v_prior numeric;
  v_room numeric;
  v_percent numeric := 0;
  v_amount numeric;
  v_out jsonb := '[]'::jsonb;
  v_subtotal numeric;
begin
  if auth.uid() is null or new.project_id is null or not exists (
    select 1 from jsonb_array_elements(new.lines) as l(x)
    where l.x ->> 'type' = 'percent'
       or (l.x ->> 'type' = 'free' and lower(btrim(l.x ->> 'description')) = 'balance of contract')) then
    return new;
  end if;

  select p.revised_contract into v_revised from public.projects p where p.id = new.project_id and p.company_id = new.company_id for update;
  if not public.is_finite_number(v_revised) then v_revised := 0; end if;

  select coalesce(sum(i.amount) filter (where public.is_finite_number(i.amount)), 0) into v_prior
  from public.invoices i
  where i.project_id = new.project_id and i.company_id = new.company_id and i.id <> new.id and i.status in ('Sent', 'Overdue', 'Paid');

  select coalesce(sum((l.x ->> 'amount')::numeric) filter (where l.x ->> 'type' = 'percent'), 0),
         coalesce(sum((l.x ->> 'amount')::numeric) filter (where l.x ->> 'type' in ('change_order', 'draw')), 0)
  into v_percent, v_amount
  from jsonb_array_elements(new.lines) as l(x);

  v_room := coalesce(v_revised, 0) - v_prior - v_amount - v_percent;
  if v_percent > 0 and v_room < 0 then
    raise exception 'This invoice would bill past the contract: $% is already billed on this $% contract, and this invoice adds $%. Change its lines before sending it.',
      to_char(v_prior, 'FM999999999990.00'), to_char(coalesce(v_revised, 0), 'FM999999999990.00'), to_char(v_percent + v_amount, 'FM999999999990.00') using errcode = 'P0001';
  end if;

  for v_line, v_n in select t.x, t.ord::integer from jsonb_array_elements(new.lines) with ordinality as t(x, ord) loop
    if v_line ->> 'type' = 'free' and lower(btrim(v_line ->> 'description')) = 'balance of contract' and (v_line ->> 'amount')::numeric > 0 then
      if v_room <= 0 then
        raise exception 'Line %: this contract has nothing left to bill, so there is no balance to send. Change or void this invoice.', v_n using errcode = 'P0001';
      end if;
      v_amount := least((v_line ->> 'amount')::numeric, round(v_room, 2));
      v_line := jsonb_set(v_line, '{amount}', to_jsonb(v_amount));
      v_room := v_room - v_amount;
    end if;
    v_out := v_out || v_line;
  end loop;

  if v_out is distinct from new.lines then
    new.lines := v_out;
    -- The same sums as guard_invoice
    select coalesce(sum((l.x ->> 'amount')::numeric), 0) into v_subtotal from jsonb_array_elements(new.lines) as l(x);
    new.amount := round(v_subtotal, 2);
    new.gst := round(new.amount * coalesce(new.tax_pct, 0) / 100, 2);
    new.holdback_amount := round(new.amount * coalesce(new.holdback_pct, 0) / 100, 2);
    new.total := round(new.amount + new.gst - new.holdback_amount, 2);
  end if;
  return new;
end $$;
revoke execute on function public.guard_invoice_send() from public, anon, authenticated;

drop trigger if exists invoices_send_contract on public.invoices;
create trigger invoices_send_contract before update on public.invoices
  for each row when (old.status = 'Draft' and new.status = 'Sent')
  execute function public.guard_invoice_send();
