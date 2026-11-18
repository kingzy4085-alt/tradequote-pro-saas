-- Line items on the client portal. A shared proposal built from an estimate now shows the client
-- what the printed proposal shows (app/print/proposal/[id]/page.tsx): each line's description,
-- quantity, unit and one price with the markup folded in, then the subtotal, tax and total.
-- Never a cost, labour hours, the labour rate or the markup.
--
-- A line's price is its share of the price before tax, in proportion to its cost, in whole cents;
-- the cents left over go to the lines that lost the most to rounding, the earlier line on a tie.
-- That is lineSellPrice in lib/estimate-math.ts, which prints the contractor's copy. The shares are
-- worked out in double precision, in the same order of operations as that TypeScript, so the two
-- agree on every cent, ties included. The totals come from public.estimate_totals, the same sums
-- that set the estimate's stored total.
--
-- Still server only: the app calls this with the service role (lib/portal-server.ts) and it runs
-- for nobody else. Safe to run more than once.
create or replace function public.portal_view(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_share public.proposal_shares%rowtype;
  v_proposal public.proposals%rowtype;
  v_company public.companies%rowtype;
  v_estimate public.estimates%rowtype;
  v_state text;
  v_view jsonb;
  v_before_tax numeric;
  v_tax numeric;
  v_total numeric;
  v_lines jsonb;
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
  -- The estimate behind the proposal, if it has one, and only from the proposal's own company
  if v_proposal.estimate_id is not null then
    select * into v_estimate from public.estimates e where e.id = v_proposal.estimate_id and e.company_id = v_share.company_id;
  end if;

  v_view := jsonb_build_object(
    'state', v_state,
    'company', jsonb_build_object('name', v_company.name, 'contact', v_company.contact, 'phone', v_company.phone, 'email', v_company.email, 'address', v_company.address, 'tax_number', v_company.tax_number),
    'proposal', jsonb_build_object(
      'title', v_proposal.title,
      'client_name', v_proposal.client_name,
      'client_address', v_estimate.client_address,
      'scope_of_work', v_proposal.scope_of_work,
      'terms', coalesce(nullif(v_proposal.terms, ''), v_company.default_terms),
      'total_amount', v_proposal.total_amount,
      'valid_until', v_proposal.valid_until,
      'created_on', v_proposal.created_at::date),
    'expires_at', v_share.expires_at,
    'decided_at', v_share.decided_at,
    'signer_name', v_share.signer_name);
  -- Typed by hand, with no estimate behind it: the total alone, as before
  if v_estimate.id is null then return v_view; end if;

  select t.before_tax, t.tax, t.total into v_before_tax, v_tax, v_total
  from public.estimate_totals(v_estimate.id, v_estimate.labour_rate, v_estimate.markup_percentage, v_estimate.tax_percentage) t;

  with costed as (
    -- Each line's cost as estimateTotals has it: material rounded to the cent, plus hours at the rate
    select row_number() over (order by i.sort, i.id) as idx, i.description, i.quantity, i.unit,
           round(i.quantity * i.material_unit_cost, 2)::double precision
             + ((i.quantity::double precision * i.labour_hours_per_unit::double precision) * coalesce(v_estimate.labour_rate, 0)::double precision) as cost
    from public.estimate_items i
    where i.estimate_id = v_estimate.id
  ), totalled as (
    -- Added up in line order, as the TypeScript does
    select sum(costed.cost order by costed.idx) as cost, round(v_before_tax * 100)::bigint as target_cents from costed
  ), portioned as (
    -- Nothing to share out when nothing costs anything: every line is zero
    select costed.idx, costed.description, costed.quantity, costed.unit,
           case when totalled.cost > 0 then (costed.cost / totalled.cost) * totalled.target_cents::double precision else 0 end as portion,
           case when totalled.cost > 0 then totalled.target_cents else 0 end as target_cents
    from costed cross join totalled
  ), floored as (
    select portioned.*, floor(portioned.portion)::bigint as share_cents, portioned.portion - floor(portioned.portion) as lost from portioned
  ), ranked as (
    select floored.*,
           row_number() over (order by floored.lost desc, floored.idx) as place,
           floored.target_cents - sum(floored.share_cents) over () as leftover
    from floored
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'description', ranked.description,
           'quantity', ranked.quantity,
           'unit', ranked.unit,
           'amount', round((ranked.share_cents + case when ranked.place <= ranked.leftover then 1 else 0 end) / 100.0, 2))
         order by ranked.idx), '[]'::jsonb)
  into v_lines
  from ranked;

  return v_view || jsonb_build_object(
    'lines', v_lines,
    'totals', jsonb_build_object('subtotal', v_before_tax, 'tax_percentage', coalesce(v_estimate.tax_percentage, 0), 'tax', v_tax, 'total', v_total));
end $$;
-- Server only, as before: a visitor's request reaches this through the app, never directly
revoke execute on function public.portal_view(text) from public, anon, authenticated;
grant execute on function public.portal_view(text) to service_role;
