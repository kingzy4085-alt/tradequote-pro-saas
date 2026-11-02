// Runs the real migration on an embedded Postgres (PGlite) with a stand-in for
// Supabase's auth schema, then acts as different users to prove the database
// itself enforces company isolation, roles and subscription gating.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATION_PATH } from '../scripts/generate-migration';

const SUPABASE_STUB = `
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
`;

const users = {
  ownerA: { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' },
  elecA: { id: '00000000-0000-4000-8000-0000000000a2', email: 'sparky@alpha.ca' },
  pmA: { id: '00000000-0000-4000-8000-0000000000a3', email: 'pm@alpha.ca' },
  ownerB: { id: '00000000-0000-4000-8000-00000000000b', email: 'owner@bravo.ca' },
  stranger: { id: '00000000-0000-4000-8000-00000000000c', email: 'nobody@nowhere.ca' },
};
type U = keyof typeof users;

let db: PGlite;

async function as<T = Record<string, unknown>>(who: U | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  if (who) {
    const u = users[who];
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [u.id, JSON.stringify({ sub: u.id, email: u.email })]);
    await db.exec('set role authenticated');
  } else {
    await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`);
    await db.exec('set role anon');
  }
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function fails(who: U | null, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await as(who, sql, params);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`Expected failure: ${sql}`);
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  await db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  for (const u of Object.values(users)) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);

  await as('ownerA', `select public.create_company('Alpha Electric', 'SK', 'Alex Owner')`);
  await as('ownerB', `select public.create_company('Bravo Power', 'AB', 'Bea Owner')`);
  // Owner A invites an electrician and a PM, who accept
  await as('ownerA', `insert into public.invitations (company_id, email, role) values (public.user_company_id(), 'sparky@alpha.ca', 'electrician'), (public.user_company_id(), 'pm@alpha.ca', 'project_manager')`);
  const [inv] = await as<{ token: string }>('elecA', 'select token from public.pending_invitations()');
  await as('elecA', 'select public.accept_invitation($1, $2)', [inv.token, 'Sam Sparky']);
  const [inv2] = await as<{ token: string }>('pmA', 'select token from public.pending_invitations()');
  await as('pmA', 'select public.accept_invitation($1, $2)', [inv2.token, 'Pat PM']);
});

describe('tenant isolation', () => {
  it('each company sees only its own rows', async () => {
    await as('ownerA', `insert into public.estimates (title, status) values ('Alpha bid', 'Draft')`);
    await as('ownerB', `insert into public.estimates (title, status) values ('Bravo bid', 'Draft')`);
    expect((await as<{ title: string }>('ownerA', 'select title from public.estimates')).map((r) => r.title)).toEqual(['Alpha bid']);
    expect((await as<{ title: string }>('ownerB', 'select title from public.estimates')).map((r) => r.title)).toEqual(['Bravo bid']);
  });

  it('cannot insert into another company by forging company_id', async () => {
    const [{ id: bravo }] = await as<{ id: string }>('ownerB', 'select id from public.companies');
    expect(await fails('ownerA', `insert into public.estimates (company_id, title, status) values ($1, 'forged', 'Draft')`, [bravo])).toMatch(/row-level security/);
  });

  it('cannot move a row to another company or touch other companies rows', async () => {
    const [{ id: bravo }] = await as<{ id: string }>('ownerB', 'select id from public.companies');
    await as('ownerA', 'update public.estimates set company_id = $1', [bravo]);
    expect((await as('ownerA', 'select 1 from public.estimates')).length).toBe(1);
    expect((await as('ownerA', `update public.estimates set title = 'pwned' where title = 'Bravo bid' returning id`)).length).toBe(0);
    expect((await as('ownerA', `delete from public.estimates where title = 'Bravo bid' returning id`)).length).toBe(0);
    expect((await as<{ title: string }>('ownerB', 'select title from public.estimates'))[0].title).toBe('Bravo bid');
  });

  it('anonymous visitors and users without a company see nothing', async () => {
    expect(await fails(null, 'select * from public.estimates')).toMatch(/permission denied/);
    expect(await as('stranger', 'select * from public.estimates')).toEqual([]);
    expect(await as('stranger', 'select * from public.companies')).toEqual([]);
    expect(await fails('stranger', `insert into public.estimates (title, status) values ('x', 'Draft')`)).toMatch(/null value|row-level security/);
  });

  it('companies only see their own members', async () => {
    expect((await as('ownerB', 'select * from public.company_users')).length).toBe(1);
    expect((await as('ownerA', 'select * from public.company_users')).length).toBe(3);
  });
});

describe('roles', () => {
  it('an electrician cannot read estimates or finance', async () => {
    expect(await as('elecA', 'select * from public.estimates')).toEqual([]);
    expect(await fails('elecA', `insert into public.invoices (title, status) values ('x', 'Draft')`)).toMatch(/row-level security/);
  });

  it('an electrician can log field records but not delete them', async () => {
    await as('elecA', `insert into public.daily_logs (title, status) values ('Day 1', 'Submitted')`);
    expect((await as('elecA', 'delete from public.daily_logs returning id')).length).toBe(0);
    expect((await as('pmA', 'delete from public.daily_logs returning id')).length).toBe(1);
  });

  it('electricians only see their own timecards; PMs see all', async () => {
    await as('elecA', `insert into public.timecards (title, status, employee_name) values ('Job 1', 'Submitted', 'Sam')`);
    await as('ownerA', `insert into public.timecards (title, status, employee_name) values ('Job 1', 'Submitted', 'Alex')`);
    expect((await as<{ employee_name: string }>('elecA', 'select employee_name from public.timecards')).map((r) => r.employee_name)).toEqual(['Sam']);
    expect((await as('pmA', 'select * from public.timecards')).length).toBe(2);
    expect((await as('elecA', `update public.timecards set status = 'Approved' where employee_name = 'Alex' returning id`)).length).toBe(0);
  });

  it('created_by is always the real author and cannot be rewritten', async () => {
    const [row] = await as<{ id: string; created_by: string }>('pmA', `insert into public.rfis (title, status) values ('Q1', 'Open') returning id, created_by`);
    expect(row.created_by).toBe(users.pmA.id);
    expect(await fails('pmA', `insert into public.rfis (title, status, created_by) values ('Q2', 'Open', $1)`, [users.ownerA.id])).toMatch(/row-level security/);
    await as('pmA', 'update public.rfis set created_by = $1 where id = $2', [users.ownerA.id, row.id]);
    expect((await as<{ created_by: string }>('ownerA', 'select created_by from public.rfis where id = $1', [row.id]))[0].created_by).toBe(users.pmA.id);
  });

  it('only owners and admins manage the team, and nobody can promote themselves', async () => {
    expect(await fails('pmA', `select public.set_member_role($1, 'admin')`, [users.elecA.id])).toMatch(/Only owners and admins/);
    expect(await fails('elecA', `select public.set_member_role($1, 'admin')`, [users.elecA.id])).toMatch(/Only owners and admins/);
    expect(await fails('pmA', `insert into public.invitations (company_id, email, role) values (public.user_company_id(), 'x@y.ca', 'admin')`)).toMatch(/row-level security/);
    await expect(as('elecA', `update public.company_users set role = 'owner' where user_id = auth.uid()`)).rejects.toThrow(/permission denied/);
    await as('ownerA', `select public.set_member_role($1, 'foreman')`, [users.elecA.id]);
    expect((await as<{ role: string }>('ownerA', 'select role from public.company_users where user_id = $1', [users.elecA.id]))[0].role).toBe('foreman');
    await as('ownerA', `select public.set_member_role($1, 'electrician')`, [users.elecA.id]);
  });

  it('owners of one company cannot change members of another', async () => {
    expect(await fails('ownerB', `select public.set_member_role($1, 'admin')`, [users.elecA.id])).toMatch(/Member not found/);
    expect(await fails('ownerB', 'select public.remove_member($1)', [users.elecA.id])).toMatch(/Member not found/);
  });

  it('subscription fields cannot be changed by users', async () => {
    await expect(as('ownerA', `update public.companies set subscription_status = 'active'`)).rejects.toThrow(/permission denied/);
    await as('ownerA', `update public.companies set name = 'Alpha Electric Ltd.'`);
    expect((await as<{ name: string }>('ownerA', 'select name from public.companies'))[0].name).toBe('Alpha Electric Ltd.');
  });
});

describe('invitations', () => {
  it('only the invited email can accept, and only once', async () => {
    await as('ownerB', `insert into public.invitations (company_id, email, role) values (public.user_company_id(), 'someone@bravo.ca', 'foreman')`);
    const [{ token }] = await as<{ token: string }>('ownerB', 'select token from public.invitations where accepted_at is null');
    expect(await fails('stranger', 'select public.accept_invitation($1, $2)', [token, 'x'])).toMatch(/not found or expired/);
    expect(await fails('elecA', 'select public.accept_invitation($1, $2)', [token, 'x'])).toMatch(/not found or expired/);
  });

  it('a member cannot create a second company', async () => {
    expect(await fails('elecA', `select public.create_company('Side Hustle', 'SK', 'Sam')`)).toMatch(/already belong/);
  });
});

describe('subscription gating', () => {
  it('locks writes after the trial ends but keeps reads', async () => {
    await db.exec(`update public.companies set trial_ends_at = now() - interval '1 day' where name = 'Bravo Power'`);
    expect(await fails('ownerB', `insert into public.estimates (title, status) values ('late', 'Draft')`)).toMatch(/row-level security/);
    expect((await as('ownerB', `update public.estimates set title = 'late' returning id`)).length).toBe(0);
    expect((await as('ownerB', 'select * from public.estimates')).length).toBe(1);
    const [usage] = await as<{ allowed: boolean }>('ownerB', 'select * from public.consume_ai_message()');
    expect(usage.allowed).toBe(false);

    await db.exec(`update public.companies set subscription_status = 'active' where name = 'Bravo Power'`);
    await as('ownerB', `insert into public.estimates (title, status) values ('paid', 'Draft')`);
  });

  it('caps assistant use per company per day', async () => {
    const results = [];
    for (let i = 0; i < 41; i++) results.push((await as<{ allowed: boolean }>('elecA', 'select * from public.consume_ai_message()'))[0].allowed);
    expect(results.slice(0, 40).every(Boolean)).toBe(true);
    expect(results[40]).toBe(false);
  });
});
