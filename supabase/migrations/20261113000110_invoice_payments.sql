-- Partial payments on invoices. Each cheque, transfer, card payment or cash the client hands over is a
-- row here, with the day it came in. The invoice keeps up on its own: once its payments add up to its
-- total it is Paid, dated the day the last of the money came in, and if a payment is then deleted so they
-- no longer add up it goes back to Sent, where the overdue job picks it up again.
--
-- "Mark paid", "Undo payment" and every other rule in 20261104000110_billing.sql and
-- 20261104000320_review_fixes.sql are unchanged. The rules here only start to matter once an invoice has
-- a payment recorded: an invoice with none behaves exactly as it did before.
--
-- Seen, recorded and deleted by the owner and admins, the same as invoices. Safe to run more than once.

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.user_company_id() references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  -- Postgres counts NaN as above every number, so "> 0" alone would let it through
  amount numeric(14,2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  paid_on date not null,
  method text not null check (method in ('Cheque', 'EFT', 'Credit card', 'Cash', 'Other')),
  reference text check (char_length(reference) <= 100),
  note text check (char_length(note) <= 500),
  -- A payment is never edited (delete it and record it again), so there is no updated_at and nothing for
  -- set_updated_at to pin: invoice_payments_guard refuses any change but the one a deleted login makes.
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists invoice_payments_invoice_idx on public.invoice_payments(invoice_id, paid_on);
create index if not exists invoice_payments_company_idx on public.invoice_payments(company_id, paid_on);

-- The same people as invoices: the owner and admins read, record and delete, while the company can write.
-- There is no update policy or grant: a payment is deleted and recorded again, never changed.
alter table public.invoice_payments enable row level security;
drop policy if exists invoice_payments_select on public.invoice_payments;
create policy invoice_payments_select on public.invoice_payments for select to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 4);
drop policy if exists invoice_payments_insert on public.invoice_payments;
create policy invoice_payments_insert on public.invoice_payments for insert to authenticated
  with check (company_id = public.user_company_id() and public.user_rank() >= 4 and public.company_can_write() and created_by = auth.uid()
              and exists (select 1 from public.invoices i where i.id = invoice_payments.invoice_id and i.company_id = invoice_payments.company_id));
drop policy if exists invoice_payments_delete on public.invoice_payments;
create policy invoice_payments_delete on public.invoice_payments for delete to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 4 and public.company_can_write());
revoke all on public.invoice_payments from anon, authenticated;
grant select, insert, delete on public.invoice_payments to authenticated;
-- TRUNCATE fires no delete trigger, so it would leave invoices marked paid by payments that are gone
revoke truncate on public.invoice_payments from service_role;

-- Recording a payment ------------------------------------------------------------------------------
-- Which invoice it can go on and how much. This runs before the row security check, so it asks who is
-- calling first: nothing below may tell someone who cannot read invoices what one is owed or its status.
create or replace function public.guard_invoice_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice record;
  v_paid numeric;
  v_left numeric;
begin
  if tg_op = 'UPDATE' then
    -- Clearing who recorded it, when their login is deleted, is the only change the database itself makes
    if (to_jsonb(new) - 'created_by'::text) is distinct from (to_jsonb(old) - 'created_by'::text) then
      raise exception 'A recorded payment cannot be changed. Delete it and record it again.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- The same people as invoice_payments_insert. The service role is trusted, as everywhere else.
  if auth.uid() is not null then
    if new.company_id is distinct from public.user_company_id() or public.user_rank() < 4 or not public.company_can_write() then
      raise exception 'You do not have permission to do that.' using errcode = '42501';
    end if;
    -- When it was recorded, for the bookkeeper: not something the client sends
    new.created_at := now();
  end if;

  -- The lock makes two payments recorded at once take turns, so they can't both take what is left.
  -- Only an invoice of the payment's own company is looked at, or locked.
  select i.status, i.total into v_invoice from public.invoices i
  where i.id = new.invoice_id and i.company_id = new.company_id
  for update;
  if not found then
    raise exception 'That invoice could not be found.' using errcode = '22023';
  elsif v_invoice.status = 'Draft' then
    raise exception 'Mark this invoice as sent before recording a payment on it.' using errcode = 'P0001';
  elsif v_invoice.status not in ('Sent', 'Overdue', 'Paid') then
    raise exception 'This invoice is void, so it takes no payments.' using errcode = 'P0001';
  elsif v_invoice.total is null or not public.is_finite_number(v_invoice.total) then
    raise exception 'This invoice has no total to pay against.' using errcode = 'P0001';
  end if;

  if new.amount is null or not public.is_finite_number(new.amount) or new.amount <= 0 then
    raise exception 'Enter an amount above zero.' using errcode = '22023';
  end if;
  -- Money that came in has a date that has come. A day ahead of the server's date allows for time zones.
  if new.paid_on is null or not isfinite(new.paid_on) or new.paid_on < date '2000-01-01' then
    raise exception 'Enter the date the payment came in.' using errcode = '22023';
  elsif new.paid_on > current_date + 1 then
    raise exception 'A payment cannot be dated in the future. Enter the date it came in.' using errcode = '22023';
  end if;

  -- To the cent: the payments on an invoice never add up to more than its total. A row recorded earlier
  -- in the same statement is counted too, so a batch can't get past this either.
  select coalesce(sum(p.amount), 0) into v_paid from public.invoice_payments p where p.invoice_id = new.invoice_id;
  v_left := v_invoice.total - v_paid;
  if v_left <= 0 then
    raise exception 'Nothing is left to pay on this invoice.' using errcode = 'P0001';
  elsif new.amount > v_left then
    raise exception 'That is more than is left to pay: $% of this $% invoice is paid, so $% is left.',
      to_char(v_paid, 'FM999999999990.00'), to_char(v_invoice.total, 'FM999999999990.00'), to_char(v_left, 'FM999999999990.00')
      using errcode = 'P0001';
  end if;

  new.reference := nullif(public.trim_blank(new.reference), '');
  new.note := nullif(public.trim_blank(new.note), '');
  return new;
end $$;
revoke execute on function public.guard_invoice_payment() from public, anon, authenticated;

drop trigger if exists invoice_payments_guard on public.invoice_payments;
create trigger invoice_payments_guard before insert or update on public.invoice_payments
  for each row execute function public.guard_invoice_payment();

-- Keeping the invoice in step -----------------------------------------------------------------------
-- Once per statement, so deleting several payments at once sees all of them gone together. An invoice
-- that never had a payment is never touched here. The change goes through the invoice's own guards, the
-- same way pressing the button would, so its receivable, draws, alerts and job cost follow as usual.
--   Payments reach the total: the invoice is Paid, on the day the last of the money came in.
--   A delete leaves them short of a total they used to reach: it was paid through its payments, so it
--   is owed again and goes back to Sent. An invoice marked paid by hand, short of its payments, stays Paid.
create or replace function public.sync_invoice_payments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_gone numeric;
  v_invoice record;
  v_paid numeric;
  v_last date;
begin
  if tg_op = 'INSERT' then
    for v_id in select distinct n.invoice_id from n order by 1 loop
      select i.status, i.total, i.paid_at into v_invoice from public.invoices i where i.id = v_id for update;
      continue when not found;
      select coalesce(sum(p.amount), 0), max(p.paid_on) into v_paid, v_last from public.invoice_payments p where p.invoice_id = v_id;
      if v_paid >= v_invoice.total and (v_invoice.status is distinct from 'Paid' or v_invoice.paid_at is distinct from v_last) then
        update public.invoices set status = 'Paid', paid_at = v_last where id = v_id;
      end if;
    end loop;
    return null;
  end if;

  -- Deleting the invoice or the whole company takes its payments with it: nothing is left to keep in step
  if pg_trigger_depth() > 1 then return null; end if;
  for v_id, v_gone in select o.invoice_id, sum(o.amount) from o group by o.invoice_id order by 1 loop
    select i.status, i.total into v_invoice from public.invoices i where i.id = v_id for update;
    continue when not found;
    select coalesce(sum(p.amount), 0) into v_paid from public.invoice_payments p where p.invoice_id = v_id;
    if v_invoice.status = 'Paid' and v_paid < v_invoice.total and v_paid + v_gone >= v_invoice.total then
      update public.invoices set status = 'Sent', paid_at = null where id = v_id;
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.sync_invoice_payments() from public, anon, authenticated;

drop trigger if exists invoice_payments_sync_ins on public.invoice_payments;
create trigger invoice_payments_sync_ins after insert on public.invoice_payments
  referencing new table as n for each statement execute function public.sync_invoice_payments();
drop trigger if exists invoice_payments_sync_del on public.invoice_payments;
create trigger invoice_payments_sync_del after delete on public.invoice_payments
  referencing old table as o for each statement execute function public.sync_invoice_payments();

-- Invoice moves once payments are recorded ------------------------------------------------------------
-- Fires after invoices_guard (triggers run in name order), which has already allowed or refused the move
-- by its own rules and set paid_at to today on one to Paid. On an invoice with no payments it does nothing.
--   An invoice with payments can't go back to Draft, where its total could drop below them, or be voided
--   while money is recorded against it. Deleting the payments comes first.
--   One its payments pay in full can't be set back to Sent by hand: deleting a payment does that.
--   Paid through its payments, it is dated the day the last one came in.
create or replace function public.guard_invoice_with_payments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_paid numeric;
  v_last date;
begin
  -- The service role (the overdue job, tests that set up data) is trusted with what it sets, as in guard_invoice
  if auth.uid() is null then return new; end if;
  select count(*), coalesce(sum(p.amount), 0), max(p.paid_on) into v_count, v_paid, v_last
  from public.invoice_payments p where p.invoice_id = new.id;
  if v_count = 0 then return new; end if;

  if new.status is distinct from old.status and new.status in ('Draft', 'Void') then
    raise exception 'This invoice has payments recorded. Delete them first, then %.',
      case when new.status = 'Draft' then 'set it back to Draft' else 'void it' end using errcode = 'P0001';
  end if;
  if v_paid >= coalesce(new.total, 0) then
    if old.status = 'Paid' and new.status is distinct from 'Paid' then
      raise exception 'The payments recorded on this invoice add up to its total. Delete one of them to reopen it.' using errcode = 'P0001';
    end if;
    if new.status = 'Paid' then
      new.paid_at := v_last;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_invoice_with_payments() from public, anon, authenticated;

drop trigger if exists invoices_payments on public.invoices;
create trigger invoices_payments before update on public.invoices
  for each row execute function public.guard_invoice_with_payments();
