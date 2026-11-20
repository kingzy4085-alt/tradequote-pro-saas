-- Site Vault (read 3, write 3, delete 4)
create table if not exists public.site_vault (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.user_company_id() references public.companies(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  title text not null check (char_length(title) between 1 and 300),
  status text not null,
  notes text,
  document_type text,
  confidentiality text,
  expiry_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.site_vault add column if not exists document_type text;
alter table public.site_vault add column if not exists confidentiality text;
alter table public.site_vault add column if not exists expiry_date date;
create index if not exists site_vault_company_idx on public.site_vault(company_id, created_at desc);
drop trigger if exists site_vault_updated on public.site_vault;
create trigger site_vault_updated before update on public.site_vault for each row execute function public.set_updated_at();
alter table public.site_vault enable row level security;
drop policy if exists site_vault_select on public.site_vault;
drop policy if exists site_vault_insert on public.site_vault;
drop policy if exists site_vault_update on public.site_vault;
drop policy if exists site_vault_delete on public.site_vault;
create policy site_vault_select on public.site_vault for select to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3);
create policy site_vault_insert on public.site_vault for insert to authenticated
  with check (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write() and created_by = auth.uid());
create policy site_vault_update on public.site_vault for update to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3 and public.company_can_write())
  with check (company_id = public.user_company_id());
create policy site_vault_delete on public.site_vault for delete to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 4 and public.company_can_write());
revoke all on public.site_vault from anon;
grant select, insert, update, delete on public.site_vault to authenticated;
