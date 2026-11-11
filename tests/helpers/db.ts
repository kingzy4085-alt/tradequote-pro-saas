// Boots an embedded Postgres (PGlite) with a stand-in for Supabase's auth and
// storage schemas, runs every migration in filename order, and acts as a chosen
// user, so tests prove what the database itself enforces.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

export const MIGRATIONS_DIR = 'supabase/migrations';
export const BASELINE_FILE = '20261101000000_saas_core.sql';
/** The baseline as it was before links and the registry sync (commit 9441e49), which a live database may still have. */
export const OLD_BASELINE_FIXTURE = 'tests/fixtures/baseline-9441e49.sql';

// Default privileges match a real Supabase project: every new table and function
// starts open to anon and authenticated, until a migration revokes that.
export const SUPABASE_STUB = `
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
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

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
grant usage on schema storage to authenticated, service_role;
grant select, insert, delete on storage.objects to authenticated, service_role;
`;

export const migrationFiles = (): string[] => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
export const readMigration = (file: string): string => readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');

export interface TestUser {
  id: string;
  email: string;
}

export interface BootOptions {
  /** Runs this SQL in place of the current baseline, to test upgrading an older database. */
  baselineSql?: string;
  /** Only runs the migrations this returns true for. */
  include?: (file: string) => boolean;
}

export interface TestDb<U extends string> {
  pg: PGlite;
  /** Runs SQL as a signed-in user (role authenticated), or as a visitor (role anon) when `who` is null. */
  as<T = Record<string, unknown>>(who: U | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs SQL as the server's service role: no signed-in user, row security bypassed, grants still apply. */
  asService<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs SQL as the database owner, for setting up a test. */
  asSystem<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs SQL as a user, expects it to fail, and returns the error message. */
  fails(who: U | null, sql: string, params?: unknown[]): Promise<string>;
  /** Creates a company owned by `owner` and returns its id. */
  createCompany(owner: U, name: string, province?: string): Promise<string>;
  /** `inviter` invites `member` to their company with `role`, and `member` accepts. */
  join(inviter: U, member: U, role: 'admin' | 'project_manager' | 'foreman' | 'electrician', fullName?: string): Promise<void>;
  /** Puts a company's trial in the past (lapsed: read-only) or the future. */
  setLapsed(companyId: string, lapsed: boolean): Promise<void>;
}

/**
 * `const t = await bootDb({ owner: { id, email }, pm: { id, email } })`.
 * Each call is a fresh database, so keep it to one per test file where you can.
 */
export async function bootDb<U extends string>(users: Record<U, TestUser>, options: BootOptions = {}): Promise<TestDb<U>> {
  const pg = await PGlite.create();
  await pg.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    if (options.include && !options.include(file)) continue;
    await pg.exec(file === BASELINE_FILE && options.baselineSql !== undefined ? options.baselineSql : readMigration(file));
  }
  for (const u of Object.values(users) as TestUser[]) await pg.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);

  const clearClaims = () => pg.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`);

  async function as<T = Record<string, unknown>>(who: U | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await pg.exec('reset role');
    if (who) {
      const u = users[who];
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [u.id, JSON.stringify({ sub: u.id, email: u.email })]);
      await pg.exec('set role authenticated');
    } else {
      await clearClaims();
      await pg.exec('set role anon');
    }
    try {
      return (await pg.query<T>(sql, params)).rows;
    } finally {
      await pg.exec('reset role');
    }
  }

  async function asService<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await pg.exec('reset role');
    await clearClaims();
    await pg.exec('set role service_role');
    try {
      return (await pg.query<T>(sql, params)).rows;
    } finally {
      await pg.exec('reset role');
    }
  }

  async function asSystem<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await pg.exec('reset role');
    await clearClaims();
    return (await pg.query<T>(sql, params)).rows;
  }

  async function fails(who: U | null, sql: string, params: unknown[] = []): Promise<string> {
    try {
      await as(who, sql, params);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`Expected failure: ${sql}`);
  }

  async function createCompany(owner: U, name: string, province = 'SK'): Promise<string> {
    const [row] = await as<{ id: string }>(owner, 'select public.create_company($1, $2, $3) as id', [name, province, owner]);
    return row.id;
  }

  async function join(inviter: U, member: U, role: string, fullName: string = member): Promise<void> {
    await as(inviter, 'insert into public.invitations (company_id, email, role) values (public.user_company_id(), $1, $2)', [users[member].email, role]);
    const [inv] = await as<{ token: string }>(member, 'select token from public.pending_invitations()');
    await as(member, 'select public.accept_invitation($1, $2)', [inv.token, fullName]);
  }

  async function setLapsed(companyId: string, lapsed: boolean): Promise<void> {
    await asSystem(`update public.companies set subscription_status = 'trialing', trial_ends_at = now() + ($1 || ' days')::interval where id = $2`, [lapsed ? '-1' : '14', companyId]);
  }

  return { pg, as, asService, asSystem, fails, createCompany, join, setLapsed };
}
