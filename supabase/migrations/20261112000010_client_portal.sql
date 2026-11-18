-- Client portal: a contractor shares a sent proposal by link, and the client reads it and
-- accepts (name and signature) or declines without an account.
--
-- The link carries a random token. Only its SHA-256 hash is stored, so reading this table
-- gives nobody a working link. Visitors never reach the database: nothing here runs for the
-- public key. The app's server calls the two portal_* functions with the service role, after
-- its own rate limits (lib/portal-server.ts), and each looks up one share by hash and acts
-- on that one proposal only.
-- Safe to run more than once.

create table if not exists public.proposal_shares (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  decided_at timestamptz,
  decision text check (decision in ('accepted', 'declined')),
  signer_name text check (char_length(signer_name) <= 200),
  signature text check (char_length(signature) <= 300000),
  decline_reason text check (char_length(decline_reason) <= 2000),
  decided_ip text check (char_length(decided_ip) <= 100),
  decided_agent text check (char_length(decided_agent) <= 500),
  check ((decided_at is null) = (decision is null))
);
create index if not exists proposal_shares_proposal_idx on public.proposal_shares(proposal_id, created_at desc);

alter table public.proposal_shares enable row level security;
-- Read-only for the company's project managers and above. Every write goes through a function below.
drop policy if exists proposal_shares_select on public.proposal_shares;
create policy proposal_shares_select on public.proposal_shares for select to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= 3);
revoke all on public.proposal_shares from public, anon, authenticated;
grant select on public.proposal_shares to authenticated;

-- Makes the link for a sent proposal. Any earlier link for it stops working.
create or replace function public.create_proposal_share(p_proposal uuid, p_token_hash text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.proposals%rowtype;
  v_expires timestamptz;
begin
  if auth.uid() is null or public.user_rank() < 3 or not public.company_can_write() then
    raise exception 'You do not have permission to share this proposal.' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid link.' using errcode = '22023';
  end if;
  select * into v_proposal from public.proposals p where p.id = p_proposal and p.company_id = public.user_company_id() for update;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_proposal.status <> 'Sent' then
    raise exception 'Set the proposal to Sent before sharing it with the client.' using errcode = 'P0001';
  end if;
  -- Good until the end of the day its prices are, or 30 days when no date is set
  v_expires := coalesce((v_proposal.valid_until + 1)::timestamptz, now() + interval '30 days');
  if v_expires <= now() then
    raise exception 'The prices on this proposal have expired. Change "Prices valid until" before sharing it.' using errcode = 'P0001';
  end if;
  update public.proposal_shares set revoked_at = now() where proposal_id = p_proposal and revoked_at is null and decided_at is null;
  insert into public.proposal_shares (company_id, proposal_id, token_hash, created_by, expires_at)
  values (v_proposal.company_id, p_proposal, p_token_hash, auth.uid(), v_expires);
  return v_expires;
end $$;
revoke execute on function public.create_proposal_share(uuid, text) from public, anon;
grant execute on function public.create_proposal_share(uuid, text) to authenticated;

-- Turns the link off. Returns how many links were live.
create or replace function public.revoke_proposal_share(p_proposal uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if auth.uid() is null or public.user_rank() < 3 or not public.company_can_write() then
    raise exception 'You do not have permission to change this proposal.' using errcode = '42501';
  end if;
  update public.proposal_shares set revoked_at = now()
  where proposal_id = p_proposal and company_id = public.user_company_id() and revoked_at is null and decided_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.revoke_proposal_share(uuid) from public, anon;
grant execute on function public.revoke_proposal_share(uuid) to authenticated;

-- What a share is right now. A decided link keeps showing its outcome; anything else that
-- can't be acted on reads as closed, without saying why to a stranger.
create or replace function public.proposal_share_state(s public.proposal_shares, p_status text)
returns text language sql stable set search_path = '' as $$
  select case
    when s.decision is not null then s.decision
    when s.revoked_at is not null or s.expires_at <= now() or p_status <> 'Sent' then 'closed'
    else 'open'
  end
$$;
revoke execute on function public.proposal_share_state(public.proposal_shares, text) from public, anon, authenticated;

-- The client's view of one proposal: what the printed proposal shows, and nothing about cost,
-- markup, internal notes or any other record. Null for a link that doesn't exist.
create or replace function public.portal_view(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_share public.proposal_shares%rowtype;
  v_proposal public.proposals%rowtype;
  v_company public.companies%rowtype;
  v_state text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into v_share from public.proposal_shares s where s.token_hash = p_token_hash;
  if not found then return null; end if;
  select * into v_proposal from public.proposals p where p.id = v_share.proposal_id;
  select * into v_company from public.companies c where c.id = v_share.company_id;
  v_state := public.proposal_share_state(v_share, v_proposal.status);
  if v_state = 'closed' then
    return jsonb_build_object('state', 'closed', 'company', jsonb_build_object('name', v_company.name, 'phone', v_company.phone, 'email', v_company.email));
  end if;
  if v_share.first_viewed_at is null then
    update public.proposal_shares set first_viewed_at = now() where id = v_share.id;
  end if;
  return jsonb_build_object(
    'state', v_state,
    'company', jsonb_build_object('name', v_company.name, 'contact', v_company.contact, 'phone', v_company.phone, 'email', v_company.email, 'address', v_company.address),
    'proposal', jsonb_build_object(
      'title', v_proposal.title,
      'client_name', v_proposal.client_name,
      'scope_of_work', v_proposal.scope_of_work,
      'terms', coalesce(nullif(v_proposal.terms, ''), v_company.default_terms),
      'total_amount', v_proposal.total_amount,
      'valid_until', v_proposal.valid_until,
      'created_on', v_proposal.created_at::date),
    'expires_at', v_share.expires_at,
    'decided_at', v_share.decided_at,
    'signer_name', v_share.signer_name);
end $$;
-- Server only: a visitor's request reaches this through the app, never directly
revoke execute on function public.portal_view(text) from public, anon, authenticated;
grant execute on function public.portal_view(text) to service_role;

-- The client's answer. One answer per link, only while the proposal is still Sent. Accepting
-- sets the proposal to Accepted through the same triggers a contractor's own edit goes through.
create or replace function public.portal_decide(p_token_hash text, p_decision text, p_name text, p_signature text, p_reason text, p_ip text, p_agent text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_share public.proposal_shares%rowtype;
  v_status text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'This link is not valid.' using errcode = 'P0002';
  end if;
  if p_decision is null or p_decision not in ('accepted', 'declined') then
    raise exception 'Choose accept or decline.' using errcode = '22023';
  end if;
  -- Attempts are limited by the server before it calls this, not here: a refusal rolls back,
  -- and would take its own count with it.
  -- Locked, so two answers sent at once can't both land
  select * into v_share from public.proposal_shares s where s.token_hash = p_token_hash for update;
  if not found then
    raise exception 'This link is not valid.' using errcode = 'P0002';
  end if;
  select p.status into v_status from public.proposals p where p.id = v_share.proposal_id for update;
  if v_share.decision is not null then
    raise exception 'This proposal has already been answered.' using errcode = 'P0001';
  end if;
  if public.proposal_share_state(v_share, v_status) <> 'open' then
    raise exception 'This link is no longer open. Contact the company for a new one.' using errcode = 'P0001';
  end if;
  if p_decision = 'accepted' then
    if char_length(v_name) not between 1 and 200 then
      raise exception 'Enter the name of the person signing.' using errcode = '22023';
    end if;
    if p_signature is null or char_length(p_signature) > 300000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'Draw a signature first.' using errcode = '22023';
    end if;
  elsif char_length(v_name) > 200 or char_length(coalesce(p_reason, '')) > 2000 then
    raise exception 'That is too long.' using errcode = '22023';
  end if;

  update public.proposals set status = case p_decision when 'accepted' then 'Accepted' else 'Declined' end where id = v_share.proposal_id;
  update public.proposal_shares set
    decided_at = now(),
    decision = p_decision,
    signer_name = nullif(v_name, ''),
    signature = case when p_decision = 'accepted' then p_signature end,
    decline_reason = case when p_decision = 'declined' then nullif(btrim(coalesce(p_reason, '')), '') end,
    decided_ip = left(p_ip, 100),
    decided_agent = left(p_agent, 500)
  where id = v_share.id;
  return p_decision;
end $$;
revoke execute on function public.portal_decide(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.portal_decide(text, text, text, text, text, text, text) to service_role;
