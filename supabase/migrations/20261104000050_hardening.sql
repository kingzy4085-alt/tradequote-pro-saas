-- ============================================================================
-- TradeQuote PRO: production hardening. Hand-written and safe to run repeatedly.
-- Works on a fresh database and on one that already ran the old baseline.
--
--   1. Lapsed companies are read-only for deletes too.
--   2. Job-photo storage is gated by rank, billing state and the sign-off lock.
--   3. A signed daily log cannot be deleted.
--   4. Stripe events are only "done" once processed_at is set.
--   5. One pending invitation per company and email.
--   6. Postgres-backed rate limiter for public and expensive endpoints.
-- ============================================================================

-- 1. Module delete policies ---------------------------------------------------
-- The generated baseline already has this check. A database that ran the older
-- baseline keeps its policies until this rewrites them. Invitations stay out on
-- purpose: revoking access still has to work after a subscription lapses.
do $$
declare
  p record;
begin
  for p in
    select tablename, policyname, qual
    from pg_policies
    where schemaname = 'public'
      and cmd = 'DELETE'
      and policyname = tablename || '_delete'
      and tablename <> 'invitations'
      and qual is not null
      and qual not like '%company_can_write%'
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute format('create policy %I on public.%I for delete to authenticated using ((%s) and public.company_can_write())',
                   p.policyname, p.tablename, p.qual);
  end loop;
end $$;

-- 2. Job-photo storage --------------------------------------------------------
-- True when a path is <caller's company>/daily-logs/<existing log>/<file> and that log isn't signed.
create or replace function public.job_photo_log_open(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := public.user_company_id();
begin
  if v_company is null or array_length(v_parts, 1) is distinct from 4 then return false; end if;
  if v_parts[1] <> v_company::text or v_parts[2] <> 'daily-logs' then return false; end if;
  if v_parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if v_parts[4] = '' or position('..' in p_name) > 0 then return false; end if;
  return exists (
    select 1 from public.daily_logs l
    where l.id = v_parts[3]::uuid and l.company_id = v_company and l.signed_at is null
  );
end $$;
revoke execute on function public.job_photo_log_open(text) from public, anon;
grant execute on function public.job_photo_log_open(text) to authenticated;

-- Reading is unchanged. Adding needs an open log. Removing also needs a foreman
-- or above, or the person who uploaded that file. Other record types add their
-- own permissive policies under their own folder.
drop policy if exists job_photos_insert on storage.objects;
create policy job_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and public.company_can_write() and public.job_photo_log_open(name));

drop policy if exists job_photos_delete on storage.objects;
create policy job_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and public.company_can_write() and public.job_photo_log_open(name)
         and (public.user_rank() >= 2 or owner_id = auth.uid()::text));

-- 3. Signed daily logs --------------------------------------------------------
-- Same rules as the baseline, plus the delete branch. A signed log can only be
-- deleted after it is reopened. auth.uid() is null for the service role, which
-- lets removing a whole company cascade through its logs.
create or replace function public.guard_daily_log() returns trigger
language plpgsql as $$
declare
  v_prefix text;
  v_photo jsonb;
  v_fixed text[] := array['signed_at', 'signed_by', 'signature', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.signed_at is not null and auth.uid() is not null then
      raise exception 'This log is signed. Reopen it before deleting it.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.signed_at is not null then
    -- Deleting the author's login clears created_by through the foreign key. The signed log stays.
    if pg_trigger_depth() > 1 and old.created_by is not null and new.created_by is null
       and (to_jsonb(new) - 'created_by' - 'updated_at') is not distinct from (to_jsonb(old) - 'created_by' - 'updated_at')
       and not exists (select 1 from auth.users u where u.id = old.created_by) then
      return new;
    end if;
    -- A signed log only changes by being reopened, which clears the signature and nothing else
    if new.signed_at is not null or new.signed_by is not null or new.signature is not null
       or (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
      raise exception 'This log is signed. Reopen it to make changes.' using errcode = 'P0001';
    end if;
    if public.user_rank() < 2 then
      raise exception 'Only a foreman or above can reopen a signed log.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.signed_at := null; new.signed_by := null; new.signature := null;
  elsif new.signed_at is not null then
    if coalesce(btrim(new.signed_by), '') = '' or new.signature is null then
      raise exception 'Enter the name of the person signing and draw a signature.' using errcode = 'P0001';
    end if;
    new.signed_by := btrim(new.signed_by);
    new.signed_at := now();
  else
    new.signed_by := null; new.signature := null;
  end if;

  -- Photos must be files in this log's own folder of the company's storage
  v_prefix := new.company_id::text || '/daily-logs/' || new.id::text || '/';
  if jsonb_typeof(new.photos) is distinct from 'array' or jsonb_array_length(new.photos) > 50 then
    raise exception 'A log can have up to 50 photos.' using errcode = 'P0001';
  end if;
  for v_photo in select * from jsonb_array_elements(new.photos) loop
    if jsonb_typeof(v_photo) <> 'string' or left(v_photo #>> '{}', length(v_prefix)) <> v_prefix
       or position('..' in v_photo #>> '{}') > 0 or char_length(v_photo #>> '{}') > 300 then
      raise exception 'Invalid photo.' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists daily_logs_guard on public.daily_logs;
create trigger daily_logs_guard before insert or update or delete on public.daily_logs
  for each row execute function public.guard_daily_log();

-- 4. Stripe events ------------------------------------------------------------
-- A row without processed_at means an attempt started but never finished, so
-- Stripe's retry must run again. Rows from before this column existed already
-- finished; only stamp them the first time this runs.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'stripe_events' and column_name = 'processed_at') then
    alter table public.stripe_events add column processed_at timestamptz;
    update public.stripe_events set processed_at = created_at;
  end if;
end $$;

-- 5. Invitations --------------------------------------------------------------
-- Keep the newest pending invitation when an older database has duplicates.
delete from public.invitations a
using public.invitations b
where a.accepted_at is null and b.accepted_at is null
  and a.company_id = b.company_id and a.email = b.email
  and (a.created_at, a.id) < (b.created_at, b.id);
create unique index if not exists invitations_pending_unique
  on public.invitations (company_id, email) where accepted_at is null;

-- 6. Rate limits --------------------------------------------------------------
create table if not exists public.rate_limits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null default 1,
  expires_at timestamptz not null,
  primary key (key, window_start)
);
create index if not exists rate_limits_expiry_idx on public.rate_limits (expires_at);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Counts one hit in a fixed window and returns whether it is within the limit.
-- Server only (service role): the key is trusted, so a user must not be able to
-- spend someone else's allowance.
create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start, hits, expires_at)
    values (p_key, v_window, 1, v_window + make_interval(secs => p_window_seconds))
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning r.hits into v_hits;
  -- Old windows are only ever read by this function, so clear them now and then
  if random() < 0.01 then
    delete from public.rate_limits where expires_at < now();
  end if;
  return v_hits <= p_limit;
end $$;

-- The signed-in user's own allowance. Limits live here, not in the arguments, so
-- calling this directly can't change them or spend anyone else's.
create or replace function public.consume_user_rate_limit(p_bucket text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_limit := case p_bucket when 'invite' then 20 when 'onboarding' then 10 end;
  if v_limit is null then raise exception 'Unknown limit' using errcode = '22023'; end if;
  return public.check_rate_limit('user:' || auth.uid()::text || ':' || p_bucket, v_limit, 3600);
end $$;

revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.consume_user_rate_limit(text) from public, anon;
grant execute on function public.consume_user_rate_limit(text) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
  end if;
end $$;
