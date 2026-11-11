// Proves the generated registry sync does its job: a database on the old baseline
// ends up with the same schema as a new one, old rows get linked by exact name, and
// running the sync again changes nothing.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BASELINE_FILE, OLD_BASELINE_FIXTURE, bootDb, migrationFiles, readMigration, type TestDb } from './helpers/db';

const SYNC_FILE = '20261104000000_registry_sync.sql';
const JOB_PHOTOS_FILE = '20261101000100_job_photos_storage.sql';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const users = { owner: { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' } };
type U = keyof typeof users;

/** Everything a migration can change, in a form two databases can be compared by. */
async function schemaOf(t: TestDb<U>): Promise<Record<string, unknown[]>> {
  const q = (sql: string) => t.asSystem(sql);
  return {
    columns: await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by 1, 2`),
    policies: await q(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname in ('public', 'storage') order by 1, 2`),
    triggers: await q(`select c.relname, t.tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal order by 1, 2`),
    constraints: await q(`select c.relname, k.conname, pg_get_constraintdef(k.oid) as def from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' order by 1, 2`),
    indexes: await q(`select indexname, indexdef from pg_indexes where schemaname = 'public' order by 1`),
    tableGrants: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3`),
    columnGrants: await q(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    functions: await q(`select p.proname, p.prosrc, p.prosecdef, p.proconfig::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`),
  };
}

const oldBaseline = readFileSync(OLD_BASELINE_FIXTURE, 'utf8');

// Rows only an old database could have: free-text names and no links
const OLD_ROWS = `
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ff', 'old@alpha.ca');
insert into public.companies (id, name, province) values ('${COMPANY}', 'Alpha', 'SK'), ('${OTHER}', 'Bravo', 'AB');
insert into public.projects (company_id, title, status, client_name) values
  ('${COMPANY}', 'Canola Shutdown', 'Active', 'Cargill'),
  ('${COMPANY}', 'Same Name', 'Active', 'Nobody'),
  ('${COMPANY}', 'Same Name', 'Planning', null),
  ('${OTHER}', 'Bravo Only', 'Active', null);
insert into public.crm (company_id, title, status) values ('${COMPANY}', 'Cargill', 'Active Client'), ('${OTHER}', 'Cargill', 'Lead');
insert into public.punch_list (company_id, title, status, project_name, updated_at) values
  ('${COMPANY}', 'exact', 'Open', 'Canola Shutdown', '2020-01-01'),
  ('${COMPANY}', 'spaces', 'Open', '  Canola Shutdown ', '2020-01-01'),
  ('${COMPANY}', 'wrong case', 'Open', 'canola shutdown', '2020-01-01'),
  ('${COMPANY}', 'ambiguous', 'Open', 'Same Name', '2020-01-01'),
  ('${COMPANY}', 'other company', 'Open', 'Bravo Only', '2020-01-01'),
  ('${COMPANY}', 'none', 'Open', null, '2020-01-01');
insert into public.job_costing (company_id, title, status) values ('${COMPANY}', 'Canola Shutdown', 'On Track');
insert into public.timecards (company_id, title, status, employee_name) values ('${COMPANY}', 'Canola Shutdown', 'Approved', 'Sam');
insert into public.estimates (company_id, title, status, client_name) values ('${COMPANY}', 'Canola Shutdown', 'Won', 'Cargill');
insert into public.invoices (company_id, title, status, client_name) values ('${COMPANY}', 'INV 1', 'Sent', 'Cargill');
`;

describe('upgrading a database on the old baseline', () => {
  let upgraded: TestDb<U>;
  let projectId: string;
  let clientId: string;

  beforeAll(async () => {
    // Old baseline, then the old rows, then every later migration in order
    upgraded = await bootDb(users, { include: (f) => f === BASELINE_FILE || f === JOB_PHOTOS_FILE, baselineSql: oldBaseline });
    await upgraded.pg.exec(OLD_ROWS);
    for (const f of migrationFiles()) {
      if (f !== BASELINE_FILE && f !== JOB_PHOTOS_FILE) await upgraded.pg.exec(readMigration(f));
    }
    [{ id: projectId }] = await upgraded.asSystem<{ id: string }>(`select id from public.projects where title = 'Canola Shutdown'`);
    [{ id: clientId }] = await upgraded.asSystem<{ id: string }>(`select id from public.crm where title = 'Cargill' and company_id = '${COMPANY}'`);
  });

  const punch = async () =>
    Object.fromEntries((await upgraded.asSystem<{ title: string; project_id: string | null }>('select title, project_id from public.punch_list')).map((r) => [r.title, r.project_id]));

  it('links old rows by exact name, ignoring outside spaces', async () => {
    const rows = await punch();
    expect(rows.exact).toBe(projectId);
    expect(rows.spaces).toBe(projectId);
  });

  it('leaves rows alone when the name differs, is shared, is in another company or is blank', async () => {
    const rows = await punch();
    expect(rows['wrong case']).toBeNull();
    expect(rows.ambiguous).toBeNull();
    expect(rows['other company']).toBeNull();
    expect(rows.none).toBeNull();
  });

  it('keeps the old text and does not touch updated_at', async () => {
    const [row] = await upgraded.asSystem<{ project_name: string; updated_at: Date }>(`select project_name, updated_at from public.punch_list where title = 'exact'`);
    expect(row.project_name).toBe('Canola Shutdown');
    expect(new Date(row.updated_at).getUTCFullYear()).toBe(2020);
  });

  it('links jobs by title and clients by client name', async () => {
    const one = async (table: string) => (await upgraded.asSystem<{ project_id: string | null; client_id: string | null }>(`select * from public.${table} order by created_at`))[0];
    expect((await one('job_costing')).project_id).toBe(projectId);
    expect((await one('timecards')).project_id).toBe(projectId);
    expect((await one('estimates')).project_id).toBe(projectId);
    expect((await one('estimates')).client_id).toBe(clientId);
    expect((await one('invoices')).client_id).toBe(clientId);
    expect((await one('invoices')).project_id).toBeNull();
    const [p] = await upgraded.asSystem<{ client_id: string }>(`select client_id from public.projects where title = 'Canola Shutdown'`);
    expect(p.client_id).toBe(clientId);
  });

  it('ends up with exactly the schema of a new database', async () => {
    const fresh = await bootDb(users);
    const [a, b] = [await schemaOf(upgraded), await schemaOf(fresh)];
    for (const key of Object.keys(b)) expect(a[key], key).toEqual(b[key]);
  });

  it('enforces the same-company rule on upgraded tables', async () => {
    const [{ id: bravo }] = await upgraded.asSystem<{ id: string }>(`select id from public.projects where title = 'Bravo Only'`);
    await expect(upgraded.asSystem(`insert into public.rfis (company_id, title, status, project_id) values ('${COMPANY}', 'Q', 'Open', $1)`, [bravo])).rejects.toThrow(/could not be found/);
  });
});

describe('running the sync more than once', () => {
  it('changes nothing the second time, and a link someone already set stays', async () => {
    const isUpToSync = (f: string) => f <= SYNC_FILE;
    const t = await bootDb(users, { include: isUpToSync });
    await t.pg.exec(`
      insert into public.companies (id, name, province) values ('${COMPANY}', 'Alpha', 'SK');
      insert into public.projects (id, company_id, title, status) values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${COMPANY}', 'One', 'Active'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${COMPANY}', 'Two', 'Active');
      insert into public.punch_list (company_id, title, status, project_name, project_id) values
        ('${COMPANY}', 'hand linked', 'Open', 'One', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        ('${COMPANY}', 'to backfill', 'Open', 'One', null);
    `);
    const before = await schemaOf(t);
    await t.pg.exec(readMigration(SYNC_FILE));
    await t.pg.exec(readMigration(SYNC_FILE));
    expect(await schemaOf(t)).toEqual(before);
    const rows = Object.fromEntries((await t.asSystem<{ title: string; project_id: string }>('select title, project_id from public.punch_list')).map((r) => [r.title, r.project_id]));
    expect(rows['hand linked']).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(rows['to backfill']).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    // The triggers turned off for the backfill are back on
    await expect(t.asSystem(`insert into public.rfis (company_id, title, status, project_id) values ('${COMPANY}', 'Q', 'Open', '99999999-9999-4999-8999-999999999999')`)).rejects.toThrow(/could not be found/);
  });
});
