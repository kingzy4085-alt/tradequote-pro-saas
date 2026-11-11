-- Fixes from the adversarial review of the money loop, security and first-use journey.
-- A function here replaces the earlier copy of the same name. Safe to run more than once.

-- Tenancy: an update can't name another company ---------------------------------------
-- set_updated_at puts company_id back, but it fires last (triggers run in name order), so every
-- guard before it saw whatever the client sent, and the row security check saw the restored value.
-- This one fires first. change_orders and invoices keep their guards, which refuse a forged company outright.
create or replace function public.pin_company_id() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.company_id := old.company_id;
  return new;
end $$;
revoke execute on function public.pin_company_id() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select c.relname from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and t.tgfoid = 'public.set_updated_at'::regproc
      and c.relnamespace = 'public'::regnamespace and c.relname not in ('change_orders', 'invoices')
  loop
    execute format('drop trigger if exists %I on public.%I', r.relname || '_0_company', r.relname);
    execute format('create trigger %I before update on public.%I for each row execute function public.pin_company_id()', r.relname || '_0_company', r.relname);
  end loop;
end $$;

-- A table added later has no trigger above, so the check itself also goes by the row's real company
create or replace function public.guard_record_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_owner uuid := case when tg_op = 'UPDATE' then (v_old ->> 'company_id')::uuid else (v_new ->> 'company_id')::uuid end;
  v_column text;
  v_id uuid;
  v_company uuid;
  i integer := 0;
begin
  while i < tg_nargs loop
    v_column := tg_argv[i];
    v_id := (v_new ->> v_column)::uuid;
    if v_id is not null and (v_old is null or (v_old ->> v_column)::uuid is distinct from v_id) then
      execute format('select company_id from public.%I where id = $1', tg_argv[i + 1]) into v_company using v_id;
      if v_company is null or v_company is distinct from v_owner then
        raise exception 'The % you picked could not be found in your company.', replace(replace(v_column, '_id', ''), '_', ' ') using errcode = '22023';
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end $$;
revoke execute on function public.guard_record_links() from public, anon, authenticated;

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
  where e.id = v_estimate and e.company_id = public.user_company_id();

  perform public.recalc_job_cost(p_project);
  update public.job_costing j set budget_labour_hours = coalesce(v_hours, 0), budget_labour = coalesce(v_labour, 0), budget_material = coalesce(v_material, 0)
  where j.project_id = p_project
    and coalesce(j.budget_labour_hours, 0) = 0 and coalesce(j.budget_labour, 0) = 0
    and coalesce(j.budget_material, 0) = 0 and coalesce(j.budget_other, 0) = 0;
  perform public.recalc_job_cost(p_project);
end $$;

-- Read-only means read-only. Removing someone stays open on purpose, so access can still be revoked.
create or replace function public.set_member_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.user_rank() < 4 then raise exception 'Only owners and admins can change roles' using errcode = '42501'; end if;
  if not public.company_can_write() then raise exception 'Your trial or subscription has ended.' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role' using errcode = '42501'; end if;
  if p_role not in ('admin','project_manager','foreman','electrician') then raise exception 'Invalid role' using errcode = '22023'; end if;
  if p_role = 'admin' and public.user_rank() < 5 then raise exception 'Only the owner can make admins' using errcode = '42501'; end if;
  update public.company_users set role = p_role
    where user_id = p_user and company_id = public.user_company_id() and role <> 'owner'
      and (public.user_rank() = 5 or role <> 'admin');
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
end $$;

-- Who reads what it costs --------------------------------------------------------------
-- Same approach as contract money and timecard pay: row security can't hide a column and everyone
-- signed in is one database role, so nobody reads these directly. Rank-gated functions serve them.
-- A column added to these tables later needs granting.
revoke select on public.companies from authenticated;
do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(c.column_name), ', ') into v_columns
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'companies'
    and c.column_name not in ('default_labour_rate', 'default_markup', 'stripe_customer_id', 'stripe_subscription_id');
  execute format('grant select (%s) on public.companies to authenticated', v_columns);
end $$;

-- The labour rate is also the pay fallback when a worker has no rate of their own
create or replace function public.company_rates()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_row jsonb;
begin
  if coalesce(public.user_rank(), 0) < 3 then
    raise exception 'Only a project manager or above can see company rates.' using errcode = '42501';
  end if;
  select jsonb_build_object('default_markup', c.default_markup, 'default_labour_rate', c.default_labour_rate) into v_row
  from public.companies c where c.id = public.user_company_id();
  return v_row;
end $$;
revoke execute on function public.company_rates() from public, anon;
grant execute on function public.company_rates() to authenticated;

create or replace function public.company_billing_ids()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_row jsonb;
begin
  if coalesce(public.user_rank(), 0) < 4 then
    raise exception 'Only the owner or an admin can see billing details.' using errcode = '42501';
  end if;
  select jsonb_build_object('stripe_customer_id', c.stripe_customer_id, 'stripe_subscription_id', c.stripe_subscription_id) into v_row
  from public.companies c where c.id = public.user_company_id();
  return v_row;
end $$;
revoke execute on function public.company_billing_ids() from public, anon;
grant execute on function public.company_billing_ids() to authenticated;

-- It reads the two columns above, as whoever is saving the estimate
create or replace function public.estimate_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.companies%rowtype;
begin
  select * into c from public.companies where id = new.company_id;
  new.markup_percentage := coalesce(new.markup_percentage, c.default_markup);
  new.tax_percentage := coalesce(new.tax_percentage, c.default_tax);
  new.labour_rate := coalesce(new.labour_rate, c.default_labour_rate);
  new.terms := coalesce(new.terms, c.default_terms);
  return new;
end $$;
revoke execute on function public.estimate_defaults() from public, anon, authenticated;

revoke select on public.change_orders from authenticated;
do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(c.column_name), ', ') into v_columns
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'change_orders'
    and c.column_name not in ('material_cost', 'labour_rate', 'markup_pct', 'budget_cost', 'cost_impact', 'price', 'tax', 'total');
  execute format('grant select (%s) on public.change_orders to authenticated', v_columns);
end $$;

create or replace function public.change_order_money(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  if coalesce(public.user_rank(), 0) < 3 then
    raise exception 'Only a project manager or above can see change order money.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', co.id, 'material_cost', co.material_cost, 'labour_rate', co.labour_rate, 'markup_pct', co.markup_pct,
           'budget_cost', co.budget_cost, 'cost_impact', co.cost_impact, 'price', co.price, 'tax', co.tax, 'total', co.total)), '[]'::jsonb) into v_rows
  from public.change_orders co
  where co.company_id = public.user_company_id() and co.id = any(p_ids);
  return v_rows;
end $$;
revoke execute on function public.change_order_money(uuid[]) from public, anon;
grant execute on function public.change_order_money(uuid[]) to authenticated;

-- Change orders ------------------------------------------------------------------------
-- A deduct can be approved: it prices negative and brings the contract down. Only $0 is refused.
-- Reopening one the contract's billing already relies on is refused, whichever invoice billed it:
-- a free "Balance of contract" line bills it without naming it, so invoice_id alone can't tell.
create or replace function public.guard_change_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := auth.uid() is null;
  v_labour numeric;
  v_cost numeric;
  v_company_rate numeric;
  v_default_markup numeric;
  v_default_tax numeric;
  v_markup numeric;
  v_revised numeric;
  v_billed numeric;
  -- What approving and reopening may change on a locked change order
  v_fixed text[] := array['status', 'signature', 'approved_by', 'approved_at', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if not v_system and old.status = 'Approved' then
      raise exception 'This change order is approved and cannot be deleted. Reopen it first.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- An invoice claiming or releasing this change order: nothing else changes
  if pg_trigger_depth() > 1 then return new; end if;

  if new.status not in ('Draft', 'Sent', 'Approved', 'Rejected') then
    raise exception 'That is not a change order status.' using errcode = '22023';
  end if;

  if not v_system then
    if new.company_id is distinct from public.user_company_id() then
      raise exception 'You do not have permission to do that.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      new.co_number := old.co_number;
      new.invoice_id := old.invoice_id;
      new.billed_in_old_app := old.billed_in_old_app;
    end if;
  end if;

  select c.default_labour_rate, c.default_markup, c.default_tax into v_company_rate, v_default_markup, v_default_tax
  from public.companies c where c.id = new.company_id;

  if tg_op = 'INSERT' then
    if new.co_number is null or not v_system then
      new.co_number := public.next_company_number(new.company_id, 'change_order', 1)::text;
    end if;
    new.labour_rate := coalesce(new.labour_rate, v_company_rate);
    new.markup_pct := coalesce(new.markup_pct, v_default_markup);
    new.tax_pct := coalesce(new.tax_pct, v_default_tax);
    if not v_system then
      if new.status = 'Approved' then
        raise exception 'Save the change order first, then approve it with a signature.' using errcode = 'P0001';
      elsif new.status = 'Rejected' then
        raise exception 'A new change order starts as a draft. Send it before recording a rejection.' using errcode = 'P0001';
      end if;
      new.invoice_id := null;
      new.billed_in_old_app := false;
    end if;
  end if;

  if not v_system and tg_op = 'UPDATE' and old.status = 'Approved' then
    if new.status = 'Approved' then
      if (to_jsonb(new) - 'updated_at'::text) is distinct from (to_jsonb(old) - 'updated_at'::text) then
        raise exception 'This change order is approved and locked. Reopen it to make changes.' using errcode = 'P0001';
      end if;
      return new;
    end if;
    if new.status <> 'Draft' then
      raise exception 'An approved change order can only be reopened, which puts it back to Draft.' using errcode = 'P0001';
    end if;
    if old.invoice_id is not null then
      raise exception 'This change order is on an invoice. Take it off the invoice or void the invoice before reopening.' using errcode = 'P0001';
    end if;
    if old.billed_in_old_app then
      raise exception 'This change order was invoiced before this app tracked billing, so it stays approved.' using errcode = 'P0001';
    end if;
    if (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
      raise exception 'This change order is approved and locked. Reopen it first, then make changes.' using errcode = 'P0001';
    end if;
    if coalesce(old.price, 0) > 0 and old.project_id is not null then
      select p.revised_contract into v_revised from public.projects p where p.id = old.project_id for update;
      select coalesce(sum(i.amount) filter (where public.is_finite_number(i.amount)), 0) into v_billed
      from public.invoices i where i.project_id = old.project_id and i.status in ('Sent', 'Overdue', 'Paid');
      if v_billed > coalesce(v_revised, 0) - old.price then
        raise exception 'Invoices on this job have already billed this change order''s price as part of the contract. Void or correct that invoice before reopening.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- Draft > Sent > Approved or Rejected. Sent and Rejected can go back to Draft; Approved is above.
  if not v_system and tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status = 'Draft' and new.status <> 'Sent' then
      raise exception 'Mark this change order as sent to the client before recording their answer.' using errcode = 'P0001';
    elsif old.status = 'Rejected' and new.status <> 'Draft' then
      raise exception 'A rejected change order has to go back to Draft before it can be sent or approved.' using errcode = 'P0001';
    end if;
  end if;

  if not (public.is_finite_number(new.material_cost) and public.is_finite_number(new.labour_hours) and public.is_finite_number(new.labour_rate)
          and public.is_finite_number(new.markup_pct) and public.is_finite_number(new.tax_pct) and public.is_finite_number(new.days_impact)) then
    raise exception 'Costs, hours, rates, percentages and days must be real numbers.' using errcode = '22023';
  end if;
  if abs(coalesce(new.days_impact, 0)) > 36500 then
    raise exception 'A schedule impact cannot be more than 100 years.' using errcode = '22023';
  end if;

  if coalesce(new.labour_hours, 0) < 0 or coalesce(new.labour_rate, 0) < 0 or coalesce(new.markup_pct, 0) < 0
     or coalesce(new.tax_pct, 0) < 0 or coalesce(new.tax_pct, 0) > 100 then
    raise exception 'Hours, rates and percentages cannot be negative, and tax cannot be over 100%%.' using errcode = '22023';
  end if;

  -- Money never comes from the client. Mirrors changeOrderTotals in lib/billing-math.ts.
  v_labour := round(coalesce(new.labour_hours, 0) * coalesce(new.labour_rate, 0), 2);
  v_cost := round(coalesce(new.material_cost, 0) + v_labour, 2);
  v_markup := round(v_cost * coalesce(new.markup_pct, 0) / 100, 2);
  new.price := round(v_cost + v_markup, 2);
  new.tax := round(new.price * coalesce(new.tax_pct, 0) / 100, 2);
  new.total := round(new.price + new.tax, 2);
  new.cost_impact := new.price;
  -- The cost side, at the company's own labour rate. The price above is revenue.
  new.budget_cost := round(coalesce(new.material_cost, 0) + coalesce(new.labour_hours, 0) * coalesce(v_company_rate, 0), 2);

  if new.status = 'Approved' then
    if not v_system and (tg_op = 'INSERT' or old.status <> 'Approved') then
      if new.project_id is null then
        raise exception 'Pick the project before approving this change order.' using errcode = 'P0001';
      elsif new.price = 0 then
        raise exception 'A change order needs a price above zero, or a credit below it, before it can be approved.' using errcode = 'P0001';
      elsif coalesce(public.trim_blank(new.approved_by), '') = '' or new.signature is null then
        raise exception 'Enter the name of the person approving and draw their signature.' using errcode = 'P0001';
      end if;
      new.approved_by := public.trim_blank(new.approved_by);
      new.approved_at := now();
    end if;
  elsif not v_system then
    new.approved_by := null;
    new.signature := null;
    new.approved_at := null;
  end if;

  return new;
end $$;
revoke execute on function public.guard_change_order() from public, anon, authenticated;

-- Invoice lines --------------------------------------------------------------------------
-- A change order line carries the tax rate the client signed. Percents that add up to 100 bill the
-- whole contract, a stray cent either way going on the last line. Credits can be billed.
create or replace function public.price_invoice_lines(p_invoice uuid, p_company uuid, p_project uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_n integer;
  v_type text;
  v_description text;
  v_amount numeric;
  v_percent numeric;
  v_percent_total numeric := 0;
  v_contract numeric;
  v_billed numeric;
  v_billed_dollars numeric;
  v_billed_lines integer;
  v_percent_dollars numeric := 0;
  v_percent_lines integer := 0;
  v_last_percent integer;
  v_last_amount numeric;
  v_excess numeric;
  v_id uuid;
  v_co record;
  v_draw record;
  v_seen uuid[] := '{}';
  v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Invoice lines are not valid.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'An invoice can have up to 200 lines.' using errcode = '22023';
  end if;

  for v_line, v_n in select t.x, t.ord::integer from jsonb_array_elements(p_lines) with ordinality as t(x, ord) loop
    if jsonb_typeof(v_line) is distinct from 'object' then
      raise exception 'Line %: not valid.', v_n using errcode = '22023';
    end if;
    v_type := coalesce(v_line ->> 'type', 'free');
    v_description := left(btrim(coalesce(v_line ->> 'description', '')), 500);

    if v_type = 'change_order' then
      v_id := (v_line ->> 'change_order_id')::uuid;
      select co.id, co.co_number, co.title, co.status, co.price, co.tax_pct, co.project_id, co.invoice_id, co.billed_in_old_app into v_co
      from public.change_orders co where co.id = v_id and co.company_id = p_company for update;
      if not found then
        raise exception 'Line %: that change order could not be found.', v_n using errcode = '22023';
      elsif v_co.status <> 'Approved' then
        raise exception 'Line %: change order #% is not approved, so it cannot be billed yet.', v_n, v_co.co_number using errcode = '22023';
      elsif v_co.billed_in_old_app then
        raise exception 'Line %: change order #% was already invoiced before this app tracked billing.', v_n, v_co.co_number using errcode = '22023';
      elsif coalesce(v_co.price, 0) = 0 or not public.is_finite_number(v_co.price) then
        raise exception 'Line %: change order #% has no price, so there is nothing to bill.', v_n, v_co.co_number using errcode = '22023';
      elsif v_co.invoice_id is not null and v_co.invoice_id <> p_invoice then
        raise exception 'Line %: change order #% is already on another invoice.', v_n, v_co.co_number using errcode = '22023';
      elsif v_co.project_id is distinct from p_project then
        raise exception 'Line %: change order #% belongs to a different project.', v_n, v_co.co_number using errcode = '22023';
      elsif v_id = any(v_seen) then
        raise exception 'Line %: change order #% is on this invoice twice.', v_n, v_co.co_number using errcode = '22023';
      end if;
      v_seen := v_seen || v_id;
      v_amount := v_co.price;
      if v_description = '' then v_description := 'Change order #' || v_co.co_number || ': ' || v_co.title; end if;
      v_out := v_out || (jsonb_build_object('type', v_type, 'description', v_description, 'amount', v_amount, 'change_order_id', v_id)
        || case when v_co.tax_pct is null then '{}'::jsonb else jsonb_build_object('tax_pct', v_co.tax_pct) end);

    elsif v_type = 'percent' then
      v_percent := round((v_line ->> 'percent')::numeric, 4);
      if v_percent is null or v_percent <= 0 or v_percent > 100 then
        raise exception 'Line %: enter a percent above 0 and up to 100.', v_n using errcode = '22023';
      end if;
      if p_project is null then
        raise exception 'Line %: pick the project before billing a percent of its contract.', v_n using errcode = '22023';
      end if;
      if v_contract is null then
        select p.contract_value into v_contract from public.projects p where p.id = p_project and p.company_id = p_company for update;
        if coalesce(v_contract, 0) <= 0 or not public.is_finite_number(v_contract) then
          raise exception 'Line %: enter the contract value on the project first.', v_n using errcode = '22023';
        end if;
      end if;
      v_percent_total := v_percent_total + v_percent;
      v_amount := round(v_contract * v_percent / 100, 2);
      if v_description = '' then v_description := trim_scale(v_percent)::text || '% of contract'; end if;
      v_percent_dollars := v_percent_dollars + v_amount;
      v_percent_lines := v_percent_lines + 1;
      v_last_percent := jsonb_array_length(v_out);
      v_last_amount := v_amount;
      v_out := v_out || jsonb_build_object('type', v_type, 'description', v_description, 'amount', v_amount, 'percent', v_percent);

    elsif v_type = 'draw' then
      v_id := (v_line ->> 'progress_billing_id')::uuid;
      select d.id, d.title, d.billing_period, d.amount_billed, d.project_id, d.invoice_id, d.status into v_draw
      from public.progress_billing d where d.id = v_id and d.company_id = p_company for update;
      if not found then
        raise exception 'Line %: that draw could not be found.', v_n using errcode = '22023';
      elsif v_draw.invoice_id is not null and v_draw.invoice_id <> p_invoice then
        raise exception 'Line %: draw "%" is already on another invoice.', v_n, v_draw.title using errcode = '22023';
      elsif v_draw.status in ('Invoiced', 'Paid') and v_draw.invoice_id is null then
        -- Only the old app could leave one like this. Whoever knows better can set it back to Draft.
        raise exception 'Line %: draw "%" is already marked %.', v_n, v_draw.title, lower(v_draw.status) using errcode = '22023';
      elsif v_draw.project_id is distinct from p_project then
        raise exception 'Line %: draw "%" belongs to a different project.', v_n, v_draw.title using errcode = '22023';
      elsif coalesce(v_draw.amount_billed, 0) <= 0 or not public.is_finite_number(v_draw.amount_billed) then
        raise exception 'Line %: enter the amount billed on draw "%" first.', v_n, v_draw.title using errcode = '22023';
      elsif v_id = any(v_seen) then
        raise exception 'Line %: draw "%" is on this invoice twice.', v_n, v_draw.title using errcode = '22023';
      end if;
      v_seen := v_seen || v_id;
      v_amount := v_draw.amount_billed;
      if v_description = '' then v_description := concat_ws(', ', v_draw.title, nullif(btrim(v_draw.billing_period), '')); end if;
      v_out := v_out || jsonb_build_object('type', v_type, 'description', v_description, 'amount', v_amount, 'progress_billing_id', v_id);

    elsif v_type = 'free' then
      v_amount := round((v_line ->> 'amount')::numeric, 2);
      if v_amount is null or not public.is_finite_number(v_amount) then
        raise exception 'Line %: enter an amount.', v_n using errcode = '22023';
      elsif v_description = '' then
        raise exception 'Line %: enter a description.', v_n using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('type', v_type, 'description', v_description, 'amount', v_amount);

    else
      raise exception 'Line %: not a kind of line this app knows.', v_n using errcode = '22023';
    end if;
  end loop;

  if v_percent_total > 0 then
    select coalesce(sum((l.x ->> 'percent')::numeric), 0), coalesce(sum((l.x ->> 'amount')::numeric), 0), count(*)::integer
    into v_billed, v_billed_dollars, v_billed_lines
    from public.invoices i
    cross join lateral jsonb_array_elements(i.lines) as l(x)
    where i.company_id = p_company and i.project_id = p_project and i.status <> 'Void' and i.id <> p_invoice
      and l.x ->> 'type' = 'percent';
    if v_billed + v_percent_total > 100 then
      raise exception 'Other invoices have billed % of this contract, so only % is left. This invoice asks for %.',
        trim_scale(v_billed)::text || '%', trim_scale(100 - v_billed)::text || '%', trim_scale(v_percent_total)::text || '%' using errcode = '22023';
    end if;
    -- Percents can add up to 100 and still round to more or fewer dollars than the contract, by at
    -- most half a cent a line. That goes on the last line. More over than that means the contract
    -- came down after the other invoices were priced, which is for a person to sort out; more under
    -- means it went up, and the balance is still there to bill. Mirrors pricePercentLines in lib/billing-math.ts.
    v_excess := v_billed_dollars + v_percent_dollars - v_contract;
    if v_excess > 0 then
      if v_excess > 0.005 * (v_billed_lines + v_percent_lines) or v_excess > v_last_amount then
        raise exception 'Other invoices have billed $% of this $% contract, so this invoice''s $% of percent lines is too much.',
          to_char(v_billed_dollars, 'FM999999999990.00'), to_char(v_contract, 'FM999999999990.00'), to_char(v_percent_dollars, 'FM999999999990.00') using errcode = '22023';
      end if;
      v_out := jsonb_set(v_out, array[v_last_percent::text, 'amount'], to_jsonb(v_last_amount - v_excess));
    elsif v_excess < 0 and v_billed + v_percent_total = 100 and -v_excess <= 0.005 * (v_billed_lines + v_percent_lines) then
      v_out := jsonb_set(v_out, array[v_last_percent::text, 'amount'], to_jsonb(v_last_amount - v_excess));
    end if;
  end if;

  return v_out;
end $$;
revoke execute on function public.price_invoice_lines(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- Tax across an invoice's lines. A change order line is taxed at the rate it was signed at, and
-- everything else at the invoice's rate. Mirrors invoiceTotals in lib/billing-math.ts.
create or replace function public.invoice_tax(p_lines jsonb, p_tax numeric) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(round(g.amount * g.rate / 100, 2)), 0)
  from (select coalesce((l.x ->> 'tax_pct')::numeric, p_tax, 0) as rate, sum((l.x ->> 'amount')::numeric) as amount
        from jsonb_array_elements(p_lines) as l(x) group by 1) g
$$;
revoke execute on function public.invoice_tax(jsonb, numeric) from public, anon, authenticated;

-- The rate the client accepted on the quote behind this job, when there is one
create or replace function public.project_accepted_tax(p_project uuid, p_company uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select e.tax_percentage from public.projects p
  join public.estimates e on e.id = p.estimate_id and e.company_id = p.company_id
  where p.id = p_project and p.company_id = p_company
$$;
revoke execute on function public.project_accepted_tax(uuid, uuid) from public, anon, authenticated;

create or replace function public.guard_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := auth.uid() is null;
  v_tax numeric;
  v_holdback numeric;
  v_subtotal numeric;
  -- What can still change once an invoice has left Draft
  v_fixed text[] := array['status', 'paid_at', 'holdback_release_date', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if v_system then return old; end if;
    if old.status <> 'Draft' then
      raise exception 'Only a draft invoice can be deleted. Void this one instead.' using errcode = 'P0001';
    end if;
    -- Before the row goes, or the links back to it would stop the delete
    update public.change_orders set invoice_id = null where invoice_id = old.id;
    update public.progress_billing set invoice_id = null, status = 'Draft' where invoice_id = old.id;
    delete from public.receivables where invoice_id = old.id;
    return old;
  end if;

  if new.status not in ('Draft', 'Sent', 'Paid', 'Overdue', 'Void') then
    raise exception 'That is not an invoice status.' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if not v_system and new.company_id is distinct from public.user_company_id() then
      raise exception 'You do not have permission to do that.' using errcode = '42501';
    end if;
    if not v_system and new.status <> 'Draft' then
      raise exception 'A new invoice starts as a draft.' using errcode = 'P0001';
    end if;
    if new.invoice_number is null or not v_system then
      new.invoice_number := public.next_company_number(new.company_id, 'invoice', 1001)::text;
    end if;
    select c.default_tax, c.default_holdback_pct into v_tax, v_holdback from public.companies c where c.id = new.company_id;
    new.tax_pct := coalesce(new.tax_pct, public.project_accepted_tax(new.project_id, new.company_id), v_tax);
    new.holdback_pct := coalesce(new.holdback_pct, v_holdback);
    new.issue_date := coalesce(new.issue_date, current_date);
    new.due_date := coalesce(new.due_date, new.issue_date + 30);
  end if;

  -- The service role (the overdue job, tests that set up data) is trusted with what it sets
  if v_system then return new; end if;

  if tg_op = 'UPDATE' then
    if new.company_id is distinct from public.user_company_id() then
      raise exception 'You do not have permission to do that.' using errcode = '42501';
    end if;
    new.invoice_number := old.invoice_number;

    if old.status <> 'Draft' and (to_jsonb(new) - v_fixed - 'amount'::text - 'gst'::text - 'holdback_amount'::text - 'total'::text)
         is distinct from (to_jsonb(old) - v_fixed - 'amount'::text - 'gst'::text - 'holdback_amount'::text - 'total'::text) then
      raise exception 'Only a draft invoice can be edited. Set it back to Draft first.' using errcode = 'P0001';
    end if;
    -- A void record keeps what it said. Nothing else can change in the same write.
    if old.status = 'Draft' and new.status = 'Void' and (to_jsonb(new) - v_fixed - 'amount'::text - 'gst'::text - 'holdback_amount'::text - 'total'::text)
         is distinct from (to_jsonb(old) - v_fixed - 'amount'::text - 'gst'::text - 'holdback_amount'::text - 'total'::text) then
      raise exception 'Void this invoice on its own, with no other changes.' using errcode = 'P0001';
    end if;

    -- A draft moved onto a job takes the rate quoted for that job, unless this same save picked one
    if old.status = 'Draft' and new.project_id is distinct from old.project_id and new.tax_pct is not distinct from old.tax_pct then
      new.tax_pct := coalesce(public.project_accepted_tax(new.project_id, new.company_id), new.tax_pct);
    end if;

    if new.status is distinct from old.status then
      if new.status = 'Overdue' then
        raise exception 'Overdue is worked out from the due date.' using errcode = 'P0001';
      elsif old.status = 'Void' then
        raise exception 'A void invoice stays void. Make a new one instead.' using errcode = 'P0001';
      elsif old.status = 'Paid' and new.status <> 'Sent' then
        raise exception 'Undo the payment first, which puts this invoice back to Sent.' using errcode = 'P0001';
      elsif old.status = 'Draft' and new.status = 'Paid' then
        raise exception 'Mark this invoice as sent before marking it paid.' using errcode = 'P0001';
      elsif old.status = 'Draft' and new.status = 'Sent' and jsonb_array_length(new.lines) = 0 then
        raise exception 'Add at least one line before sending this invoice.' using errcode = 'P0001';
      end if;
    end if;
    if new.status is distinct from old.status then
      new.paid_at := case when new.status = 'Paid' then current_date end;
    else
      new.paid_at := old.paid_at;
    end if;
  else
    new.paid_at := null;
  end if;

  if tg_op = 'INSERT' or (old.status = 'Draft' and new.status <> 'Void') then
    if coalesce(new.tax_pct, 0) not between 0 and 100 or coalesce(new.holdback_pct, 0) not between 0 and 100 then
      raise exception 'Tax and holdback must be between 0 and 100%%.' using errcode = '22023';
    end if;
    -- Leaving Draft prices it one last time, so a percent line goes out at today's contract
    if tg_op = 'INSERT' or new.lines is distinct from old.lines or new.project_id is distinct from old.project_id or new.status is distinct from old.status then
      new.lines := public.price_invoice_lines(new.id, new.company_id, new.project_id, new.lines);
    end if;
    -- Only when something behind the money moved, so renaming an old draft keeps its hand-typed tax
    if tg_op = 'INSERT' or old.total is null or new.lines is distinct from old.lines
       or new.tax_pct is distinct from old.tax_pct or new.holdback_pct is distinct from old.holdback_pct then
      -- Mirrors invoiceTotals in lib/billing-math.ts: holdback comes off the pre-tax amount
      select coalesce(sum((l.x ->> 'amount')::numeric), 0) into v_subtotal from jsonb_array_elements(new.lines) as l(x);
      new.amount := round(v_subtotal, 2);
      new.gst := public.invoice_tax(new.lines, new.tax_pct);
      new.holdback_amount := round(new.amount * coalesce(new.holdback_pct, 0) / 100, 2);
      new.total := round(new.amount + new.gst - new.holdback_amount, 2);
    else
      new.amount := old.amount;
      new.gst := old.gst;
      new.holdback_amount := old.holdback_amount;
      new.total := old.total;
    end if;
  else
    new.amount := old.amount;
    new.gst := old.gst;
    new.holdback_amount := old.holdback_amount;
    new.total := old.total;
  end if;

  return new;
end $$;
revoke execute on function public.guard_invoice() from public, anon, authenticated;

-- A draw on an invoice has the invoice's holdback terms. The invoice is what the client and the
-- dashboard go by, so the terms follow it, and a draft draw's terms are copied onto its invoice.
create or replace function public.sync_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cos uuid[] := '{}';
  v_draws uuid[] := '{}';
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.lines is not distinct from old.lines
     and new.total is not distinct from old.total and new.holdback_pct is not distinct from old.holdback_pct
     and new.holdback_release_date is not distinct from old.holdback_release_date then
    return null;
  end if;

  if new.status <> 'Void' then
    select coalesce(array_agg((l.x ->> 'change_order_id')::uuid) filter (where l.x ->> 'type' = 'change_order'), '{}'),
           coalesce(array_agg((l.x ->> 'progress_billing_id')::uuid) filter (where l.x ->> 'type' = 'draw'), '{}')
    into v_cos, v_draws
    from jsonb_array_elements(new.lines) as l(x);
  end if;

  update public.change_orders set invoice_id = null where invoice_id = new.id and id <> all(v_cos);
  update public.change_orders set invoice_id = new.id where id = any(v_cos) and invoice_id is distinct from new.id;

  update public.progress_billing set invoice_id = null, status = 'Draft' where invoice_id = new.id and id <> all(v_draws);
  update public.progress_billing
  set invoice_id = new.id, status = case when new.status = 'Paid' then 'Paid' else 'Invoiced' end,
      holdback_percent = new.holdback_pct, holdback_release_date = new.holdback_release_date
  where id = any(v_draws)
    and (invoice_id is distinct from new.id or status is distinct from case when new.status = 'Paid' then 'Paid' else 'Invoiced' end
         or holdback_percent is distinct from new.holdback_pct or holdback_release_date is distinct from new.holdback_release_date);

  if new.status in ('Sent', 'Overdue', 'Paid') then
    insert into public.receivables (company_id, created_by, title, status, project_id, client_name, amount, due_date, invoice_id)
    values (new.company_id, new.created_by, left('Invoice ' || new.invoice_number || ': ' || new.title, 300),
            case when new.status = 'Paid' then 'Collected' else public.receivable_age_status(new.due_date) end,
            new.project_id, new.client_name, new.total, new.due_date, new.id)
    on conflict (invoice_id) where invoice_id is not null do update set
      title = excluded.title, status = excluded.status, project_id = excluded.project_id,
      client_name = excluded.client_name, amount = excluded.amount, due_date = excluded.due_date;
  else
    delete from public.receivables where invoice_id = new.id;
  end if;
  return null;
end $$;
revoke execute on function public.sync_invoice() from public, anon, authenticated;

create or replace function public.guard_progress_billing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then
      raise exception 'This draw is on an invoice. Delete or void that invoice first.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'Draft' then
      raise exception 'A new draw starts as a draft. Creating its invoice moves it on.' using errcode = 'P0001';
    end if;
    new.invoice_id := null;
    if new.holdback_percent is null then
      select c.default_holdback_pct into new.holdback_percent from public.companies c where c.id = new.company_id;
    end if;
  else
    new.invoice_id := old.invoice_id;
    if new.status is distinct from old.status and (old.invoice_id is not null or new.status <> 'Draft') then
      raise exception 'A draw follows its invoice. Change the invoice instead.' using errcode = 'P0001';
    end if;
    if old.invoice_id is not null and (new.amount_billed is distinct from old.amount_billed or new.project_id is distinct from old.project_id) then
      raise exception 'This draw is on an invoice. Take it off the invoice to change the amount or project.' using errcode = 'P0001';
    end if;
    -- The form sends every field on every save, so these are kept rather than refused
    if old.invoice_id is not null then
      new.holdback_percent := old.holdback_percent;
      new.holdback_release_date := old.holdback_release_date;
    end if;
  end if;
  if not public.is_finite_number(new.amount_billed) or coalesce(new.amount_billed, 0) < 0 or coalesce(new.holdback_percent, 0) not between 0 and 100 then
    raise exception 'The amount must be a number that is not negative, and holdback must be between 0 and 100%%.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.guard_progress_billing() from public, anon, authenticated;

-- A draft can't bill past the contract ---------------------------------------------------
-- As 20261104000310, with change order and draw lines held to the contract too. Those are checked
-- against what contract lines have billed so far: percents, change orders, draws and a "Balance of
-- contract". Hand-typed charges don't count against them, so time and material on a job can't block
-- billing a signed change order. Nothing to hold them to on a job with no contract at all.
create or replace function public.guard_invoice_send() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_n integer;
  v_revised numeric;
  v_prior numeric;
  v_prior_contract numeric;
  v_room numeric;
  v_percent numeric := 0;
  v_billed numeric := 0;
  v_amount numeric;
  v_out jsonb := '[]'::jsonb;
  v_subtotal numeric;
begin
  if auth.uid() is null or new.project_id is null or not exists (
    select 1 from jsonb_array_elements(new.lines) as l(x)
    where l.x ->> 'type' in ('percent', 'change_order', 'draw')
       or (l.x ->> 'type' = 'free' and lower(btrim(l.x ->> 'description')) = 'balance of contract')) then
    return new;
  end if;

  select p.revised_contract into v_revised from public.projects p where p.id = new.project_id and p.company_id = new.company_id for update;
  if not public.is_finite_number(v_revised) then v_revised := 0; end if;

  select coalesce(sum(i.amount) filter (where public.is_finite_number(i.amount)), 0) into v_prior
  from public.invoices i
  where i.project_id = new.project_id and i.company_id = new.company_id and i.id <> new.id and i.status in ('Sent', 'Overdue', 'Paid');

  select coalesce(sum((l.x ->> 'amount')::numeric), 0) into v_prior_contract
  from public.invoices i
  cross join lateral jsonb_array_elements(i.lines) as l(x)
  where i.project_id = new.project_id and i.company_id = new.company_id and i.id <> new.id and i.status in ('Sent', 'Overdue', 'Paid')
    and (l.x ->> 'type' <> 'free' or lower(btrim(l.x ->> 'description')) = 'balance of contract');

  select coalesce(sum((l.x ->> 'amount')::numeric) filter (where l.x ->> 'type' = 'percent'), 0),
         coalesce(sum((l.x ->> 'amount')::numeric) filter (where l.x ->> 'type' in ('change_order', 'draw')), 0)
  into v_percent, v_billed
  from jsonb_array_elements(new.lines) as l(x);

  v_room := coalesce(v_revised, 0) - v_prior - v_billed - v_percent;
  if v_percent > 0 and v_room < 0 then
    raise exception 'This invoice would bill past the contract: $% is already billed on this $% contract, and this invoice adds $%. Change its lines before sending it.',
      to_char(v_prior, 'FM999999999990.00'), to_char(coalesce(v_revised, 0), 'FM999999999990.00'), to_char(v_percent + v_billed, 'FM999999999990.00') using errcode = 'P0001';
  end if;
  if v_billed > 0 and coalesce(v_revised, 0) > 0 and coalesce(v_revised, 0) - v_prior_contract - v_billed - v_percent < 0 then
    raise exception 'This invoice would bill past the contract: $% is already billed on this $% contract, and this invoice adds $%. Change its lines before sending it.',
      to_char(v_prior_contract, 'FM999999999990.00'), to_char(coalesce(v_revised, 0), 'FM999999999990.00'), to_char(v_percent + v_billed, 'FM999999999990.00') using errcode = 'P0001';
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
    new.gst := public.invoice_tax(new.lines, new.tax_pct);
    new.holdback_amount := round(new.amount * coalesce(new.holdback_pct, 0) / 100, 2);
    new.total := round(new.amount + new.gst - new.holdback_amount, 2);
  end if;
  return new;
end $$;
revoke execute on function public.guard_invoice_send() from public, anon, authenticated;

-- A job takes one accepted quote. A second one would be marked Won with no contract behind it.
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
    if exists (select 1 from public.projects p where p.id = v_id and p.proposal_id is not null and p.proposal_id <> p_proposal) then
      raise exception 'This job already has an accepted quote, so this one would not change its contract. Add the work to the job as a change order, or make a new project for it.' using errcode = 'P0001';
    end if;
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

-- Job cost ---------------------------------------------------------------------------------
-- Paid leaves out holdback, which the client hasn't paid. A PO stays committed for whatever
-- approved bills haven't covered yet, so a part bill or one still To Approve doesn't lose the rest.
-- A bill with no project of its own counts on the job of the PO it was matched to.
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
      select e.* into v_est from public.estimates e where e.id = v_p.estimate_id and e.company_id = v_p.company_id;
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
  where b.status in ('Approved', 'Paid') and public.is_finite_number(b.amount)
    and (b.project_id = p_project
         or (b.project_id is null and exists (select 1 from public.purchase_orders po where po.id = b.purchase_order_id and po.project_id = p_project)));

  select coalesce(sum(x.amount) filter (where x.category = 'Material'), 0), coalesce(sum(x.amount) filter (where x.category <> 'Material'), 0)
  into v_entry_material, v_entry_other
  from public.job_cost_entries x where x.project_id = p_project;

  select coalesce(sum(greatest(po.amount - coalesce((
           select sum(b.amount) from public.payables b
           where b.purchase_order_id = po.id and b.status in ('Approved', 'Paid') and public.is_finite_number(b.amount)), 0), 0)), 0)
  into v_committed
  from public.purchase_orders po
  where po.project_id = p_project and po.status in ('Issued', 'Partially Received', 'Received')
    and public.is_finite_number(po.amount);

  -- Before tax, so billed compares with the contract. Paid is the same, less the holdback still withheld.
  select coalesce(sum(i.amount) filter (where i.status in ('Sent', 'Overdue', 'Paid')), 0),
         coalesce(sum(i.amount - coalesce(i.holdback_amount, 0)) filter (where i.status = 'Paid'), 0)
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

-- Numbers already stored move to the new sums. Nothing here is a person's work: these are rollups.
do $$
declare
  r record;
begin
  for r in select p.id from public.projects p order by p.id loop
    perform public.recalc_job_cost(r.id);
  end loop;
end $$;

-- Estimates --------------------------------------------------------------------------------
-- Pressing Save on an estimate that is with the client must be able to fix its scope. The lines
-- come along with every save, so lines that haven't changed leave them untouched, locked or not.
create or replace function public.save_estimate_items(p_estimate uuid, p_items jsonb, p_total numeric default null)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_same boolean := false;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 1000 then
    raise exception 'An estimate can have up to 1000 lines' using errcode = '22023';
  end if;
  perform 1 from public.estimates where id = p_estimate for update;
  if not found then raise exception 'Estimate not found' using errcode = 'P0002'; end if;

  -- Rounded the way the columns round. A value that can't be compared goes on to be refused below.
  begin
    select coalesce((select jsonb_agg(jsonb_build_array(i.description, i.quantity, i.unit, i.material_unit_cost, i.labour_hours_per_unit) order by i.sort, i.id)
                     from public.estimate_items i where i.estimate_id = p_estimate), '[]'::jsonb)
         = coalesce((select jsonb_agg(jsonb_build_array(coalesce(t.x ->> 'description', ''), coalesce((t.x ->> 'quantity')::numeric, 0)::numeric(14,3), coalesce(t.x ->> 'unit', 'ea'),
                                                        coalesce((t.x ->> 'material_unit_cost')::numeric, 0)::numeric(14,2), coalesce((t.x ->> 'labour_hours_per_unit')::numeric, 0)::numeric(12,3)) order by t.ord)
                     from jsonb_array_elements(p_items) with ordinality as t(x, ord)), '[]'::jsonb)
    into v_same;
  exception when others then
    v_same := false;
  end;
  if v_same then return; end if;

  delete from public.estimate_items where estimate_id = p_estimate;
  insert into public.estimate_items (estimate_id, sort, description, quantity, unit, material_unit_cost, labour_hours_per_unit)
  select p_estimate, (t.ord - 1)::integer,
         coalesce(t.x ->> 'description', ''), coalesce((t.x ->> 'quantity')::numeric, 0), coalesce(t.x ->> 'unit', 'ea'),
         coalesce((t.x ->> 'material_unit_cost')::numeric, 0), coalesce((t.x ->> 'labour_hours_per_unit')::numeric, 0)
  from jsonb_array_elements(p_items) with ordinality as t(x, ord);
end $$;
revoke execute on function public.save_estimate_items(uuid, jsonb, numeric) from public, anon;
grant execute on function public.save_estimate_items(uuid, jsonb, numeric) to authenticated;

-- Setting the proposal back to Draft is refused once a project exists, so only offer it before then
create or replace function public.estimate_lock_hint(p_estimate uuid, p_what text) returns text
language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.projects pr join public.proposals p on pr.proposal_id = p.id where p.estimate_id = p_estimate)
              then 'A project was made from it, so add new work to the job as a change order.'
              else 'Set the proposal back to Draft to change ' || p_what || '.' end
$$;
revoke execute on function public.estimate_lock_hint(uuid, text) from public, anon, authenticated;

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
    raise exception 'This estimate''s proposal is with the client, so its price is locked. %', public.estimate_lock_hint(new.id, 'it') using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.guard_estimate_total() from public, anon, authenticated;

create or replace function public.estimate_items_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_locked uuid;
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.estimate_id) into v_ids from n;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.estimate_id) into v_ids from o;
  else
    select array_agg(distinct x.estimate_id) into v_ids
    from (select n.estimate_id from n union select o.estimate_id from o) x;
  end if;
  select e.id into v_locked from public.estimates e where e.id = any(v_ids) and public.estimate_is_with_client(e.id) limit 1;
  if v_locked is not null then
    raise exception 'This estimate''s proposal is with the client, so its lines are locked. %', public.estimate_lock_hint(v_locked, 'them') using errcode = 'P0001';
  end if;
  -- The value is thrown away: guard_estimate_total works out the real one
  update public.estimates e set total_amount = 0 where e.id = any(v_ids);
  return null;
end $$;
revoke execute on function public.estimate_items_changed() from public, anon, authenticated;
