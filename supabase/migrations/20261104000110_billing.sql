-- Change orders, invoices, progress draws and receivables. The module columns come from
-- lib/modules.ts through the registry sync; this file holds the rules. All money is worked
-- out here (lib/billing-math.ts only previews it in the browser and must agree: tested).
-- Safe to run more than once.
--
-- pg_trigger_depth() > 1 below means "one of these rules is making this change, not a
-- person": an invoice's trigger claiming a change order, say. A client can't reach that
-- depth with values of its own. auth.uid() is null means the service role or a migration.

-- Postgres sorts NaN above every number, so a plain "< 0" or "<= 0" lets it through, and a
-- single NaN turns every sum it reaches into NaN. Each money rule below checks this first.
create or replace function public.is_finite_number(p numeric) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (p <> 'NaN'::numeric and p <> 'Infinity'::numeric and p <> '-Infinity'::numeric)
$$;
revoke execute on function public.is_finite_number(numeric) from public, anon, authenticated;

-- btrim only strips ASCII spaces. This strips what the forms' zod trim strips, so a tab or a
-- no-break space is not a name here either.
create or replace function public.trim_blank(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(p,
    '^[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$',
    '', 'g')
$$;
revoke execute on function public.trim_blank(text) from public, anon, authenticated;

-- A drawn signature is too big to come back with every list row, so like daily_logs.signature
-- it is not a registry field. Same shape as SignatureImage in lib/signature.ts.
alter table public.change_orders add column if not exists signature text;
alter table public.change_orders drop constraint if exists change_orders_signature_check;
alter table public.change_orders add constraint change_orders_signature_check
  check (signature ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' and char_length(signature) <= 300000) not valid;

-- The old app's Invoiced status has no invoice behind it here, so this is what stops one
-- being billed a second time. Set only by the backfill below.
alter table public.change_orders add column if not exists billed_in_old_app boolean not null default false;

-- Per-company numbers ------------------------------------------------------------
create table if not exists public.company_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('change_order', 'invoice')),
  last_value bigint not null,
  primary key (company_id, kind)
);
alter table public.company_counters enable row level security;
revoke all on public.company_counters from anon, authenticated;

-- The row lock taken by the upsert is what stops two saves getting the same number
create or replace function public.next_company_number(p_company uuid, p_kind text, p_first bigint)
returns bigint language sql security definer set search_path = '' as $$
  insert into public.company_counters as c (company_id, kind, last_value)
  values (p_company, p_kind, p_first)
  on conflict (company_id, kind) do update set last_value = c.last_value + 1
  returning c.last_value
$$;
revoke execute on function public.next_company_number(uuid, text, bigint) from public, anon, authenticated;

-- Old rows on a live database ------------------------------------------------------
-- Rows from before this engine had hand-typed amounts and a hand-set status. Triggers are
-- off so the rules below don't refuse what the old app was allowed to save.
alter table public.change_orders disable trigger user;
update public.change_orders set status = 'Sent' where status not in ('Draft', 'Sent', 'Approved', 'Rejected', 'Invoiced');
update public.change_orders set status = 'Approved', billed_in_old_app = true where status = 'Invoiced';
update public.change_orders set cost_impact = null where not public.is_finite_number(cost_impact);
update public.change_orders set days_impact = null where not public.is_finite_number(days_impact) or abs(days_impact) > 36500;
-- The old hand-typed price becomes the material line, so saving or reopening one keeps its price
update public.change_orders
set material_cost = cost_impact, labour_hours = 0, markup_pct = 0, tax_pct = 0, price = cost_impact, tax = 0, total = cost_impact
where price is null and cost_impact is not null;
update public.change_orders set approved_by = 'Approved before sign-off was added' where status = 'Approved' and approved_by is null;
do $$
declare
  r record;
begin
  for r in select id, company_id from public.change_orders where co_number is null order by created_at, id loop
    update public.change_orders set co_number = public.next_company_number(r.company_id, 'change_order', 1)::text where id = r.id;
  end loop;
end $$;
alter table public.change_orders enable trigger user;

alter table public.invoices disable trigger user;
update public.invoices set amount = null where not public.is_finite_number(amount);
update public.invoices set gst = null where not public.is_finite_number(gst);
update public.invoices set
  lines = case when coalesce(amount, 0) <> 0
               then jsonb_build_array(jsonb_build_object('type', 'free', 'description', title, 'amount', amount))
               else '[]'::jsonb end,
  amount = coalesce(amount, 0),
  gst = coalesce(gst, 0),
  tax_pct = case when coalesce(amount, 0) > 0 then round(coalesce(gst, 0) / amount * 100, 2) else 0 end,
  holdback_pct = 0,
  holdback_amount = 0,
  total = coalesce(amount, 0) + coalesce(gst, 0)
where total is null;
update public.invoices set paid_at = updated_at::date where status = 'Paid' and paid_at is null;
do $$
declare
  r record;
begin
  for r in select id, company_id from public.invoices where invoice_number is null order by created_at, title, id loop
    update public.invoices set invoice_number = public.next_company_number(r.company_id, 'invoice', 1001)::text where id = r.id;
  end loop;
end $$;
alter table public.invoices enable trigger user;

alter table public.progress_billing disable trigger user;
update public.progress_billing set amount_billed = null where not public.is_finite_number(amount_billed);
alter table public.progress_billing enable trigger user;

create unique index if not exists change_orders_number_idx on public.change_orders(company_id, co_number) where co_number is not null;
create unique index if not exists invoices_number_idx on public.invoices(company_id, invoice_number) where invoice_number is not null;
create unique index if not exists receivables_invoice_unique on public.receivables(invoice_id) where invoice_id is not null;

-- Change orders -------------------------------------------------------------------
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
      elsif new.price <= 0 then
        raise exception 'A change order needs a price above zero before it can be approved.' using errcode = 'P0001';
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

drop trigger if exists change_orders_guard on public.change_orders;
create trigger change_orders_guard before insert or update or delete on public.change_orders
  for each row execute function public.guard_change_order();

-- A date past what Postgres can hold has no end date to show. It must not stop the project saving.
create or replace function public.revised_end_date(p_end date, p_days numeric) returns date
language plpgsql immutable set search_path = '' as $$
begin
  return p_end + p_days::integer;
exception when numeric_value_out_of_range or datetime_field_overflow then
  return null;
end $$;
revoke execute on function public.revised_end_date(date, numeric) from public, anon, authenticated;

-- The contract moves with approved change orders. Worked out here on every project write,
-- so the columns can't be set by hand and can't drift from the change orders behind them.
create or replace function public.guard_project_contract() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_changes numeric := 0;
  v_days numeric := 0;
begin
  if not public.is_finite_number(new.contract_value) then
    raise exception 'The contract value must be a real number.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(sum(co.price), 0), coalesce(sum(round(coalesce(co.days_impact, 0))), 0) into v_changes, v_days
    from public.change_orders co
    where co.project_id = new.id and co.status = 'Approved';
  end if;
  new.approved_changes := v_changes;
  new.approved_days := v_days;
  new.revised_contract := coalesce(new.contract_value, 0) + v_changes;
  new.revised_end_date := public.revised_end_date(new.end_date, v_days);
  return new;
end $$;

drop trigger if exists projects_contract on public.projects;
create trigger projects_contract before insert or update on public.projects
  for each row execute function public.guard_project_contract();

create or replace function public.rollup_change_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.price is not distinct from old.price
     and new.days_impact is not distinct from old.days_impact and new.project_id is not distinct from old.project_id then
    return null;
  end if;
  if tg_op <> 'INSERT' and old.project_id is not null then
    update public.projects set approved_changes = 0 where id = old.project_id;
  end if;
  if tg_op <> 'DELETE' and new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    update public.projects set approved_changes = 0 where id = new.project_id;
  end if;
  return null;
end $$;

drop trigger if exists change_orders_rollup on public.change_orders;
create trigger change_orders_rollup after insert or update or delete on public.change_orders
  for each row execute function public.rollup_change_order();

-- Old approved change orders count from the start
alter table public.projects disable trigger user;
update public.projects set contract_value = null where not public.is_finite_number(contract_value);
update public.projects p set
  approved_changes = t.changes,
  approved_days = t.days,
  revised_contract = coalesce(p.contract_value, 0) + t.changes,
  revised_end_date = public.revised_end_date(p.end_date, t.days)
from (
  select pr.id,
         coalesce(sum(co.price) filter (where co.status = 'Approved'), 0) as changes,
         coalesce(sum(round(coalesce(co.days_impact, 0))) filter (where co.status = 'Approved'), 0) as days
  from public.projects pr
  left join public.change_orders co on co.project_id = pr.id
  group by pr.id
) t
where t.id = p.id
  and (p.approved_changes is distinct from t.changes or p.approved_days is distinct from t.days
       or p.revised_contract is distinct from coalesce(p.contract_value, 0) + t.changes
       or p.revised_end_date is distinct from public.revised_end_date(p.end_date, t.days));
alter table public.projects enable trigger user;

-- Invoice lines -------------------------------------------------------------------
-- Checks and prices one invoice's lines. The client sends what to bill; the amount of
-- anything but a free line comes from here. Locks each record it bills, so two invoices
-- can't claim one change order and two saves can't both take the last of a contract.
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
      select co.id, co.co_number, co.title, co.status, co.price, co.project_id, co.invoice_id, co.billed_in_old_app into v_co
      from public.change_orders co where co.id = v_id and co.company_id = p_company for update;
      if not found then
        raise exception 'Line %: that change order could not be found.', v_n using errcode = '22023';
      elsif v_co.status <> 'Approved' then
        raise exception 'Line %: change order #% is not approved, so it cannot be billed yet.', v_n, v_co.co_number using errcode = '22023';
      elsif v_co.billed_in_old_app then
        raise exception 'Line %: change order #% was already invoiced before this app tracked billing.', v_n, v_co.co_number using errcode = '22023';
      elsif coalesce(v_co.price, 0) <= 0 or not public.is_finite_number(v_co.price) then
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
      v_out := v_out || jsonb_build_object('type', v_type, 'description', v_description, 'amount', v_amount, 'change_order_id', v_id);

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
    -- Percents can add up to 100 and still round to more dollars than the contract, by at most
    -- half a cent a line. That comes off the last line. Anything more means the contract came
    -- down after the other invoices were priced, which is for a person to sort out.
    -- Mirrors pricePercentLines in lib/billing-math.ts.
    v_excess := v_billed_dollars + v_percent_dollars - v_contract;
    if v_excess > 0 then
      if v_excess > 0.005 * (v_billed_lines + v_percent_lines) or v_excess > v_last_amount then
        raise exception 'Other invoices have billed $% of this $% contract, so this invoice''s $% of percent lines is too much.',
          to_char(v_billed_dollars, 'FM999999999990.00'), to_char(v_contract, 'FM999999999990.00'), to_char(v_percent_dollars, 'FM999999999990.00') using errcode = '22023';
      end if;
      v_out := jsonb_set(v_out, array[v_last_percent::text, 'amount'], to_jsonb(v_last_amount - v_excess));
    end if;
  end if;

  return v_out;
end $$;
revoke execute on function public.price_invoice_lines(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- Invoices ------------------------------------------------------------------------
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
    new.tax_pct := coalesce(new.tax_pct, v_tax);
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
      new.gst := round(new.amount * coalesce(new.tax_pct, 0) / 100, 2);
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

drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard before insert or update or delete on public.invoices
  for each row execute function public.guard_invoice();

create or replace function public.receivable_age_status(p_due date) returns text
language sql stable set search_path = '' as $$
  select case
    -- An old row can hold an infinite date, and subtracting one is an error that would stop the backfill below
    when p_due is null or p_due = 'infinity'::date then 'Current'
    when p_due = '-infinity'::date then '90+ Days'
    when current_date - p_due < 30 then 'Current'
    when current_date - p_due < 60 then '30 Days'
    when current_date - p_due < 90 then '60 Days'
    else '90+ Days'
  end
$$;

-- Keeps what hangs off an invoice in step with it: the change orders and draws it bills,
-- and the receivable it creates once sent.
create or replace function public.sync_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cos uuid[] := '{}';
  v_draws uuid[] := '{}';
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.lines is not distinct from old.lines
     and new.total is not distinct from old.total then
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
  set invoice_id = new.id, status = case when new.status = 'Paid' then 'Paid' else 'Invoiced' end
  where id = any(v_draws)
    and (invoice_id is distinct from new.id or status is distinct from case when new.status = 'Paid' then 'Paid' else 'Invoiced' end);

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

drop trigger if exists invoices_sync on public.invoices;
create trigger invoices_sync after insert or update on public.invoices
  for each row execute function public.sync_invoice();

-- Receivables ---------------------------------------------------------------------
-- A receivable from an invoice follows that invoice. On any other, the age is still worked out.
create or replace function public.guard_receivable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then
      raise exception 'This receivable follows its invoice. Void the invoice instead.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.invoice_id is not null then
    if (to_jsonb(new) - 'updated_at'::text) is distinct from (to_jsonb(old) - 'updated_at'::text) then
      raise exception 'This receivable follows its invoice. Change the invoice instead.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  new.invoice_id := null;
  if new.status <> 'Collected' then new.status := public.receivable_age_status(new.due_date); end if;
  return new;
end $$;

drop trigger if exists receivables_guard on public.receivables;
create trigger receivables_guard before insert or update or delete on public.receivables
  for each row execute function public.guard_receivable();

-- Invoices the old app had already sent are owed money too. If someone typed a receivable for
-- one by hand (same amount, and same title or client), that one is linked and left as they
-- typed it instead of adding a second. Anything else gets a new one.
alter table public.receivables disable trigger user;
do $$
declare
  r record;
begin
  for r in
    select i.* from public.invoices i
    where i.status in ('Sent', 'Overdue')
      and not exists (select 1 from public.receivables x where x.invoice_id = i.id)
    order by i.created_at, i.id
  loop
    update public.receivables set invoice_id = r.id
    where id = (
      select x.id from public.receivables x
      where x.company_id = r.company_id and x.invoice_id is null and x.amount in (r.total, r.amount)
        and (lower(btrim(x.title)) = lower(btrim(r.title))
             or (nullif(btrim(x.client_name), '') is not null and lower(btrim(x.client_name)) = lower(btrim(r.client_name))))
      order by x.created_at, x.id
      limit 1
    );
    if not found then
      insert into public.receivables (company_id, created_by, title, status, project_id, client_name, amount, due_date, invoice_id)
      values (r.company_id, r.created_by, left('Invoice ' || r.invoice_number || ': ' || r.title, 300),
              public.receivable_age_status(r.due_date), r.project_id, r.client_name, r.total, r.due_date, r.id);
    end if;
  end loop;
end $$;
alter table public.receivables enable trigger user;

-- Progress draws ------------------------------------------------------------------
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
  end if;
  if not public.is_finite_number(new.amount_billed) or coalesce(new.amount_billed, 0) < 0 or coalesce(new.holdback_percent, 0) not between 0 and 100 then
    raise exception 'The amount must be a number that is not negative, and holdback must be between 0 and 100%%.' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists progress_billing_guard on public.progress_billing;
create trigger progress_billing_guard before insert or update or delete on public.progress_billing
  for each row execute function public.guard_progress_billing();

-- Saving and creating -------------------------------------------------------------
-- Saves an invoice's details and lines in one transaction, as the caller (row security
-- applies). The trigger prices the lines and works out the totals.
create or replace function public.save_invoice(p_invoice uuid, p_fields jsonb, p_lines jsonb)
returns public.invoices language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.invoices;
begin
  update public.invoices i set
    title = case when p_fields ? 'title' then p_fields ->> 'title' else i.title end,
    notes = case when p_fields ? 'notes' then p_fields ->> 'notes' else i.notes end,
    project_id = case when p_fields ? 'project_id' then (p_fields ->> 'project_id')::uuid else i.project_id end,
    client_id = case when p_fields ? 'client_id' then (p_fields ->> 'client_id')::uuid else i.client_id end,
    client_name = case when p_fields ? 'client_name' then p_fields ->> 'client_name' else i.client_name end,
    client_address = case when p_fields ? 'client_address' then p_fields ->> 'client_address' else i.client_address end,
    issue_date = case when p_fields ? 'issue_date' then (p_fields ->> 'issue_date')::date else i.issue_date end,
    due_date = case when p_fields ? 'due_date' then (p_fields ->> 'due_date')::date else i.due_date end,
    tax_pct = case when p_fields ? 'tax_pct' then (p_fields ->> 'tax_pct')::numeric else i.tax_pct end,
    holdback_pct = case when p_fields ? 'holdback_pct' then (p_fields ->> 'holdback_pct')::numeric else i.holdback_pct end,
    holdback_release_date = case when p_fields ? 'holdback_release_date' then (p_fields ->> 'holdback_release_date')::date else i.holdback_release_date end,
    lines = coalesce(p_lines, i.lines)
  where i.id = p_invoice
  returning i.* into v_row;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  return v_row;
end $$;
revoke execute on function public.save_invoice(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_invoice(uuid, jsonb, jsonb) to authenticated;

-- The button on a draw: a draft invoice for it, or the one it already has. Nothing is sent.
create or replace function public.create_invoice_from_draw(p_draw uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_draw public.progress_billing;
  v_client_id uuid;
  v_client_name text;
  v_invoice uuid;
begin
  select d.* into v_draw from public.progress_billing d where d.id = p_draw for update;
  if not found then raise exception 'Draw not found' using errcode = 'P0002'; end if;
  if v_draw.invoice_id is not null then return v_draw.invoice_id; end if;

  if v_draw.project_id is not null then
    select p.client_id, p.client_name into v_client_id, v_client_name from public.projects p where p.id = v_draw.project_id;
  end if;

  insert into public.invoices (title, status, project_id, client_id, client_name, holdback_pct, holdback_release_date, lines)
  values (v_draw.title, 'Draft', v_draw.project_id, v_client_id, v_client_name, v_draw.holdback_percent, v_draw.holdback_release_date,
          jsonb_build_array(jsonb_build_object('type', 'draw', 'progress_billing_id', v_draw.id)))
  returning id into v_invoice;
  return v_invoice;
end $$;
revoke execute on function public.create_invoice_from_draw(uuid) from public, anon;
grant execute on function public.create_invoice_from_draw(uuid) to authenticated;

revoke execute on function public.guard_change_order(), public.guard_project_contract(), public.rollup_change_order(),
  public.guard_invoice(), public.sync_invoice(), public.guard_receivable(), public.guard_progress_billing()
  from public, anon, authenticated;
revoke execute on function public.receivable_age_status(date) from public, anon;
grant execute on function public.receivable_age_status(date) to authenticated;
