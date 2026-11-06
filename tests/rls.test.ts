// Runs every migration on an embedded Postgres (PGlite) with a stand-in for
// Supabase's auth and storage, then acts as different users to prove the database
// itself enforces company isolation, roles and subscription gating.
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootDb, type TestDb } from './helpers/db';

const users = {
  ownerA: { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' },
  elecA: { id: '00000000-0000-4000-8000-0000000000a2', email: 'sparky@alpha.ca' },
  pmA: { id: '00000000-0000-4000-8000-0000000000a3', email: 'pm@alpha.ca' },
  ownerB: { id: '00000000-0000-4000-8000-00000000000b', email: 'owner@bravo.ca' },
  stranger: { id: '00000000-0000-4000-8000-00000000000c', email: 'nobody@nowhere.ca' },
};
type U = keyof typeof users;

let db: PGlite;
let as: TestDb<U>['as'];
let fails: TestDb<U>['fails'];
let t: TestDb<U>;

beforeAll(async () => {
  t = await bootDb(users);
  ({ pg: db, as, fails } = t);

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
    expect(await as('stranger', 'select id from public.companies')).toEqual([]);
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
    await as('elecA', `insert into public.timecards (title, status, employee_name, regular_hours) values ('Job 1', 'Submitted', 'Sam', 8)`);
    await as('ownerA', `insert into public.timecards (title, status, employee_name, regular_hours) values ('Job 1', 'Submitted', 'Alex', 8)`);
    expect((await as<{ employee_name: string }>('elecA', 'select employee_name from public.timecards')).map((r) => r.employee_name)).toEqual(['Sam Sparky']); // an electrician's card carries their real name, whatever was typed
    expect((await as('pmA', 'select id from public.timecards')).length).toBe(2);
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

describe('trial email tables', () => {
  it('are hidden from users and visitors', async () => {
    await db.exec(`insert into public.email_unsubscribes (email) values ('owner@alpha.ca')`);
    for (const t of ['trial_emails', 'email_unsubscribes']) {
      expect(await fails('ownerA', `select * from public.${t}`)).toMatch(/permission denied/);
      expect(await fails(null, `select * from public.${t}`)).toMatch(/permission denied/);
    }
    expect(await fails('ownerA', 'delete from public.email_unsubscribes')).toMatch(/permission denied/);
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

describe('company profile and estimate defaults', () => {
  it('owners edit the profile; others cannot', async () => {
    await as('ownerA', `update public.companies set default_markup = 20, default_terms = 'Net 30', phone = '306-555-0100'`);
    await as('pmA', `update public.companies set default_markup = 99`);
    // The markup and labour rate are closed to every signed-in user and come from company_rates
    const [c] = await as<{ phone: string }>('ownerA', 'select phone from public.companies');
    const [{ r: rates }] = await as<{ r: { default_markup: string } }>('ownerA', 'select public.company_rates() as r');
    expect(Number(rates.default_markup)).toBe(20);
    expect(c.phone).toBe('306-555-0100');
    await expect(as('ownerA', `update public.companies set trial_ends_at = now() + interval '10 years'`)).rejects.toThrow(/permission denied/);
  });

  it('new estimates start with the company defaults unless given their own', async () => {
    const [a] = await as<{ markup_percentage: string; tax_percentage: string; terms: string }>('pmA', `insert into public.estimates (title, status) values ('Defaults', 'Draft') returning markup_percentage, tax_percentage, terms`);
    expect(Number(a.markup_percentage)).toBe(20);
    expect(Number(a.tax_percentage)).toBe(5);
    expect(a.terms).toBe('Net 30');
    const [b] = await as<{ markup_percentage: string }>('pmA', `insert into public.estimates (title, status, markup_percentage) values ('Own', 'Draft', 7) returning markup_percentage`);
    expect(Number(b.markup_percentage)).toBe(7);
    expect(await fails('pmA', `insert into public.estimates (title, status, tax_percentage) values ('Bad', 'Draft', 150)`)).toMatch(/check constraint/);
  });
});

describe('estimate line items', () => {
  let estimate: string;
  const items = JSON.stringify([
    { description: 'EMT 3/4', quantity: 100, unit: 'ft', material_unit_cost: 1.25, labour_hours_per_unit: 0.05 },
    { description: 'Panel', quantity: 1, unit: 'ea', material_unit_cost: 900, labour_hours_per_unit: 8 },
  ]);

  beforeAll(async () => {
    [{ id: estimate }] = await as<{ id: string }>('pmA', `insert into public.estimates (title, status) values ('Lines', 'Draft') returning id`);
  });

  it('saves lines and the total together, and replaces them on the next save', async () => {
    await as('pmA', 'select public.save_estimate_items($1, $2::jsonb, $3)', [estimate, items, 1234.567]);
    const rows = await as<{ description: string; sort: number }>('pmA', 'select description, sort from public.estimate_items where estimate_id = $1 order by sort', [estimate]);
    expect(rows).toEqual([{ description: 'EMT 3/4', sort: 0 }, { description: 'Panel', sort: 1 }]);
    // The total sent is ignored: the database works it out from the lines and the company's default rates
    expect(Number((await as<{ total_amount: string }>('pmA', 'select total_amount from public.estimates where id = $1', [estimate]))[0].total_amount)).not.toBe(1234.57);

    await as('pmA', 'select public.save_estimate_items($1, $2::jsonb, $3)', [estimate, JSON.stringify([{ description: 'Only', quantity: 1 }]), 10]);
    expect((await as('pmA', 'select 1 from public.estimate_items where estimate_id = $1', [estimate])).length).toBe(1);
  });

  it('rejects bad lines and leaves the saved ones alone', async () => {
    expect(await fails('pmA', 'select public.save_estimate_items($1, $2::jsonb, 0)', [estimate, JSON.stringify([{ quantity: -1 }])])).toMatch(/check constraint/);
    const tooMany = JSON.stringify(Array.from({ length: 1001 }, () => ({ quantity: 1 })));
    expect(await fails('pmA', 'select public.save_estimate_items($1, $2::jsonb, 0)', [estimate, tooMany])).toMatch(/up to 1000 lines/);
    expect((await as('pmA', 'select 1 from public.estimate_items where estimate_id = $1', [estimate])).length).toBe(1);
  });

  it('other companies and electricians cannot see or change the lines', async () => {
    expect(await as('ownerB', 'select * from public.estimate_items')).toEqual([]);
    expect(await as('elecA', 'select * from public.estimate_items')).toEqual([]);
    expect(await fails('ownerB', 'select public.save_estimate_items($1, $2::jsonb, 0)', [estimate, items])).toMatch(/Estimate not found/);
    expect(await fails('elecA', 'select public.save_estimate_items($1, $2::jsonb, 0)', [estimate, items])).toMatch(/Estimate not found/);
    expect(await fails('ownerB', `insert into public.estimate_items (estimate_id, description) values ($1, 'sneaky')`, [estimate])).toMatch(/row-level security/);
    expect((await as('ownerB', 'delete from public.estimate_items returning id')).length).toBe(0);
    expect((await as('pmA', 'select 1 from public.estimate_items where estimate_id = $1', [estimate])).length).toBe(1);
  });

  it('deleting an estimate deletes its lines', async () => {
    await as('pmA', 'delete from public.estimates where id = $1', [estimate]);
    expect(await as('ownerA', 'select * from public.estimate_items where estimate_id = $1', [estimate])).toEqual([]);
  });
});

describe('daily log photos and sign-off', () => {
  let log: string;
  let company: string;
  const SIG = 'data:image/png;base64,iVBORw0KGgo=';

  beforeAll(async () => {
    [{ id: company }] = await as<{ id: string }>('ownerA', 'select id from public.companies');
    [{ id: log }] = await as<{ id: string }>('elecA', `insert into public.daily_logs (title, status, signed_at, signed_by) values ('Day 2', 'Draft', now(), 'forged') returning id`);
  });

  it('a new log is never created already signed', async () => {
    const [row] = await as<{ signed_at: string | null }>('elecA', 'select signed_at from public.daily_logs where id = $1', [log]);
    expect(row.signed_at).toBeNull();
  });

  it('only accepts photos inside the log’s own folder', async () => {
    const ok = `${company}/daily-logs/${log}/a.jpg`;
    await as('elecA', 'update public.daily_logs set photos = $1::jsonb where id = $2', [JSON.stringify([ok]), log]);
    for (const bad of [`${users.ownerB.id}/daily-logs/${log}/a.jpg`, `${company}/daily-logs/other/a.jpg`, `${company}/daily-logs/${log}/../../x.jpg`]) {
      expect(await fails('elecA', 'update public.daily_logs set photos = $1::jsonb where id = $2', [JSON.stringify([bad]), log])).toMatch(/Invalid photo/);
    }
    expect(await fails('elecA', `update public.daily_logs set photos = '{"a":1}'::jsonb where id = $1`, [log])).toMatch(/up to 50 photos/);
  });

  it('signing needs a name and signature, and locks the log', async () => {
    expect(await fails('elecA', `update public.daily_logs set signed_at = now(), signed_by = 'Sam' where id = $1`, [log])).toMatch(/draw a signature/);
    expect(await fails('elecA', `update public.daily_logs set signed_at = now(), signed_by = 'Sam', signature = 'data:text/html,x' where id = $1`, [log])).toMatch(/check constraint/);
    await as('elecA', `update public.daily_logs set signed_at = '2000-01-01', signed_by = ' Sam ', signature = $1 where id = $2`, [SIG, log]);
    const [row] = await as<{ signed_at: Date; signed_by: string }>('elecA', 'select signed_at, signed_by from public.daily_logs where id = $1', [log]);
    expect(row.signed_by).toBe('Sam');
    expect(new Date(row.signed_at).getFullYear()).toBeGreaterThan(2000);

    expect(await fails('elecA', `update public.daily_logs set title = 'changed' where id = $1`, [log])).toMatch(/signed/);
    expect(await fails('pmA', `update public.daily_logs set signed_by = 'Someone else' where id = $1`, [log])).toMatch(/signed/);
    expect(await fails('pmA', `update public.daily_logs set signed_at = null, signed_by = null, signature = null, title = 'x' where id = $1`, [log])).toMatch(/signed/);
  });

  it('only a foreman or above can reopen, which clears the signature', async () => {
    expect(await fails('elecA', 'update public.daily_logs set signed_at = null, signed_by = null, signature = null where id = $1', [log])).toMatch(/foreman or above/);
    await as('pmA', 'update public.daily_logs set signed_at = null, signed_by = null, signature = null where id = $1', [log]);
    await as('elecA', `update public.daily_logs set title = 'Day 2 (revised)' where id = $1`, [log]);
    expect((await as<{ title: string }>('elecA', 'select title from public.daily_logs where id = $1', [log]))[0].title).toBe('Day 2 (revised)');
  });
});

describe('founding-list leads', () => {
  it('are not readable or writable by app users or visitors', async () => {
    await db.exec(`insert into public.leads (name, company, email) values ('Lee', 'Lead Co', 'lee@lead.ca')`);
    expect(await fails('ownerA', 'select * from public.leads')).toMatch(/permission denied/);
    expect(await fails(null, `insert into public.leads (name, company, email) values ('x', 'y', 'z@z.ca')`)).toMatch(/permission denied/);
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

describe('links between records', () => {
  let projectA: string;
  let projectB: string;
  let clientA: string;
  let clientB: string;
  let poA: string;
  let poB: string;

  beforeAll(async () => {
    [{ id: projectA }] = await as<{ id: string }>('ownerA', `insert into public.projects (title, status) values ('Alpha job', 'Active') returning id`);
    [{ id: projectB }] = await as<{ id: string }>('ownerB', `insert into public.projects (title, status) values ('Bravo job', 'Active') returning id`);
    [{ id: clientA }] = await as<{ id: string }>('ownerA', `insert into public.crm (title, status) values ('Alpha client', 'Lead') returning id`);
    [{ id: clientB }] = await as<{ id: string }>('ownerB', `insert into public.crm (title, status) values ('Bravo client', 'Lead') returning id`);
    [{ id: poA }] = await as<{ id: string }>('ownerA', `insert into public.purchase_orders (title, status) values ('PO A', 'Issued') returning id`);
    [{ id: poB }] = await as<{ id: string }>('ownerB', `insert into public.purchase_orders (title, status) values ('PO B', 'Issued') returning id`);
  });

  it('a record can link to its own company\'s project and client', async () => {
    const [row] = await as<{ project_id: string; client_id: string }>('ownerA', `insert into public.invoices (title, status, project_id, client_id) values ('INV 1', 'Draft', $1, $2) returning project_id, client_id`, [projectA, clientA]);
    expect(row).toEqual({ project_id: projectA, client_id: clientA });
    // An electrician can link field records too, though they can't read the client list
    const [log] = await as<{ project_id: string }>('elecA', `insert into public.field_logs (title, status, project_id) values ('Note', 'Logged', $1) returning project_id`, [projectA]);
    expect(log.project_id).toBe(projectA);
  });

  it('rejects another company\'s project and client on insert', async () => {
    expect(await fails('ownerA', `insert into public.rfis (title, status, project_id) values ('Q', 'Open', $1)`, [projectB])).toMatch(/project you picked could not be found/);
    expect(await fails('ownerA', `insert into public.estimates (title, status, client_id) values ('E', 'Draft', $1)`, [clientB])).toMatch(/client you picked could not be found/);
    expect(await fails('ownerA', `insert into public.payables (title, status, purchase_order_id) values ('Bill', 'To Approve', $1)`, [poB])).toMatch(/purchase order you picked could not be found/);
  });

  it('rejects another company\'s project and client on update', async () => {
    const [{ id }] = await as<{ id: string }>('ownerA', `insert into public.projects (title, status, client_id) values ('Linked', 'Active', $1) returning id`, [clientA]);
    expect(await fails('ownerA', 'update public.projects set client_id = $1 where id = $2', [clientB, id])).toMatch(/client you picked could not be found/);
    const [{ id: rfi }] = await as<{ id: string }>('ownerA', `insert into public.rfis (title, status, project_id) values ('Q2', 'Open', $1) returning id`, [projectA]);
    expect(await fails('ownerA', 'update public.rfis set project_id = $1 where id = $2', [projectB, rfi])).toMatch(/project you picked could not be found/);
    expect((await as<{ project_id: string }>('ownerA', 'select project_id from public.rfis where id = $1', [rfi]))[0].project_id).toBe(projectA);
  });

  it('answers the same for an id that does not exist, so a guess learns nothing', async () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    expect(await fails('ownerA', `insert into public.rfis (title, status, project_id) values ('Q', 'Open', $1)`, [missing])).toMatch(/project you picked could not be found/);
  });

  it('the server\'s service role is held to the same rule', async () => {
    const [{ id: company }] = await as<{ id: string }>('ownerA', 'select id from public.companies');
    await expect(t.asService(`insert into public.rfis (company_id, title, status, project_id) values ($1, 'Q', 'Open', $2)`, [company, projectB])).rejects.toThrow(/could not be found/);
    const [row] = await t.asService<{ project_id: string }>(`insert into public.rfis (company_id, title, status, project_id) values ($1, 'Service', 'Open', $2) returning project_id`, [company, projectA]);
    expect(row.project_id).toBe(projectA);
  });

  it('clearing a link and editing other fields still work', async () => {
    const [{ id }] = await as<{ id: string }>('ownerA', `insert into public.payables (title, status, project_id, purchase_order_id) values ('Bill', 'To Approve', $1, $2) returning id`, [projectA, poA]);
    await as('ownerA', `update public.payables set title = 'Bill 2' where id = $1`, [id]);
    await as('ownerA', 'update public.payables set project_id = null, purchase_order_id = null where id = $1', [id]);
    expect((await as<{ project_id: null }>('ownerA', 'select project_id from public.payables where id = $1', [id]))[0].project_id).toBeNull();
  });

  it('a project or client with linked records cannot be deleted until they move', async () => {
    const [{ id: project }] = await as<{ id: string }>('ownerA', `insert into public.projects (title, status) values ('Delete me', 'Active') returning id`);
    const [{ id: rfi }] = await as<{ id: string }>('ownerA', `insert into public.rfis (title, status, project_id) values ('Q3', 'Open', $1) returning id`, [project]);
    expect(await fails('ownerA', 'delete from public.projects where id = $1', [project])).toMatch(/foreign key/);
    await as('ownerA', 'update public.rfis set project_id = null where id = $1', [rfi]);
    expect((await as('ownerA', 'delete from public.projects where id = $1 returning id', [project])).length).toBe(1);
  });

  it('deleting a whole company removes its linked records with it', async () => {
    await as('stranger', `select public.create_company('Short Lived', 'MB', 'Sid')`);
    const [{ id: company }] = await as<{ id: string }>('stranger', 'select id from public.companies');
    const [{ id: project }] = await as<{ id: string }>('stranger', `insert into public.projects (title, status) values ('Job', 'Active') returning id`);
    await as('stranger', `insert into public.rfis (title, status, project_id) values ('Q', 'Open', $1)`, [project]);
    await t.asService('delete from public.companies where id = $1', [company]);
    expect((await t.asSystem('select 1 from public.rfis where company_id = $1', [company])).length).toBe(0);
    await t.asSystem('delete from public.company_users where user_id = $1', [users.stranger.id]);
  });
});

describe('company settings added by the registry sync', () => {
  it('start at their defaults and the owner can change them', async () => {
    const [c] = await as<{ overtime_multiplier: string; default_holdback_pct: string }>('ownerB', 'select overtime_multiplier, default_holdback_pct from public.companies');
    expect(Number(c.overtime_multiplier)).toBe(1.5);
    expect(Number(c.default_holdback_pct)).toBe(10);
    await as('ownerB', 'update public.companies set overtime_multiplier = 2, default_holdback_pct = 7.5');
    const [d] = await as<{ overtime_multiplier: string }>('ownerB', 'select overtime_multiplier from public.companies');
    expect(Number(d.overtime_multiplier)).toBe(2);
    expect(await fails('ownerB', 'update public.companies set overtime_multiplier = 0.5')).toMatch(/check constraint/);
    expect(await fails('ownerB', 'update public.companies set default_holdback_pct = 101')).toMatch(/check constraint/);
    await as('ownerB', 'update public.companies set overtime_multiplier = 1.5, default_holdback_pct = 10');
  });
});
