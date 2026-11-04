// The shared schema and extension points the feature modules build on: links between
// records, system-owned fields and statuses, the sync migration and the shared helpers.
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import ModulePage from '@/components/module-page';
import { CompanyProfileSchema, COMPANY_PROFILE_COLUMNS } from '@/lib/company';
import { DETAIL_PAGES, PRINT_PAGES, detailHref, printHref } from '@/lib/detail-pages';
import { MODULES, editableFields, getModule, manualStatuses, referenceTable, tableColumns, type ModuleDef } from '@/lib/modules';
import { Letterhead, loadLetterhead } from '@/lib/print';
import { signatureImage } from '@/lib/signature';
import { parseRecord } from '@/lib/validation';
import { bootDb, bootOldBaselineDb, type TestDb, type TestUser } from './helpers/db';
import { fakeSupabase } from './helpers/fake-supabase';

const mockState = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  requireApi: vi.fn(async () => mockState.ctx),
}));

const { listColumns, listRecords } = await import('@/lib/crud');
const { authorizedCron } = await import('@/lib/cron');

const PROJECT_MODULES = [
  'rfis', 'change-orders', 'submittals', 'drawings', 'documents', 'daily-logs', 'field-logs', 'timecards', 'crew-schedule', 'tailgate-logs', 'safety-logs', 'loto-permits', 'inspections', 'punch-list',
  'commissioning', 'cable-testing', 'quality-control', 'non-conformance', 'tasks', 'job-costing', 'progress-billing', 'invoices', 'receivables', 'payables', 'purchase-orders', 'equipment-rentals', 'estimates', 'proposals',
];
const CLIENT_MODULES = ['estimates', 'proposals', 'projects', 'invoices'];

const hasField = (slug: string, key: string, type?: string) => getModule(slug)!.fields.some((f) => f.key === key && (!type || f.type === type));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('registry', () => {
  it('links the job-scoped modules to projects and the sales modules to clients', () => {
    for (const slug of PROJECT_MODULES) expect(hasField(slug, 'project_id', 'project'), slug).toBe(true);
    for (const slug of CLIENT_MODULES) expect(hasField(slug, 'client_id', 'client'), slug).toBe(true);
    expect(MODULES.filter((m) => m.fields.some((f) => f.type === 'project')).length).toBe(PROJECT_MODULES.length);
    expect(MODULES.filter((m) => m.fields.some((f) => f.type === 'client')).length).toBe(CLIENT_MODULES.length);
  });

  it('keeps the free-text fields so old data survives', () => {
    for (const slug of ['punch-list', 'change-orders', 'purchase-orders']) expect(hasField(slug, 'project_name')).toBe(true);
    for (const slug of CLIENT_MODULES) expect(hasField(slug, 'client_name')).toBe(true);
  });

  it.each([
    ['sub-compliance', 'wcb_clearance_expiry', 'date'],
    ['vendors', 'wcb_clearance_expiry', 'date'],
    ['warehouse-inventory', 'reorder_point', 'number'],
    ['fleet', 'next_service_date', 'date'],
    ['fleet', 'next_service_km', 'number'],
    ['site-vault', 'expiry_date', 'date'],
    ['employees', 'hourly_cost', 'money'],
    ['progress-billing', 'holdback_release_date', 'date'],
    ['payables', 'purchase_order_id', 'uuid'],
  ])('%s has %s', (slug, key, type) => {
    expect(hasField(slug, key, type)).toBe(true);
  });

  it('every link names a table in the registry, and computed fields are never required', () => {
    const tables = new Set(MODULES.map((m) => m.table));
    for (const m of MODULES) {
      for (const f of m.fields) {
        const target = referenceTable(f);
        if (target) expect(tables.has(target), `${m.slug}.${f.key}`).toBe(true);
        if (f.type === 'uuid') expect(target, `${m.slug}.${f.key}`).toBeDefined();
        if (f.computed) expect(f.required, `${m.slug}.${f.key}`).toBeFalsy();
      }
      for (const s of m.systemStatuses ?? []) expect(m.statuses, m.slug).toContain(s);
    }
  });

  it('hides the purchase order link from the generic form and list', () => {
    const payables = getModule('payables')!;
    expect(editableFields(payables).map((f) => f.key)).not.toContain('purchase_order_id');
    expect(tableColumns(payables).map((c) => c.key)).not.toContain('purchase_order_id');
    expect(parseRecord(payables, { title: 'Bill', purchase_order_id: uuid(1) }, 'create')).toMatchObject({ ok: true, data: { purchase_order_id: uuid(1) } });
  });

  it('never lists a raw id, and shows the linked name before the typed one', () => {
    for (const m of MODULES) {
      for (const c of tableColumns(m)) {
        const value = c.value({ project_id: uuid(1), client_id: uuid(2), purchase_order_id: uuid(3) });
        expect(value, `${m.slug}.${c.key}`).toBeUndefined();
      }
    }
    const project = tableColumns(getModule('punch-list')!).find((c) => c.label === 'Project')!;
    expect(project.value({ project: { title: 'Linked' }, project_name: 'Typed' })).toBe('Linked');
    expect(project.value({ project: null, project_name: 'Typed' })).toBe('Typed');
    expect(tableColumns(getModule('punch-list')!).filter((c) => c.label.startsWith('Project')).length).toBe(1);
    const client = tableColumns(getModule('invoices')!).find((c) => c.key === 'client_name')!;
    expect(client.label).toBe('Client');
    expect(client.value({ client: { title: 'Cargill' }, client_name: 'Old' })).toBe('Cargill');
  });
});

describe('record validation of the new field kinds', () => {
  const invoices = getModule('invoices')!;

  // A module with a computed field and a system status, as the feature modules declare them
  const custom: ModuleDef = {
    ...invoices,
    systemStatuses: ['Overdue'],
    fields: [...invoices.fields, { key: 'balance', label: 'Balance', type: 'money', computed: true }],
  };

  it('accepts a link, clears it with a blank, and refuses anything but an id', () => {
    expect(parseRecord(invoices, { title: 'A', project_id: uuid(1), client_id: uuid(2) }, 'create')).toMatchObject({ ok: true, data: { project_id: uuid(1), client_id: uuid(2) } });
    expect(parseRecord(invoices, { project_id: '' }, 'update')).toEqual({ ok: true, data: { project_id: null } });
    const bad = parseRecord(invoices, { title: 'A', project_id: "1' or 1=1" }, 'create');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors.project_id).toBeDefined();
  });

  it('strips computed fields on create and update', () => {
    const created = parseRecord(custom, { title: 'A', balance: 5 }, 'create');
    expect(created.ok && 'balance' in created.data).toBe(false);
    expect(parseRecord(custom, { balance: 5 }, 'update')).toMatchObject({ ok: false, errors: { _: 'Nothing to update' } });
    expect(editableFields(custom).map((f) => f.key)).not.toContain('balance');
  });

  it('refuses a system status by hand but keeps the rest', () => {
    expect(manualStatuses(custom)).not.toContain('Overdue');
    const refused = parseRecord(custom, { status: 'Overdue' }, 'update');
    expect(refused).toMatchObject({ ok: false, errors: { status: 'This status is set automatically' } });
    expect(parseRecord(custom, { status: 'Hacked' }, 'update')).toMatchObject({ ok: false, errors: { status: 'Pick a status from the list' } });
    expect(parseRecord(custom, { status: 'Paid' }, 'update')).toEqual({ ok: true, data: { status: 'Paid' } });
  });

  it('starts a new record on the first manual status', () => {
    const r = parseRecord({ ...custom, systemStatuses: ['Draft'] }, { title: 'A' }, 'create');
    expect(r.ok && r.data.status).toBe('Sent');
    const allSystem = parseRecord({ ...custom, systemStatuses: custom.statuses }, { title: 'A' }, 'create');
    expect(allSystem.ok && allSystem.data.status).toBe(custom.statuses[0]);
  });
});

describe('list API', () => {
  const params = (module: string) => ({ params: { module } });
  const signedIn = (tables: Record<string, Record<string, unknown>[]>) => {
    const client = fakeSupabase(tables);
    mockState.ctx = { supabase: client, user: { id: uuid(9) }, role: 'owner', company: { id: uuid(8), name: 'Alpha' }, canWrite: true };
    return client;
  };

  it('filters by project through ?project=', async () => {
    const client = signedIn({ rfis: [{ id: 'a', title: 'A', project_id: uuid(1) }, { id: 'b', title: 'B', project_id: uuid(2) }] });
    const res = await listRecords(new Request(`https://app.test/api/modules/rfis?project=${uuid(1)}`), params('rfis'));
    expect((await res.json()).data.map((r: { id: string }) => r.id)).toEqual(['a']);
    expect(client.log[0].filters).toContainEqual(['eq', 'project_id', uuid(1)]);
  });

  it('refuses a malformed project filter instead of ignoring it', async () => {
    signedIn({ rfis: [] });
    const res = await listRecords(new Request('https://app.test/api/modules/rfis?project=nope'), params('rfis'));
    expect(res.status).toBe(400);
  });

  it('ignores the project filter on modules with no project', async () => {
    const client = signedIn({ crm: [{ id: 'a', title: 'A' }] });
    const res = await listRecords(new Request(`https://app.test/api/modules/crm?project=${uuid(1)}`), params('crm'));
    expect((await res.json()).data.length).toBe(1);
    expect(client.log[0].filters).toEqual([]);
  });

  it('gives a picker only id and title, sorted by name', async () => {
    const client = signedIn({ projects: [{ id: 'a', title: 'A', contract_value: 100 }] });
    await listRecords(new Request('https://app.test/api/modules/projects?picker=1&limit=200'), params('projects'));
    expect(client.log[0].columns).toBe('id, title');
    expect(client.log[0].order).toEqual(['title', 'id']);
  });

  it('brings linked names along with a list', () => {
    expect(listColumns(getModule('rfis')!)).toContain('project:projects!project_id(title)');
    expect(listColumns(getModule('invoices')!)).toContain('client:crm!client_id(title)');
    expect(listColumns(getModule('crm')!)).not.toContain('!');
  });
});

describe('shared helpers', () => {
  it('detail and print routes come from the map', () => {
    expect(detailHref('estimates', 'x')).toBe('/estimates/x');
    expect(detailHref('daily-logs', 'x')).toBe('/daily-logs/x');
    expect(detailHref('rfis', 'x')).toBeNull();
    expect(printHref('proposals', 'x')).toBe('/print/proposal/x');
    expect(printHref('rfis', 'x')).toBeNull();
    for (const slug of [...Object.keys(DETAIL_PAGES), ...Object.keys(PRINT_PAGES)]) expect(getModule(slug), slug).toBeDefined();
    expect(readFileSync('components/module-page.tsx', 'utf8')).not.toMatch(/new Set\(\['estimates'/);
  });

  describe('authorizedCron', () => {
    const request = (authorization?: string) => new Request('https://app.test/api/cron/x', { headers: authorization ? { authorization } : {} });

    beforeEach(() => vi.stubEnv('CRON_SECRET', 'a-long-enough-cron-secret-for-tests'));

    it('accepts only the exact bearer token', () => {
      expect(authorizedCron(request('Bearer a-long-enough-cron-secret-for-tests'))).toBe(true);
      expect(authorizedCron(request('Bearer wrong'))).toBe(false);
      expect(authorizedCron(request())).toBe(false);
    });

    it('throws when the secret is missing, so a route can say it is not configured', () => {
      vi.stubEnv('CRON_SECRET', '');
      expect(() => authorizedCron(request('Bearer '))).toThrow();
    });

    it('is what the trial email job uses', () => {
      const route = readFileSync('app/api/cron/trial-emails/route.ts', 'utf8');
      expect(route).toContain('authorizedCron(request)');
      expect(route).not.toContain('timingSafeEqual');
    });
  });

  it('the module page offers a project filter only where records link to a project', () => {
    const render = (slug: string) => renderToStaticMarkup(createElement(ModulePage, { slug, canWrite: true, canDelete: true, initialProject: uuid(1) }));
    expect(render('rfis')).toContain('Filter by project');
    expect(render('rfis')).toContain('All projects');
    expect(render('crm')).not.toContain('Filter by project');
  });

  it('the signature pad and print button moved to components', () => {
    expect(existsSync('components/signature-pad.tsx')).toBe(true);
    expect(existsSync('components/print-button.tsx')).toBe(true);
    expect(existsSync('app/(app)/daily-logs/[id]/signature-pad.tsx')).toBe(false);
    expect(signatureImage.safeParse('data:image/png;base64,AAAA').success).toBe(true);
    expect(signatureImage.safeParse('data:text/html,x').success).toBe(false);
  });

  it('the letterhead prints the company details and leaves out what is missing', () => {
    const html = renderToStaticMarkup(createElement(Letterhead, { company: { name: 'Alpha Electric', address: '1 Main St', phone: '306-555-0100', email: 'a@alpha.ca' }, title: 'Invoice', details: ['November 4, 2026'] }));
    expect(html).toContain('Alpha Electric');
    expect(html).toContain('1 Main St');
    expect(html).toContain('306-555-0100 · a@alpha.ca');
    expect(html).toContain('Invoice');
    expect(html).toContain('November 4, 2026');
    const bare = renderToStaticMarkup(createElement(Letterhead, { company: { name: 'Bravo' }, title: 'Invoice' }));
    expect(bare).not.toContain('<p></p>');
  });

  it('the letterhead reads the companies row and still prints a name if that fails', async () => {
    const company = { id: uuid(1), name: 'Alpha' };
    const client = fakeSupabase({ companies: [{ id: uuid(1), name: 'Alpha Ltd', address: '1 Main St' }] });
    expect(await loadLetterhead({ supabase: client as never, company })).toMatchObject({ name: 'Alpha Ltd', address: '1 Main St' });
    const empty = fakeSupabase({ companies: [] });
    expect(await loadLetterhead({ supabase: empty as never, company })).toEqual({ name: 'Alpha' });
  });

  it('the company profile accepts the new settings, within limits', () => {
    expect(COMPANY_PROFILE_COLUMNS).toContain('overtime_multiplier');
    expect(COMPANY_PROFILE_COLUMNS).toContain('default_holdback_pct');
    expect(CompanyProfileSchema.parse({ overtime_multiplier: '2', default_holdback_pct: '10' })).toEqual({ overtime_multiplier: 2, default_holdback_pct: 10 });
    expect(CompanyProfileSchema.safeParse({ overtime_multiplier: '0.5' }).success).toBe(false);
    expect(CompanyProfileSchema.safeParse({ default_holdback_pct: '101' }).success).toBe(false);
  });
});

const alpha: TestUser = { id: uuid(101), email: 'owner@alpha.ca' };
const alphaForeman: TestUser = { id: uuid(102), email: 'foreman@alpha.ca' };
const alphaSparky: TestUser = { id: uuid(103), email: 'sparky@alpha.ca' };
const bravo: TestUser = { id: uuid(201), email: 'owner@bravo.ca' };

describe('links on a new database', () => {
  let t: TestDb;
  let projectA: string;
  let projectB: string;
  let clientA: string;
  let clientB: string;
  let poB: string;

  const firstId = async (user: TestUser, sql: string) => (await t.as<{ id: string }>(user, sql))[0].id;

  beforeAll(async () => {
    t = await bootDb();
    await t.addUsers(alpha, alphaForeman, alphaSparky, bravo);
    await t.createCompany(alpha, 'Alpha Electric');
    await t.createCompany(bravo, 'Bravo Power', 'AB');
    await t.addMember(alpha, alphaForeman, 'foreman');
    await t.addMember(alpha, alphaSparky, 'electrician');
    projectA = await firstId(alpha, `insert into public.projects (title, status) values ('Alpha job', 'Active') returning id`);
    projectB = await firstId(bravo, `insert into public.projects (title, status) values ('Bravo job', 'Active') returning id`);
    clientA = await firstId(alpha, `insert into public.crm (title, status) values ('Alpha client', 'Lead') returning id`);
    clientB = await firstId(bravo, `insert into public.crm (title, status) values ('Bravo client', 'Lead') returning id`);
    poB = await firstId(bravo, `insert into public.purchase_orders (title, status) values ('Bravo PO', 'Draft') returning id`);
  });

  it('accepts a link to a record in the same company', async () => {
    const [row] = await t.as<{ project_id: string; client_id: string }>(alpha, `insert into public.estimates (title, status, project_id, client_id) values ('Bid', 'Draft', $1, $2) returning project_id, client_id`, [projectA, clientA]);
    expect(row).toEqual({ project_id: projectA, client_id: clientA });
  });

  it('rejects another company’s project and client on insert', async () => {
    expect(await t.fails(alpha, `insert into public.rfis (title, status, project_id) values ('Q', 'Open', $1)`, [projectB])).toMatch(/project was not found/);
    expect(await t.fails(alpha, `insert into public.projects (title, status, client_id) values ('P', 'Active', $1)`, [clientB])).toMatch(/client was not found/);
    expect(await t.fails(alpha, `insert into public.estimates (title, status, project_id, client_id) values ('P', 'Draft', $1, $2)`, [projectA, clientB])).toMatch(/client was not found/);
  });

  it('rejects another company’s project and client on update', async () => {
    const id = await firstId(alpha, `insert into public.invoices (title, status) values ('Inv', 'Draft') returning id`);
    expect(await t.fails(alpha, `update public.invoices set project_id = $1 where id = $2`, [projectB, id])).toMatch(/project was not found/);
    expect(await t.fails(alpha, `update public.invoices set client_id = $1 where id = $2`, [clientB, id])).toMatch(/client was not found/);
  });

  it('cannot get past the check by forging company_id in the same update', async () => {
    const [{ id: bravoCompany }] = await t.as<{ id: string }>(bravo, 'select id from public.companies');
    const id = await firstId(alpha, `insert into public.tasks (title, status) values ('T', 'To Do') returning id`);
    expect(await t.fails(alpha, `update public.tasks set company_id = $1, project_id = $2 where id = $3`, [bravoCompany, projectB, id])).toMatch(/project was not found/);
    expect((await t.as<{ project_id: string | null }>(alpha, 'select project_id from public.tasks where id = $1', [id]))[0].project_id).toBeNull();
  });

  it('answers the same for an id that does not exist, so ids cannot be probed', async () => {
    const other = await t.fails(alpha, `insert into public.rfis (title, status, project_id) values ('Q', 'Open', $1)`, [projectB]);
    const missing = await t.fails(alpha, `insert into public.rfis (title, status, project_id) values ('Q', 'Open', $1)`, [uuid(999)]);
    expect(missing).toBe(other);
  });

  it('checks the payables purchase order link too', async () => {
    expect(await t.fails(alpha, `insert into public.payables (title, status, purchase_order_id) values ('Bill', 'To Approve', $1)`, [poB])).toMatch(/purchase order was not found/);
  });

  it('works for a role that cannot read the linked table', async () => {
    // Foremen can't read clients, and the check must not depend on what the caller can read
    const member = await t.as(alphaForeman, 'select id from public.crm');
    expect(member).toEqual([]);
    await t.as(alphaSparky, `insert into public.field_logs (title, status, project_id) values ('Note', 'Logged', $1)`, [projectA]);
  });

  it('the check function cannot be called directly', async () => {
    expect(await t.fails(alpha, 'select public.check_same_company()')).toMatch(/permission denied|trigger functions/);
    expect(await t.fails(null, 'select public.check_same_company()')).toMatch(/permission denied|trigger functions/);
  });

  it('deleting a project clears links and keeps the records', async () => {
    const project = await firstId(alpha, `insert into public.projects (title, status) values ('Short job', 'Active') returning id`);
    const rfi = await firstId(alpha, `insert into public.rfis (title, status, project_id) values ('Keep me', 'Open', '${project}') returning id`);
    await t.as(alpha, 'delete from public.projects where id = $1', [project]);
    expect((await t.as<{ project_id: string | null }>(alpha, 'select project_id from public.rfis where id = $1', [rfi]))[0].project_id).toBeNull();
  });

  describe('a signed daily log', () => {
    const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';

    it('survives its project being deleted, still signed', async () => {
      const project = await firstId(alpha, `insert into public.projects (title, status) values ('Signed job', 'Active') returning id`);
      const log = await firstId(alpha, `insert into public.daily_logs (title, status, project_id) values ('Day', 'Draft', '${project}') returning id`);
      await t.as(alpha, `update public.daily_logs set signed_at = now(), signed_by = 'Pat', signature = $1 where id = $2`, [SIGNATURE, log]);
      await t.as(alpha, 'delete from public.projects where id = $1', [project]);
      const [row] = await t.as<{ project_id: string | null; signed_at: string | null; signed_by: string }>(alpha, 'select project_id, signed_at, signed_by from public.daily_logs where id = $1', [log]);
      expect(row.project_id).toBeNull();
      expect(row.signed_at).not.toBeNull();
      expect(row.signed_by).toBe('Pat');
    });

    it('still cannot have its link changed or cleared by hand', async () => {
      const log = await firstId(alpha, `insert into public.daily_logs (title, status, project_id) values ('Day 2', 'Draft', '${projectA}') returning id`);
      await t.as(alpha, `update public.daily_logs set signed_at = now(), signed_by = 'Pat', signature = $1 where id = $2`, [SIGNATURE, log]);
      expect(await t.fails(alpha, 'update public.daily_logs set project_id = null where id = $1', [log])).toMatch(/signed/);
    });
  });

  it('removing a whole company still cascades through linked and signed records', async () => {
    const owner: TestUser = { id: uuid(301), email: 'owner@charlie.ca' };
    await t.addUsers(owner);
    const company = await t.createCompany(owner, 'Charlie Controls');
    const project = await firstId(owner, `insert into public.projects (title, status) values ('C job', 'Active') returning id`);
    const log = await firstId(owner, `insert into public.daily_logs (title, status, project_id) values ('C day', 'Draft', '${project}') returning id`);
    await t.as(owner, `update public.daily_logs set signed_at = now(), signed_by = 'Pat', signature = 'data:image/png;base64,iVBORw0KGgo=' where id = $1`, [log]);
    await t.system('delete from public.companies where id = $1', [company]);
    expect((await t.system('select 1 from public.daily_logs where id = $1', [log])).length).toBe(0);
  });

  it('company settings have defaults, owners can change them, others cannot, and limits hold', async () => {
    const [c] = await t.as<{ overtime_multiplier: string; default_holdback_pct: string }>(alpha, 'select overtime_multiplier, default_holdback_pct from public.companies');
    expect(Number(c.overtime_multiplier)).toBe(1.5);
    expect(Number(c.default_holdback_pct)).toBe(10);
    await t.as(alpha, 'update public.companies set overtime_multiplier = 2, default_holdback_pct = 7.5');
    await t.as(alphaForeman, 'update public.companies set overtime_multiplier = 9');
    const [after] = await t.as<{ overtime_multiplier: string }>(alpha, 'select overtime_multiplier from public.companies');
    expect(Number(after.overtime_multiplier)).toBe(2);
    expect(await t.fails(alpha, 'update public.companies set overtime_multiplier = 0.5')).toMatch(/check constraint/);
    expect(await t.fails(alpha, 'update public.companies set default_holdback_pct = 101')).toMatch(/check constraint/);
  });

  it('the registry sync can run again and changes nothing', async () => {
    const before = await t.as(alpha, 'select id, project_id, client_id, updated_at from public.estimates order by id');
    await t.runMigration('20261104000000_registry_sync.sql');
    await t.runMigration('20261104000000_registry_sync.sql');
    expect(await t.as(alpha, 'select id, project_id, client_id, updated_at from public.estimates order by id')).toEqual(before);
    expect(await t.fails(alpha, `insert into public.rfis (title, status, project_id) values ('Q', 'Open', $1)`, [projectB])).toMatch(/project was not found/);
  });
});

describe('upgrading a database that ran the old baseline', () => {
  let t: TestDb;
  let fresh: TestDb;
  const stamp = '2020-01-02T03:04:05.000Z';

  beforeAll(async () => {
    t = await bootOldBaselineDb(async (old) => {
      await old.addUsers(alpha, bravo);
      await old.createCompany(alpha, 'Alpha Electric');
      await old.createCompany(bravo, 'Bravo Power', 'AB');
      await old.as(alpha, `insert into public.projects (title, status, client_name) values ('Canola Plant', 'Active', 'Cargill'), ('Twice', 'Active', null), ('Twice', 'Active', null)`);
      await old.as(bravo, `insert into public.projects (title, status) values ('Bravo only', 'Active')`);
      await old.as(alpha, `insert into public.crm (title, status) values ('Cargill', 'Active Client')`);
      await old.as(alpha, `insert into public.punch_list (title, status, project_name) values ('Exact', 'Open', 'Canola Plant'), ('Close', 'Open', 'canola plant'), ('Ambiguous', 'Open', 'Twice'), ('Other company', 'Open', 'Bravo only'), ('Blank', 'Open', null)`);
      await old.as(alpha, `insert into public.change_orders (title, status, project_name) values ('CO', 'Pending Approval', 'Canola Plant')`);
      await old.as(alpha, `insert into public.purchase_orders (title, status, project_name) values ('PO', 'Draft', 'Canola Plant')`);
      await old.as(alpha, `insert into public.estimates (title, status, client_name) values ('Canola Plant', 'Draft', 'Cargill')`);
      await old.as(alpha, `insert into public.job_costing (title, status) values ('Canola Plant', 'On Track')`);
      await old.as(alpha, `insert into public.timecards (title, status, employee_name) values ('Canola Plant', 'Submitted', 'Sam')`);
      await old.as(alpha, `insert into public.invoices (title, status, client_name) values ('INV-1', 'Draft', 'Cargill'), ('INV-2', 'Draft', 'Someone new')`);
      await old.as(alpha, `insert into public.rfis (title, status) values ('Canola Plant', 'Open')`);
      await old.db.exec(`alter table public.estimates disable trigger estimates_updated; update public.estimates set updated_at = '${stamp}'; alter table public.estimates enable trigger estimates_updated;`);
    });
    fresh = await bootDb();
  });

  const columns = (db: TestDb) =>
    db.system<{ c: string }>(`select table_name || '.' || column_name || ':' || data_type as c from information_schema.columns where table_schema = 'public' order by 1`);
  const triggers = (db: TestDb) => db.system<{ c: string }>(`select c.relname || '.' || t.tgname as c from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal order by 1`);
  const policies = (db: TestDb) => db.system<{ c: string }>(`select tablename || '.' || policyname as c from pg_policies where schemaname in ('public', 'storage') order by 1`);
  const constraints = (db: TestDb) => db.system<{ c: string }>(`select conname as c from pg_constraint where connamespace = 'public'::regnamespace and contype = 'f' order by 1`);

  it('ends with the same schema as a new database', async () => {
    expect(await columns(t)).toEqual(await columns(fresh));
    expect(await triggers(t)).toEqual(await triggers(fresh));
    expect(await policies(t)).toEqual(await policies(fresh));
    expect(await constraints(t)).toEqual(await constraints(fresh));
  });

  it('links by exact name within the company', async () => {
    const [canola] = await t.as<{ id: string }>(alpha, `select id from public.projects where title = 'Canola Plant'`);
    const punch = await t.as<{ title: string; project_id: string | null }>(alpha, 'select title, project_id from public.punch_list order by title');
    expect(Object.fromEntries(punch.map((r) => [r.title, r.project_id]))).toEqual({ Exact: canola.id, Close: null, Ambiguous: null, 'Other company': null, Blank: null });
    for (const table of ['change_orders', 'purchase_orders', 'estimates', 'job_costing', 'timecards']) {
      expect((await t.as<{ project_id: string }>(alpha, `select project_id from public.${table}`))[0].project_id, table).toBe(canola.id);
    }
  });

  it('links clients by exact name, and leaves names with no match alone', async () => {
    const [cargill] = await t.as<{ id: string }>(alpha, 'select id from public.crm');
    const invoices = await t.as<{ title: string; client_id: string | null; client_name: string }>(alpha, 'select title, client_id, client_name from public.invoices order by title');
    expect(invoices).toEqual([
      { title: 'INV-1', client_id: cargill.id, client_name: 'Cargill' },
      { title: 'INV-2', client_id: null, client_name: 'Someone new' },
    ]);
    expect((await t.as<{ client_id: string }>(alpha, `select client_id from public.projects where title = 'Canola Plant'`))[0].client_id).toBe(cargill.id);
    expect((await t.as<{ client_id: string }>(alpha, 'select client_id from public.estimates'))[0].client_id).toBe(cargill.id);
  });

  it('leaves a title that only happens to match unlinked on modules whose title is not a job', async () => {
    expect((await t.as<{ project_id: string | null }>(alpha, 'select project_id from public.rfis'))[0].project_id).toBeNull();
  });

  it('does not count linking as an edit, and leaves the update trigger on', async () => {
    const [before] = await t.as<{ updated_at: Date }>(alpha, 'select updated_at from public.estimates');
    expect(new Date(before.updated_at).toISOString()).toBe(stamp);
    await t.as(alpha, `update public.estimates set scope = 'Edited'`);
    const [after] = await t.as<{ updated_at: Date }>(alpha, 'select updated_at from public.estimates');
    expect(new Date(after.updated_at).toISOString()).not.toBe(stamp);
  });

  it('can run again without relinking or failing', async () => {
    const before = await t.as(alpha, 'select title, project_id from public.punch_list order by title');
    await t.runMigration('20261104000000_registry_sync.sql');
    expect(await t.as(alpha, 'select title, project_id from public.punch_list order by title')).toEqual(before);
  });

  it('can run again after a later migration locks a table', async () => {
    await t.as(alpha, `insert into public.timecards (title, status, employee_name) values ('Canola Plant', 'Approved', 'Late')`);
    await t.db.exec(`
      create function public.test_lock() returns trigger language plpgsql as $$ begin raise exception 'locked' using errcode = 'P0001'; end $$;
      create trigger timecards_test_lock before update on public.timecards for each row execute function public.test_lock();`);
    await t.runMigration('20261104000000_registry_sync.sql');
    const [row] = await t.as<{ project_id: string | null }>(alpha, `select project_id from public.timecards where employee_name = 'Late'`);
    expect(row.project_id).not.toBeNull();
    expect(await t.fails(alpha, `update public.timecards set notes = 'x' where employee_name = 'Late'`)).toMatch(/locked/);
    await t.db.exec('drop trigger timecards_test_lock on public.timecards; drop function public.test_lock();');
  });

  it('enforces the same rules afterwards', async () => {
    const [{ id: bravoProject }] = await t.as<{ id: string }>(bravo, 'select id from public.projects');
    expect(await t.fails(alpha, `insert into public.rfis (title, status, project_id) values ('Q', 'Open', $1)`, [bravoProject])).toMatch(/project was not found/);
    await t.as(alpha, 'update public.companies set overtime_multiplier = 1.75');
    expect(Number((await t.as<{ overtime_multiplier: string }>(alpha, 'select overtime_multiplier from public.companies'))[0].overtime_multiplier)).toBe(1.75);
  });
});
