create or replace function public.company_can_write() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.companies c
    where c.id = public.user_company_id()
      and (c.subscription_status in ('active', 'past_due')
           or (c.subscription_status = 'trialing' and c.trial_ends_at > now()))
  )
$$;
