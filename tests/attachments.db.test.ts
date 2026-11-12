// File attachments in the database: the bucket, the rows in record_attachments and the storage rules,
// run as real roles on embedded Postgres. A signed-in user holds the public key and a session and can
// reach storage and PostgREST directly, so these rules are what actually keeps files apart.
// The rules the routes and pages add on top are in tests/attachments.test.ts.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ATTACHMENTS_BUCKET, ATTACHMENT_CONTENT_TYPES, ATTACHMENT_EXTENSIONS, ATTACHMENT_MODULES, ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_RECORD, MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { getModule } from '@/lib/modules';
import { bootDb, readMigration, type TestDb } from './helpers/db';

const MIGRATION = '20261113000130_attachments.sql';
const uid = (n: number) => `00000000-0000-4000-8000-0000000013${String(n).padStart(2, '0')}`;
const users = {
  ownerA: { id: uid(1), email: 'owner@alpha.ca' },
  adminA: { id: uid(2), email: 'admin@alpha.ca' },
  pmA: { id: uid(3), email: 'pm@alpha.ca' },
  foremanA: { id: uid(4), email: 'foreman@alpha.ca' },
  foreman2A: { id: uid(5), email: 'foreman2@alpha.ca' },
  elecA: { id: uid(6), email: 'elec@alpha.ca' },
  ownerB: { id: uid(7), email: 'owner@bravo.ca' },
};
type U = keyof typeof users;
type Row = Record<string, any>;

let t: TestDb<U>;
let alpha: string;
let bravo: string;
let drawing: string;
let document: string;
let vault: string;
let drawingB: string;
let rfi: string;

const TYPE: Record<string, string> = Object.fromEntries(Object.entries(ATTACHMENT_TYPES).map(([ext, type]) => [ext, type.contentType]));
const PUT = `insert into storage.objects (bucket_id, name) values ('attachments', $1) returning name`;
const RECORD = 'insert into public.record_attachments (module, record_id, path, file_name, content_type, size_bytes) values ($1, $2, $3, $4, $5, $6) returning *';

/** A new storage path in a record's folder. */
const fileAt = (company: string, module: string, record: string, ext = 'pdf') => `${company}/${module}/${record}/${randomUUID()}.${ext}`;
const upload = (who: U, name: string) => t.as(who, PUT, [name]);
/** Puts a file in storage as the server would, past every rule, so a test can reach the row rules on their own. */
const plant = (name: string) => t.asSystem(PUT, [name]);
const record = (who: U, module: string, recordId: string, path: string, fileName = 'Sheet E-101.pdf', contentType = 'application/pdf', size = 2048) =>
  t.as<Row>(who, RECORD, [module, recordId, path, fileName, contentType, size]);
/** What the browser and the route do together: upload into company A's folder for the record, then record it. */
async function attach(who: U, module: string, recordId: string, ext = 'pdf'): Promise<Row> {
  const path = fileAt(alpha, module, recordId, ext);
  await upload(who, path);
  const [row] = await record(who, module, recordId, path, `Sheet.${ext}`, TYPE[ext]);
  return row;
}
const rowsOf = (who: U, recordId: string) => t.as<Row>(who, 'select id from public.record_attachments where record_id = $1', [recordId]);
const objectsOf = (who: U, recordId: string) => t.as<Row>(who, `select name from storage.objects where bucket_id = 'attachments' and position($1 in name) > 0`, [recordId]);
const removeObject = async (who: U, name: string) => (await t.as(who, `delete from storage.objects where bucket_id = 'attachments' and name = $1 returning id`, [name])).length;
const removeRow = async (who: U, id: string) => (await t.as(who, 'delete from public.record_attachments where id = $1 returning id', [id])).length;
const newRecord = async (who: U, table: string, title: string, status: string) => (await t.as<Row>(who, `insert into public.${table} (title, status) values ($1, $2) returning id`, [title, status]))[0].id as string;

beforeAll(async () => {
  t = await bootDb(users);
  alpha = await t.createCompany('ownerA', 'Alpha Electric');
  bravo = await t.createCompany('ownerB', 'Bravo Power');
  await t.join('ownerA', 'adminA', 'admin');
  await t.join('ownerA', 'pmA', 'project_manager');
  await t.join('ownerA', 'foremanA', 'foreman');
  await t.join('ownerA', 'foreman2A', 'foreman');
  await t.join('ownerA', 'elecA', 'electrician');
  drawing = await newRecord('foremanA', 'drawings', 'Single Line Diagram', 'For Review');
  document = await newRecord('foremanA', 'documents', 'Site safety plan', 'Active');
  vault = await newRecord('pmA', 'site_vault', 'Plant access list', 'Secure');
  drawingB = await newRecord('ownerB', 'drawings', 'Bravo SLD', 'For Review');
  rfi = await newRecord('pmA', 'rfis', 'Confirm feeder size', 'Open');
});

describe('the bucket and the SQL agree with lib/attachments.ts and lib/modules.ts', () => {
  it('the bucket is private, holds 25 MB at most, and takes exactly the listed types', async () => {
    const [bucket] = await t.asSystem<Row>('select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1', [ATTACHMENTS_BUCKET]);
    expect(bucket.public).toBe(false);
    expect(Number(bucket.file_size_limit)).toBe(MAX_ATTACHMENT_BYTES);
    expect([...bucket.allowed_mime_types].sort()).toEqual([...ATTACHMENT_CONTENT_TYPES].sort());
  });

  it('the read, write and delete ranks written into the SQL are the ones each module has in lib/modules.ts', async () => {
    for (const slug of ATTACHMENT_MODULES) {
      const mod = getModule(slug)!;
      const [ranks] = await t.asSystem<Row>(`select public.attachment_rank($1, 'read') as read, public.attachment_rank($1, 'write') as write, public.attachment_rank($1, 'remove') as remove`, [slug]);
      expect(ranks, slug).toEqual({ read: mod.read, write: mod.write, remove: mod.remove });
    }
    const [{ none }] = await t.asSystem<Row>(`select public.attachment_rank('rfis', 'read') as none`);
    expect(none).toBeNull();
  });

  it('every listed extension can be stored and recorded with its type, and nothing else can be stored', async () => {
    const sheet = await newRecord('foremanA', 'documents', 'Every type', 'Active');
    for (const ext of ATTACHMENT_EXTENSIONS) expect((await attach('foremanA', 'documents', sheet, ext)).content_type, ext).toBe(TYPE[ext]);
    for (const ext of ['exe', 'svg', 'html', 'js', 'heic', 'zip', 'PDF', '']) {
      expect(await t.fails('foremanA', PUT, [fileAt(alpha, 'documents', sheet, ext)]), ext).toMatch(/row-level security/);
    }
  });
});

describe('who may add, open and delete', () => {
  it('a foreman adds a file to a drawing, and it lands in their company under their name', async () => {
    const row = await attach('foremanA', 'drawings', drawing);
    expect(row.company_id).toBe(alpha);
    expect(row.created_by).toBe(users.foremanA.id);
  });

  it('an electrician opens drawing and document files but cannot add any', async () => {
    const row = await attach('foremanA', 'drawings', drawing);
    const doc = await attach('foremanA', 'documents', document);
    expect((await t.as('elecA', 'select 1 from public.record_attachments where id = any($1)', [[row.id, doc.id]])).length).toBe(2);
    expect((await t.as('elecA', 'select 1 from storage.objects where name = any($1)', [[row.path, doc.path]])).length).toBe(2);
    const path = fileAt(alpha, 'drawings', drawing);
    expect(await t.fails('elecA', PUT, [path])).toMatch(/row-level security/);
    await plant(path);
    expect(await t.fails('elecA', RECORD, ['drawings', drawing, path, 'Mine.pdf', 'application/pdf', 10])).toMatch(/row-level security/);
  });

  it('a project manager or above deletes drawing files; the foreman who added one cannot take it back once it is recorded', async () => {
    const row = await attach('foremanA', 'drawings', drawing);
    expect(await removeRow('foremanA', row.id)).toBe(0);
    expect(await removeObject('foremanA', row.path)).toBe(0);
    expect(await removeObject('pmA', row.path)).toBe(1);
    expect(await removeRow('pmA', row.id)).toBe(1);
  });

  it('Site Vault files follow the vault: hidden from a foreman, added by a project manager, deleted only by an admin or owner', async () => {
    const row = await attach('pmA', 'site-vault', vault);
    expect(await rowsOf('foremanA', vault)).toEqual([]);
    expect(await objectsOf('foremanA', vault)).toEqual([]);
    expect(await t.fails('foremanA', PUT, [fileAt(alpha, 'site-vault', vault)])).toMatch(/row-level security/);
    expect(await removeRow('pmA', row.id)).toBe(0);
    expect(await removeObject('pmA', row.path)).toBe(0);
    expect(await removeObject('adminA', row.path)).toBe(1);
    expect(await removeRow('adminA', row.id)).toBe(1);
    const second = await attach('pmA', 'site-vault', vault);
    expect(await removeRow('ownerA', second.id)).toBe(1);
  });

  it('whoever uploaded a file can take it back while nothing records it, and nobody else below the delete rank can', async () => {
    const path = fileAt(alpha, 'drawings', drawing);
    await upload('foremanA', path);
    expect(await removeObject('foreman2A', path)).toBe(0);
    expect(await removeObject('elecA', path)).toBe(0);
    expect(await removeObject('foremanA', path)).toBe(1);
  });

  it('a row cannot claim another author', async () => {
    const path = fileAt(alpha, 'drawings', drawing);
    await upload('foremanA', path);
    expect(await t.fails('foremanA', 'insert into public.record_attachments (module, record_id, path, file_name, content_type, size_bytes, created_by) values ($1, $2, $3, $4, $5, $6, $7)', ['drawings', drawing, path, 'x.pdf', 'application/pdf', 10, users.ownerA.id])).toMatch(/row-level security/);
  });

  it('rows are never edited: not renamed, not moved, not re-credited', async () => {
    const row = await attach('foremanA', 'drawings', drawing);
    for (const sql of [
      `update public.record_attachments set file_name = 'Renamed.pdf' where id = $1`,
      `update public.record_attachments set record_id = '${document}' where id = $1`,
      `update public.record_attachments set created_by = '${users.ownerA.id}' where id = $1`,
    ]) {
      expect(await t.fails('ownerA', sql, [row.id]), sql).toMatch(/permission denied/);
    }
  });
});

describe('company lines', () => {
  it('another company sees none of the files and cannot add, record or delete any', async () => {
    const row = await attach('foremanA', 'drawings', drawing);
    expect(await t.as('ownerB', 'select 1 from public.record_attachments')).toEqual([]);
    expect(await t.as('ownerB', 'select 1 from storage.objects where name = $1', [row.path])).toEqual([]);
    expect(await removeRow('ownerB', row.id)).toBe(0);
    expect(await removeObject('ownerB', row.path)).toBe(0);
    expect(await t.fails('ownerB', PUT, [fileAt(alpha, 'drawings', drawing)])).toMatch(/row-level security/);
    // Naming company A outright does not help
    const path = fileAt(alpha, 'drawings', drawing);
    await plant(path);
    expect(await t.fails('ownerB', 'insert into public.record_attachments (company_id, module, record_id, path, file_name, content_type, size_bytes) values ($1, $2, $3, $4, $5, $6, $7)', [alpha, 'drawings', drawing, path, 'x.pdf', 'application/pdf', 10])).toMatch(/row-level security/);
    expect((await t.as('ownerA', 'select 1 from public.record_attachments where id = $1', [row.id])).length).toBe(1);
  });

  it("a record of another company cannot take a file, even from the caller's own folder", async () => {
    const mine = fileAt(bravo, 'drawings', drawing);
    expect(await t.fails('ownerB', PUT, [mine])).toMatch(/row-level security/);
    await plant(mine);
    expect(await t.fails('ownerB', RECORD, ['drawings', drawing, mine, 'x.pdf', 'application/pdf', 10])).toMatch(/row-level security/);
    const theirs = fileAt(alpha, 'drawings', drawingB);
    expect(await t.fails('ownerA', PUT, [theirs])).toMatch(/row-level security/);
    await plant(theirs);
    expect(await t.fails('ownerA', RECORD, ['drawings', drawingB, theirs, 'x.pdf', 'application/pdf', 10])).toMatch(/row-level security/);
  });

  it('visitors who are not signed in are refused outright', async () => {
    expect(await t.fails(null, 'select 1 from public.record_attachments')).toMatch(/permission denied/);
    expect(await t.fails(null, 'select 1 from storage.objects')).toMatch(/permission denied/);
    for (const fn of [`public.attachment_rank('drawings', 'read')`, `public.attachment_record_exists('drawings', '${drawing}')`, `public.attachment_path_allowed('x', 'read')`]) {
      expect(await t.fails(null, `select ${fn}`), fn).toMatch(/permission denied/);
    }
  });
});

describe('the module, the record, the place, the name and the size', () => {
  it('the module has to be one of the three, and the record has to be in that module', async () => {
    const rfiPath = fileAt(alpha, 'rfis', rfi);
    expect(await t.fails('pmA', PUT, [rfiPath])).toMatch(/row-level security/);
    await plant(rfiPath);
    expect(await t.fails('pmA', RECORD, ['rfis', rfi, rfiPath, 'x.pdf', 'application/pdf', 10])).toMatch(/row-level security/);
    await expect(t.asSystem(`insert into public.record_attachments (company_id, module, record_id, path, file_name, content_type, size_bytes) values ($1, 'rfis', $2, $3, 'x.pdf', 'application/pdf', 10)`, [alpha, rfi, rfiPath])).rejects.toThrow(/check constraint/);
    // A document's id filed under drawings
    const wrong = fileAt(alpha, 'drawings', document);
    expect(await t.fails('foremanA', PUT, [wrong])).toMatch(/row-level security/);
    await plant(wrong);
    expect(await t.fails('foremanA', RECORD, ['drawings', document, wrong, 'x.pdf', 'application/pdf', 10])).toMatch(/row-level security/);
    // A row whose module and record disagree with where its file is
    const docPath = fileAt(alpha, 'documents', document);
    await upload('foremanA', docPath);
    expect(await t.fails('foremanA', RECORD, ['drawings', drawing, docPath, 'x.pdf', 'application/pdf', 10])).toMatch(/check constraint/);
  });

  it('a file sits directly in its own record`s folder, under a random name with a lower-case extension', async () => {
    for (const name of [
      `${alpha}/drawings/${drawing}/sub/${randomUUID()}.pdf`,
      `${alpha}/drawings/${drawing}/plan.pdf`,
      `${alpha}/drawings/${drawing}/${randomUUID().toUpperCase()}.pdf`,
      `${alpha}/drawings/${drawing}/../${randomUUID()}.pdf`,
      `${alpha}/drawings/${randomUUID()}.pdf`,
      `${alpha}/drawings/${drawing}/${randomUUID()}.pdf.exe`,
      `${alpha}/drawings/${randomUUID()}/${randomUUID()}.pdf`,
    ]) {
      expect(await t.fails('foremanA', PUT, [name]), name).toMatch(/row-level security/);
    }
    const elsewhere = fileAt(alpha, 'drawings', drawing);
    await upload('foremanA', elsewhere);
    const second = await newRecord('foremanA', 'drawings', 'Second sheet', 'For Review');
    expect(await t.fails('foremanA', RECORD, ['drawings', second, elsewhere, 'x.pdf', 'application/pdf', 10])).toMatch(/check constraint/);
  });

  it('a row needs its file in storage already, and one file is one row', async () => {
    const path = fileAt(alpha, 'drawings', drawing);
    expect(await t.fails('foremanA', RECORD, ['drawings', drawing, path, 'x.pdf', 'application/pdf', 10])).toMatch(/row-level security/);
    await upload('foremanA', path);
    await record('foremanA', 'drawings', drawing, path);
    expect(await t.fails('foremanA', RECORD, ['drawings', drawing, path, 'y.pdf', 'application/pdf', 10])).toMatch(/duplicate key|unique/);
  });

  it('a file is 1 byte to 25 MB', async () => {
    for (const size of [0, -1, MAX_ATTACHMENT_BYTES + 1]) {
      const path = fileAt(alpha, 'drawings', drawing);
      await upload('foremanA', path);
      expect(await t.fails('foremanA', RECORD, ['drawings', drawing, path, 'x.pdf', 'application/pdf', size]), String(size)).toMatch(/check constraint/);
    }
    for (const size of [1, MAX_ATTACHMENT_BYTES]) {
      const path = fileAt(alpha, 'drawings', drawing);
      await upload('foremanA', path);
      expect((await record('foremanA', 'drawings', drawing, path, 'Sized.pdf', 'application/pdf', size))[0].size_bytes).toBe(size);
    }
  });

  it('the name is one line with no folders and keeps the stored extension, and the type is the one that extension calls for', async () => {
    const path = fileAt(alpha, 'drawings', drawing);
    await upload('foremanA', path);
    for (const [fileName, type] of [
      ['../../etc/passwd.pdf', 'application/pdf'],
      ['C:\\plans\\a.pdf', 'application/pdf'],
      ['two\nlines.pdf', 'application/pdf'],
      [' padded.pdf', 'application/pdf'],
      ['', 'application/pdf'],
      [`${'x'.repeat(197)}.pdf`, 'application/pdf'],
      ['plan.exe', 'application/pdf'],
      ['plan.png', 'application/pdf'],
      ['plan', 'application/pdf'],
      ['plan.pdf', 'text/html'],
      ['plan.pdf', 'image/png'],
    ]) {
      expect(await t.fails('foremanA', RECORD, ['drawings', drawing, path, fileName, type, 10]), JSON.stringify(fileName)).toMatch(/check constraint/);
    }
    expect((await record('foremanA', 'drawings', drawing, path, 'Plan (Rev 2) é.PDF', 'application/pdf', 10))[0].file_name).toBe('Plan (Rev 2) é.PDF');
    const longest = fileAt(alpha, 'drawings', drawing);
    await upload('foremanA', longest);
    expect((await record('foremanA', 'drawings', drawing, longest, `${'x'.repeat(196)}.pdf`, 'application/pdf', 10)).length).toBe(1);
  });
});

describe('the subscription, the limit and deleting the record', () => {
  it('a lapsed company can still open its files, but cannot add, record or delete any', async () => {
    const row = await attach('foremanA', 'drawings', drawing);
    const unrecorded = fileAt(alpha, 'drawings', drawing);
    await upload('foremanA', unrecorded);
    await t.setLapsed(alpha, true);
    try {
      expect((await t.as('elecA', 'select 1 from public.record_attachments where id = $1', [row.id])).length).toBe(1);
      expect((await t.as('elecA', 'select 1 from storage.objects where name = $1', [row.path])).length).toBe(1);
      expect(await t.fails('foremanA', PUT, [fileAt(alpha, 'drawings', drawing)])).toMatch(/row-level security/);
      expect(await t.fails('foremanA', RECORD, ['drawings', drawing, unrecorded, 'x.pdf', 'application/pdf', 10])).toMatch(/row-level security/);
      expect(await removeRow('ownerA', row.id)).toBe(0);
      expect(await removeObject('ownerA', row.path)).toBe(0);
      expect(await removeObject('foremanA', unrecorded)).toBe(0);
    } finally {
      await t.setLapsed(alpha, false);
    }
  });

  it(`a record holds up to ${MAX_ATTACHMENTS_PER_RECORD} files`, async () => {
    const busy = await newRecord('foremanA', 'drawings', 'Busy sheet', 'For Review');
    const folder = `${alpha}/drawings/${busy}/`;
    await t.asSystem(`insert into storage.objects (bucket_id, name) select 'attachments', $1 || gen_random_uuid() || '.pdf' from generate_series(1, $2::int)`, [folder, MAX_ATTACHMENTS_PER_RECORD + 1]);
    const names = (await t.asSystem<Row>('select name from storage.objects where starts_with(name, $1) order by name', [folder])).map((r) => r.name as string);
    await t.as('foremanA', `insert into public.record_attachments (module, record_id, path, file_name, content_type, size_bytes) select 'drawings', $1, n, 'Sheet.pdf', 'application/pdf', 10 from unnest($2::text[]) as n`, [busy, names.slice(0, MAX_ATTACHMENTS_PER_RECORD)]);
    expect(await t.fails('foremanA', RECORD, ['drawings', busy, names[MAX_ATTACHMENTS_PER_RECORD], 'One more.pdf', 'application/pdf', 10])).toMatch(/up to 100 files/);
    expect((await rowsOf('foremanA', busy)).length).toBe(MAX_ATTACHMENTS_PER_RECORD);
  });

  it("deleting a record takes its file rows with it and leaves every other record's", async () => {
    const doomed = await newRecord('foremanA', 'documents', 'Old manual', 'Archived');
    await attach('foremanA', 'documents', doomed);
    await attach('foremanA', 'documents', doomed);
    const kept = await attach('foremanA', 'documents', document);
    expect((await t.as('pmA', 'delete from public.documents where id = $1 returning id', [doomed])).length).toBe(1);
    expect(await t.asSystem('select 1 from public.record_attachments where record_id = $1', [doomed])).toEqual([]);
    expect((await t.asSystem('select 1 from public.record_attachments where id = $1', [kept.id])).length).toBe(1);
    // The same for the other two modules
    const sheet = await newRecord('foremanA', 'drawings', 'Superseded sheet', 'Superseded');
    await attach('foremanA', 'drawings', sheet);
    const item = await newRecord('pmA', 'site_vault', 'Old contract', 'Expired');
    await attach('pmA', 'site-vault', item);
    await t.as('pmA', 'delete from public.drawings where id = $1', [sheet]);
    await t.as('adminA', 'delete from public.site_vault where id = $1', [item]);
    expect(await t.asSystem('select 1 from public.record_attachments where record_id = any($1)', [[sheet, item]])).toEqual([]);
  });

  it('a record nobody may delete keeps its files', async () => {
    const row = await attach('foremanA', 'drawings', drawing);
    expect(await t.as('foremanA', 'delete from public.drawings where id = $1 returning id', [drawing])).toEqual([]);
    expect((await t.asSystem('select 1 from public.record_attachments where id = $1', [row.id])).length).toBe(1);
  });
});

describe('the migration', () => {
  it('can run twice and leaves the same rules behind', async () => {
    const snapshot = async () => ({
      policies: await t.asSystem(`select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where tablename in ('record_attachments', 'objects') order by 1, 2, 3`),
      constraints: await t.asSystem(`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.record_attachments'::regclass order by 1`),
      triggers: await t.asSystem(`select tgrelid::regclass::text as tbl, tgname, pg_get_triggerdef(oid) as def from pg_trigger where not tgisinternal and tgname like '%attachment%' order by 1, 2`),
      functions: await t.asSystem(`select proname, prosrc, prosecdef, proconfig::text from pg_proc where proname like '%attachment%' order by 1`),
      grants: await t.asSystem(`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'record_attachments' and grantee in ('anon', 'authenticated') order by 1, 2`),
      bucket: await t.asSystem(`select * from storage.buckets where id = 'attachments'`),
    });
    const before = await snapshot();
    await t.asSystem('select 1');
    await t.pg.exec(readMigration(MIGRATION));
    await t.pg.exec(readMigration(MIGRATION));
    expect(await snapshot()).toEqual(before);
    expect(before.grants).toEqual([
      { grantee: 'authenticated', privilege_type: 'DELETE' },
      { grantee: 'authenticated', privilege_type: 'INSERT' },
      { grantee: 'authenticated', privilege_type: 'SELECT' },
    ]);
    expect(before.triggers.map((r) => (r as Row).tgname)).toEqual(['documents_attachments', 'drawings_attachments', 'record_attachments_guard', 'site_vault_attachments']);
  });
});
