-- File attachments on Drawings, Documents and Site Vault records. Safe to run more than once.
--
-- The browser uploads a file straight to a private storage bucket with the user's own session, at
-- <company id>/<module>/<record id>/<random id>.<extension>, then the app records its name, type
-- and size in record_attachments. Who may read, add and remove files follows each module's read,
-- write and remove ranks in lib/modules.ts; tests/attachments.db.test.ts checks the two agree.

-- 1. The bucket ----------------------------------------------------------------------------------
-- Private: files are only reached through short-lived signed links. Storage itself refuses a file
-- over 25 MB or of a type not listed here (lib/attachments.ts holds the same list). Running this
-- again puts the settings back if the bucket was changed by hand.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 26214400, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/vnd.dwg', 'image/vnd.dxf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 2. Who may do what -----------------------------------------------------------------------------
-- The read, write and remove ranks of the three modules, as lib/modules.ts has them. Any other
-- module or action is null, which every check below takes as no.
create or replace function public.attachment_rank(p_module text, p_action text)
returns integer language sql immutable set search_path = '' as $$
  select case p_module
    when 'drawings' then case p_action when 'read' then 1 when 'write' then 2 when 'remove' then 3 end
    when 'documents' then case p_action when 'read' then 1 when 'write' then 2 when 'remove' then 3 end
    when 'site-vault' then case p_action when 'read' then 3 when 'write' then 3 when 'remove' then 4 end
  end $$;

-- True when the record is in that module's table and belongs to the caller's company. Runs as the
-- caller, so the module's own row security has its say too.
create or replace function public.attachment_record_exists(p_module text, p_record uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(case p_module
    when 'drawings' then exists (select 1 from public.drawings r where r.id = p_record and r.company_id = public.user_company_id())
    when 'documents' then exists (select 1 from public.documents r where r.id = p_record and r.company_id = public.user_company_id())
    when 'site-vault' then exists (select 1 from public.site_vault r where r.id = p_record and r.company_id = public.user_company_id())
  end, false) $$;

-- True when a storage path is <caller's company>/<module>/<record of that module in the caller's
-- company>/<random id>.<allowed extension> and the caller's rank allows p_action on that module.
-- Runs as the caller: it needs no rights the caller doesn't already have.
create or replace function public.attachment_path_allowed(p_name text, p_action text)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := public.user_company_id();
begin
  if v_company is null or array_length(v_parts, 1) is distinct from 4 or v_parts[1] is distinct from v_company::text then
    return false;
  end if;
  if coalesce(public.user_rank(), 0) < coalesce(public.attachment_rank(v_parts[2], p_action), 99) then
    return false;
  end if;
  if v_parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg|webp|dwg|dxf|docx|xlsx|txt|csv)$' then
    return false;
  end if;
  return public.attachment_record_exists(v_parts[2], v_parts[3]::uuid);
end $$;

-- 3. What each file is ---------------------------------------------------------------------------
-- Rows are written once and never edited: signed-in users have no update on this table, so nothing
-- can move a row to another company, record or author afterwards.
create table if not exists public.record_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.user_company_id() references public.companies(id) on delete cascade,
  module text not null check (module in ('drawings', 'documents', 'site-vault')),
  record_id uuid not null,
  path text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- The file sits in its own record's folder, under a random name with an allowed extension
  constraint record_attachments_path_check check (coalesce(path ~ ('^' || company_id::text || '/' || module || '/' || record_id::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg|webp|dwg|dxf|docx|xlsx|txt|csv)$'), false)),
  -- The name shown and downloaded: one line, no folders, and the stored file's extension, so a
  -- download can't arrive as a different kind of file from the one that was checked on upload
  constraint record_attachments_file_name_check check (char_length(file_name) between 1 and 200 and file_name = btrim(file_name)
    and file_name !~ '[[:cntrl:]/\\]'
    and coalesce(lower(substring(file_name from '\.([^.]+)$')) = substring(path from '\.([a-z]+)$'), false)),
  -- Stored and served as the one type its extension calls for
  constraint record_attachments_type_check check (coalesce(content_type = case substring(path from '\.([a-z]+)$')
    when 'pdf' then 'application/pdf'
    when 'png' then 'image/png'
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'webp' then 'image/webp'
    when 'dwg' then 'image/vnd.dwg'
    when 'dxf' then 'image/vnd.dxf'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'txt' then 'text/plain'
    when 'csv' then 'text/csv'
  end, false))
);
create index if not exists record_attachments_record_idx on public.record_attachments(company_id, module, record_id, created_at desc);

-- Up to 100 files on one record. Runs as the caller, who can see every file of a module they may
-- add to, so the count is the real one.
create or replace function public.guard_record_attachment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.record_attachments a
      where a.company_id = new.company_id and a.module = new.module and a.record_id = new.record_id) >= 100 then
    raise exception 'A record can have up to 100 files. Delete some before adding more.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists record_attachments_guard on public.record_attachments;
create trigger record_attachments_guard before insert on public.record_attachments
  for each row execute function public.guard_record_attachment();

-- Reading follows the module's read rank, adding its write rank, removing its remove rank. A new
-- row has to name a record of the caller's company in that module, and a file already in storage.
alter table public.record_attachments enable row level security;
drop policy if exists record_attachments_select on public.record_attachments;
create policy record_attachments_select on public.record_attachments for select to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= public.attachment_rank(module, 'read'));
drop policy if exists record_attachments_insert on public.record_attachments;
create policy record_attachments_insert on public.record_attachments for insert to authenticated
  with check (company_id = public.user_company_id() and public.user_rank() >= public.attachment_rank(module, 'write')
              and public.company_can_write() and created_by = auth.uid()
              and public.attachment_record_exists(module, record_id)
              and exists (select 1 from storage.objects o where o.bucket_id = 'attachments' and o.name = record_attachments.path));
drop policy if exists record_attachments_delete on public.record_attachments;
create policy record_attachments_delete on public.record_attachments for delete to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= public.attachment_rank(module, 'remove')
         and public.company_can_write());
revoke all on public.record_attachments from anon, authenticated;
grant select, insert, delete on public.record_attachments to authenticated;

-- 4. The files in storage ------------------------------------------------------------------------
-- Same ranks as the rows. These only match the attachments bucket, so they widen nothing else.
-- Whoever uploaded a file can also take it out again while nothing records it, which is how the
-- browser cleans up after an upload whose record could not be saved.
drop policy if exists attachments_select on storage.objects;
create policy attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.attachment_path_allowed(name, 'read'));
drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.company_can_write() and public.attachment_path_allowed(name, 'write'));
drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.company_can_write()
         and (public.attachment_path_allowed(name, 'remove')
              or (owner_id = auth.uid()::text and public.attachment_path_allowed(name, 'write')
                  and not exists (select 1 from public.record_attachments a where a.path = objects.name))));

-- 5. A record's files go with it -----------------------------------------------------------------
-- Its rows go in the same statement as the record. The delete route (lib/crud.ts) removes the files
-- from storage first, while the record still exists for the storage rules to find. Definer, so the
-- rows go whoever deletes the record; it only ever touches the deleted record's own rows.
create or replace function public.delete_record_attachments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.record_attachments a
  where a.company_id = old.company_id and a.module = tg_argv[0] and a.record_id = old.id;
  return old;
end $$;
drop trigger if exists drawings_attachments on public.drawings;
create trigger drawings_attachments after delete on public.drawings
  for each row execute function public.delete_record_attachments('drawings');
drop trigger if exists documents_attachments on public.documents;
create trigger documents_attachments after delete on public.documents
  for each row execute function public.delete_record_attachments('documents');
drop trigger if exists site_vault_attachments on public.site_vault;
create trigger site_vault_attachments after delete on public.site_vault
  for each row execute function public.delete_record_attachments('site-vault');

revoke execute on function public.attachment_rank(text, text), public.attachment_record_exists(text, uuid),
  public.attachment_path_allowed(text, text), public.guard_record_attachment(), public.delete_record_attachments()
  from public, anon;
revoke execute on function public.guard_record_attachment(), public.delete_record_attachments() from authenticated;
grant execute on function public.attachment_rank(text, text), public.attachment_record_exists(text, uuid),
  public.attachment_path_allowed(text, text) to authenticated;
