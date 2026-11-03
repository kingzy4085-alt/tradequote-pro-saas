-- TradeQuote PRO Phase 2: daily logs with job photos and a foreman signature.
-- Safe to run more than once. Run in Supabase: SQL Editor > New query > paste all > Run.

alter table public."daily-logs" add column if not exists log_date date default current_date;
alter table public."daily-logs" add column if not exists project text;
alter table public."daily-logs" add column if not exists crew text;
alter table public."daily-logs" add column if not exists crew_count integer default 0;
alter table public."daily-logs" add column if not exists hours numeric default 0;
alter table public."daily-logs" add column if not exists weather text;
alter table public."daily-logs" add column if not exists work_done text;
alter table public."daily-logs" add column if not exists delays text;
alter table public."daily-logs" add column if not exists safety_notes text;
alter table public."daily-logs" add column if not exists photos jsonb not null default '[]';
alter table public."daily-logs" add column if not exists signed_by text;
alter table public."daily-logs" add column if not exists signature text;
alter table public."daily-logs" add column if not exists signed_at timestamptz;

-- Private photo storage; each company's files live under a folder named by its company id
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists job_photos_select on storage.objects;
drop policy if exists job_photos_insert on storage.objects;
drop policy if exists job_photos_delete on storage.objects;
create policy job_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy job_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy job_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = public.current_company_id()::text);

notify pgrst, 'reload schema';
