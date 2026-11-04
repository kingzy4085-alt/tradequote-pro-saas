// Boots embedded Postgres (PGlite) with stand-ins for Supabase's auth and storage,
// runs the real migrations and lets a test act as any user. Rules enforced by the
// database itself are tested through this.
import { PGlite } from '@electric-sql/pglite';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

export const MIGRATIONS_DIR = 'supabase/migrations';

/** The commit whose baseline is what a live database ran before the registry sync existed. */
export const OLD_BASELINE_COMMIT = '9441e49';
const OLD_APPLIED = ['20261101000000_saas_core.sql', '20261101000100_job_photos_storage.sql'];

const SUPABASE_STUB = `
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

export interface TestUser {
  id: string;
  email: string;
}

export interface TestDb {
  db: PGlite;
  /** Runs SQL as a signed-in user under row level security, or as an anonymous visitor when null. */
  as<T = Record<string, unknown>>(user: TestUser | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs SQL that must fail as that user and returns the error message. Throws if it succeeds. */
  fails(user: TestUser | null, sql: string, params?: unknown[]): Promise<string>;
  /** Runs SQL as the table owner, with no signed-in user: how migrations and service-role jobs see the data. */
  system<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Adds users to auth.users. */
  addUsers(...users: TestUser[]): Promise<void>;
  /** Signs a user up as the owner of a new company and returns its id. */
  createCompany(owner: TestUser, name: string, province?: string): Promise<string>;
  /** Invites a user to the owner's company and accepts for them. */
  addMember(owner: TestUser, user: TestUser, role: 'admin' | 'project_manager' | 'foreman' | 'electrician', fullName?: string): Promise<void>;
  /** Runs one migration file again. */
  runMigration(file: string): Promise<void>;
}

export const migrationFiles = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const readMigration = (file: string) => readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
const oldMigration = (file: string) => execFileSync('git', ['show', `${OLD_BASELINE_COMMIT}:${MIGRATIONS_DIR}/${file}`], { encoding: 'utf8', maxBuffer: 10_000_000 });

function wrap(db: PGlite): TestDb {
  async function setSession(user: TestUser | null) {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [user?.id ?? '', user ? JSON.stringify({ sub: user.id, email: user.email }) : '']);
  }

  const t: TestDb = {
    db,
    async as<T>(user: TestUser | null, sql: string, params: unknown[] = []) {
      await setSession(user);
      await db.exec(user ? 'set role authenticated' : 'set role anon');
      try {
        return (await db.query<T>(sql, params)).rows;
      } finally {
        await db.exec('reset role');
      }
    },
    async fails(user, sql, params = []) {
      try {
        await t.as(user, sql, params);
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error(`Expected failure: ${sql}`);
    },
    async system<T>(sql: string, params: unknown[] = []) {
      await setSession(null);
      return (await db.query<T>(sql, params)).rows;
    },
    async addUsers(...users) {
      for (const u of users) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
    },
    async createCompany(owner, name, province = 'SK') {
      const [{ id }] = await t.as<{ id: string }>(owner, `select public.create_company($1, $2, 'Owner') as id`, [name, province]);
      return id;
    },
    async addMember(owner, user, role, fullName = 'Team Member') {
      await t.as(owner, `insert into public.invitations (company_id, email, role) values (public.user_company_id(), $1, $2)`, [user.email, role]);
      const [invite] = await t.as<{ token: string }>(user, 'select token from public.pending_invitations()');
      await t.as(user, 'select public.accept_invitation($1, $2)', [invite.token, fullName]);
    },
    async runMigration(file) {
      await t.system('select 1');
      await db.exec(readMigration(file));
    },
  };
  return t;
}

/** A new database with every migration applied in sorted order. */
export async function bootDb(): Promise<TestDb> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) await db.exec(readMigration(file));
  return wrap(db);
}

/**
 * A database as it stood before the registry sync: the old baseline from git. `seed` adds
 * data in the old schema, then every migration since runs on top, as it would in production.
 */
export async function bootOldBaselineDb(seed?: (t: TestDb) => Promise<void>): Promise<TestDb> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  for (const file of OLD_APPLIED) await db.exec(oldMigration(file));
  const t = wrap(db);
  if (seed) await seed(t);
  await t.system('select 1');
  for (const file of migrationFiles()) if (!OLD_APPLIED.includes(file)) await db.exec(readMigration(file));
  return t;
}
