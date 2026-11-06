// Adversarial checks on the daily automation. Everything database-side runs on PGlite against
// the real migrations. A test here that fails is a reproduced bug, left failing for the fixer.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BASELINE_FILE, OLD_BASELINE_FIXTURE, bootDb, migrationFiles, readMigration, type TestDb } from './helpers/db';
import { fakeSupabase } from './helpers/fake-supabase';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => null }));

import { AUTOMATION_RULES, companyToday } from '@/lib/alerts';
import { runAutomationJob, sendImmediateAlerts, type Db, type EmailSettings, type SendFn } from '@/lib/automation';
import { subscriptionAllowsWrite } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { PROVINCES, provinceTimeZone } from '@/lib/provinces';
import { parseRecord } from '@/lib/validation';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = (n: number, email: string) => ({ id: uid(n), email });
const USERS = {
  ownerA: person(1, 'owner@alpha.ca'),
  pmA: person(2, 'pm@alpha.ca'),
  foremanA: person(3, 'foreman@alpha.ca'),
  elecA: person(4, 'elec@alpha.ca'),
  ownerB: person(5, 'owner@bravo.ca'),
  ownerL: person(6, 'owner@lapsed.ca'),
  ownerP: person(7, 'owner@poison.ca'),
  elecP: person(8, 'elec@poison.ca'),
  ownerO: person(9, 'owner@order.ca'),
  ownerD: person(10, 'owner@delete.ca'),
  doomed: person(11, 'doomed@delete.ca'),
  ownerS: person(12, 'owner@safety.ca'),
  foremanS: person(13, 'foreman@safety.ca'),
  elecS: person(14, 'elec@safety.ca'),
  ownerK: person(15, 'owner@bound.ca'),
  ownerZ: person(16, 'owner@gone.ca'),
};
type U = keyof typeof USERS;

const SIG = 'data:image/png;base64,AAAA';
const settings: EmailSettings = { config: { apiKey: 'k', from: 'a@b.ca' }, sender: { business: 'B', address: 'A' }, secret: 's', siteUrl: 'https://app.test' };

let t: TestDb<U>;
let A: string, B: string, L: string, P: string, O: string, D: string, S: string, K: string;
let TODAY: string;

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const on = (days: number) => addDays(TODAY, days);

type RunResult = { skipped: boolean; flips: number; raised: number; changed: number; resolved: number };
const run = async (company: string, today = TODAY) => (await t.asService<{ r: RunResult }>('select public.run_company_automation($1, $2) as r', [company, today]))[0].r;

async function put(table: string, company: string, values: Record<string, unknown>, db: TestDb<U> = t): Promise<string> {
  const row: Record<string, unknown> = { company_id: company, ...values };
  const cols = Object.keys(row);
  const [{ id }] = await db.asSystem<{ id: string }>(`insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(row));
  return id;
}
const statusOf = async (table: string, id: string) => (await t.asSystem<{ status: string }>(`select status from public.${table} where id = $1`, [id]))[0]?.status;
const openAlert = async (rule: string, record: string) =>
  (await t.asSystem<{ id: string; bucket: string; message: string; severity: string; emailed_at: string | null; company_id: string }>('select * from public.alerts where rule_key = $1 and record_id = $2 and resolved_at is null', [rule, record]))[0];
const eventsOf = async (company: string) => (await t.asSystem<{ n: number }>('select count(*)::int as n from public.automation_events where company_id = $1', [company]))[0].n;
const receivableOf = async (invoice: string) => (await t.asSystem<{ status: string; due_date: string }>('select status, due_date::text from public.receivables where invoice_id = $1', [invoice]))[0];

/** The owner's invoice through the same path the app uses: a draft with lines, then Sent. */
async function sentInvoice(who: U, due: string, title = 'Invoice'): Promise<string> {
  const lines = JSON.stringify([{ type: 'free', description: 'Work', amount: 1000 }]);
  const [{ id }] = await t.as<{ id: string }>(who, `insert into public.invoices (title, status, due_date, lines) values ($1, 'Draft', $2, $3::jsonb) returning id`, [title, due, lines]);
  await t.as(who, `update public.invoices set status = 'Sent' where id = $1`, [id]);
  return id;
}

beforeAll(async () => {
  t = await bootDb<U>(USERS);
  // PGlite takes the machine's zone. Supabase runs in UTC, which is what these dates must hold up in.
  await t.pg.exec(`set timezone = 'UTC'`);
  TODAY = (await t.asSystem<{ d: string }>('select current_date::text as d'))[0].d;
  A = await t.createCompany('ownerA', 'Alpha');
  B = await t.createCompany('ownerB', 'Bravo');
  L = await t.createCompany('ownerL', 'Lapsed');
  P = await t.createCompany('ownerP', 'Poison');
  O = await t.createCompany('ownerO', 'Order');
  D = await t.createCompany('ownerD', 'Delete');
  S = await t.createCompany('ownerS', 'Safety');
  K = await t.createCompany('ownerK', 'Bound');
  await t.join('ownerA', 'pmA', 'project_manager');
  await t.join('ownerA', 'foremanA', 'foreman');
  await t.join('ownerA', 'elecA', 'electrician');
  await t.join('ownerP', 'elecP', 'electrician');
  await t.join('ownerD', 'doomed', 'foreman');
  await t.join('ownerS', 'foremanS', 'foreman');
  await t.join('ownerS', 'elecS', 'electrician');
}, 120_000);

describe('wrong role and other tenants', () => {
  it('no function this migration adds is callable by anon or a signed-in user, except the four alert calls', async () => {
    const source = readFileSync('supabase/migrations/20261104000210_automation.sql', 'utf8');
    const names = [...new Set([...source.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]))];
    expect(names.length).toBeGreaterThan(10);
    const userCalls = new Set(['list_my_alerts', 'my_alert_summary', 'snooze_alert', 'dismiss_alert']);
    const rows = await t.asSystem<{ proname: string; anon: boolean; authed: boolean }>(
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authed
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)`,
      [names]
    );
    expect(rows.length).toBe(names.length);
    for (const row of rows) {
      expect(`${row.proname} anon ${row.anon}`).toBe(`${row.proname} anon false`);
      expect(`${row.proname} authed ${row.authed}`).toBe(`${row.proname} authed ${userCalls.has(row.proname)}`);
    }
  });

  it('every security definer function here pins an empty search path', async () => {
    const rows = await t.asSystem<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and p.proname = any($1)`,
      [['apply_alert_rule', 'alerts_on_record_change', 'automation_flip', 'automation_status_flips', 'company_is_active', 'run_company_automation', 'automation_housekeeping', 'claim_digest_send', 'release_digest_send']]
    );
    expect(rows).toHaveLength(9);
    for (const r of rows) expect(r.proconfig?.join()).toContain('search_path=""');
  });

  it('the service role can do every read and write the jobs ask of it, with those exact columns', async () => {
    await t.asService(`select id, province, subscription_status, trial_ends_at, name from public.companies limit 1`);
    await t.asService(`select c.id, s.last_run_date from public.companies c left join public.automation_company_state s on s.company_id = c.id limit 1`);
    await t.asService(`select user_id, email, full_name, role, company_id from public.company_users limit 1`);
    await t.asService(`select id, company_id, rule_key, module, record_id, title, message, severity, min_rank, bucket, due_on, bucket_changed_at, resolved_at, immediate, emailed_at, created_at from public.alerts limit 1`);
    await t.asService(`update public.alerts set emailed_at = emailed_at where false`);
    await t.asService(`select alert_id, user_id, snoozed_until, dismissed_bucket from public.alert_member_state limit 1`);
    await t.asService(`select user_id, sent_at from public.digest_sends limit 1`);
    await t.asService(`select email, scope from public.email_unsubscribes limit 1`);
    await t.asService(`insert into public.email_unsubscribes (email, scope) values ('svc@x.ca', 'alerts') on conflict (email, scope) do nothing`);
    await t.asService(`select job, companies_ok, companies_failed, out_of_time, created_at, id, run_date from public.automation_runs limit 1`);
    await t.asService(`insert into public.automation_runs (run_date, job, companies_ok, companies_failed, duration_ms, out_of_time, summary) values ('2027-01-01', 'verify', 0, 0, 0, false, '{}')`);
  });

  it('a user cannot point their own snooze row at another company\'s alert, or an alert above their rank', async () => {
    const theirs = await put('invoices', B, { title: 'Bravo secret', status: 'Sent', due_date: on(-2) });
    const mine = await put('tasks', A, { title: 'Alpha task', status: 'To Do', due_date: on(-2) });
    const hidden = await put('invoices', A, { title: 'Alpha invoice', status: 'Sent', due_date: on(-2) });
    await run(A);
    await run(B);
    const alertB = (await openAlert('invoices.due', theirs)).id;
    const alertTask = (await openAlert('tasks.due', mine)).id;
    const alertInv = (await openAlert('invoices.due', hidden)).id;
    await t.as('elecA', 'select public.dismiss_alert($1)', [alertTask]);
    expect(await t.fails('elecA', 'update public.alert_member_state set alert_id = $1 where alert_id = $2', [alertB, alertTask])).toMatch(/row-level security/);
    expect(await t.fails('elecA', 'update public.alert_member_state set alert_id = $1 where alert_id = $2', [alertInv, alertTask])).toMatch(/row-level security/);
    expect(await t.fails('elecA', `update public.alert_member_state set user_id = $1 where alert_id = $2`, [USERS.ownerA.id, alertTask])).toMatch(/row-level security/);
    expect(await t.fails('ownerB', 'select public.snooze_alert($1, $2)', [alertInv, on(1)])).toMatch(/not found/i);
    expect(await t.as('ownerB', 'select id from public.list_my_alerts($1, 500) where id = $2', [TODAY, alertInv])).toEqual([]);
    expect(await t.as('ownerB', 'select * from public.alert_member_state')).toEqual([]);
  });

  it('a user cannot fake the run marker to make the job skip their company', async () => {
    expect(await t.fails('ownerA', `update public.automation_company_state set last_run_date = '2999-01-01'`)).toMatch(/permission denied/);
    expect(await t.fails('ownerA', `insert into public.automation_company_state (company_id, last_run_date) values ('${A}', '2999-01-01')`)).toMatch(/permission denied/);
  });

  it('a demoted foreman loses the alert at once, and a removed member sees nothing', async () => {
    const id = await put('sub_compliance', A, { title: 'Sub', status: 'Compliant', liability_expiry: on(-2), wcb_clearance_expiry: on(90) });
    await run(A);
    const alert = (await openAlert('sub_compliance.liability', id)).id;
    const sees = async () => (await t.as('foremanA', 'select id from public.alerts where id = $1', [alert])).length;
    expect(await sees()).toBe(1);
    await t.asSystem(`update public.company_users set role = 'electrician' where user_id = $1`, [USERS.foremanA.id]);
    expect(await sees()).toBe(0);
    await t.asSystem(`delete from public.company_users where user_id = $1`, [USERS.foremanA.id]);
    expect(await t.as('foremanA', 'select id from public.list_my_alerts($1, 500)', [TODAY])).toEqual([]);
    const [{ s }] = await t.as<{ s: { total: number } }>('foremanA', 'select public.my_alert_summary($1) as s', [TODAY]);
    expect(s.total).toBe(0);
    await t.asSystem(`insert into public.company_users (company_id, user_id, role, email, full_name) values ($1, $2, 'foreman', $3, 'Back')`, [A, USERS.foremanA.id, USERS.foremanA.email]);
  });

  it('a newer inspection in another company does not silence a follow-up here', async () => {
    const mine = await put('inspections', A, { title: 'Same title', status: 'Failed', inspection_date: on(-10) });
    await put('inspections', B, { title: 'Same title', status: 'Passed', inspection_date: on(-1) });
    await run(A);
    expect(await openAlert('inspections.failed_followup', mine)).toBeTruthy();
  });
});

describe('lapsed subscriptions', () => {
  const STATES: [string, string, boolean][] = [
    ['active', '2000-01-01T00:00:00Z', true],
    ['past_due', '2000-01-01T00:00:00Z', true],
    ['trialing', '2999-01-01T00:00:00Z', true],
    ['trialing', '2000-01-01T00:00:00Z', false],
    ['canceled', '2999-01-01T00:00:00Z', false],
    ['unpaid', '2999-01-01T00:00:00Z', false],
    ['incomplete', '2999-01-01T00:00:00Z', false],
    ['paused', '2999-01-01T00:00:00Z', false],
  ];

  it.each(STATES)('%s with trial end %s agrees in the job, the RPC and the write gate', async (status, ends, expected) => {
    try {
      await t.asSystem('update public.companies set subscription_status = $1, trial_ends_at = $2 where id = $3', [status, ends, L]);
    } catch {
      return; // The schema refuses this status, so it cannot occur
    }
    expect(subscriptionAllowsWrite({ subscription_status: status, trial_ends_at: ends } as never)).toBe(expected);
    expect((await t.asService<{ a: boolean }>('select public.company_is_active($1) as a', [L]))[0].a).toBe(expected);
    expect((await t.as<{ a: boolean }>('ownerL', 'select public.company_can_write() as a'))[0].a).toBe(expected);
    expect((await run(L)).skipped).toBe(!expected);
    await t.setLapsed(L, false);
  });

  it('nothing moves while lapsed, alerts stay readable, a save is refused, and it catches up on reactivation', async () => {
    const invoice = await put('invoices', L, { title: 'Stale', status: 'Sent', due_date: on(-40) });
    await run(L);
    expect(await statusOf('invoices', invoice)).toBe('Overdue');
    const task = await put('tasks', L, { title: 'While lapsed', status: 'To Do', due_date: on(-3) });
    await t.setLapsed(L, true);
    const before = await eventsOf(L);
    expect(await run(L, on(40))).toMatchObject({ skipped: true, flips: 0, raised: 0 });
    expect(await eventsOf(L)).toBe(before);
    expect(await openAlert('tasks.due', task)).toBeUndefined();
    expect(await t.as('ownerL', 'select id from public.alerts where rule_key = $1', ['invoices.due'])).toHaveLength(1);
    await expect(t.as('ownerL', `update public.tasks set status = 'Done' where id = $1`, [task])).resolves.toEqual([]);
    expect(await statusOf('tasks', task)).toBe('To Do');
    await t.setLapsed(L, false);
    await run(L);
    expect(await openAlert('tasks.due', task)).toBeTruthy();
  });
});

describe('double submit', () => {
  it('dismissing or snoozing twice leaves one row', async () => {
    const id = await put('tasks', K, { title: 'Twice', status: 'To Do', due_date: on(-2) });
    await run(K);
    const alert = (await openAlert('tasks.due', id)).id;
    await t.as('ownerK', 'select public.dismiss_alert($1)', [alert]);
    await t.as('ownerK', 'select public.dismiss_alert($1)', [alert]);
    await t.as('ownerK', 'select public.snooze_alert($1, $2)', [alert, on(3)]);
    await t.as('ownerK', 'select public.snooze_alert($1, $2)', [alert, on(3)]);
    expect(await t.asSystem('select count(*)::int as n from public.alert_member_state where alert_id = $1', [alert])).toEqual([{ n: 1 }]);
  });

  it('a third run the same date after flips, buckets and saves is still silent', async () => {
    await put('warranty', K, { title: 'W', status: 'Active', expiry_date: on(-1) });
    await put('sub_compliance', K, { title: 'S', status: 'Compliant', liability_expiry: on(-1), wcb_clearance_expiry: on(5) });
    await put('fleet', K, { title: 'F', status: 'Operational', next_service_date: on(1) });
    await put('site_vault', K, { title: 'V', status: 'Secure', expiry_date: on(-1) });
    await put('equipment_rentals', K, { title: 'R', status: 'On Rent', off_rent_date: on(-20), daily_rate: 33.335 });
    await put('receivables', K, { title: 'Rec', status: 'Current', due_date: on(-65) });
    await sentInvoice('ownerK', on(-95));
    await run(K);
    const events = await eventsOf(K);
    expect(await run(K)).toEqual({ skipped: false, flips: 0, raised: 0, changed: 0, resolved: 0 });
    expect(await run(K)).toEqual({ skipped: false, flips: 0, raised: 0, changed: 0, resolved: 0 });
    expect(await eventsOf(K)).toBe(events);
  });

  it('two sweeps of the safety email racing still send once', async () => {
    const alert = { id: uid(700), company_id: uid(701), rule_key: 'safety_logs.incident', module: 'safety-logs', record_id: uid(702), title: 'Arc', message: 'Critical', severity: 'critical', min_rank: 2, bucket: 'open', due_on: null, bucket_changed_at: new Date().toISOString(), immediate: true, emailed_at: null, resolved_at: null, created_at: new Date().toISOString() };
    const db = fakeSupabase({ alerts: [alert], companies: [{ id: uid(701), name: 'Co' }], company_users: [{ company_id: uid(701), email: 'o@x.ca', role: 'owner' }], email_unsubscribes: [] });
    const sent: string[] = [];
    const send: SendFn = async (e) => (sent.push(e.to), { ok: true });
    await Promise.all([sendImmediateAlerts(db as unknown as Db, settings, send), sendImmediateAlerts(db as unknown as Db, settings, send)]);
    expect(sent).toEqual(['o@x.ca']);
  });
});

describe('bypassing the UI with direct writes', () => {
  // A person with the app's public key can write to these tables without going through the forms.
  // One bad row must not stop the whole company's run: every other alert and flip goes stale with it.
  const POISON: [string, U, string][] = [
    ['an electrician sets a task due date to infinity', 'elecP', `insert into public.tasks (title, status, due_date) values ('Poison', 'To Do', 'infinity') returning id`],
    ['an electrician sets a task due date to -infinity', 'elecP', `insert into public.tasks (title, status, due_date) values ('Poison', 'To Do', '-infinity') returning id`],
    ['an electrician sends an RFI with created_at infinity', 'elecP', `insert into public.rfis (title, status, created_at) values ('Poison', 'Open', 'infinity') returning id`],
    ['the owner writes an infinite warranty expiry', 'ownerP', `insert into public.warranty (title, status, expiry_date) values ('Poison', 'Active', 'infinity') returning id`],
    ['the owner writes an infinite project end date', 'ownerP', `insert into public.projects (title, status, end_date) values ('Poison', 'Active', 'infinity') returning id`],
    ['a far-future date', 'elecP', `insert into public.tasks (title, status, due_date) values ('Poison', 'To Do', '5874897-12-31') returning id`],
    ['a far-past date', 'elecP', `insert into public.tasks (title, status, due_date) values ('Poison', 'To Do', '4713-01-01 BC') returning id`],
    ['an infinite rental rate', 'ownerP', `insert into public.equipment_rentals (title, status, off_rent_date, daily_rate) values ('Poison', 'On Rent', '2000-01-01', 'Infinity') returning id`],
    ['a NaN rental rate', 'ownerP', `insert into public.equipment_rentals (title, status, off_rent_date, daily_rate) values ('Poison', 'On Rent', '2000-01-01', 'NaN') returning id`],
    ['a huge rental rate', 'ownerP', `insert into public.equipment_rentals (title, status, off_rent_date, daily_rate) values ('Poison', 'On Rent', '2000-01-01', 1e30) returning id`],
    ['NaN mileage on a truck', 'ownerP', `insert into public.fleet (title, status, mileage, next_service_km) values ('Poison', 'Operational', 'NaN', 'Infinity') returning id`],
  ];

  it.each(POISON)('%s: the rest of the company still runs', async (_label, who, sql) => {
    let id: string | undefined;
    let table: string;
    try {
      id = (await t.as<{ id: string }>(who, sql))[0].id;
    } catch {
      return; // Refused at the save: nothing gets in, which is also fine
    } finally {
      table = /into public\.(\w+)/.exec(sql)![1];
    }
    const control = await put('tasks', P, { title: 'Control', status: 'To Do', due_date: on(-1) });
    const invoice = await put('invoices', P, { title: 'Control invoice', status: 'Sent', due_date: on(-1) });
    try {
      await run(P);
      expect(await openAlert('tasks.due', control)).toBeTruthy();
      expect(await statusOf('invoices', invoice)).toBe('Overdue');
    } finally {
      await t.asSystem(`delete from public.${table} where id = $1`, [id]);
      await t.asSystem('delete from public.tasks where id = $1', [control]);
      await t.asSystem('delete from public.receivables where invoice_id = $1', [invoice]);
      await t.asSystem('delete from public.invoices where id = $1', [invoice]);
    }
  });

  // Saves refuse these now, so the list above no longer reaches the run. A database that already
  // holds one still has to run, so these put the row in past the triggers.
  const stored = async (table: string, values: Record<string, unknown>) => {
    await t.asSystem(`alter table public.${table} disable trigger user`);
    try {
      return await put(table, P, values);
    } finally {
      await t.asSystem(`alter table public.${table} enable trigger user`);
    }
  };
  const unstore = async (table: string, id: string) => {
    await t.asSystem(`alter table public.${table} disable trigger user`);
    await t.asSystem(`delete from public.${table} where id = $1`, [id]);
    await t.asSystem(`alter table public.${table} enable trigger user`);
  };

  it.each<[string, string, Record<string, unknown>]>([
    ['tasks.due', 'tasks', { status: 'To Do', due_date: 'infinity' }],
    ['tasks.due', 'tasks', { status: 'To Do', due_date: '-infinity' }],
    ['rfis.no_date', 'rfis', { status: 'Open', created_at: 'infinity' }],
    ['inspections.failed_followup', 'inspections', { status: 'Failed', inspection_date: '-infinity' }],
    ['equipment_rentals.off_rent', 'equipment_rentals', { status: 'On Rent', off_rent_date: '-infinity', daily_rate: 10 }],
    ['receivables.overdue', 'receivables', { status: 'Current', due_date: '-infinity' }],
    ['invoices.due', 'invoices', { status: 'Sent', due_date: '-infinity' }],
    ['invoices.due', 'invoices', { status: 'Overdue', due_date: 'infinity' }],
    ['projects.overrun', 'projects', { status: 'Active', revised_end_date: '-infinity' }],
  ])('%s: a stored %s row with an infinite date stops nothing and raises nothing', async (rule, table, values) => {
    const id = await stored(table, { title: 'Stored', ...values });
    const control = await put('tasks', P, { title: 'Control', status: 'To Do', due_date: on(-1) });
    try {
      await run(P);
      expect(await openAlert('tasks.due', control)).toBeTruthy();
      expect(await openAlert(rule, id)).toBeUndefined();
      expect(await statusOf(table, id)).toBe(values.status);
    } finally {
      await unstore(table, id);
      await t.asSystem('delete from public.tasks where id = $1', [control]);
    }
  });

  it('the job can still flip the status of a row holding an infinite date', async () => {
    const id = await stored('warranty', { title: 'Stored', status: 'Active', expiry_date: '-infinity' });
    await run(P);
    expect(await statusOf('warranty', id)).toBe('Expired');
    await unstore('warranty', id);
  });

  it('a person cannot save an infinite date, new or edited, and a real one still saves', async () => {
    expect(await t.fails('elecP', `insert into public.tasks (title, status, due_date) values ('x', 'To Do', 'infinity')`)).toMatch(/real calendar date/);
    const [{ id }] = await t.as<{ id: string }>('elecP', `insert into public.tasks (title, status, due_date) values ('x', 'To Do', $1) returning id`, [on(3)]);
    expect(await t.fails('elecP', `update public.tasks set due_date = '-infinity' where id = $1`, [id])).toMatch(/real calendar date/);
    await t.asSystem('delete from public.tasks where id = $1', [id]);
  });

  it.each([['5874897-12-31', -1], ['4713-01-01 BC', 1]])('a receivable due %s survives a company whose date differs from the server', async (due, shift) => {
    const id = await put('receivables', P, { title: 'Edge', status: 'Current', due_date: due });
    await run(P, on(shift as number));
    await run(P);
    expect(await statusOf('receivables', id)).toBe(shift === -1 ? 'Current' : '90+ Days');
    await t.asSystem('delete from public.receivables where id = $1', [id]);
  });

  it('the time zone in the database matches lib/provinces.ts', async () => {
    for (const code of [...PROVINCES.map((p) => p.code), 'XX']) {
      const [{ z }] = await t.asSystem<{ z: string }>('select public.company_time_zone($1) as z', [code]);
      expect(`${code} ${z}`).toBe(`${code} ${provinceTimeZone(code)}`);
    }
  });

  it('the API refuses an infinite date, so only a direct write reaches the table', () => {
    expect(parseRecord(getModule('tasks')!, { title: 'x', due_date: 'infinity' }, 'create').ok).toBe(false);
  });

  it('the status of stock never lies about a NaN quantity or reorder point', async () => {
    const insert = async (quantity: string, reorder: string | null) => {
      try {
        const [row] = await t.as<{ id: string; status: string }>('ownerK', `insert into public.warehouse_inventory (title, status, quantity, reorder_point) values ('NaN', 'In Stock', $1::numeric, $2::numeric) returning id, status`, [quantity, reorder]);
        return row.status;
      } catch {
        return 'refused';
      }
    };
    expect(await insert('NaN', '5')).not.toBe('In Stock');
    expect(await insert('10', 'NaN')).not.toBe('Low');
  });

  it('a user cannot set Overdue, or age a receivable, by hand', async () => {
    const id = await sentInvoice('ownerK', on(-40), 'By hand');
    expect(await t.fails('ownerK', `update public.invoices set status = 'Overdue' where id = $1`, [id])).toMatch(/worked out/);
    const rec = (await t.asSystem<{ id: string }>('select id from public.receivables where invoice_id = $1', [id]))[0].id;
    expect(await t.fails('ownerK', `update public.receivables set status = 'Collected' where id = $1`, [rec])).toMatch(/follows its invoice/);
    const [manual] = await t.as<{ id: string; status: string }>('ownerK', `insert into public.receivables (title, status, due_date) values ('Manual', 'Current', $1) returning id, status`, [on(-65)]);
    expect(manual.status).toBe('60 Days');
    const [hand] = await t.as<{ status: string }>('ownerK', `update public.receivables set status = 'Current' where id = $1 returning status`, [manual.id]);
    expect(hand.status).toBe('60 Days');
  });
});

describe('boundary values the existing tests skip', () => {
  const invoiceWithHoldback = (date: string, holdback = 100) =>
    put('invoices', K, { title: 'HB', status: 'Sent', lines: JSON.stringify([{ type: 'free', description: 'x', amount: 1000 }]), holdback_amount: holdback, holdback_release_date: date, due_date: on(90) });

  it.each([[8, null], [7, 'd+7'], [1, 'd+7'], [0, 'd0'], [-1, 'd0']])('invoice holdback %i days out is bucket %s', async (days, bucket) => {
    const id = await invoiceWithHoldback(on(days as number));
    await run(K);
    expect((await openAlert('invoices.holdback', id))?.bucket ?? null).toBe(bucket);
  });

  it.each([[8, false], [7, true], [3, true], [2, false]])('blocker %i days out alerts on the early rule: %s', async (days, expected) => {
    const id = await put('punch_list', K, { title: 'Blocker', status: 'Open', priority: 'Critical / Inspection Blocker', due_date: on(days as number) });
    await run(K);
    expect(!!(await openAlert('punch_list.blocker', id))).toBe(expected);
    expect(!!(await openAlert('punch_list.due', id))).toBe(days === 2);
  });

  it.each([
    ['tailgate_logs.sign_off', 'tailgate_logs', 'Needs Sign-off', 1, 2],
    ['loto_permits.open', 'loto_permits', 'Locked Out', 7, 8],
    ['timecards.submitted', 'timecards', 'Submitted', 3, 4],
    ['safety_logs.wcb_reminder', 'safety_logs', 'Open', 0, 1],
    ['rfis.no_date', 'rfis', 'Open', 7, 8],
  ])('%s is quiet one day under its threshold and fires at it', async (rule, table, status, under, at) => {
    const extra: Record<string, unknown> = table === 'safety_logs' ? { incident_type: 'Medical Aid' } : table === 'timecards' ? { employee_name: 'Tess', regular_hours: 8, work_date: on(-(under as number)) } : table === 'loto_permits' ? { equipment_isolated: 'Drive', authorized_person: 'Tess' } : {};
    const stamp = (d: number) => `${on(-d)}T12:00:00Z`;
    const quiet = await put(table as string, K, { title: 'Q', status, created_at: stamp(under as number), ...extra });
    const loud = await put(table as string, K, { title: 'L', status, created_at: stamp(at as number), ...extra });
    await run(K);
    expect(await openAlert(rule as string, quiet)).toBeUndefined();
    expect(await openAlert(rule as string, loud)).toBeTruthy();
  });

  it('inspection follow-up is quiet at 6 days and fires at 7', async () => {
    const quiet = await put('inspections', K, { title: 'Q', status: 'Failed', inspection_date: on(-6) });
    const loud = await put('inspections', K, { title: 'L', status: 'Re-inspect', inspection_date: on(-7) });
    await run(K);
    expect(await openAlert('inspections.failed_followup', quiet)).toBeUndefined();
    expect(await openAlert('inspections.failed_followup', loud)).toBeTruthy();
  });

  it('ages a receivable correctly across a leap day and a year end', async () => {
    const a = await put('receivables', K, { title: 'Leap', status: 'Current', due_date: '2028-01-30' });
    const b = await put('receivables', K, { title: 'Year', status: 'Current', due_date: '2027-12-02' });
    await run(K, '2028-02-29'); // 30 days after Jan 30 in a leap year, 89 after Dec 2
    expect(await statusOf('receivables', a)).toBe('30 Days');
    expect(await statusOf('receivables', b)).toBe('60 Days');
    await run(K, '2028-02-28');
    expect(await statusOf('receivables', a)).toBe('Current');
    await run(K);
  });

  it('low stock at fractional and negative boundaries', async () => {
    const status = async (q: number, r: number | null) => (await t.as<{ status: string }>('ownerK', `insert into public.warehouse_inventory (title, status, quantity, reorder_point) values ('x', 'In Stock', $1, $2) returning status`, [q, r]))[0].status;
    expect(await status(5.0001, 5)).toBe('In Stock');
    expect(await status(4.9999, 5)).toBe('Low');
    expect(await status(0.0001, null)).toBe('In Stock');
    expect(await status(-0.0001, null)).toBe('Out of Stock');
    expect(await status(0, -5)).toBe('Out of Stock');
    expect(await status(3, -5)).toBe('In Stock');
  });

  it('accrued rental money rounds to the cent', async () => {
    const id = await put('equipment_rentals', K, { title: 'Lift', status: 'On Rent', off_rent_date: on(-3), daily_rate: 33.335 });
    await run(K);
    // daily_rate is numeric(14,2), so 33.335 is stored as 33.34 before it is multiplied
    expect((await openAlert('equipment_rentals.off_rent', id)).message).toBe('Past its off-rent date by 3 days. Accrued since then: $100.02.');
    await t.asSystem('update public.equipment_rentals set daily_rate = 0 where id = $1', [id]);
    await run(K);
    expect((await openAlert('equipment_rentals.off_rent', id)).message).toContain('$0.00');
  });

  it('companyToday survives an old company with no province or a typed-out one', () => {
    const when = new Date('2027-03-16T03:00:00Z');
    expect(companyToday(null as unknown as string, when)).toBe('2027-03-15');
    expect(companyToday('Saskatchewan', when)).toBe('2027-03-15');
  });

  // The audit's "not X" rules were written as allow-lists, which go stale if a status is added
  it.each([
    ['tasks.due', ['Done']],
    ['punch_list.due', ['Closed']],
    ['loto_permits.open', ['Released']],
    ['vendors.insurance', ['On Hold']],
    ['receivables.overdue', ['Collected']],
  ])('%s watches every status except the ones the audit excludes', (key, excluded) => {
    const rule = AUTOMATION_RULES.find((r) => r.key === key)!;
    expect([...rule.statuses!].sort()).toEqual(getModule(rule.module)!.statuses.filter((s) => !(excluded as string[]).includes(s)).sort());
  });

  // Age counts from the company's own date. 01:00 UTC on the 8th is the evening of the 7th in Regina.
  it('an evening incident in Regina reaches "older than 7 days" on the local date, not the UTC one', async () => {
    const id = await put('safety_logs', K, { title: 'Evening', status: 'Open', severity: 'Low', incident_type: 'Near Miss', created_at: `${on(-7)}T01:00:00Z` });
    await run(K);
    expect(await openAlert('safety_logs.open', id)).toBeTruthy();
  });
});

describe('out-of-order status changes', () => {
  it('Sent > Overdue > Paid > Sent > Overdue > Draft > Sent > Void: never fights billing, and alerts follow', async () => {
    const id = await sentInvoice('ownerO', on(-35));
    await run(O);
    expect(await statusOf('invoices', id)).toBe('Overdue');
    expect((await receivableOf(id)).status).toBe('30 Days');
    expect((await openAlert('invoices.due', id)).bucket).toBe('d-30');

    await t.as('ownerO', `update public.invoices set status = 'Paid' where id = $1`, [id]);
    expect((await receivableOf(id)).status).toBe('Collected');
    expect(await openAlert('invoices.due', id)).toBeUndefined();
    await run(O);
    expect(await statusOf('invoices', id)).toBe('Paid');

    await t.as('ownerO', `update public.invoices set status = 'Sent' where id = $1`, [id]);
    expect((await t.asSystem<{ paid_at: string | null }>('select paid_at from public.invoices where id = $1', [id]))[0].paid_at).toBeNull();
    await run(O);
    expect(await statusOf('invoices', id)).toBe('Overdue');
    expect((await receivableOf(id)).status).toBe('30 Days');

    await t.as('ownerO', `update public.invoices set status = 'Draft' where id = $1`, [id]);
    expect(await receivableOf(id)).toBeUndefined();
    await run(O);
    expect(await statusOf('invoices', id)).toBe('Draft');
    expect(await openAlert('invoices.due', id)).toBeUndefined();

    await t.as('ownerO', `update public.invoices set due_date = $1 where id = $2`, [on(10), id]);
    await t.as('ownerO', `update public.invoices set status = 'Sent' where id = $1`, [id]);
    await run(O);
    expect(await statusOf('invoices', id)).toBe('Sent');
    expect((await receivableOf(id)).status).toBe('Current');

    await t.as('ownerO', `update public.invoices set status = 'Void' where id = $1`, [id]);
    expect(await receivableOf(id)).toBeUndefined();
    await run(O, on(60));
    expect(await statusOf('invoices', id)).toBe('Void');
    expect(await receivableOf(id)).toBeUndefined();
    await run(O);
  });

  it('a person setting Overdue back to Sent is corrected once, and the job does not change the locked fields', async () => {
    const id = await sentInvoice('ownerO', on(-5), 'Hand back');
    await run(O);
    const before = (await t.asSystem<{ amount: string; total: string; invoice_number: string }>('select amount, total, invoice_number from public.invoices where id = $1', [id]))[0];
    await t.as('ownerO', `update public.invoices set status = 'Sent' where id = $1`, [id]);
    expect(await run(O)).toMatchObject({ flips: 1 });
    expect(await statusOf('invoices', id)).toBe('Overdue');
    expect(await run(O)).toMatchObject({ flips: 0 });
    expect((await t.asSystem('select amount, total, invoice_number from public.invoices where id = $1', [id]))[0]).toEqual(before);
    // A write billing still allows on an Overdue invoice doesn't knock it off Overdue
    await t.as('ownerO', `update public.invoices set holdback_release_date = $1 where id = $2`, [on(30), id]);
    expect(await statusOf('invoices', id)).toBe('Overdue');
  });

  it('a date run out of order is corrected by the next run, for invoices and receivables alike', async () => {
    const id = await sentInvoice('ownerO', on(-70), 'Backwards');
    await run(O);
    expect((await receivableOf(id)).status).toBe('60 Days');
    await run(O, on(-71));
    expect(await statusOf('invoices', id)).toBe('Sent');
    expect((await receivableOf(id)).status).toBe('Current');
    await run(O);
    expect(await statusOf('invoices', id)).toBe('Overdue');
    expect((await receivableOf(id)).status).toBe('60 Days');
    expect(await run(O)).toMatchObject({ flips: 0, raised: 0, changed: 0, resolved: 0 });
  });

  it('the bucket moves backward too, without losing the alert row', async () => {
    const id = await put('tasks', O, { title: 'Moved', status: 'To Do', due_date: on(-1) });
    await run(O);
    const first = (await openAlert('tasks.due', id)).id;
    await t.asSystem('update public.tasks set due_date = $1 where id = $2', [on(0), id]);
    await run(O);
    const alert = await openAlert('tasks.due', id);
    expect(alert.id).toBe(first);
    expect(alert.bucket).toBe('d0');
  });

  it('an incident closed and reopened keeps one alert and does not email twice', async () => {
    const [{ id }] = await t.as<{ id: string }>('ownerO', `insert into public.safety_logs (title, status, severity) values ('Arc', 'Open', 'Critical') returning id`);
    await t.asSystem('update public.alerts set emailed_at = now() where record_id = $1', [id]);
    await t.as('ownerO', `update public.safety_logs set status = 'Resolved' where id = $1`, [id]);
    expect(await openAlert('safety_logs.incident', id)).toBeUndefined();
    await t.as('ownerO', `update public.safety_logs set status = 'Open' where id = $1`, [id]);
    const alert = await openAlert('safety_logs.incident', id);
    expect(alert.emailed_at).not.toBeNull();
    expect(await t.asSystem('select id from public.alerts where record_id = $1 and rule_key = $2', [id, 'safety_logs.incident'])).toHaveLength(1);
  });
});

describe('deleting referenced records', () => {
  it('deleting a record clears its alert and everyone\'s snooze, and a run stays clean', async () => {
    const id = await put('employees', D, { title: 'Tessa', status: 'Active', ticket_expiry: on(-2) });
    await run(D);
    const alert = (await openAlert('employees.ticket', id)).id;
    await t.as('ownerD', 'select public.snooze_alert($1, $2)', [alert, on(5)]);
    await t.as('ownerD', 'delete from public.employees where id = $1', [id]);
    expect(await openAlert('employees.ticket', id)).toBeUndefined();
    expect(await t.asSystem('select * from public.alert_member_state where alert_id = $1', [alert])).toEqual([]);
    expect(await run(D)).toMatchObject({ raised: 0, resolved: 0 });
  });

  it('deleting a project with records on it is refused cleanly, and clears once it can go', async () => {
    const project = await put('projects', D, { title: 'Job', status: 'Active', end_date: on(-5) });
    const inspection = await put('inspections', D, { title: 'Rough', status: 'Failed', project_id: project, inspection_date: on(-10) });
    await run(D);
    expect(await openAlert('projects.overrun', project)).toBeTruthy();
    // Records on a project hold it in place, so its alert must survive the refused delete
    await expect(t.as('ownerD', 'delete from public.projects where id = $1', [project])).rejects.toThrow(/foreign key/);
    expect(await openAlert('projects.overrun', project)).toBeTruthy();
    await t.asSystem('delete from public.inspections where id = $1', [inspection]);
    expect(await openAlert('inspections.failed_followup', inspection)).toBeUndefined();
    await t.as('ownerD', 'delete from public.projects where id = $1', [project]);
    expect(await openAlert('projects.overrun', project)).toBeUndefined();
    await run(D);
  });

  it('deleting a draft invoice and a draw hands holdback alerts over correctly', async () => {
    const lines = JSON.stringify([{ type: 'free', description: 'x', amount: 1000 }]);
    const invoice = await put('invoices', D, { title: 'I', status: 'Sent', lines, holdback_amount: 100, holdback_release_date: on(3) });
    const draw = await put('progress_billing', D, { title: 'D', status: 'Invoiced', invoice_id: invoice, holdback_release_date: on(3) });
    await run(D);
    expect(await openAlert('invoices.holdback', invoice)).toBeUndefined();
    expect(await openAlert('progress_billing.holdback', draw)).toBeTruthy();
    await t.asSystem('delete from public.progress_billing where id = $1', [draw]);
    expect(await openAlert('progress_billing.holdback', draw)).toBeUndefined();
    await run(D);
    expect(await openAlert('invoices.holdback', invoice)).toBeTruthy();
  });

  it('a draw holding no holdback raises no holdback alert, same as an invoice with none', async () => {
    const draw = await put('progress_billing', D, { title: 'None held', status: 'Draft', holdback_percent: 0, holdback_release_date: on(3) });
    await run(D);
    expect(await openAlert('progress_billing.holdback', draw)).toBeUndefined();
  });

  it('a draw holding no holdback does not silence the holdback alert on its invoice', async () => {
    const lines = JSON.stringify([{ type: 'free', description: 'x', amount: 1000 }]);
    const invoice = await put('invoices', D, { title: 'I', status: 'Sent', lines, holdback_amount: 100, holdback_release_date: on(3) });
    const draw = await put('progress_billing', D, { title: 'D', status: 'Invoiced', invoice_id: invoice, holdback_percent: 0, holdback_release_date: on(3) });
    await run(D);
    expect(await openAlert('progress_billing.holdback', draw)).toBeUndefined();
    expect(await openAlert('invoices.holdback', invoice)).toBeTruthy();
  });

  it('a person leaving takes their snooze and digest rows with them', async () => {
    const id = await put('sub_compliance', D, { title: 'Sub', status: 'Compliant', liability_expiry: on(-2), wcb_clearance_expiry: on(90) });
    await run(D);
    const alert = (await openAlert('sub_compliance.liability', id)).id;
    await t.as('doomed', 'select public.dismiss_alert($1)', [alert]);
    await t.asService('select public.claim_digest_send($1, $2, $3)', [D, USERS.doomed.id, TODAY]);
    await t.asSystem('delete from auth.users where id = $1', [USERS.doomed.id]);
    expect(await t.asSystem('select * from public.alert_member_state where user_id = $1', [USERS.doomed.id])).toEqual([]);
    expect(await t.asSystem('select * from public.digest_sends where user_id = $1', [USERS.doomed.id])).toEqual([]);
    expect((await run(D)).skipped).toBe(false);
  });

  it('deleting a whole company with alerts, events and runs goes through', async () => {
    const Z = await t.createCompany('ownerZ', 'Gone');
    await put('tasks', Z, { title: 'T', status: 'To Do', due_date: on(-2) });
    await put('invoices', Z, { title: 'I', status: 'Sent', due_date: on(-40) });
    await put('safety_logs', Z, { title: 'S', status: 'Open', severity: 'Critical' });
    await run(Z);
    await t.asSystem('delete from public.companies where id = $1', [Z]);
    for (const table of ['alerts', 'automation_events', 'automation_company_state', 'receivables']) {
      expect(await t.asSystem(`select 1 from public.${table} where company_id = $1`, [Z])).toEqual([]);
    }
  });
});

describe('finished guards', () => {
  it('timecards: approving clears the alert, unapproving brings it back at the next run, and pay stays hidden', async () => {
    const id = await put('timecards', S, { title: 'Card', status: 'Submitted', employee_name: 'Tess', regular_hours: 8, work_date: on(-5), created_at: `${on(-5)}T12:00:00Z` });
    await run(S);
    const alert = await openAlert('timecards.submitted', id);
    expect(alert).toBeTruthy();
    expect(JSON.stringify(alert)).not.toMatch(/hourly_cost|overtime_multiplier/);
    await t.as('ownerS', `select public.decide_timecards($1, 'approve')`, [[id]]);
    expect(await statusOf('timecards', id)).toBe('Approved');
    expect(await openAlert('timecards.submitted', id)).toBeUndefined();
    const stamp = async () => (await t.asSystem<{ u: string; c: string | null }>('select updated_at::text as u, hourly_cost::text as c from public.timecards where id = $1', [id]))[0];
    const before = await stamp();
    await run(S);
    expect(await stamp()).toEqual(before);
    expect(await t.fails('foremanS', 'select hourly_cost from public.timecards where id = $1', [id])).toMatch(/permission denied/);
    await t.as('ownerS', `select public.decide_timecards($1, 'unapprove')`, [[id]]);
    await run(S);
    expect(await openAlert('timecards.submitted', id)).toBeTruthy();
    await t.as('ownerS', `select public.decide_timecards($1, 'reject', 'Wrong hours')`, [[id]]);
    expect(await openAlert('timecards.submitted', id)).toBeUndefined();
  });

  const lotoSQL = `insert into public.loto_permits (title, status, equipment_isolated, authorized_person, lock_number, record_date, isolation_points, energy_sources, verification_method, release_notes)
    values ('Conveyor', 'Draft', 'Drive', 'Tessa', 'L-1', '2026-11-04', 'Breaker 7', '["Electrical"]', 'Meter', 'Clear') returning id`;

  it('LOTO: signing out clears the alert, the run leaves a locked record alone, and reopening brings it back', async () => {
    const [{ id }] = await t.as<{ id: string }>('elecS', lotoSQL);
    await t.asSystem('alter table public.loto_permits disable trigger user');
    await t.asSystem(`update public.loto_permits set created_at = now() - interval '9 days' where id = $1`, [id]);
    await t.asSystem('alter table public.loto_permits enable trigger user');
    await run(S);
    expect(await openAlert('loto_permits.open', id)).toBeTruthy();
    const sign = (slot: string) => t.as('elecS', 'select public.sign_safety_record($1, $2, $3, $4, $5)', ['loto-permits', id, slot, 'Tessa', SIG]);
    await sign('lock_on');
    expect(await openAlert('loto_permits.open', id)).toBeTruthy();
    await sign('verified');
    await sign('lock_off');
    expect(await statusOf('loto_permits', id)).toBe('Released');
    expect(await openAlert('loto_permits.open', id)).toBeUndefined();
    const stamp = async () => (await t.asSystem<{ u: string }>('select updated_at::text as u from public.loto_permits where id = $1', [id]))[0].u;
    const before = await stamp();
    await run(S);
    expect(await stamp()).toBe(before);
    expect(await openAlert('loto_permits.open', id)).toBeUndefined();
    await t.as('ownerS', 'select public.reopen_safety_record($1, $2, $3)', ['loto-permits', id, 'Wrong breaker']);
    await run(S);
    expect(await openAlert('loto_permits.open', id)).toBeTruthy();
  });

  it('an unsafe walk raises once, and running again adds no second alert', async () => {
    const [{ id }] = await t.as<{ id: string }>('foremanS', `insert into public.safety_inspections (title, status, result) values ('Walk', 'Draft', 'Unsafe: Work Stopped') returning id`);
    const alert = await openAlert('safety_inspections.unsafe', id);
    expect(alert.severity).toBe('critical');
    await run(S);
    await run(S);
    expect(await t.asSystem('select id from public.alerts where record_id = $1', [id])).toHaveLength(1);
  });

  // Audit: "safety_logs with severity High/Critical or type Medical Aid/Lost Time ... should alert when created."
  it.each(['Critical severity', 'Lost Time', 'Medical Aid'])('%s logged after the fact as Resolved still alerts the people who must know', async (kind) => {
    const severity = kind === 'Critical severity' ? 'Critical' : 'Low';
    const type = kind === 'Critical severity' ? 'Near Miss' : kind;
    const [{ id }] = await t.as<{ id: string }>('elecS', `insert into public.safety_logs (title, status, severity, incident_type) values ('After the fact', 'Resolved', $1, $2) returning id`, [severity, type]);
    expect(await t.asSystem('select id from public.alerts where record_id = $1 and rule_key = $2', [id, 'safety_logs.incident'])).toHaveLength(1);
  });

  it('a medical aid incident resolved within the day still gets its WCB reminder', async () => {
    const id = await put('safety_logs', S, { title: 'Hand', status: 'Resolved', severity: 'Low', incident_type: 'Medical Aid', created_at: `${on(-1)}T12:00:00Z` });
    await run(S);
    expect(await openAlert('safety_logs.wcb_reminder', id)).toBeTruthy();
  });

  it('an incident logged as Resolved says so, is owed its email, and clears on its first edit', async () => {
    const [{ id }] = await t.as<{ id: string }>('elecS', `insert into public.safety_logs (title, status, severity, incident_type) values ('Logged late', 'Resolved', 'Low', 'Lost Time') returning id`);
    const alert = await openAlert('safety_logs.incident', id);
    expect(alert.message).toContain('Logged as already resolved.');
    expect(alert).toMatchObject({ emailed_at: null, no_email_reason: null });
    await run(S);
    expect(await openAlert('safety_logs.incident', id)).toBeTruthy();
    // Counted from the day it was logged in the company's zone. TODAY is the database's UTC date,
    // which is already tomorrow for a Saskatchewan company during its evening.
    const [{ logged }] = await t.asSystem<{ logged: string }>(
      `select public.alert_local_date(s.created_at, public.company_time_zone(c.province))::text as logged
       from public.safety_logs s join public.companies c on c.id = s.company_id where s.id = $1`, [id]);
    await run(S, addDays(logged, 7));
    expect(await openAlert('safety_logs.incident', id)).toBeTruthy();
    await run(S, addDays(logged, 8));
    expect(await openAlert('safety_logs.incident', id)).toBeUndefined();
    await run(S);
    expect(await openAlert('safety_logs.incident', id)).toBeTruthy();
    await t.as('ownerS', `update public.safety_logs set notes = 'Reviewed' where id = $1`, [id]);
    expect(await openAlert('safety_logs.incident', id)).toBeUndefined();
  });

  it('a resolved incident keeps its WCB reminder for its first week, and an open one until it closes', async () => {
    const resolved = await put('safety_logs', S, { title: 'Closed', status: 'Resolved', severity: 'Low', incident_type: 'Lost Time', created_at: `${on(-7)}T12:00:00Z` });
    const old = await put('safety_logs', S, { title: 'Closed long ago', status: 'Resolved', severity: 'Low', incident_type: 'Lost Time', created_at: `${on(-8)}T12:00:00Z` });
    const open = await put('safety_logs', S, { title: 'Still open', status: 'Open', severity: 'Low', incident_type: 'Lost Time', created_at: `${on(-30)}T12:00:00Z` });
    await run(S);
    expect(await openAlert('safety_logs.wcb_reminder', resolved)).toBeTruthy();
    expect(await openAlert('safety_logs.wcb_reminder', old)).toBeUndefined();
    expect(await openAlert('safety_logs.wcb_reminder', open)).toBeTruthy();
  });

  it('only the daily run finding an already old record skips the safety email, never a save', async () => {
    await t.asSystem('alter table public.safety_logs disable trigger user');
    const found = (title: string, days: number) => put('safety_logs', S, { title, status: 'Open', severity: 'Critical', incident_type: 'Near Miss', created_at: `${on(-days)}T12:00:00Z` });
    const old = await found('Found old', 8);
    const recent = await found('Found recent', 7);
    await t.asSystem('alter table public.safety_logs enable trigger user');
    await run(S);
    expect((await openAlert('safety_logs.incident', old))).toMatchObject({ no_email_reason: 'old_record' });
    expect((await openAlert('safety_logs.incident', recent))).toMatchObject({ no_email_reason: null });

    const escalated = await put('safety_logs', S, { title: 'Grew', status: 'Open', severity: 'Low', incident_type: 'Near Miss', created_at: '2024-11-01T12:00:00Z' });
    await t.as('ownerS', `update public.safety_logs set severity = 'Critical' where id = $1`, [escalated]);
    expect(await openAlert('safety_logs.incident', escalated)).toMatchObject({ no_email_reason: null });
  });

  it('the job never writes a job-cost status or a closed job', async () => {
    const job = await put('job_costing', S, { title: 'Job', status: 'Closed' });
    await run(S);
    expect(await statusOf('job_costing', job)).toBe('Closed');
    expect(await t.asSystem(`select * from public.automation_events where table_name = 'job_costing'`)).toEqual([]);
  });
});

describe('the job against a real database', () => {
  // Same queries as runAutomationJob, answered from PGlite, so a real failure takes the real path
  const liveDb = (): Db => ({
    from: () => {
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        gt: () => chain,
        insert: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          t.asSystem(`select c.id, c.province, c.subscription_status, c.trial_ends_at, (select to_jsonb(s) from public.automation_company_state s where s.company_id = c.id) as automation_company_state from public.companies c where c.id = any($1) order by c.id`, [[P, K]]).then((data) => resolve({ data, error: null })),
      };
      return chain;
    },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name !== 'run_company_automation') return { data: {}, error: null };
      try {
        const rows = await t.asService<{ r: unknown }>('select public.run_company_automation($1, $2) as r', [args!.p_company, args!.p_today]);
        return { data: rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  });

  it('a second pass the same day skips who already ran', async () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runAutomationJob(liveDb());
      const summary = await runAutomationJob(liveDb());
      expect(summary.alreadyRun).toBe(2);
      expect(summary.failed).toBe(0);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('upgrading a database with old rows', () => {
  type V = 'owner';
  let up: TestDb<V>;
  let company: string;
  const ids: Record<string, string> = {};

  const seed = async (key: string, table: string, values: Record<string, unknown>) => {
    ids[key] = await put(table, company, values, up as unknown as TestDb<U>);
  };

  beforeAll(async () => {
    const before = (f: string) => f === BASELINE_FILE || f === '20261101000100_job_photos_storage.sql' || f === '20261101000200_trial_emails.sql';
    up = await bootDb<V>({ owner: person(50, 'owner@old.ca') }, { baselineSql: readFileSync(OLD_BASELINE_FIXTURE, 'utf8'), include: before });
    await up.pg.exec(`set timezone = 'UTC'`);
    company = await up.createCompany('owner', 'Old Co');
    await up.asSystem(`insert into public.email_unsubscribes (email) values ('old@list.ca')`);

    const twoYears = '2024-11-01T12:00:00Z';
    await seed('lowStock', 'warehouse_inventory', { title: 'Old empty', status: 'In Stock', quantity: 0 });
    await seed('noQty', 'warehouse_inventory', { title: 'Old no qty', status: 'Low' });
    await seed('handOverdue', 'invoices', { title: 'Hand overdue, future', status: 'Overdue', due_date: on(20), amount: 100 });
    await seed('noDue', 'invoices', { title: 'Overdue, no date', status: 'Overdue', amount: 100 });
    await seed('paid', 'invoices', { title: 'Old paid', status: 'Paid', due_date: on(-400), amount: 100 });
    await seed('recHand', 'receivables', { title: 'Hand receivable', status: 'Current', due_date: on(-95), amount: 50 });
    await seed('recNoDate', 'receivables', { title: 'No date', status: '60 Days', amount: 50 });
    await seed('warranty', 'warranty', { title: 'Old warranty', status: 'Active', expiry_date: on(-400) });
    await seed('oldIncident', 'safety_logs', { title: 'Two years ago', status: 'Open', severity: 'Critical', created_at: twoYears, updated_at: twoYears });
    await seed('oldFailed', 'inspections', { title: 'Failed long ago', status: 'Failed', inspection_date: '2024-10-01', created_at: twoYears, updated_at: twoYears });
    await seed('task', 'tasks', { title: 'Old task', status: 'To Do', due_date: on(-3) });
    await seed('infiniteTask', 'tasks', { title: 'Infinite task', status: 'To Do', due_date: 'infinity' });
    await seed('nanStock', 'warehouse_inventory', { title: 'NaN stock', status: 'In Stock', quantity: 'NaN' });

    for (const f of migrationFiles()) if (!before(f)) await up.pg.exec(readMigration(f));
  }, 180_000);

  const upRun = async () => (await up.asService<{ r: RunResult }>('select public.run_company_automation($1, $2) as r', [company, TODAY]))[0].r;
  const upStatus = async (table: string, id: string) => (await up.asSystem<{ status: string }>(`select status from public.${table} where id = $1`, [id]))[0]?.status;

  it('the migration fixes stock statuses, and the first run settles old rows without touching what it must not', async () => {
    expect(await upStatus('warehouse_inventory', ids.lowStock)).toBe('Out of Stock');
    expect(await upStatus('warehouse_inventory', ids.noQty)).toBe('Low');
    await upRun();
    expect(await upStatus('invoices', ids.handOverdue)).toBe('Sent');
    expect(await upStatus('invoices', ids.noDue)).toBe('Sent');
    expect(await upStatus('invoices', ids.paid)).toBe('Paid');
    expect(await upStatus('receivables', ids.recHand)).toBe('90+ Days');
    expect(await upStatus('receivables', ids.recNoDate)).toBe('60 Days');
    expect(await upStatus('warranty', ids.warranty)).toBe('Expired');
    expect(await upRun()).toEqual({ skipped: false, flips: 0, raised: 0, changed: 0, resolved: 0 });
  });

  it('an old NaN stock row is cleared rather than stopping the upgrade, and an old infinite date stops no run', async () => {
    expect(await up.asSystem('select quantity::text as q from public.warehouse_inventory where id = $1', [ids.nanStock])).toEqual([{ q: null }]);
    await upRun();
    expect(await up.asSystem('select id from public.alerts where record_id = $1', [ids.infiniteTask])).toEqual([]);
    expect(await up.asSystem('select id from public.alerts where record_id = $1', [ids.task])).toHaveLength(1);
  });

  it('the old list stays marketing, and alerts can be added beside it', async () => {
    expect(await up.asSystem(`select scope from public.email_unsubscribes where email = 'old@list.ca'`)).toEqual([{ scope: 'marketing' }]);
    await up.asSystem(`insert into public.email_unsubscribes (email, scope) values ('old@list.ca', 'alerts')`);
    expect(await up.asSystem(`select count(*)::int as n from public.email_unsubscribes where email = 'old@list.ca'`)).toEqual([{ n: 2 }]);
  });

  it('running the migration a second time changes nothing and adds no alerts', async () => {
    const count = async () => (await up.asSystem<{ a: number; e: number; u: number; r: number }>(`select (select count(*)::int from public.alerts) a, (select count(*)::int from public.automation_events) e, (select count(*)::int from public.email_unsubscribes) u, (select count(*)::int from public.automation_rules) r`))[0];
    const before = await count();
    await up.pg.exec(readMigration('20261104000210_automation.sql'));
    expect(await count()).toEqual(before);
    expect(await upRun()).toEqual({ skipped: false, flips: 0, raised: 0, changed: 0, resolved: 0 });
  });

  // lib/automation.ts: "Old ones stay in the app. A company turning email on shouldn't get a backlog."
  it('a two-year-old incident and inspection show in the app, but go out as no "immediate" email on upgrade', async () => {
    const rows = await up.asSystem<{ j: Record<string, unknown> }>(`select to_jsonb(a) as j from public.alerts a where a.company_id = $1 and a.immediate`, [company]);
    const alerts = rows.map((r) => r.j);
    expect(alerts.map((a) => a.record_id)).toEqual(expect.arrayContaining([ids.oldIncident, ids.oldFailed]));
    const db = fakeSupabase({ alerts, companies: [{ id: company, name: 'Old Co' }], company_users: [{ company_id: company, email: 'owner@old.ca', role: 'owner' }], email_unsubscribes: [] });
    const sent: { subject: string }[] = [];
    const send: SendFn = async (e) => (sent.push(e), { ok: true });
    await sendImmediateAlerts(db as unknown as Db, settings, send);
    expect(sent.map((e) => e.subject)).toEqual([]);
  });
});
