-- Company price book: each company's own price and labour hours for catalog items (and its own items),
-- which the cost engine puts ahead of the reference catalog. This repairs material_price_book as it was
-- first created (20261113000000): it had no way to tell whose row was whose, no uniqueness, and no
-- policies, so nobody could read or write it. The reference prices now live in the code catalog
-- (lib/costbook), so the rows with no company, which only held five sample prices, are removed.
-- Seen and edited by project managers and above, the same as estimates. Safe to run more than once.

-- Rows with no company belong to nobody and were never readable
delete from public.material_price_book where company_id is null;

-- One price per company and item code: keep the newest of any duplicates
delete from public.material_price_book p
using (
  select id, row_number() over (partition by company_id, item_code order by created_at desc, id desc) as n
  from public.material_price_book
) d
where p.id = d.id and d.n > 1;

-- company_id comes from the session, never from the client
alter table public.material_price_book alter column company_id set not null;
alter table public.material_price_book alter column company_id set default public.user_company_id();
alter table public.material_price_book alter column category set default '';
alter table public.material_price_book alter column description set default '';
alter table public.material_price_book alter column unit set default 'ea';

alter table public.material_price_book add column if not exists labour_hours numeric;
alter table public.material_price_book add column if not exists updated_at timestamptz not null default now();
-- set_updated_at pins this and company_id on every update, as it does on the other tables
alter table public.material_price_book add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.material_price_book'::regclass and conname = 'material_price_book_unit_cost_check') then
    alter table public.material_price_book add constraint material_price_book_unit_cost_check check (unit_cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.material_price_book'::regclass and conname = 'material_price_book_labour_hours_check') then
    alter table public.material_price_book add constraint material_price_book_labour_hours_check check (labour_hours is null or labour_hours >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.material_price_book'::regclass and conname = 'material_price_book_item_code_check') then
    alter table public.material_price_book add constraint material_price_book_item_code_check check (char_length(item_code) between 1 and 60 and item_code = btrim(item_code));
  end if;
end $$;

create unique index if not exists material_price_book_company_code_idx on public.material_price_book(company_id, item_code);

-- The sample-price insert in 20261113000000 runs again whenever every migration is re-run (a redeploy), and it
-- names no company. A row with no company belongs to nobody, so such an insert is skipped rather than failing
-- on the not-null column or leaving unreadable orphans behind. Nothing signed in can reach this: the default
-- and the policies give every client row a company.
create or replace function public.material_price_book_skip_orphans() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.company_id is null then return null; end if;
  return new;
end $$;
revoke execute on function public.material_price_book_skip_orphans() from public, anon, authenticated;
drop trigger if exists material_price_book_orphans on public.material_price_book;
create trigger material_price_book_orphans before insert on public.material_price_book for each row execute function public.material_price_book_skip_orphans();

drop trigger if exists material_price_book_updated on public.material_price_book;
create trigger material_price_book_updated before update on public.material_price_book for each row execute function public.set_updated_at();

alter table public.material_price_book enable row level security;
drop policy if exists material_price_book_select on public.material_price_book;
create policy material_price_book_select on public.material_price_book for select to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3);
drop policy if exists material_price_book_insert on public.material_price_book;
create policy material_price_book_insert on public.material_price_book for insert to authenticated
  with check (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write());
drop policy if exists material_price_book_update on public.material_price_book;
create policy material_price_book_update on public.material_price_book for update to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write())
  with check (company_id = public.user_company_id());
drop policy if exists material_price_book_delete on public.material_price_book;
create policy material_price_book_delete on public.material_price_book for delete to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write());
revoke all on public.material_price_book from public, anon, authenticated;
grant select, insert, update, delete on public.material_price_book to authenticated;
