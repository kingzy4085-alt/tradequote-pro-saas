-- ============================================================================
-- TradeQuote PRO — private storage for daily-log job photos.
-- Run after 20261101000000_saas_core.sql. Hand-written (Supabase storage schema).
--
-- Files live at <company id>/daily-logs/<log id>/<file>; a signed-in user can only
-- read, add or remove files inside their own company's folder.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy job_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = public.user_company_id()::text);
create policy job_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and (storage.foldername(name))[1] = public.user_company_id()::text
              and public.company_can_write());
create policy job_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = public.user_company_id()::text);
