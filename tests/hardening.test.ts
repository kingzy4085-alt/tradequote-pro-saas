// Runs every migration in order on embedded Postgres and proves the hardening
// rules: lapsed companies can't delete, job photos follow the log's lock, signed
// logs can't be deleted, invitations are unique and rate limits hold.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const STUB = `
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated;

-- Just enough of Supabase storage for the policies to run against
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner_id text default auth.uid()::text
);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
`;

const MIGRATIONS = 'supabase/migrations';
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const HARDENING = `${MIGRATIONS}/20261104000050_hardening.sql`;

const users = {
  owner: { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' },
  pm: { id: '00000000-0000-4000-8000-0000000000a3', email: 'pm@alpha.ca' },
  foreman: { id: '00000000-0000-4000-8000-0000000000a4', email: 'foreman@alpha.ca' },
  sparky: { id: '00000000-0000-4000-8000-0000000000a2', email: 'sparky@alpha.ca' },
  sparky2: { id: '00000000-0000-4000-8000-0000000000a5', email: 'sparky2@alpha.ca' },
  other: { id: '00000000-0000-4000-8000-00000000000b', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

let db: PGlite;
let companyA: string;
let companyB: string;

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

async function asSystem<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`);
  return (await db.query<T>(sql, params)).rows;
}

async function fails(who: U | null, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await as(who, sql, params);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`Expected failure: ${sql}`);
}

async function join(email: U, role: string) {
  await as('owner', `insert into public.invitations (company_id, email, role) values (public.user_company_id(), $1, $2)`, [users[email].email, role]);
  const [inv] = await as<{ token: string }>(email, 'select token from public.pending_invitations()');
  await as(email, 'select public.accept_invitation($1, $2)', [inv.token, email]);
}

const SIGNATURE = 'data:image/png;base64,AAAA';

async function newLog(signed = false): Promise<string> {
  const [{ id }] = await as<{ id: string }>('owner', `insert into public.daily_logs (title, status) values ('Log', 'Draft') returning id`);
  if (signed) await sign(id);
  return id;
}
const sign = (id: string) => as('owner', `update public.daily_logs set signed_by = 'Pat', signature = $1, signed_at = now() where id = $2`, [SIGNATURE, id]);
const reopen = (id: string) => as('owner', `update public.daily_logs set signed_by = null, signature = null, signed_at = null where id = $1`, [id]);
const pathFor = (log: string, file = 'a.jpg', company = companyA) => `${company}/daily-logs/${log}/${file}`;
const upload = (who: U, name: string) => as(who, `insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [name]);
const removeFile = async (who: U, name: string) => (await as(who, `delete from storage.objects where bucket_id = 'job-photos' and name = $1 returning id`, [name])).length;
const setLapsed = (lapsed: boolean) =>
  asSystem(`update public.companies set subscription_status = 'trialing', trial_ends_at = now() + ($1 || ' days')::interval where id = $2`, [lapsed ? '-1' : '14', companyA]);

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(STUB);
  for (const f of files) await db.exec(readFileSync(`${MIGRATIONS}/${f}`, 'utf8'));
  for (const u of Object.values(users)) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  await as('owner', `select public.create_company('Alpha Electric', 'SK', 'Alex')`);
  await as('other', `select public.create_company('Bravo Power', 'AB', 'Bea')`);
  await join('pm', 'project_manager');
  await join('foreman', 'foreman');
  await join('sparky', 'electrician');
  await join('sparky2', 'electrician');
  companyA = (await as<{ id: string }>('owner', 'select id from public.companies'))[0].id;
  companyB = (await as<{ id: string }>('other', 'select id from public.companies'))[0].id;
});

beforeEach(async () => {
  await setLapsed(false);
});

describe('migrations', () => {
  it('have unique version prefixes', () => {
    const versions = files.map((f) => f.split('_')[0]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(files).toContain('20261101000200_trial_emails.sql');
  });

  it('the hardening migration can run twice', async () => {
    await db.exec(readFileSync(HARDENING, 'utf8'));
    await db.exec(readFileSync(HARDENING, 'utf8'));
  });

  it('adds the write check to a delete policy left by the old baseline', async () => {
    await db.exec(`drop policy rfis_delete on public.rfis;
      create policy rfis_delete on public.rfis for delete to authenticated using (company_id = public.user_company_id() and public.user_rank() >= 3);`);
    await db.exec(readFileSync(HARDENING, 'utf8'));
    const [{ qual }] = await asSystem<{ qual: string }>(`select qual from pg_policies where tablename = 'rfis' and policyname = 'rfis_delete'`);
    expect(qual).toContain('company_can_write');
    expect(qual).toContain('user_rank');
  });

  it('keeps existing Stripe events finished and only then starts leaving them open', async () => {
    await asSystem(`insert into public.stripe_events (id, type) values ('evt_new', 'x')`);
    await db.exec(readFileSync(HARDENING, 'utf8'));
    expect((await asSystem<{ processed_at: string | null }>(`select processed_at from public.stripe_events where id = 'evt_new'`))[0].processed_at).toBeNull();
  });

  it('stamps pre-existing Stripe events when the column first appears', async () => {
    await asSystem(`alter table public.stripe_events drop column processed_at`);
    await asSystem(`insert into public.stripe_events (id, type) values ('evt_old', 'x')`);
    await db.exec(readFileSync(HARDENING, 'utf8'));
    expect((await asSystem<{ processed_at: string | null }>(`select processed_at from public.stripe_events where id = 'evt_old'`))[0].processed_at).not.toBeNull();
  });
});

describe('lapsed companies are read-only for deletes', () => {
  it('blocks module deletes after the trial ends, keeps reads, and allows them again once active', async () => {
    const [{ id }] = await as<{ id: string }>('owner', `insert into public.rfis (title, status) values ('RFI 1', 'Open') returning id`);
    await setLapsed(true);
    expect((await as('owner', 'delete from public.rfis where id = $1 returning id', [id])).length).toBe(0);
    expect((await as('owner', 'select id from public.rfis where id = $1', [id])).length).toBe(1);
    await setLapsed(false);
    expect((await as('owner', 'delete from public.rfis where id = $1 returning id', [id])).length).toBe(1);
  });

  it('every module delete policy carries the check', async () => {
    const rows = await asSystem<{ tablename: string; qual: string }>(`select tablename, qual from pg_policies where schemaname = 'public' and cmd = 'DELETE' and tablename <> 'invitations'`);
    expect(rows.length).toBeGreaterThan(40);
    for (const r of rows) expect(`${r.tablename}: ${r.qual}`).toContain('company_can_write');
  });

  it('profile edits stay allowed, and access can still be revoked', async () => {
    await as('owner', `insert into public.invitations (company_id, email, role) values (public.user_company_id(), 'later@alpha.ca', 'foreman')`);
    await setLapsed(true);
    expect((await as('owner', `update public.companies set phone = '306-555-0100' returning id`)).length).toBe(1);
    expect((await as('owner', `delete from public.invitations where email = 'later@alpha.ca' returning id`)).length).toBe(1);
  });
});

describe('job photo storage', () => {
  it('uploads need a real, open log in the caller\'s own company', async () => {
    const log = await newLog();
    await upload('sparky', pathFor(log));
    await expect(upload('sparky', pathFor('00000000-0000-4000-8000-000000000999'))).rejects.toThrow(/row-level security/);
    await expect(upload('sparky', `${companyA}/anything/at/all.jpg`)).rejects.toThrow(/row-level security/);
    await expect(upload('sparky', `${companyA}/daily-logs/not-a-uuid/a.jpg`)).rejects.toThrow(/row-level security/);
    await expect(upload('sparky', `${companyA}/daily-logs/${log}/../../x.jpg`)).rejects.toThrow(/row-level security/);
    await expect(upload('other', pathFor(log))).rejects.toThrow(/row-level security/);
    await expect(upload('other', pathFor(log, 'a.jpg', companyB))).rejects.toThrow(/row-level security/);
    const signed = await newLog(true);
    await expect(upload('sparky', pathFor(signed))).rejects.toThrow(/row-level security/);
  });

  it('no uploads once the company has lapsed', async () => {
    const log = await newLog();
    await setLapsed(true);
    await expect(upload('owner', pathFor(log))).rejects.toThrow(/row-level security/);
  });

  it('an electrician can remove only their own upload; a foreman can remove any', async () => {
    const log = await newLog();
    await upload('sparky', pathFor(log, 'mine.jpg'));
    await upload('sparky2', pathFor(log, 'theirs.jpg'));
    await upload('pm', pathFor(log, 'pm.jpg'));
    expect(await removeFile('sparky', pathFor(log, 'theirs.jpg'))).toBe(0);
    expect(await removeFile('sparky', pathFor(log, 'pm.jpg'))).toBe(0);
    expect(await removeFile('sparky', pathFor(log, 'mine.jpg'))).toBe(1);
    expect(await removeFile('foreman', pathFor(log, 'theirs.jpg'))).toBe(1);
  });

  it('nobody can remove a photo from a signed log until it is reopened', async () => {
    const log = await newLog();
    await upload('sparky', pathFor(log));
    await sign(log);
    expect(await removeFile('sparky', pathFor(log))).toBe(0);
    expect(await removeFile('owner', pathFor(log))).toBe(0);
    await reopen(log);
    expect(await removeFile('owner', pathFor(log))).toBe(1);
  });

  it('nobody can remove photos once the company has lapsed', async () => {
    const log = await newLog();
    await upload('owner', pathFor(log));
    await setLapsed(true);
    expect(await removeFile('owner', pathFor(log))).toBe(0);
  });

  it('another company cannot remove or see the files', async () => {
    const log = await newLog();
    await upload('owner', pathFor(log, 'private.jpg'));
    expect(await removeFile('other', pathFor(log, 'private.jpg'))).toBe(0);
    expect(await as('other', `select id from storage.objects where name = $1`, [pathFor(log, 'private.jpg')])).toEqual([]);
  });

  it('the path check is not callable by anonymous visitors', async () => {
    expect(await fails(null, `select public.job_photo_log_open('x')`)).toMatch(/permission denied/);
  });
});

describe('signed daily logs', () => {
  it('cannot be deleted until reopened', async () => {
    const log = await newLog(true);
    expect(await fails('pm', 'delete from public.daily_logs where id = $1', [log])).toMatch(/Reopen it before deleting/);
    await reopen(log);
    expect((await as('pm', 'delete from public.daily_logs where id = $1 returning id', [log])).length).toBe(1);
  });

  it('still locks edits and limits reopening to a foreman or above', async () => {
    const log = await newLog(true);
    expect(await fails('sparky', `update public.daily_logs set title = 'changed' where id = $1`, [log])).toMatch(/signed/);
    expect(await fails('sparky', `update public.daily_logs set signed_by = null, signature = null, signed_at = null where id = $1`, [log])).toMatch(/foreman or above/);
    await as('foreman', `update public.daily_logs set signed_by = null, signature = null, signed_at = null where id = $1`, [log]);
    expect((await as<{ signed_at: string | null }>('owner', 'select signed_at from public.daily_logs where id = $1', [log]))[0].signed_at).toBeNull();
  });

  it('do not block the server removing a whole company', async () => {
    await as('other', `insert into public.daily_logs (title, status) values ('Bravo log', 'Draft')`);
    await as('other', `update public.daily_logs set signed_by = 'Bea', signature = $1, signed_at = now()`, [SIGNATURE]);
    await asSystem('delete from public.daily_logs where company_id = $1', [companyB]);
    expect(await asSystem('select id from public.daily_logs where company_id = $1', [companyB])).toEqual([]);
  });
});

describe('invitations', () => {
  it('allows one pending invitation per company and email', async () => {
    await as('owner', `insert into public.invitations (company_id, email, role) values (public.user_company_id(), 'dup@alpha.ca', 'foreman')`);
    expect(await fails('owner', `insert into public.invitations (company_id, email, role) values (public.user_company_id(), 'dup@alpha.ca', 'electrician')`)).toMatch(/invitations_pending_unique/);
    // Another company can invite the same person
    await as('other', `insert into public.invitations (company_id, email, role) values (public.user_company_id(), 'dup@alpha.ca', 'foreman')`);
  });

  it('allows a new invitation after the last was accepted', async () => {
    await as('owner', `insert into public.invitations (company_id, email, role, accepted_at) values (public.user_company_id(), 'back@alpha.ca', 'foreman', now())`);
    await as('owner', `insert into public.invitations (company_id, email, role) values (public.user_company_id(), 'back@alpha.ca', 'foreman')`);
  });
});

describe('rate limits', () => {
  it('allows up to the limit in a window', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push((await asSystem<{ ok: boolean }>(`select public.check_rate_limit('test:a', 3, 3600) as ok`))[0].ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it('counts keys separately', async () => {
    await asSystem(`select public.check_rate_limit('test:b', 1, 3600)`);
    expect((await asSystem<{ ok: boolean }>(`select public.check_rate_limit('test:c', 1, 3600) as ok`))[0].ok).toBe(true);
  });

  it('starts a new count after the window', async () => {
    await asSystem(`select public.check_rate_limit('test:d', 1, 3600)`);
    expect((await asSystem<{ ok: boolean }>(`select public.check_rate_limit('test:d', 1, 3600) as ok`))[0].ok).toBe(false);
    await asSystem(`update public.rate_limits set window_start = window_start - interval '2 hours' where key = 'test:d'`);
    expect((await asSystem<{ ok: boolean }>(`select public.check_rate_limit('test:d', 1, 3600) as ok`))[0].ok).toBe(true);
  });

  it('users cannot call the raw limiter or read its table', async () => {
    expect(await fails('owner', `select public.check_rate_limit('leads:ip:x', 1, 60)`)).toMatch(/permission denied/);
    expect(await fails(null, `select public.check_rate_limit('leads:ip:x', 1, 60)`)).toMatch(/permission denied/);
    expect(await fails('owner', 'select * from public.rate_limits')).toMatch(/permission denied/);
  });

  it('a user spends only their own allowance, at the limit set in the database', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 11; i++) {
      results.push((await as<{ ok: boolean }>('sparky', `select public.consume_user_rate_limit('onboarding') as ok`))[0].ok);
    }
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
    expect((await as<{ ok: boolean }>('sparky2', `select public.consume_user_rate_limit('onboarding') as ok`))[0].ok).toBe(true);
  });

  it('refuses unknown buckets and anonymous callers', async () => {
    expect(await fails('owner', `select public.consume_user_rate_limit('made-up')`)).toMatch(/Unknown limit/);
    expect(await fails(null, `select public.consume_user_rate_limit('invite')`)).toMatch(/permission denied/);
  });
});

describe('new security definer functions', () => {
  it('pin an empty search_path', async () => {
    const rows = await asSystem<{ proname: string; proconfig: string[] }>(
      `select proname, proconfig from pg_proc where proname in ('job_photo_log_open', 'check_rate_limit', 'consume_user_rate_limit')`
    );
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.proconfig.join()).toMatch(/search_path=(""|)$/);
  });
});
