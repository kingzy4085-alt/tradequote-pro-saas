// The client portal is the one place a stranger reaches customer data, so the database's own
// rules are tested directly: nothing here goes through the app's routes. The portal functions
// run for the server only, so the tests call them as the service role, the way lib/portal-server.ts does.
import { beforeAll, describe, expect, it } from 'vitest';
import { PortalDecision, hashPortalToken, isPortalToken, newPortalToken, portalUrl, shareStatus, type ShareRow } from '@/lib/portal';
import { bootDb, type TestDb } from './helpers/db';

const SIG = 'data:image/png;base64,iVBORw0KGgo=';

describe('portal links', () => {
  it('makes a different, URL-safe 43-character token every time and stores only a hash', () => {
    const a = newPortalToken();
    const b = newPortalToken();
    expect(a).not.toBe(b);
    expect(isPortalToken(a)).toBe(true);
    expect(hashPortalToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPortalToken(a)).not.toContain(a);
    expect(portalUrl('https://app.example.ca/', a)).toBe(`https://app.example.ca/portal/${a}`);
  });

  it('refuses anything that is not a token before it reaches the database', () => {
    for (const bad of ['', 'short', `${'a'.repeat(42)}/`, 'a'.repeat(44), "'; drop table proposals;--".padEnd(43, 'x'), null, 42]) expect(isPortalToken(bad)).toBe(false);
  });

  it('accepting needs a name and a drawn signature; declining needs neither', () => {
    expect(PortalDecision.safeParse({ decision: 'accepted', name: 'Dana Smith', signature: SIG }).success).toBe(true);
    expect(PortalDecision.safeParse({ decision: 'accepted', name: ' ', signature: SIG }).success).toBe(false);
    expect(PortalDecision.safeParse({ decision: 'accepted', name: 'Dana', signature: 'data:text/html;base64,PHNjcmlwdD4=' }).success).toBe(false);
    expect(PortalDecision.safeParse({ decision: 'accepted', name: 'Dana', signature: `data:image/png;base64,${'A'.repeat(300_001)}` }).success).toBe(false);
    expect(PortalDecision.safeParse({ decision: 'declined' }).success).toBe(true);
    expect(PortalDecision.safeParse({ decision: 'declined', reason: 'x'.repeat(2001) }).success).toBe(false);
    expect(PortalDecision.safeParse({ decision: 'maybe' }).success).toBe(false);
  });

  it('tells the contractor where the link stands', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    const base: ShareRow = { created_at: '', expires_at: '2026-12-01T00:00:00Z', revoked_at: null, first_viewed_at: null, decided_at: null, decision: null, signer_name: null, decline_reason: null };
    expect(shareStatus(null, now)).toBe('none');
    expect(shareStatus(base, now)).toBe('live');
    expect(shareStatus({ ...base, first_viewed_at: '2026-11-10T00:00:00Z' }, now)).toBe('viewed');
    expect(shareStatus({ ...base, expires_at: '2026-11-11T12:00:00Z' }, now)).toBe('expired');
    expect(shareStatus({ ...base, revoked_at: '2026-11-10T00:00:00Z' }, now)).toBe('revoked');
    expect(shareStatus({ ...base, revoked_at: '2026-11-10T00:00:00Z', decision: 'accepted', decided_at: '2026-11-09T00:00:00Z' }, now)).toBe('accepted');
  });
});

const users = {
  ownerA: { id: '00000000-0000-4000-8000-0000000000a1', email: 'owner@alpha.ca' },
  foremanA: { id: '00000000-0000-4000-8000-0000000000a4', email: 'foreman@alpha.ca' },
  ownerB: { id: '00000000-0000-4000-8000-0000000000b1', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

const VIEW = 'select public.portal_view($1) as v';
const DECIDE = 'select public.portal_decide($1, $2, $3, $4, $5, $6, $7) as d';
const SHARE = 'select public.create_proposal_share($1, $2) as expires';

describe('the portal in the database', () => {
  let t: TestDb<U>;
  let alpha: string;
  let n = 0;

  /** A sent proposal of company A with a live link. Returns its id and the link's hash. */
  async function shared(validUntil = ''): Promise<{ id: string; hash: string }> {
    const [{ id }] = await t.as<{ id: string }>(
      'ownerA',
      `insert into public.proposals (title, status, client_name, total_amount, scope_of_work, notes${validUntil ? ', valid_until' : ''}) values ($1, 'Sent', 'Cargill', 12500, 'Replace MCC', 'INTERNAL: margin is 40%'${validUntil ? `, ${validUntil}` : ''}) returning id`,
      [`Proposal ${++n}`]
    );
    const hash = hashPortalToken(newPortalToken());
    await t.as('ownerA', SHARE, [id, hash]);
    return { id, hash };
  }
  // As the server: the only caller the database allows
  const view = async (hash: unknown) => (await t.asService<{ v: Record<string, any> | null }>(VIEW, [hash]))[0].v;
  const decide = (params: unknown[]) => t.asService(DECIDE, params);
  const accept = (hash: string) => decide([hash, 'accepted', 'Dana Smith', SIG, null, '203.0.113.9', 'TestBrowser']);
  /** The message the database refuses an answer with. */
  async function refused(params: unknown[]): Promise<string> {
    try {
      await decide(params);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('Expected the portal to refuse that answer');
  }
  const statusOf = async (id: string) => (await t.asSystem<{ status: string }>('select status from public.proposals where id = $1', [id]))[0].status;

  beforeAll(async () => {
    t = await bootDb(users);
    alpha = await t.createCompany('ownerA', 'Alpha Electric');
    await t.createCompany('ownerB', 'Bravo Power');
    await t.join('ownerA', 'foremanA', 'foreman');
  });

  it('the link shows the proposal, and never cost notes or ids', async () => {
    const { id, hash } = await shared();
    const v = (await view(hash))!;
    expect(v.state).toBe('open');
    expect(v.company.name).toBe('Alpha Electric');
    expect(v.proposal).toMatchObject({ client_name: 'Cargill', scope_of_work: 'Replace MCC', total_amount: 12500 });
    const text = JSON.stringify(v);
    expect(text).not.toContain('INTERNAL');
    expect(text).not.toContain(id);
    expect(text).not.toContain(alpha);
    expect(text).not.toMatch(/stripe|markup|labour_rate|token/i);
  });

  it('records the first view once', async () => {
    const { hash } = await shared();
    await view(hash);
    const [{ first_viewed_at: first }] = await t.asSystem<{ first_viewed_at: string }>('select first_viewed_at from public.proposal_shares where token_hash = $1', [hash]);
    expect(first).not.toBeNull();
    await view(hash);
    const [{ first_viewed_at: second }] = await t.asSystem<{ first_viewed_at: string }>('select first_viewed_at from public.proposal_shares where token_hash = $1', [hash]);
    expect(String(second)).toBe(String(first));
  });

  it('a wrong, malformed or missing token gets nothing at all', async () => {
    expect(await view(hashPortalToken(newPortalToken()))).toBeNull();
    expect(await view('not-a-hash')).toBeNull();
    expect(await view(null)).toBeNull();
    expect(await refused([hashPortalToken(newPortalToken()), 'accepted', 'Dana', SIG, null, null, null])).toMatch(/not valid/);
    expect(await refused(['not-a-hash', 'accepted', 'Dana', SIG, null, null, null])).toMatch(/not valid/);
  });

  it('nobody can call the portal functions directly: not a visitor with the public key, not a signed-in user', async () => {
    const { id, hash } = await shared();
    for (const who of [null, 'ownerA', 'ownerB'] as const) {
      expect(await t.fails(who, VIEW, [hash])).toMatch(/permission denied/);
      expect(await t.fails(who, DECIDE, [hash, 'accepted', 'Dana', SIG, null, null, null])).toMatch(/permission denied/);
    }
    expect(await statusOf(id)).toBe('Sent');
    expect((await t.asSystem<{ first_viewed_at: string | null }>('select first_viewed_at from public.proposal_shares where token_hash = $1', [hash]))[0].first_viewed_at).toBeNull();
  });

  it('visitors cannot read the tables behind the portal, or make a link', async () => {
    expect(await t.fails(null, 'select * from public.proposal_shares')).toMatch(/permission denied/);
    expect(await t.fails(null, 'select * from public.proposals')).toMatch(/permission denied/);
    expect(await t.fails(null, SHARE, ['00000000-0000-4000-8000-000000000000', 'a'.repeat(64)])).toMatch(/permission denied/);
    expect(await t.fails(null, 'select public.revoke_proposal_share($1)', ['00000000-0000-4000-8000-000000000000'])).toMatch(/permission denied/);
  });

  it('accepting signs it, sets the proposal to Accepted and records who and from where', async () => {
    const { id, hash } = await shared();
    await accept(hash);
    expect(await statusOf(id)).toBe('Accepted');
    const [row] = await t.asSystem<Record<string, string>>('select decision, signer_name, signature, decided_ip, decided_agent, decided_at from public.proposal_shares where token_hash = $1', [hash]);
    expect(row).toMatchObject({ decision: 'accepted', signer_name: 'Dana Smith', signature: SIG, decided_ip: '203.0.113.9', decided_agent: 'TestBrowser' });
    expect(row.decided_at).not.toBeNull();
    expect((await view(hash))!).toMatchObject({ state: 'accepted', signer_name: 'Dana Smith' });
  });

  it('the contractor sees the answer on their own proposal, and the client cannot be un-signed by an edit', async () => {
    const { id, hash } = await shared();
    await accept(hash);
    const [mine] = await t.as<Record<string, string>>('ownerA', 'select decision, signer_name from public.proposal_shares where proposal_id = $1', [id]);
    expect(mine).toEqual({ decision: 'accepted', signer_name: 'Dana Smith' });
    expect((await t.as<{ status: string }>('ownerA', 'select status from public.proposals where id = $1', [id]))[0].status).toBe('Accepted');
    expect(await t.fails('ownerA', `update public.proposal_shares set signer_name = 'Someone Else' where proposal_id = $1`, [id])).toMatch(/permission denied/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('one answer per link: a second accept or a change of mind is refused', async () => {
    const { id, hash } = await shared();
    await accept(hash);
    expect(await refused([hash, 'declined', null, null, 'changed my mind', null, null])).toMatch(/already been answered/);
    expect(await refused([hash, 'accepted', 'Someone Else', SIG, null, null, null])).toMatch(/already been answered/);
    expect(await statusOf(id)).toBe('Accepted');
    expect((await t.asSystem<{ signer_name: string }>('select signer_name from public.proposal_shares where token_hash = $1', [hash]))[0].signer_name).toBe('Dana Smith');
  });

  it('declining sets Declined and keeps the reason, with no signature needed', async () => {
    const { id, hash } = await shared();
    await decide([hash, 'declined', null, null, '  Went with another bid  ', null, null]);
    expect(await statusOf(id)).toBe('Declined');
    const [row] = await t.asSystem<Record<string, string | null>>('select decision, decline_reason, signature from public.proposal_shares where token_hash = $1', [hash]);
    expect(row).toEqual({ decision: 'declined', decline_reason: 'Went with another bid', signature: null });
  });

  it('accepting without a name or a real signature image is refused and changes nothing', async () => {
    const { id, hash } = await shared();
    expect(await refused([hash, 'accepted', '  ', SIG, null, null, null])).toMatch(/name of the person signing/);
    expect(await refused([hash, 'accepted', 'Dana', null, null, null, null])).toMatch(/signature/);
    expect(await refused([hash, 'accepted', 'Dana', 'data:text/html;base64,PHNjcmlwdD4=', null, null, null])).toMatch(/signature/);
    expect(await refused([hash, 'accepted', 'Dana', `data:image/png;base64,${'A'.repeat(300_001)}`, null, null, null])).toMatch(/signature/);
    expect(await refused([hash, 'approved', 'Dana', SIG, null, null, null])).toMatch(/accept or decline/);
    expect(await refused([hash, null, 'Dana', SIG, null, null, null])).toMatch(/accept or decline/);
    expect(await statusOf(id)).toBe('Sent');
  });

  it('a refused answer leaves no trace, so a later valid one still works', async () => {
    const { id, hash } = await shared();
    for (let i = 0; i < 12; i++) expect(await refused([hash, 'accepted', '', SIG, null, null, null])).toMatch(/name of the person signing/);
    expect(await statusOf(id)).toBe('Sent');
    await accept(hash);
    expect(await statusOf(id)).toBe('Accepted');
  });

  it('a revoked link is closed, says nothing about the proposal and cannot be answered', async () => {
    const { id, hash } = await shared();
    expect((await t.as<{ n: number }>('ownerA', 'select public.revoke_proposal_share($1) as n', [id]))[0].n).toBe(1);
    const v = (await view(hash))!;
    expect(v.state).toBe('closed');
    expect(v.proposal).toBeUndefined();
    expect(JSON.stringify(v)).not.toMatch(/Cargill|Replace MCC|12500/);
    expect(await refused([hash, 'accepted', 'Dana', SIG, null, null, null])).toMatch(/no longer open/);
    expect(await statusOf(id)).toBe('Sent');
  });

  it('an expired link is closed and cannot be answered', async () => {
    const { id, hash } = await shared();
    await t.asSystem(`update public.proposal_shares set expires_at = now() - interval '1 minute' where token_hash = $1`, [hash]);
    expect((await view(hash))!.state).toBe('closed');
    expect(await refused([hash, 'accepted', 'Dana', SIG, null, null, null])).toMatch(/no longer open/);
    expect(await statusOf(id)).toBe('Sent');
  });

  it('the link lasts to the end of the day the prices are valid, and an expired proposal cannot be shared', async () => {
    const { hash } = await shared(`current_date + 3`);
    const [{ ok }] = await t.asSystem<{ ok: boolean }>(`select expires_at = (current_date + 4)::timestamptz as ok from public.proposal_shares where token_hash = $1`, [hash]);
    expect(ok).toBe(true);
    const [{ id }] = await t.as<{ id: string }>('ownerA', `insert into public.proposals (title, status, valid_until) values ('Stale', 'Sent', current_date - 1) returning id`);
    expect(await t.fails('ownerA', SHARE, [id, hashPortalToken(newPortalToken())])).toMatch(/have expired/);
  });

  it('pulling a proposal back to Draft closes its link; only a Sent proposal can be shared', async () => {
    const { id, hash } = await shared();
    await t.as('ownerA', `update public.proposals set status = 'Draft' where id = $1`, [id]);
    expect((await view(hash))!.state).toBe('closed');
    expect(await refused([hash, 'accepted', 'Dana', SIG, null, null, null])).toMatch(/no longer open/);
    expect(await t.fails('ownerA', SHARE, [id, hashPortalToken(newPortalToken())])).toMatch(/Set the proposal to Sent/);
    expect(await statusOf(id)).toBe('Draft');
  });

  it('sharing again makes the old link stop working', async () => {
    const { id, hash: old } = await shared();
    const fresh = hashPortalToken(newPortalToken());
    await t.as('ownerA', SHARE, [id, fresh]);
    expect((await view(old))!.state).toBe('closed');
    expect((await view(fresh))!.state).toBe('open');
  });

  it('the same link cannot be registered twice, for this proposal or another', async () => {
    const { id, hash } = await shared();
    expect(await t.fails('ownerA', SHARE, [id, hash])).toMatch(/duplicate key|unique/i);
    expect(await t.fails('ownerA', SHARE, [id, 'XYZ'])).toMatch(/Invalid link/);
    expect((await view(hash))!.state).toBe('open');
  });

  it('another company cannot share, revoke or see links for this proposal', async () => {
    const { id, hash } = await shared();
    expect(await t.fails('ownerB', SHARE, [id, hashPortalToken(newPortalToken())])).toMatch(/not found/i);
    expect((await t.as<{ n: number }>('ownerB', 'select public.revoke_proposal_share($1) as n', [id]))[0].n).toBe(0);
    expect(await t.as('ownerB', 'select 1 from public.proposal_shares')).toEqual([]);
    expect((await view(hash))!.state).toBe('open');
  });

  it('a foreman cannot share or revoke, and nobody can write the link table directly', async () => {
    const { id, hash } = await shared();
    expect(await t.fails('foremanA', SHARE, [id, hashPortalToken(newPortalToken())])).toMatch(/permission/);
    expect(await t.fails('foremanA', 'select public.revoke_proposal_share($1)', [id])).toMatch(/permission/);
    expect(await t.as('foremanA', 'select 1 from public.proposal_shares')).toEqual([]);
    expect(await t.fails('ownerA', `update public.proposal_shares set decision = 'accepted', decided_at = now() where token_hash = $1`, [hash])).toMatch(/permission denied/);
    expect(await t.fails('ownerA', `insert into public.proposal_shares (company_id, proposal_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 day')`, [alpha, id, 'b'.repeat(64)])).toMatch(/permission denied/);
    expect(await t.fails('ownerA', 'delete from public.proposal_shares where token_hash = $1', [hash])).toMatch(/permission denied/);
  });

  it('a lapsed company cannot make new links', async () => {
    const [{ id }] = await t.as<{ id: string }>('ownerA', `insert into public.proposals (title, status) values ('Before lapse', 'Sent') returning id`);
    await t.setLapsed(alpha, true);
    expect(await t.fails('ownerA', SHARE, [id, hashPortalToken(newPortalToken())])).toMatch(/permission/);
    await t.setLapsed(alpha, false);
  });

  it('after an answer the server learns who to tell: the company address, else the owner', async () => {
    const { hash } = await shared();
    const notice = async () => (await t.asService<{ n: Record<string, any> | null }>('select public.portal_notice($1) as n', [hash]))[0].n;
    expect(await notice()).toBeNull();
    await accept(hash);
    expect(await notice()).toMatchObject({ to: 'owner@alpha.ca', company: 'Alpha Electric', decision: 'accepted', signer_name: 'Dana Smith', client_name: 'Cargill', total_amount: 12500 });
    expect(JSON.stringify(await notice())).not.toMatch(/INTERNAL|data:image|token/);

    await t.as('ownerA', `update public.companies set email = 'Office@Alpha.ca' where id = $1`, [alpha]);
    expect((await notice())!.to).toBe('Office@Alpha.ca');
    // Turning off marketing emails does not stop this one; turning off alert emails does
    await t.asSystem(`insert into public.email_unsubscribes (email, scope) values ('office@alpha.ca', 'marketing')`);
    expect((await notice())!.to).toBe('Office@Alpha.ca');
    await t.asSystem(`insert into public.email_unsubscribes (email, scope) values ('office@alpha.ca', 'alerts')`);
    expect((await notice())!.to).toBeNull();
    await t.as('ownerA', 'update public.companies set email = null where id = $1', [alpha]);
  });

  it('a declined proposal carries the reason to the contractor', async () => {
    const { hash } = await shared();
    await decide([hash, 'declined', null, null, 'Went with another bid', null, null]);
    const [{ n }] = await t.asService<{ n: Record<string, any> }>('select public.portal_notice($1) as n', [hash]);
    expect(n).toMatchObject({ decision: 'declined', decline_reason: 'Went with another bid', signer_name: null });
  });

  it('only the server can ask who to tell, and an unknown link tells it nothing', async () => {
    const { hash } = await shared();
    await accept(hash);
    for (const who of [null, 'ownerA', 'ownerB'] as const) expect(await t.fails(who, 'select public.portal_notice($1)', [hash])).toMatch(/permission denied/);
    expect((await t.asService<{ n: unknown }>('select public.portal_notice($1) as n', [hashPortalToken(newPortalToken())]))[0].n).toBeNull();
  });

  it('deleting the proposal takes its links with it', async () => {
    const { id, hash } = await shared();
    await t.as('ownerA', `update public.proposals set status = 'Draft' where id = $1`, [id]);
    expect((await t.as('ownerA', 'delete from public.proposals where id = $1 returning id', [id])).length).toBe(1);
    expect(await view(hash)).toBeNull();
  });
});
