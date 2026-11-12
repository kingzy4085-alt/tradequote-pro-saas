-- Owner tools: a company logo on printed documents, and closing the company account.
-- (The data export needs nothing here: it reads every table as the signed-in owner, so row
-- security decides what is in it.) Safe to run more than once.

-- 1. Company logo -----------------------------------------------------------------------
-- The file lives in the private bucket below, at <company id>/<file>. The column only ever
-- names a PNG or JPEG file directly inside the company's own folder.
alter table public.companies add column if not exists logo_path text;
alter table public.companies drop constraint if exists companies_logo_path_check;
alter table public.companies add constraint companies_logo_path_check
  check (logo_path ~ ('^' || id::text || '/[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.(png|jpg|jpeg)$'));

-- Columns on companies are granted one by one (see 20261104000320_review_fixes.sql). Everyone in
-- the company reads it for the documents they print; row security and companies_update keep
-- changes to the owner and admins.
grant select (logo_path) on public.companies to authenticated;
grant update (logo_path) on public.companies to authenticated;

-- Private: a page shows the logo through a short-lived signed link. PNG or JPEG, up to 1 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Everyone in the company can read its logo. Only the owner and admins add or remove one, and
-- only while the company can make changes. A file goes directly inside the company's folder.
drop policy if exists company_logos_select on storage.objects;
create policy company_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = public.user_company_id()::text);
drop policy if exists company_logos_insert on storage.objects;
create policy company_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'company-logos'
              and name ~ ('^' || public.user_company_id()::text || '/[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.(png|jpg|jpeg)$')
              and public.user_rank() >= 4 and public.company_can_write());
drop policy if exists company_logos_delete on storage.objects;
create policy company_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = public.user_company_id()::text
         and public.user_rank() >= 4 and public.company_can_write());

-- 2. Closing the company account --------------------------------------------------------
-- Deletes the caller's company and, through the foreign keys, every row it owns. Only the owner,
-- and only with the company's exact name typed back. The app's route cancels any Stripe
-- subscription and removes the stored files it can reach before it calls this.
-- Not limited to a company that can still make changes: a lapsed company can always leave.
create or replace function public.close_company(p_confirm_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_company public.companies%rowtype;
begin
  if auth.uid() is null or coalesce(public.user_rank(), 0) < 5 then
    raise exception 'Only the owner can close the company account.' using errcode = '42501';
  end if;
  select * into v_company from public.companies c where c.id = public.user_company_id() for update;
  if not found then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;
  if p_confirm_name is null or p_confirm_name <> v_company.name then
    raise exception 'Type the company name exactly as it is shown to confirm.' using errcode = '22023';
  end if;
  -- The guards on signed and approved records let only the database itself remove them, which is
  -- how they tell a whole company going from one record being deleted. The checks above are the
  -- gate, so the delete runs with no signed-in user, for the rest of this transaction only.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  delete from public.companies c where c.id = v_company.id;
end $$;
revoke execute on function public.close_company(text) from public, anon;
grant execute on function public.close_company(text) to authenticated;
