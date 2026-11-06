// The engines together: one job through timecards, change orders, invoices and sign-offs,
// then the things that cut across all of them (lapsing, deleting a job, a login, a company).
// Each engine's own rules are tested in its own file; this checks they don't trip each other.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listColumns, recordColumns } from '@/lib/crud';
import { MODULES } from '@/lib/modules';
import { bootDb, type TestDb } from './helpers/db';

const SIG = 'data:image/png;base64,AAAA';
const users = {
  owner: { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' },
  pm: { id: '00000000-0000-4000-8000-00000000000b', email: 'pm@alpha.ca' },
  foreman: { id: '00000000-0000-4000-8000-00000000000c', email: 'foreman@alpha.ca' },
  sparky: { id: '00000000-0000-4000-8000-00000000000d', email: 'sparky@alpha.ca' },
  gone: { id: '00000000-0000-4000-8000-00000000000e', email: 'gone@alpha.ca' },
};
type U = keyof typeof users;
type Row = Record<string, any>;

let t: TestDb<U>;
let company: string;

const one = async (who: U, sql: string, params: unknown[] = []) => (await t.as<Row>(who, sql, params))[0];
const sys = async (sql: string, params: unknown[] = []) => (await t.asSystem<Row>(sql, params))[0];
const num = (v: unknown) => Number(v);

const newProject = async (title: string, contract = 100000) =>
  (await one('pm', `insert into public.projects (title, status, contract_value) values ($1, 'Active', $2) returning id`, [title, contract])).id as string;
let day = 0;
/** Each on its own day, so a worker never hits the 24 hour cap by accident. */
const newCard = async (project: string, who: U = 'sparky') =>
  (await one(who, `insert into public.timecards (title, status, employee_name, regular_hours, overtime_hours, project_id, work_date) values ('Job', 'Submitted', 'Sam', 8, 2, $1, date '2026-01-01' + $2::int) returning id`, [project, ++day])).id as string;
const approvedCo = async (project: string, who: U = 'pm') => {
  const co = await one(who, `insert into public.change_orders (title, status, project_id, material_cost, labour_hours, labour_rate, markup_pct, tax_pct) values ('Extra', 'Draft', $1, 1000, 10, 100, 0, 5) returning id`, [project]);
  await t.as(who, `update public.change_orders set status = 'Sent' where id = $1`, [co.id]);
  await t.as(who, `update public.change_orders set status = 'Approved', approved_by = 'Client Person', signature = $2 where id = $1`, [co.id, SIG]);
  return co.id as string;
};
const newInvoice = async (project: string, lines: unknown[] = [{ type: 'free', description: 'Progress', amount: 1000 }]) =>
  (await one('owner', `insert into public.invoices (title, status, project_id, tax_pct, holdback_pct, lines) values ('INV', 'Draft', $1, 5, 10, $2) returning id`, [project, JSON.stringify(lines)])).id as string;
const newPermit = async (project: string, who: U = 'sparky') => {
  const permit = await one(who, `insert into public.loto_permits (title, status, equipment_isolated, authorized_person, project_id, lock_number, record_date, isolation_points, energy_sources, verification_method, release_notes)
    values ('Panel', 'Draft', 'MCC-4', 'Sam', $1, 'L-1', '2026-11-02', 'Breaker 7', '["Electrical"]', 'Meter', 'Clear') returning id`, [project]);
  return permit.id as string;
};
const signPermit = async (id: string, who: U = 'sparky') => {
  for (const slot of ['lock_on', 'verified', 'lock_off']) await t.as(who, 'select public.sign_safety_record($1, $2, $3, $4, $5)', ['loto-permits', id, slot, 'Sam', SIG]);
};
const signedLog = async (project: string, who: U = 'sparky') => {
  const log = await one(who, `insert into public.daily_logs (title, status, project_id) values ('Day', 'Draft', $1) returning id`, [project]);
  await t.as(who, `update public.daily_logs set status = 'Submitted', signed_at = now(), signed_by = 'Sam', signature = $2 where id = $1`, [log.id, SIG]);
  return log.id as string;
};

beforeAll(async () => {
  t = await bootDb(users);
  company = await t.createCompany('owner', 'Alpha');
  await t.join('owner', 'pm', 'project_manager', 'Pat PM');
  await t.join('owner', 'foreman', 'foreman', 'Frank Foreman');
  await t.join('owner', 'sparky', 'electrician', 'Sam Sparky');
  await t.join('owner', 'gone', 'admin', 'Gail Gone');
  await t.as('owner', 'update public.companies set default_labour_rate = 40, overtime_multiplier = 1.5');
}, 120_000);
afterAll(() => t.pg.close());

describe('one job, start to finish', () => {
  it('runs from client to paid invoice with every engine on the same project', async () => {
    const client = await one('pm', `insert into public.crm (title, status) values ('Cargill', 'Active Client') returning id`);
    const project = (await one('pm', `insert into public.projects (title, status, contract_value, client_id) values ('Shutdown', 'Active', 100000, $1) returning id`, [client.id])).id as string;

    // Crew time: entered by the electrician, approved by the foreman, costed from the company rate
    const card = await newCard(project);
    await t.as('foreman', `select public.decide_timecards($1::uuid[], 'approve')`, [[card]]);
    const costed = await sys('select status, hourly_cost, labour_cost, approved_by from public.timecards where id = $1', [card]);
    expect(costed.status).toBe('Approved');
    expect(num(costed.hourly_cost)).toBe(40);
    expect(num(costed.labour_cost)).toBe(8 * 40 + 2 * 40 * 1.5);
    expect(costed.approved_by).toBe(users.foreman.id);

    // A change order moves the contract
    await approvedCo(project);
    const job = await sys('select approved_changes, revised_contract from public.projects where id = $1', [project]);
    expect(num(job.approved_changes)).toBe(2000);
    expect(num(job.revised_contract)).toBe(102000);

    // A safety sign-off on the same job locks without touching the money
    const permit = await newPermit(project);
    await signPermit(permit);
    expect((await sys('select status from public.loto_permits where id = $1', [permit])).status).toBe('Released');
    expect(num((await sys('select revised_contract from public.projects where id = $1', [project])).revised_contract)).toBe(102000);

    // Invoice: numbered, receivable appears on Sent, Paid collects it
    const invoice = await newInvoice(project);
    await t.as('owner', `update public.invoices set status = 'Sent' where id = $1`, [invoice]);
    expect(num((await sys('select invoice_number from public.invoices where id = $1', [invoice])).invoice_number)).toBeGreaterThanOrEqual(1001);
    expect(await sys('select id from public.receivables where invoice_id = $1', [invoice])).toBeDefined();
    await t.as('owner', `update public.invoices set status = 'Paid' where id = $1`, [invoice]);
    const paid = await sys('select status from public.invoices where id = $1', [invoice]);
    expect(paid.status).toBe('Paid');
  });

  it('a draw makes a draft invoice on the same job and leaves nothing sent', async () => {
    const project = await newProject('Draws');
    const draw = await one('owner', `insert into public.progress_billing (title, status, project_id, amount_billed, holdback_percent) values ('Draw 1', 'Draft', $1, 5000, 10) returning id`, [project]);
    await t.as('owner', 'select public.create_invoice_from_draw($1)', [draw.id]);
    const invoice = await sys('select status, project_id from public.invoices where id = (select invoice_id from public.progress_billing where id = $1)', [draw.id]);
    expect(invoice.status).toBe('Draft');
    expect(invoice.project_id).toBe(project);
  });
});

describe('a lapsed company is read-only in every engine', () => {
  let project: string;
  let card: string;
  let permit: string;
  let invoice: string;
  let log: string;
  let co: string;

  beforeAll(async () => {
    project = await newProject('Lapsing');
    card = await newCard(project);
    permit = await newPermit(project);
    invoice = await newInvoice(project);
    log = (await one('sparky', `insert into public.daily_logs (title, status, project_id) values ('Day', 'Draft', $1) returning id`, [project])).id;
    co = (await one('pm', `insert into public.change_orders (title, status, project_id, material_cost) values ('x', 'Draft', $1, 10) returning id`, [project])).id;
    await t.setLapsed(company, true);
  });
  afterAll(() => t.setLapsed(company, false));

  const unchanged = async (who: U, sql: string, params: unknown[]) => {
    const out = await t.as<Row>(who, sql, params).catch((e: Error) => e);
    if (out instanceof Error) expect(out.message).toMatch(/read-only|row-level security|trial|subscription|ended/i);
    else expect(out).toEqual([]);
  };

  it('blocks plain updates and deletes', async () => {
    await unchanged('pm', `update public.timecards set regular_hours = 1 where id = $1 returning id`, [card]);
    await unchanged('owner', `delete from public.timecards where id = $1 returning id`, [card]);
    await unchanged('sparky', `update public.loto_permits set lock_number = 'X' where id = $1 returning id`, [permit]);
    await unchanged('owner', `update public.invoices set status = 'Sent' where id = $1 returning id`, [invoice]);
    await unchanged('owner', `delete from public.invoices where id = $1 returning id`, [invoice]);
    await unchanged('sparky', `update public.daily_logs set title = 'X' where id = $1 returning id`, [log]);
    await unchanged('pm', `delete from public.daily_logs where id = $1 returning id`, [log]);
    await unchanged('pm', `update public.change_orders set title = 'X' where id = $1 returning id`, [co]);
    await unchanged('pm', `update public.projects set contract_value = 1 where id = $1 returning id`, [project]);
  });

  it('blocks every RPC that writes', async () => {
    const before = await sys('select status from public.timecards where id = $1', [card]);
    await t.as('foreman', `select public.decide_timecards($1::uuid[], 'approve')`, [[card]]).catch(() => undefined);
    expect((await sys('select status from public.timecards where id = $1', [card])).status).toBe(before.status);
    expect(await t.fails('sparky', 'select public.sign_safety_record($1, $2, $3, $4, $5)', ['loto-permits', permit, 'lock_on', 'Sam', SIG])).toBeTruthy();
    expect(await t.fails('owner', `select public.reopen_safety_record('loto-permits', $1, 'why')`, [permit])).toBeTruthy();
    expect(await t.fails('owner', `select public.export_timecards('2026-01-01', '2026-12-31')`)).toBeTruthy();
    expect(await t.fails('owner', `select public.save_invoice($1, '{}'::jsonb, '[]'::jsonb)`, [invoice])).toBeTruthy();
  });

  it('still lets people read', async () => {
    expect((await t.as('pm', 'select id from public.timecards where id = $1', [card])).length).toBe(1);
    expect((await t.as('owner', 'select id from public.invoices where id = $1', [invoice])).length).toBe(1);
    expect((await t.as('sparky', 'select id from public.loto_permits where id = $1', [permit])).length).toBe(1);
  });
});

describe('deleting across engines', () => {
  /** A job carrying a locked record from every engine. */
  async function fullJob(title: string, author: U = 'pm') {
    const project = await newProject(title);
    const card = await newCard(project);
    await t.as('foreman', `select public.decide_timecards($1::uuid[], 'approve')`, [[card]]);
    const co = await approvedCo(project, 'pm');
    const invoice = await newInvoice(project);
    await t.as('owner', `update public.invoices set status = 'Sent' where id = $1`, [invoice]);
    const permit = await newPermit(project, author === 'pm' ? 'sparky' : author);
    await signPermit(permit, author === 'pm' ? 'sparky' : author);
    const log = await signedLog(project);
    return { project, card, co, invoice, permit, log };
  }

  it('a job with locked records cannot be deleted out from under them', async () => {
    const job = await fullJob('Refuse delete');
    const out = await t.as<Row>('owner', 'delete from public.projects where id = $1 returning id', [job.project]).catch((e: Error) => e);
    expect(out instanceof Error ? 'refused' : out).toBe('refused');
    // lib/api.ts dbError turns this code into "Other records are still linked to this one"
    expect((out as Error & { code?: string }).code).toBe('23503');
    expect(await sys('select id from public.projects where id = $1', [job.project])).toBeDefined();
    expect((await sys('select project_id from public.loto_permits where id = $1', [job.permit])).project_id).toBe(job.project);
  });

  it('deleting a job with only open paperwork does not leave a dangling link', async () => {
    const project = await newProject('Plain');
    const rfi = await one('pm', `insert into public.rfis (title, status, project_id) values ('Q', 'Open', $1) returning id`, [project]);
    const out = await t.as<Row>('owner', 'delete from public.projects where id = $1 returning id', [project]).catch((e: Error) => e);
    const left = await sys('select project_id from public.rfis where id = $1', [rfi.id]);
    if (out instanceof Error) expect(left.project_id).toBe(project);
    else expect(left.project_id).toBeNull();
  });

  it('deleting a login keeps the locked records it authored, in every engine', async () => {
    // Authored by the person who then loses their login
    const project = (await one('gone', `insert into public.projects (title, status, contract_value) values ('Authored', 'Active', 1000) returning id`)).id as string;
    const card = await newCard(project, 'gone');
    await t.as('owner', `select public.decide_timecards($1::uuid[], 'approve')`, [[card]]);
    const co = await approvedCo(project, 'gone');
    const invoice = (await one('gone', `insert into public.invoices (title, status, project_id, tax_pct, holdback_pct, lines) values ('INV', 'Draft', $1, 5, 10, $2) returning id`, [project, JSON.stringify([{ type: 'free', description: 'x', amount: 10 }])])).id;
    await t.as('gone', `update public.invoices set status = 'Sent' where id = $1`, [invoice]);
    const permit = await newPermit(project, 'gone');
    await signPermit(permit, 'gone');
    const log = await signedLog(project, 'gone');

    await t.asSystem('delete from auth.users where id = $1', [users.gone.id]);

    for (const [table, id] of [['timecards', card], ['change_orders', co], ['invoices', invoice], ['loto_permits', permit], ['daily_logs', log], ['projects', project]]) {
      const row = await sys(`select created_by from public.${table} where id = $1`, [id]);
      expect(row, table).toBeDefined();
      expect(row.created_by, table).toBeNull();
    }
    expect((await sys('select status from public.timecards where id = $1', [card])).status).toBe('Approved');
    expect((await sys('select status from public.loto_permits where id = $1', [permit])).status).toBe('Released');
    expect((await sys('select status from public.invoices where id = $1', [invoice])).status).toBe('Sent');
  });

  it('removing a member keeps their approved time and signed paperwork', async () => {
    const project = await newProject('Member leaves');
    const card = await newCard(project);
    await t.as('foreman', `select public.decide_timecards($1::uuid[], 'approve')`, [[card]]);
    await t.as('owner', 'select public.remove_member($1)', [users.foreman.id]);
    const row = await sys('select status, approved_by, approved_by_name, labour_cost from public.timecards where id = $1', [card]);
    expect(row.status).toBe('Approved');
    expect(row.approved_by_name).toBe('Frank Foreman');
    expect(num(row.labour_cost)).toBeGreaterThan(0);
  });

  it('deleting the whole company takes every locked record with it', async () => {
    const owner2 = { id: '00000000-0000-4000-8000-0000000000f1', email: 'f@f.ca' };
    await t.asSystem('insert into auth.users (id, email) values ($1, $2)', [owner2.id, owner2.email]);
    // A company built directly: the delete has to survive all guards at once, as the service role does it
    await t.asSystem(`insert into public.companies (id, name, province) values ('33333333-3333-4333-8333-333333333333', 'Temp', 'SK')`);
    await t.asSystem(`insert into public.company_users (company_id, user_id, email, role, full_name) values ('33333333-3333-4333-8333-333333333333', $1, $2, 'owner', 'F')`, [owner2.id, owner2.email]);
    await t.pg.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [owner2.id, JSON.stringify({ sub: owner2.id, email: owner2.email })]);
    await t.pg.exec('set role authenticated');
    const q = async (sql: string, params: unknown[] = []) => (await t.pg.query<Row>(sql, params)).rows[0];
    const project = (await q(`insert into public.projects (title, status) values ('P', 'Active') returning id`)).id;
    const card = (await q(`insert into public.timecards (title, status, employee_name, regular_hours, project_id, work_date) values ('J', 'Submitted', 'X', 8, $1, '2026-11-02') returning id`, [project])).id;
    await q(`update public.timecards set status = 'Approved' where id = $1`, [card]);
    const co = (await q(`insert into public.change_orders (title, status, project_id, material_cost, tax_pct) values ('C', 'Sent', $1, 10, 5) returning id`, [project])).id;
    await q(`update public.change_orders set status = 'Approved', approved_by = 'Client', signature = $2 where id = $1`, [co, SIG]);
    const invoice = (await q(`insert into public.invoices (title, status, project_id, tax_pct, holdback_pct, lines) values ('I', 'Draft', $1, 5, 10, $2) returning id`, [project, JSON.stringify([{ type: 'free', description: 'x', amount: 10 }])])).id;
    await q(`update public.invoices set status = 'Sent' where id = $1`, [invoice]);
    const permit = (await q(`insert into public.loto_permits (title, status, equipment_isolated, authorized_person, project_id, lock_number, record_date, isolation_points, energy_sources, verification_method, release_notes) values ('L', 'Draft', 'E', 'F', $1, 'L', '2026-11-02', 'B', '["Electrical"]', 'M', 'C') returning id`, [project])).id;
    for (const slot of ['lock_on', 'verified', 'lock_off']) await q('select public.sign_safety_record($1, $2, $3, $4, $5)', ['loto-permits', permit, slot, 'F', SIG]);
    const log = (await q(`insert into public.daily_logs (title, status, project_id) values ('D', 'Draft', $1) returning id`, [project])).id;
    await q(`update public.daily_logs set status = 'Submitted', signed_at = now(), signed_by = 'F', signature = $2 where id = $1`, [log, SIG]);
    await t.pg.exec('reset role');

    await t.asService(`delete from public.companies where id = '33333333-3333-4333-8333-333333333333'`);
    for (const table of ['projects', 'timecards', 'change_orders', 'invoices', 'receivables', 'loto_permits', 'daily_logs']) {
      expect(await sys(`select count(*)::int as n from public.${table} where company_id = '33333333-3333-4333-8333-333333333333'`), table).toEqual({ n: 0 });
    }
  });
});

describe('the registry and the database agree on what can be read', () => {
  it('every generic select works for a signed-in user, on every module', async () => {
    for (const mod of MODULES) {
      for (const columns of [listColumns(mod), recordColumns(mod)]) {
        await expect(t.as('owner', `select ${columns} from public.${mod.table} limit 1`), mod.slug).resolves.toBeDefined();
      }
    }
  });

  it('marks the pay and contract columns restricted, and they stay out of reach', async () => {
    const restricted = MODULES.flatMap((m) => m.fields.filter((f) => f.restricted).map((f) => `${m.table}.${f.key}`));
    expect(restricted).toEqual(['timecards.hourly_cost', 'timecards.labour_cost', 'projects.contract_value', 'projects.approved_changes', 'projects.revised_contract', 'change_orders.total', 'change_orders.material_cost', 'change_orders.labour_rate', 'change_orders.markup_pct', 'change_orders.price', 'change_orders.tax', 'change_orders.cost_impact', 'change_orders.budget_cost']);
    for (const column of ['hourly_cost', 'labour_cost']) {
      expect(await t.fails('owner', `select ${column} from public.timecards`)).toMatch(/permission denied/);
    }
  });

  it('a timecard saved through the generic columns comes back without pay', async () => {
    const mod = MODULES.find((m) => m.slug === 'timecards')!;
    const [card] = await t.as<Row>('sparky', `insert into public.timecards (title, status, employee_name, regular_hours, work_date) values ('J', 'Submitted', 'Sam', 1, '2025-01-01') returning ${recordColumns(mod)}`);
    expect(card.employee_name).toBe('Sam Sparky');
    expect(card).not.toHaveProperty('hourly_cost');
  });
});
