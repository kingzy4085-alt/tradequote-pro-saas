// The in-app alert for a client's answer to a shared proposal (rule proposals.answered).
// Runs the real daily automation on embedded Postgres: the client answers through the portal
// functions as the server would, then run_company_automation raises, keeps or clears the alert.
import { beforeAll, describe, expect, it } from 'vitest';
import { AUTOMATION_RULES, alertHref } from '@/lib/alerts';
import { hashPortalToken, newPortalToken } from '@/lib/portal';
import { bootDb, type TestDb } from './helpers/db';

const SIG = 'data:image/png;base64,iVBORw0KGgo=';
const users = {
  ownerA: { id: '00000000-0000-4000-8000-0000000000a1', email: 'owner@alpha.ca' },
  pmA: { id: '00000000-0000-4000-8000-0000000000a3', email: 'pm@alpha.ca' },
  foremanA: { id: '00000000-0000-4000-8000-0000000000a4', email: 'foreman@alpha.ca' },
  ownerB: { id: '00000000-0000-4000-8000-0000000000b1', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

// Alpha is in Saskatchewan (UTC-6 all year). Noon there on the 15th is 18:00 UTC.
const TODAY = '2027-03-15';
const NOON_ON = (date: string) => `${date}T18:00:00Z`;

type Alert = { id: string; title: string; message: string; severity: string; min_rank: number; module: string; record_id: string; bucket: string; resolved_at: string | null };

describe('alert when a client answers a shared proposal', () => {
  let t: TestDb<U>;
  let alpha: string;
  let bravo: string;
  let n = 0;

  const run = async (company: string, today = TODAY) =>
    (await t.asService<{ r: Record<string, number | boolean> }>('select public.run_company_automation($1, $2) as r', [company, today]))[0].r;
  const alertFor = async (proposal: string) =>
    (await t.asSystem<Alert>(`select * from public.alerts where rule_key = 'proposals.answered' and record_id = $1`, [proposal]))[0];
  const visibleTo = async (who: U) =>
    (await t.as<Alert>(who, 'select * from public.list_my_alerts($1)', [TODAY])).filter((a) => a.module === 'proposals' && a.message.startsWith('The client answered'));

  /** A sent proposal of company A shared by link. Returns its id and the link's hash. */
  async function shared(title = `Proposal ${++n}`): Promise<{ id: string; hash: string }> {
    const [{ id }] = await t.as<{ id: string }>('ownerA', `insert into public.proposals (title, status, client_name, total_amount) values ($1, 'Sent', 'Cargill', 12500) returning id`, [title]);
    const hash = hashPortalToken(newPortalToken());
    await t.as('ownerA', 'select public.create_proposal_share($1, $2)', [id, hash]);
    return { id, hash };
  }
  /** The client answers through the portal, as the server does, at noon local time on `date`. */
  async function answer(hash: string, decision: 'accepted' | 'declined', date = TODAY, reason: string | null = null) {
    await t.asService('select public.portal_decide($1, $2, $3, $4, $5, $6, $7)', [hash, decision, decision === 'accepted' ? 'Dana Smith' : null, decision === 'accepted' ? SIG : null, reason, null, null]);
    await t.asSystem('update public.proposal_shares set decided_at = $1 where token_hash = $2', [NOON_ON(date), hash]);
  }

  beforeAll(async () => {
    t = await bootDb(users);
    alpha = await t.createCompany('ownerA', 'Alpha Electric', 'SK');
    bravo = await t.createCompany('ownerB', 'Bravo Power', 'SK');
    await t.join('ownerA', 'pmA', 'project_manager');
    await t.join('ownerA', 'foremanA', 'foreman');
  });

  it('is an info rule for project managers and up on proposals', () => {
    const rule = AUTOMATION_RULES.find((r) => r.key === 'proposals.answered')!;
    expect(rule).toMatchObject({ module: 'proposals', table: 'proposals', kind: 'condition', minRank: 3, severity: 'info' });
    expect(rule.immediate).toBeFalsy();
  });

  it('an accepted proposal raises an info alert that names the signer and links to the proposal', async () => {
    const { id, hash } = await shared('MCC replacement');
    await answer(hash, 'accepted');
    await run(alpha);
    const alert = await alertFor(id);
    expect(alert).toMatchObject({ title: 'MCC replacement', severity: 'info', min_rank: 3, module: 'proposals', resolved_at: null });
    expect(alert.message).toBe('The client answered through the shared link. Accepted and signed by Dana Smith.');
    expect(alertHref(alert)).toBe(`/proposals/${id}`);
  });

  it('a declined proposal says so, with the reason', async () => {
    const { id, hash } = await shared();
    await answer(hash, 'declined', TODAY, 'Went with another bid');
    await run(alpha);
    expect((await alertFor(id)).message).toBe('The client answered through the shared link. Declined. Reason: Went with another bid');
  });

  it('a declined proposal with no reason still reads cleanly', async () => {
    const { id, hash } = await shared();
    await answer(hash, 'declined');
    await run(alpha);
    expect((await alertFor(id)).message).toBe('The client answered through the shared link. Declined.');
  });

  it('a proposal shared but not answered, or never shared, raises nothing', async () => {
    const { id: unanswered } = await shared();
    const [{ id: unshared }] = await t.as<{ id: string }>('ownerA', `insert into public.proposals (title, status) values ('Not shared', 'Accepted') returning id`);
    await run(alpha);
    expect(await alertFor(unanswered)).toBeUndefined();
    expect(await alertFor(unshared)).toBeUndefined();
  });

  it('project managers and owners see it; a foreman and another company do not', async () => {
    const { id, hash } = await shared();
    await answer(hash, 'accepted');
    await run(alpha);
    expect((await visibleTo('ownerA')).map((a) => a.record_id)).toContain(id);
    expect((await visibleTo('pmA')).map((a) => a.record_id)).toContain(id);
    expect(await visibleTo('foremanA')).toEqual([]);
    await run(bravo);
    expect(await visibleTo('ownerB')).toEqual([]);
  });

  it('stays for 7 days counting the day of the answer, then clears itself', async () => {
    const { id, hash } = await shared();
    await answer(hash, 'accepted', '2027-03-09');
    await run(alpha, '2027-03-08');
    expect(await alertFor(id), 'not before the answer').toBeUndefined();
    await run(alpha, '2027-03-09');
    expect((await alertFor(id)).resolved_at).toBeNull();
    await run(alpha, '2027-03-15');
    expect((await alertFor(id)).resolved_at, 'day 7').toBeNull();
    await run(alpha, '2027-03-16');
    expect((await alertFor(id)).resolved_at, 'day 8').not.toBeNull();
  });

  it('uses the company’s own date: a late-evening answer in Regina counts on that day, not the UTC one', async () => {
    const { id, hash } = await shared();
    await answer(hash, 'accepted');
    // 23:30 in Regina on the 8th is already the 9th in UTC. On the 15th that is 7 days back: over.
    await t.asSystem('update public.proposal_shares set decided_at = $1 where token_hash = $2', ['2027-03-09T05:30:00Z', hash]);
    await run(alpha, '2027-03-14');
    expect((await alertFor(id)).resolved_at).toBeNull();
    await run(alpha, '2027-03-15');
    expect((await alertFor(id)).resolved_at).not.toBeNull();
  });

  it('a second run on the same day changes nothing', async () => {
    const { id, hash } = await shared();
    await answer(hash, 'accepted');
    await run(alpha);
    const before = await alertFor(id);
    await run(alpha);
    expect(await alertFor(id)).toEqual(before);
  });

  it('shared again and answered again, it comes back as new news', async () => {
    const { id, hash } = await shared();
    await answer(hash, 'declined', '2027-03-01');
    await run(alpha, '2027-03-01');
    const first = await alertFor(id);
    await run(alpha);
    expect((await alertFor(id)).resolved_at).not.toBeNull();

    await t.as('ownerA', `update public.proposals set status = 'Sent' where id = $1`, [id]);
    const again = hashPortalToken(newPortalToken());
    await t.as('ownerA', 'select public.create_proposal_share($1, $2)', [id, again]);
    await answer(again, 'accepted');
    await run(alpha);
    const second = await alertFor(id);
    expect(second.resolved_at).toBeNull();
    expect(second.bucket).not.toBe(first.bucket);
    expect(second.message).toMatch(/Accepted and signed by Dana Smith/);
  });

  it('deleting the proposal clears its alert', async () => {
    const { id, hash } = await shared();
    await answer(hash, 'declined');
    await run(alpha);
    expect((await alertFor(id)).resolved_at).toBeNull();
    await t.as('ownerA', 'delete from public.proposals where id = $1', [id]);
    expect((await alertFor(id)).resolved_at).not.toBeNull();
  });

  it('signed-in users cannot read the links table through the alert, or write alerts', async () => {
    expect(await t.fails('ownerA', `insert into public.alerts (company_id, rule_key, module, record_id, title, message, severity, min_rank, bucket) values ($1, 'proposals.answered', 'proposals', $1, 't', 'm', 'info', 3, 'x')`, [alpha])).toMatch(/permission denied/);
    expect(await t.as('foremanA', 'select 1 from public.proposal_shares')).toEqual([]);
  });
});
