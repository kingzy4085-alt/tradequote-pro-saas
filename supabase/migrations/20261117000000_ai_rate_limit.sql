-- Voice estimating (/api/ai/parse-voice) calls a paid AI model, so each signed-in user gets an hourly
-- allowance, the same way invites and onboarding do. Until this runs, the app treats the unknown
-- bucket as a limiter failure and lets the request through (see lib/rate-limit.ts).
create or replace function public.consume_user_rate_limit(p_bucket text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_limit := case p_bucket when 'invite' then 20 when 'onboarding' then 10 when 'ai' then 60 end;
  if v_limit is null then raise exception 'Unknown limit' using errcode = '22023'; end if;
  return public.check_rate_limit('user:' || auth.uid()::text || ':' || p_bucket, v_limit, 3600);
end $$;

revoke execute on function public.consume_user_rate_limit(text) from public, anon;
grant execute on function public.consume_user_rate_limit(text) to authenticated;
