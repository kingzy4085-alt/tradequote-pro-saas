-- Restore core helpers missing from production despite their original migrations being recorded as applied.
-- Safe to run more than once.

create or replace function public.set_updated_at() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.company_id := old.company_id;
  if new.created_by is null and old.created_by is not null and pg_trigger_depth() > 1
     and not exists (select 1 from auth.users u where u.id = old.created_by) then
    new.updated_at := old.updated_at;
    return new;
  end if;
  new.updated_at := now();
  new.created_by := old.created_by;
  return new;
end $$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

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
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
  end if;
end $$;
