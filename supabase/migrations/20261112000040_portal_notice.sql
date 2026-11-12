-- Who to tell, and what, once a client has answered a shared proposal. The app emails the
-- contractor after recording the answer (lib/portal-notify.ts). Server only, like the other
-- portal functions. Null for a link that does not exist or has not been answered.
-- Safe to run more than once.
create or replace function public.portal_notice(p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    -- The company's own address if it gave one, else its owner's. Nobody who turned alert emails off.
    'to', (
      select x.address from (
        select coalesce(nullif(btrim(c.email), ''), (
          select u.email from public.company_users u
          where u.company_id = s.company_id and u.role = 'owner' and nullif(btrim(u.email), '') is not null
          order by u.created_at, u.user_id limit 1)) as address
      ) x
      where x.address is not null
        and not exists (select 1 from public.email_unsubscribes e where e.email = lower(x.address) and e.scope = 'alerts')),
    'company', c.name,
    'proposal_id', p.id,
    'title', p.title,
    'client_name', p.client_name,
    'total_amount', p.total_amount,
    'decision', s.decision,
    'signer_name', s.signer_name,
    'decline_reason', s.decline_reason)
  from public.proposal_shares s
  join public.proposals p on p.id = s.proposal_id
  join public.companies c on c.id = s.company_id
  where s.token_hash = p_token_hash and s.decision is not null
$$;
revoke execute on function public.portal_notice(text) from public, anon, authenticated;
grant execute on function public.portal_notice(text) to service_role;