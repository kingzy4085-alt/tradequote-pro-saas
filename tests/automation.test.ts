// The daily automation: flips, alert buckets, who can read what, the digest and the safety email.
// Database behaviour runs on PGlite. The jobs run against an in-memory stand-in seeded from it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootDb, type TestDb } from './helpers/db';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mocks.admin, createSupabaseServerClient: () => mocks.admin }));

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { POST as alertAction } from '@/app/api/alerts/[id]/route';
import { GET as alertsList } from '@/app/api/alerts/route';
import AlertsPanel from '@/components/alerts-panel';
import { GET as automationRoute } from '@/app/api/cron/automation/route';
import { GET as digestRoute } from '@/app/api/cron/digest/route';
import { GET as statusRoute } from '@/app/api/cron/status/route';
import { GET as unsubGet, POST as unsubPost } from '@/app/api/email/unsubscribe/route';
import { AUTOMATION_RULES, alertHref, alertsForMember, companyToday, deviceToday, overdueWord, type AlertRow } from '@/lib/alerts';
import { STALE_AFTER_MS, alertsUnsubscribeUrl, checkAutomationHealth, renderDigest, runAutomationJob, runDigestJob, sendImmediateAlerts, type Db, type EmailSettings, type SendFn } from '@/lib/automation';
import { MODULES, getModule, pickableStatuses } from '@/lib/modules';
import { unsubscribeUrl } from '@/lib/trial-emails';
import { parseRecord } from '@/lib/validation';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = (n: number, email: string) => ({ id: uid(n), email });
const USERS = {
  ownerA: person(1, 'owner@alpha.ca'),
  adminA: person(2, 'admin@alpha.ca'),
  pmA: person(3, 'pm@alpha.ca'),
  foremanA: person(4, 'foreman@alpha.ca'),
  elecA: person(5, 'elec@alpha.ca'),
  ownerB: person(6, 'owner@bravo.ca'),
  ownerL: person(7, 'owner@locked.ca'),
  ownerF: person(8, 'owner@flips.ca'),
  ownerR: person(9, 'owner@rules.ca'),
  ownerX: person(10, 'owner@xtra.ca'),
};
type U = keyof typeof USERS;

const TODAY = '2027-03-15';
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const on = (days: number) => addDays(TODAY, days);

let t: TestDb<U>;
let companyA: string;
let companyB: string;
let companyL: string;
let companyF: string;
let companyR: string;
let companyX: string;

const run = async (company: string, today = TODAY) => (await t.asService<{ r: Record<string, number | boolean> }>('select public.run_company_automation($1, $2) as r', [company, today]))[0].r;

/** Inserts as the system (triggers see no user). Returns the new row's id. */
async function put(table: string, company: string, values: Record<string, unknown>): Promise<string> {
  const row: Record<string, unknown> = { company_id: company, ...values };
  const cols = Object.keys(row);
  const [{ id }] = await t.asSystem<{ id: string }>(`insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(row));
  return id;
}
const statusOf = async (table: string, id: string) => (await t.asSystem<{ status: string }>(`select status from public.${table} where id = $1`, [id]))[0].status;
const openAlert = async (rule: string, record: string) => (await t.asSystem<{ bucket: string; message: string; severity: string; min_rank: number; id: string }>('select * from public.alerts where rule_key = $1 and record_id = $2 and resolved_at is null', [rule, record]))[0];

beforeAll(async () => {
  t = await bootDb<U>(USERS);
  companyA = await t.createCompany('ownerA', 'Alpha Electric');
  companyB = await t.createCompany('ownerB', 'Bravo Electric');
  companyL = await t.createCompany('ownerL', 'Locked Electric');
  companyF = await t.createCompany('ownerF', 'Flips Electric');
  companyR = await t.createCompany('ownerR', 'Rules Electric');
  companyX = await t.createCompany('ownerX', 'Extra Electric');
  await t.join('ownerA', 'adminA', 'admin');
  await t.join('ownerA', 'pmA', 'project_manager');
  await t.join('ownerA', 'foremanA', 'foreman');
  await t.join('ownerA', 'elecA', 'electrician');
});

describe('the rules match the modules', () => {
  const BASE = new Set(['id', 'title', 'status', 'notes', 'company_id', 'created_at', 'updated_at', 'created_by']);

  it.each(AUTOMATION_RULES.map((r) => [r.key, r] as const))('%s is valid', (_key, rule) => {
    const mod = getModule(rule.module);
    expect(mod, 'module exists').toBeTruthy();
    expect(mod!.table).toBe(rule.table);
    expect(rule.minRank).toBeGreaterThanOrEqual(mod!.read);
    // The one exception shows only the card's own worker, which the alerts_select policy and alertsForMember enforce
    if (mod!.ownRowsBelow && rule.key !== 'timecards.rejected') expect(rule.minRank).toBeGreaterThanOrEqual(mod!.ownRowsBelow);
    for (const status of rule.statuses ?? []) expect(mod!.statuses).toContain(status);

    const columns = new Map(mod!.fields.map((f) => [f.key, f]));
    const inSql = [rule.whereSql, rule.bucketSql, rule.detailSql].filter(Boolean).join(' ').matchAll(/\br\.(\w+)/g);
    for (const [, column] of inSql) {
      expect(BASE.has(column) || columns.has(column), `${column} exists`).toBe(true);
      expect(columns.get(column)?.restricted, `${column} is not a pay column`).toBeFalsy();
    }

    if (rule.kind === 'date') {
      expect(columns.get(rule.dateColumn!)?.type).toBe('date');
      expect(rule.offsets!.length).toBeGreaterThan(0);
      expect([...rule.offsets!].sort((a, b) => b - a)).toEqual(rule.offsets);
      expect(new Set(rule.offsets).size).toBe(rule.offsets!.length);
    } else if (rule.kind === 'age') {
      expect(BASE.has(rule.dateColumn!) || columns.get(rule.dateColumn!)?.type === 'date').toBe(true);
      expect(rule.ageDays).toBeGreaterThan(0);
    } else {
      expect(rule.statuses ?? rule.whereSql).toBeTruthy();
    }
    if (rule.immediate) expect(rule.onWrite).toBe(true);
  });

  it('keys are unique', () => {
    expect(new Set(AUTOMATION_RULES.map((r) => r.key)).size).toBe(AUTOMATION_RULES.length);
  });

  it('the seeded rows equal the rules in code', async () => {
    const rows = await t.asSystem<Record<string, unknown>>('select * from public.automation_rules order by key');
    const expected = [...AUTOMATION_RULES].sort((a, b) => (a.key < b.key ? -1 : 1));
    const collate = await t.asSystem<{ key: string }>('select key from public.automation_rules order by key collate "C"');
    expect(rows.length).toBe(expected.length);
    for (const { key } of collate) {
      const row = rows.find((r) => r.key === key)!;
      const rule = AUTOMATION_RULES.find((r) => r.key === key)!;
      expect(row).toMatchObject({
        module: rule.module,
        table_name: rule.table,
        grp: rule.group,
        kind: rule.kind,
        min_rank: rule.minRank,
        date_column: rule.dateColumn ?? null,
        statuses: rule.statuses ?? null,
        offsets: rule.offsets ?? null,
        weekly: !!rule.weekly,
        age_days: rule.ageDays ?? null,
        where_sql: rule.whereSql ?? null,
        bucket_sql: rule.bucketSql ?? null,
        detail_sql: rule.detailSql ?? null,
        msg_soon: rule.soon,
        msg_past: rule.past ?? null,
        severity: rule.severity,
        immediate: !!rule.immediate,
        on_write: !!rule.onWrite,
      });
    }
  });

  it('uses the exact thresholds that were decided', () => {
    const offsets = (key: string) => AUTOMATION_RULES.find((r) => r.key === key)!.offsets;
    expect(offsets('invoices.due')).toEqual([3, 0, -1, -30, -60, -90]);
    expect(offsets('receivables.overdue')).toEqual([-30, -60, -90]);
    expect(offsets('payables.due')).toEqual([7, 0, -1]);
    expect(offsets('purchase_orders.required')).toEqual([7, 2, -1]);
    expect(offsets('sub_compliance.liability')).toEqual([30, 14, 7, 0, -1]);
    expect(offsets('sub_compliance.wcb')).toEqual([14, 7, 0, -1]);
    expect(offsets('vendors.insurance')).toEqual([30, 14, 0]);
    expect(offsets('employees.ticket')).toEqual([60, 30, 7, 0, -1]);
    expect(offsets('warranty.expiry')).toEqual([60, 30, 7]);
    expect(offsets('progress_billing.holdback')).toEqual([7, 0]);
    expect(offsets('invoices.holdback')).toEqual([7, 0]);
  });

  it('never names a provincial lien or WCB period', () => {
    const text = JSON.stringify(AUTOMATION_RULES) + readFileSync('supabase/migrations/20261104000210_automation.sql', 'utf8');
    expect(text).not.toMatch(/\b(45|60|42)[- ]day (lien|holdback)|within \d+ (hours|days) (to|of) (the )?WCB/i);
  });
});

describe('alert buckets', () => {
  const bucket = async (days: number, offsets: number[], weekly = false) =>
    (await t.asSystem<{ b: string | null }>('select public.alert_bucket($1, $2, $3) as b', [days, offsets, weekly]))[0].b;

  it.each([
    [4, null], [3, 'd+3'], [1, 'd+3'], [0, 'd0'], [-1, 'd-1'], [-29, 'd-1'], [-30, 'd-30'], [-31, 'd-30'],
    [-59, 'd-30'], [-60, 'd-60'], [-61, 'd-60'], [-89, 'd-60'], [-90, 'd-90'], [-91, 'd-90'], [-400, 'd-90'],
  ])('invoice at %i days', async (days, expected) => {
    expect(await bucket(days, [3, 0, -1, -30, -60, -90])).toBe(expected);
  });

  it.each([[3, null], [2, 'd+2'], [1, 'd+2'], [0, 'd0'], [-1, 'd-1'], [-7, 'd-1'], [-8, 'w1'], [-14, 'w1'], [-15, 'w2'], [-22, 'w3']])(
    'weekly rule at %i days',
    async (days, expected) => {
      expect(await bucket(days, [2, 0, -1], true)).toBe(expected);
    }
  );
});

describe('status flips', () => {
  type FlipCase = [string, Record<string, unknown>, string];
  const flipTable = (table: string, cases: FlipCase[]) => {
    const ids = new Map<string, string>();
    return {
      seed: async () => {
        for (const [name, values] of cases) ids.set(name, await put(table, companyF, { title: name, ...values }));
      },
      check: async () => {
        for (const [name, , expected] of cases) expect(`${name}: ${await statusOf(table, ids.get(name)!)}`).toBe(`${name}: ${expected}`);
      },
      id: (name: string) => ids.get(name)!,
    };
  };

  const invoices = flipTable('invoices', [
    ['Sent, due yesterday', { status: 'Sent', due_date: on(-1) }, 'Overdue'],
    ['Sent, due today', { status: 'Sent', due_date: on(0) }, 'Sent'],
    ['Sent, due tomorrow', { status: 'Sent', due_date: on(1) }, 'Sent'],
    ['Overdue, due yesterday', { status: 'Overdue', due_date: on(-1) }, 'Overdue'],
    ['Overdue, due today', { status: 'Overdue', due_date: on(0) }, 'Sent'],
    ['Overdue, due tomorrow', { status: 'Overdue', due_date: on(1) }, 'Sent'],
    ['Draft, long past', { status: 'Draft', due_date: on(-90) }, 'Draft'],
    ['Paid, long past', { status: 'Paid', due_date: on(-90) }, 'Paid'],
    ['Void, long past', { status: 'Void', due_date: on(-90) }, 'Void'],
  ]);
  const receivables = flipTable('receivables', [
    ...([[-1, 'Current'], [0, 'Current'], [1, 'Current'], [29, 'Current'], [30, '30 Days'], [59, '30 Days'], [60, '60 Days'], [89, '60 Days'], [90, '90+ Days'], [400, '90+ Days']] as const).map(
      ([age, expected]): FlipCase => [`${age} days past due`, { status: 'Current', due_date: on(-age) }, expected]
    ),
    ['Comes back when the date moves', { status: '90+ Days', due_date: on(5) }, 'Current'],
    ['Collected stays', { status: 'Collected', due_date: on(-90) }, 'Collected'],
    ['No due date stays', { status: '30 Days', due_date: null }, '30 Days'],
  ]);
  const warranty = flipTable('warranty', [
    ['-1', { status: 'Active', expiry_date: on(-1) }, 'Expired'],
    ['0', { status: 'Active', expiry_date: on(0) }, 'Expiring'],
    ['+1', { status: 'Active', expiry_date: on(1) }, 'Expiring'],
    ['+29', { status: 'Active', expiry_date: on(29) }, 'Expiring'],
    ['+30', { status: 'Active', expiry_date: on(30) }, 'Expiring'],
    ['+31', { status: 'Active', expiry_date: on(31) }, 'Active'],
    ['Expired comes back', { status: 'Expired', expiry_date: on(90) }, 'Active'],
    ['Expiring comes back', { status: 'Expiring', expiry_date: on(90) }, 'Active'],
    ['Claimed stays', { status: 'Claimed', expiry_date: on(-1) }, 'Claimed'],
    ['No date stays', { status: 'Active', expiry_date: null }, 'Active'],
  ]);
  const subs = flipTable('sub_compliance', [
    ['liability -1', { status: 'Compliant', liability_expiry: on(-1), wcb_clearance_expiry: on(90) }, 'Non-Compliant'],
    ['wcb -1', { status: 'Compliant', liability_expiry: on(90), wcb_clearance_expiry: on(-1) }, 'Non-Compliant'],
    ['liability 0', { status: 'Compliant', liability_expiry: on(0), wcb_clearance_expiry: on(90) }, 'Expiring'],
    ['liability +30', { status: 'Compliant', liability_expiry: on(30), wcb_clearance_expiry: on(90) }, 'Expiring'],
    ['liability +31', { status: 'Expiring', liability_expiry: on(31), wcb_clearance_expiry: on(90) }, 'Compliant'],
    ['wcb +14', { status: 'Compliant', liability_expiry: on(90), wcb_clearance_expiry: on(14) }, 'Expiring'],
    ['wcb +15', { status: 'Expiring', liability_expiry: on(90), wcb_clearance_expiry: on(15) }, 'Compliant'],
    ['back from non-compliant', { status: 'Non-Compliant', liability_expiry: on(90), wcb_clearance_expiry: on(90) }, 'Compliant'],
    ['liability blank stays', { status: 'Compliant', liability_expiry: null, wcb_clearance_expiry: on(90) }, 'Compliant'],
    ['wcb blank stays', { status: 'Non-Compliant', liability_expiry: on(90), wcb_clearance_expiry: null }, 'Non-Compliant'],
    ['both blank stays', { status: 'Expiring', liability_expiry: null, wcb_clearance_expiry: null }, 'Expiring'],
    ['blank does not hide a lapse', { status: 'Compliant', liability_expiry: on(-1), wcb_clearance_expiry: null }, 'Non-Compliant'],
  ]);
  const vault = flipTable('site_vault', [
    ['-1', { status: 'Secure', expiry_date: on(-1) }, 'Expired'],
    ['0', { status: 'Secure', expiry_date: on(0) }, 'Secure'],
    ['+1', { status: 'Secure', expiry_date: on(1) }, 'Secure'],
    ['comes back', { status: 'Expired', expiry_date: on(0) }, 'Secure'],
    ['hand-marked with no date stays', { status: 'Expired', expiry_date: null }, 'Expired'],
  ]);
  const fleet = flipTable('fleet', [
    ['date +14', { status: 'Operational', next_service_date: on(14) }, 'Service Due'],
    ['date +15', { status: 'Operational', next_service_date: on(15) }, 'Operational'],
    ['500 km left', { status: 'Operational', mileage: 1000, next_service_km: 1500 }, 'Service Due'],
    ['501 km left', { status: 'Operational', mileage: 1000, next_service_km: 1501 }, 'Operational'],
    ['serviced, back', { status: 'Service Due', next_service_date: on(90), mileage: 1000, next_service_km: 9000 }, 'Operational'],
    ['still due', { status: 'Service Due', next_service_date: on(90), mileage: 1000, next_service_km: 1100 }, 'Service Due'],
    ['out of service stays', { status: 'Out of Service', next_service_date: on(-5) }, 'Out of Service'],
    ['no data stays', { status: 'Operational' }, 'Operational'],
    ['hand-marked, no data stays', { status: 'Service Due' }, 'Service Due'],
  ]);
  const all = [invoices, receivables, warranty, subs, vault, fleet];
  let firstRun: Record<string, number | boolean>;

  beforeAll(async () => {
    for (const table of all) await table.seed();
    firstRun = await run(companyF);
  });

  it('flipped something', () => expect(firstRun.flips).toBeGreaterThan(10));
  it('invoices: Sent and Overdue only', () => invoices.check());
  it('receivables: age uses the billing engine thresholds', () => receivables.check());
  it('warranty', () => warranty.check());
  it('sub compliance', () => subs.check());
  it('site vault', () => vault.check());
  it('fleet', () => fleet.check());

  it('a second run on the same date changes nothing and logs nothing', async () => {
    const before = await t.asSystem<{ n: number }>('select count(*)::int as n from public.automation_events');
    const stamps = async () => JSON.stringify(await t.asSystem(`
      select (select max(updated_at) from public.invoices) a, (select max(updated_at) from public.receivables) b, (select max(updated_at) from public.warranty) c,
             (select max(updated_at) from public.fleet) d, (select max(updated_at) from public.alerts where company_id = '${companyF}') e`));
    const stampsBefore = await stamps();
    const second = await run(companyF);
    expect(second).toEqual({ skipped: false, flips: 0, raised: 0, changed: 0, resolved: 0 });
    expect(await t.asSystem('select count(*)::int as n from public.automation_events')).toEqual(before);
    expect(await stamps()).toBe(stampsBefore);
  });

  it('logs each flip as an event', async () => {
    const rows = await t.asSystem('select from_value, to_value from public.automation_events where company_id = $1 and kind = $2 and record_id = $3', [companyF, 'status_flip', warranty.id('-1')]);
    expect(rows).toEqual([{ from_value: 'Active', to_value: 'Expired' }]);
  });

  it('reverses on a later date too: an invoice moved out goes back to Sent, its receivable follows', async () => {
    const id = await put('invoices', companyF, { title: 'Moves', status: 'Sent', due_date: on(-45) });
    await run(companyF);
    expect(await statusOf('invoices', id)).toBe('Overdue');
    const receivable = async () => (await t.asSystem<{ status: string }>('select status from public.receivables where invoice_id = $1', [id]))[0].status;
    expect(await receivable()).toBe('30 Days');

    // Fifteen more days and the ageing moves on without anyone touching it
    await run(companyF, on(15));
    expect(await receivable()).toBe('60 Days');

    await t.asSystem('update public.invoices set due_date = $1 where id = $2', [on(40), id]);
    await run(companyF, on(15));
    expect(await statusOf('invoices', id)).toBe('Sent');
    expect(await receivable()).toBe('Current');
    await run(companyF);
  });

  it('never fights the billing engine: Paid stays Paid, its receivable stays Collected, and undoing it ages again', async () => {
    const id = await put('invoices', companyF, { title: 'Paid one', status: 'Sent', due_date: on(-65) });
    await run(companyF);
    const receivable = async () => (await t.asSystem<{ status: string }>('select status from public.receivables where invoice_id = $1', [id]))[0].status;
    expect(await receivable()).toBe('60 Days');

    await t.asSystem(`update public.invoices set status = 'Paid' where id = $1`, [id]);
    expect(await receivable()).toBe('Collected');
    await run(companyF);
    expect(await statusOf('invoices', id)).toBe('Paid');
    expect(await receivable()).toBe('Collected');

    await t.asSystem(`update public.invoices set status = 'Sent' where id = $1`, [id]);
    await run(companyF);
    expect(await statusOf('invoices', id)).toBe('Overdue');
    expect(await receivable()).toBe('60 Days');
    expect(await run(companyF)).toMatchObject({ flips: 0, raised: 0, changed: 0, resolved: 0 });
  });
});

describe('date alerts at every boundary', () => {
  const dateRules = AUTOMATION_RULES.filter((r) => r.kind === 'date' && !r.whereSql);
  const expectedBucket = (rule: (typeof dateRules)[number], days: number): string | null => {
    const reached = rule.offsets!.filter((o) => o >= days);
    if (!reached.length) return null;
    const nearest = Math.min(...reached);
    const last = Math.min(...rule.offsets!);
    if (rule.weekly && days < last && Math.floor((last - days) / 7) >= 1) return `w${Math.floor((last - days) / 7)}`;
    return `d${nearest > 0 ? '+' : ''}${nearest}`;
  };
  // Warranties flip to Expired once past, and the rule only watches the live statuses
  const leavesRule = (rule: (typeof dateRules)[number], days: number) => rule.key === 'warranty.expiry' && days < 0;
  const STARTS: Record<string, string> = { projects: 'end_date' };
  const seeded: { rule: (typeof dateRules)[number]; days: number; id: string }[] = [];

  beforeAll(async () => {
    for (const rule of dateRules) {
      const interesting = new Set([...rule.offsets!, ...rule.offsets!.map((o) => o + 1), ...rule.offsets!.map((o) => o - 1), -1, 0, 1, -29, -30, -59, -60, -89, -90]);
      for (const days of interesting) {
        const id = await put(rule.table, companyR, { title: `${rule.key} ${days}`, status: rule.statuses?.[0] ?? getModule(rule.module)!.statuses[0], [STARTS[rule.table] ?? rule.dateColumn!]: on(days) });
        seeded.push({ rule, days, id });
      }
    }
    await run(companyR);
  }, 300_000);

  it('produces the expected bucket for each rule and day', async () => {
    const rows = await t.asSystem<{ rule_key: string; record_id: string; bucket: string }>('select rule_key, record_id, bucket from public.alerts where company_id = $1 and resolved_at is null', [companyR]);
    const found = new Map(rows.map((r) => [`${r.rule_key}:${r.record_id}`, r.bucket]));
    const wrong = seeded
      .map(({ rule, days, id }) => ({ rule: rule.key, days, want: leavesRule(rule, days) ? null : expectedBucket(rule, days), got: found.get(`${rule.key}:${id}`) ?? null }))
      .filter((c) => c.want !== c.got);
    expect(wrong).toEqual([]);
    expect(seeded.length).toBeGreaterThan(100);
  });

  it('copies each rule\'s rank onto its alerts', async () => {
    const rows = await t.asSystem<{ rule_key: string; min_rank: number }>('select distinct rule_key, min_rank from public.alerts where company_id = $1', [companyR]);
    for (const row of rows) expect(row.min_rank).toBe(AUTOMATION_RULES.find((r) => r.key === row.rule_key)!.minRank);
  });

  it('words the message for the day it falls on', async () => {
    const byDays = (key: string, days: number) => seeded.find((s) => s.rule.key === key && s.days === days)!.id;
    expect((await openAlert('invoices.due', byDays('invoices.due', 3))).message).toBe('Payment due in 3 days');
    expect((await openAlert('invoices.due', byDays('invoices.due', 0))).message).toBe('Payment due today');
    expect((await openAlert('invoices.due', byDays('invoices.due', -1))).message).toBe('Payment overdue by 1 day');
    expect((await openAlert('invoices.due', byDays('invoices.due', -1))).severity).toBe('critical');
    expect((await openAlert('vendors.insurance', byDays('vendors.insurance', 30))).severity).toBe('info');
    expect((await openAlert('vendors.insurance', byDays('vendors.insurance', 0))).severity).toBe('warning');
  });

  it('moves to the next bucket as days pass, and a second run that day adds nothing', async () => {
    const id = await put('payables', companyX, { title: 'Bill', status: 'To Approve', due_date: on(7) });
    await run(companyX);
    expect((await openAlert('payables.due', id)).bucket).toBe('d+7');
    expect(await run(companyX, on(6))).toMatchObject({ changed: 0, raised: 0 });
    expect((await openAlert('payables.due', id)).message).toBe('Bill due in 1 day');
    expect(await run(companyX, on(7))).toMatchObject({ changed: 1 });
    expect((await openAlert('payables.due', id)).bucket).toBe('d0');
    expect(await run(companyX, on(7))).toMatchObject({ flips: 0, raised: 0, changed: 0, resolved: 0 });
    await t.asSystem('delete from public.payables where id = $1', [id]);
  });

  it('clears when the condition clears, on the run or at the save', async () => {
    const id = await put('tasks', companyX, { title: 'Task', status: 'To Do', due_date: on(-1) });
    await run(companyX);
    expect(await openAlert('tasks.due', id)).toBeTruthy();

    await t.asSystem('update public.tasks set status = $1 where id = $2', ['Done', id]);
    expect(await openAlert('tasks.due', id)).toBeUndefined();

    // Reopened: raised again by the next run, as one alert
    await t.asSystem('update public.tasks set status = $1 where id = $2', ['To Do', id]);
    await run(companyX);
    expect(await openAlert('tasks.due', id)).toBeTruthy();
    expect(await t.asSystem('select count(*)::int as n from public.alerts where record_id = $1', [id])).toEqual([{ n: 1 }]);

    // Moved out of range by a date change the daily run sees
    await t.asSystem('update public.tasks set due_date = $1 where id = $2', [on(30), id]);
    await run(companyX);
    expect(await openAlert('tasks.due', id)).toBeUndefined();

    // Deleted
    await t.asSystem('update public.tasks set due_date = $1 where id = $2', [on(-1), id]);
    await run(companyX);
    await t.asSystem('delete from public.tasks where id = $1', [id]);
    expect(await openAlert('tasks.due', id)).toBeUndefined();
  });

  it('a save does not raise a date alert early or clear one that still applies', async () => {
    const id = await put('tasks', companyX, { title: 'Early', status: 'To Do', due_date: '2000-01-01' });
    expect(await openAlert('tasks.due', id)).toBeUndefined();
    await run(companyX);
    expect(await openAlert('tasks.due', id)).toBeTruthy();
    await t.asSystem('update public.tasks set title = $1 where id = $2', ['Early, renamed', id]);
    expect(await openAlert('tasks.due', id)).toBeTruthy();
    await t.asSystem('delete from public.tasks where id = $1', [id]);
  });
});

describe('age and special alerts', () => {
  const daysAgo = (n: number) => `${on(-n)}T12:00:00Z`;
  const AGE_CASES: [string, string, string, Record<string, unknown>, number][] = [
    ['submittals.pending', 'submittals', 'Pending Review', {}, 14],
    ['safety_logs.open', 'safety_logs', 'Open', {}, 8],
    ['daily_logs.draft', 'daily_logs', 'Draft', {}, 3],
    ['rfis.no_date', 'rfis', 'Open', {}, 8],
    ['equipment_rentals.no_date', 'equipment_rentals', 'On Rent', {}, 31],
    ['proposals.follow_up', 'proposals', 'Sent', {}, 14],
  ];

  it.each(AGE_CASES)('%s starts at the right age', async (rule, table, status, extra, threshold) => {
    const before = await put(table, companyX, { title: 'Just under', status, ...extra, created_at: daysAgo(threshold - 1), updated_at: daysAgo(threshold - 1) });
    const at = await put(table, companyX, { title: 'At it', status, ...extra, created_at: daysAgo(threshold), updated_at: daysAgo(threshold) });
    await run(companyX);
    expect(await openAlert(rule, before)).toBeUndefined();
    expect(await openAlert(rule, at)).toBeTruthy();
    await t.asSystem(`delete from public.${table} where id = any($1)`, [[before, at]]);
    await run(companyX);
  });

  it('a timecard waiting four days alerts rank 3 and up, and the alert carries no pay', async () => {
    const before = await put('timecards', companyA, { title: 'Under', status: 'Submitted', employee_name: 'Tessa', regular_hours: 8, work_date: on(-3), created_at: daysAgo(3) });
    const at = await put('timecards', companyA, { title: 'At', status: 'Submitted', employee_name: 'Tessa', regular_hours: 8, work_date: on(-4), created_at: daysAgo(4) });
    await run(companyA);
    expect(await openAlert('timecards.submitted', before)).toBeUndefined();
    const alert = await openAlert('timecards.submitted', at);
    expect(alert.min_rank).toBe(3);
    expect(alert.message).toBe('Waiting on approval for 4 days');
    expect(await t.as('foremanA', 'select id from public.alerts where id = $1', [alert.id])).toEqual([]);
    expect(await t.as('pmA', 'select id from public.alerts where id = $1', [alert.id])).toHaveLength(1);
    await t.asSystem('delete from public.timecards where id = any($1)', [[before, at]]);
    await run(companyA);
  });

  it('a rental past its date states what it has accrued, and goes weekly', async () => {
    const id = await put('equipment_rentals', companyX, { title: 'Boom lift', status: 'On Rent', daily_rate: 250, off_rent_date: on(-10) });
    await run(companyX);
    const alert = await openAlert('equipment_rentals.off_rent', id);
    expect(alert.bucket).toBe('w1');
    expect(alert.message).toBe('Past its off-rent date by 10 days. Accrued since then: $2,500.00.');
    await t.asSystem('delete from public.equipment_rentals where id = $1', [id]);
  });

  it('a critical blocker warns at +7 then hands over at +2, never showing twice', async () => {
    const id = await put('punch_list', companyX, { title: 'Blocker', status: 'Open', priority: 'Critical / Inspection Blocker', due_date: on(7) });
    await run(companyX);
    expect((await openAlert('punch_list.blocker', id)).bucket).toBe('d+7');
    expect(await openAlert('punch_list.due', id)).toBeUndefined();
    await run(companyX, on(5));
    expect(await openAlert('punch_list.blocker', id)).toBeUndefined();
    expect((await openAlert('punch_list.due', id)).bucket).toBe('d+2');
    const normal = await put('punch_list', companyX, { title: 'Normal', status: 'Open', priority: 'Normal', due_date: on(7) });
    await run(companyX);
    expect(await openAlert('punch_list.blocker', normal)).toBeUndefined();
    await t.asSystem('delete from public.punch_list where id = any($1)', [[id, normal]]);
    await run(companyX);
  });

  it('a failed inspection with no newer one follows up after 7 days', async () => {
    const lonely = await put('inspections', companyX, { title: 'Rough-in', status: 'Failed', inspection_date: on(-7) });
    const under = await put('inspections', companyX, { title: 'Slab', status: 'Re-inspect', inspection_date: on(-6) });
    const redone = await put('inspections', companyX, { title: 'Final', status: 'Failed', inspection_date: on(-20) });
    await put('inspections', companyX, { title: 'Final', status: 'Passed', inspection_date: on(-10) });
    await run(companyX);
    expect(await openAlert('inspections.failed_followup', lonely)).toBeTruthy();
    expect(await openAlert('inspections.failed_followup', under)).toBeUndefined();
    expect(await openAlert('inspections.failed_followup', redone)).toBeUndefined();
    await t.asSystem('delete from public.inspections where company_id = $1', [companyX]);
    await run(companyX);
  });

  it('a sub with a blank date gets a missing alert, and an unverified cert is alert only', async () => {
    const blank = await put('sub_compliance', companyX, { title: 'Blank', status: 'Compliant', liability_expiry: on(90), safety_cert_verified: false });
    await run(companyX);
    expect(await openAlert('sub_compliance.missing', blank)).toBeTruthy();
    expect(await openAlert('sub_compliance.safety_cert', blank)).toBeTruthy();
    expect(await statusOf('sub_compliance', blank)).toBe('Compliant');
    await t.asSystem('update public.sub_compliance set wcb_clearance_expiry = $1, safety_cert_verified = true where id = $2', [on(90), blank]);
    await run(companyX);
    expect(await openAlert('sub_compliance.missing', blank)).toBeUndefined();
    expect(await openAlert('sub_compliance.safety_cert', blank)).toBeUndefined();
    await t.asSystem('delete from public.sub_compliance where id = $1', [blank]);
  });

  it('holdback alerts follow the date the company typed', async () => {
    const id = await put('progress_billing', companyX, { title: 'Draw', status: 'Draft', holdback_release_date: on(7) });
    await run(companyX);
    expect((await openAlert('progress_billing.holdback', id)).bucket).toBe('d+7');
    await t.asSystem('update public.progress_billing set holdback_release_date = null where id = $1', [id]);
    expect(await openAlert('progress_billing.holdback', id)).toBeUndefined();
    await t.asSystem('delete from public.progress_billing where id = $1', [id]);
  });

  it('holdback on an invoice alerts rank 4 even after it is paid, and once only when a draw has the date', async () => {
    const lines = JSON.stringify([{ description: 'Work', quantity: 1, unit_price: 1000 }]);
    const invoice = await put('invoices', companyX, { title: 'Inv', status: 'Sent', lines, holdback_amount: 100, holdback_release_date: on(7) });
    await run(companyX);
    const alert = await openAlert('invoices.holdback', invoice);
    expect(alert.bucket).toBe('d+7');
    expect(alert.min_rank).toBe(4);

    // TODAY is ahead of the real clock here, so each save below is judged by the run after it
    await t.asSystem(`update public.invoices set status = 'Paid' where id = $1`, [invoice]);
    await run(companyX);
    expect(await openAlert('invoices.holdback', invoice)).toBeTruthy();

    // No holdback held, nothing to release
    await t.asSystem('update public.invoices set holdback_amount = 0 where id = $1', [invoice]);
    await run(companyX);
    expect(await openAlert('invoices.holdback', invoice)).toBeUndefined();
    await t.asSystem('update public.invoices set holdback_amount = 100 where id = $1', [invoice]);
    await run(companyX, on(1));
    expect(await openAlert('invoices.holdback', invoice)).toBeTruthy();

    // A draw billed on this invoice carries the date: its alert speaks, the invoice's goes quiet
    const draw = await put('progress_billing', companyX, { title: 'Draw', status: 'Invoiced', invoice_id: invoice, holdback_release_date: on(7) });
    await run(companyX, on(2));
    expect(await openAlert('invoices.holdback', invoice)).toBeUndefined();
    expect(await openAlert('progress_billing.holdback', draw)).toBeTruthy();

    await t.asSystem('delete from public.progress_billing where id = $1', [draw]);
    await t.asSystem(`update public.invoices set status = 'Draft' where id = $1`, [invoice]);
    expect(await openAlert('invoices.holdback', invoice)).toBeUndefined();
    await t.asSystem('delete from public.invoices where id = $1', [invoice]);
  });

  it('project overrun uses the revised end date, so an approved change adds time', async () => {
    const id = await put('projects', companyX, { title: 'Job', status: 'Active', end_date: on(-1) });
    await run(companyX);
    expect((await openAlert('projects.overrun', id)).bucket).toBe('d-1');
    await t.asSystem('update public.projects set approved_days = 0, end_date = $1 where id = $2', [on(0), id]);
    await run(companyX);
    expect(await openAlert('projects.overrun', id)).toBeUndefined();
    await t.asSystem('delete from public.projects where id = $1', [id]);
  });
});

describe('low stock', () => {
  const insert = async (quantity: number | null, reorder: number | null, status = 'In Stock') => {
    const id = await put('warehouse_inventory', companyX, { title: `q${quantity} r${reorder}`, status, quantity, reorder_point: reorder });
    return id;
  };

  it.each([
    [-1, 5, 'Out of Stock'], [0, 5, 'Out of Stock'], [0, null, 'Out of Stock'], [1, 5, 'Low'], [5, 5, 'Low'], [6, 5, 'In Stock'], [5, null, 'In Stock'], [0, 0, 'Out of Stock'],
  ])('quantity %s with reorder point %s is %s', async (quantity, reorder, expected) => {
    expect(await statusOf('warehouse_inventory', await insert(quantity as number, reorder as number | null))).toBe(expected);
  });

  it('no quantity leaves the status alone', async () => {
    expect(await statusOf('warehouse_inventory', await insert(null, 5, 'Low'))).toBe('Low');
  });

  it('overrides a status sent by hand, as a user too', async () => {
    const [row] = await t.as<{ id: string; status: string }>('foremanA', `insert into public.warehouse_inventory (title, status, quantity, reorder_point) values ('Connector', 'In Stock', 1, 5) returning id, status`);
    expect(row.status).toBe('Low');
    const [updated] = await t.as<{ status: string }>('foremanA', `update public.warehouse_inventory set status = 'In Stock' where id = $1 returning status`, [row.id]);
    expect(updated.status).toBe('Low');
    await t.as('ownerA', 'delete from public.warehouse_inventory where id = $1', [row.id]);
  });

  it('users cannot pick the computed statuses through the API either', () => {
    const mod = getModule('warehouse-inventory')!;
    expect(pickableStatuses(mod)).toEqual(['In Stock']);
    expect(parseRecord(mod, { title: 'x', status: 'Low' }, 'create').ok).toBe(false);
  });

  it('alerts once on the way in, again when it runs out, and clears when restocked', async () => {
    const id = await insert(20, 5);
    expect(await openAlert('warehouse.low_stock', id)).toBeUndefined();

    await t.asSystem('update public.warehouse_inventory set quantity = 5 where id = $1', [id]);
    const low = await openAlert('warehouse.low_stock', id);
    expect(low.bucket).toBe('Low');
    expect(low.min_rank).toBe(2);
    const events = async () => (await t.asSystem<{ kind: string }>('select kind from public.automation_events where record_id = $1 order by created_at', [id])).map((e) => e.kind);
    expect(await events()).toEqual(['alert_raised']);

    await t.asSystem('update public.warehouse_inventory set quantity = 4 where id = $1', [id]);
    await run(companyX);
    expect(await events()).toEqual(['alert_raised']);

    await t.asSystem('update public.warehouse_inventory set quantity = 0 where id = $1', [id]);
    expect((await openAlert('warehouse.low_stock', id)).bucket).toBe('Out of Stock');
    expect(await events()).toEqual(['alert_raised', 'alert_changed']);

    await t.asSystem('update public.warehouse_inventory set quantity = 6 where id = $1', [id]);
    expect(await openAlert('warehouse.low_stock', id)).toBeUndefined();
    expect(await events()).toEqual(['alert_raised', 'alert_changed', 'alert_resolved']);
  });
});

describe('safety alerts on save', () => {
  const log = async (who: U, values: string) => (await t.as<{ id: string }>(who, `insert into public.safety_logs (title, status, severity, incident_type) values ${values} returning id`))[0].id;
  const count = async (id: string) => (await t.asSystem<{ n: number }>('select count(*)::int as n from public.alerts where rule_key = $1 and record_id = $2', ['safety_logs.incident', id]))[0].n;

  it('a critical incident raises one alert the moment an electrician saves it, and an edit adds none', async () => {
    const id = await log('elecA', `('Arc flash', 'Open', 'Critical', 'Near Miss')`);
    expect(await count(id)).toBe(1);
    const alert = await openAlert('safety_logs.incident', id);
    expect(alert.severity).toBe('critical');
    expect(alert.message).toContain('Critical');
    await t.as('elecA', `update public.safety_logs set title = 'Arc flash at MCC', severity = 'High' where id = $1`, [id]);
    expect(await count(id)).toBe(1);
    expect((await openAlert('safety_logs.incident', id)).message).toContain('High');
    await run(companyA);
    expect(await count(id)).toBe(1);
  });

  it.each([
    ['Medical Aid', 'Low', true], ['Lost Time', 'Low', true], ['Near Miss', 'High', true], ['Near Miss', 'Medium', false], ['First Aid', 'Low', false], ['Hazard', 'Critical', true],
  ])('%s at %s severity: alert %s', async (type, severity, expected) => {
    const id = await log('foremanA', `('Incident', 'Open', '${severity}', '${type}')`);
    expect(await count(id)).toBe(expected ? 1 : 0);
  });

  it('a low incident escalated by an edit alerts then; resolving it clears', async () => {
    const id = await log('foremanA', `('Grew', 'Open', 'Low', 'Near Miss')`);
    await t.as('foremanA', `update public.safety_logs set severity = 'Critical' where id = $1`, [id]);
    expect(await openAlert('safety_logs.incident', id)).toBeTruthy();
    await t.as('foremanA', `update public.safety_logs set status = 'Resolved' where id = $1`, [id]);
    expect(await openAlert('safety_logs.incident', id)).toBeUndefined();
  });

  it('a failed inspection and an unsafe safety walk alert on save', async () => {
    const [inspection] = await t.as<{ id: string }>('foremanA', `insert into public.inspections (title, status) values ('Rough-in', 'Failed') returning id`);
    expect(await openAlert('inspections.failed', inspection.id)).toBeTruthy();
    await t.as('foremanA', `update public.inspections set status = 'Passed' where id = $1`, [inspection.id]);
    expect(await openAlert('inspections.failed', inspection.id)).toBeUndefined();

    const walk = await put('safety_inspections', companyA, { title: 'Walk', status: 'Draft', result: 'Unsafe: Work Stopped' });
    expect(await openAlert('safety_inspections.unsafe', walk)).toBeTruthy();
  });

  it('a medical aid incident gets a WCB reminder a day later, naming no deadline', async () => {
    const id = await put('safety_logs', companyX, { title: 'Hand injury', status: 'Open', incident_type: 'Medical Aid', severity: 'Low', created_at: `${on(-1)}T12:00:00Z` });
    await run(companyX);
    const alert = await openAlert('safety_logs.wcb_reminder', id);
    expect(alert.message).toBe("Check this has been reported to your province's WCB. Logged 1 day ago.");
    await t.asSystem('delete from public.safety_logs where id = $1', [id]);
  });

  it('a failure in the alert step does not lose the record', async () => {
    await t.asSystem('alter table public.alerts rename to alerts_gone');
    try {
      const id = await log('elecA', `('Saved anyway', 'Open', 'Critical', 'Lost Time')`);
      expect((await t.asSystem('select id from public.safety_logs where id = $1', [id])).length).toBe(1);
    } finally {
      await t.asSystem('alter table public.alerts_gone rename to alerts');
    }
    await run(companyA);
  });
});

describe('who can run and read what', () => {
  it('anon and authenticated cannot execute the service functions', async () => {
    const calls = [
      `select public.run_company_automation('${uid(99)}', '2027-01-01')`,
      `select public.company_is_active('${uid(99)}')`,
      `select public.automation_housekeeping('2027-01-01')`,
      `select public.claim_digest_send('${uid(99)}', '${uid(98)}', '2027-01-01')`,
      `select public.release_digest_send('${uid(99)}', '${uid(98)}', '2027-01-01')`,
      `select * from public.apply_alert_rule('invoices.due', '${uid(99)}', '2027-01-01')`,
      `select public.automation_status_flips('${uid(99)}', '2027-01-01')`,
    ];
    for (const sql of calls) {
      expect(await t.fails(null, sql)).toMatch(/permission denied/);
      expect(await t.fails('ownerA', sql)).toMatch(/permission denied/);
    }
  });

  it('the service role can run it', async () => {
    expect(await run(companyB)).toMatchObject({ skipped: false });
  });

  it('nobody signed in can read or write the bookkeeping tables', async () => {
    for (const table of ['automation_rules', 'automation_events', 'automation_runs', 'digest_sends']) {
      expect(await t.fails('ownerA', `select * from public.${table}`)).toMatch(/permission denied/);
      expect(await t.fails(null, `select * from public.${table}`)).toMatch(/permission denied/);
    }
    expect(await t.fails('ownerA', `update public.alerts set resolved_at = now()`)).toMatch(/permission denied/);
    expect(await t.fails('ownerA', `delete from public.alerts`)).toMatch(/permission denied/);
    expect(await t.fails('ownerA', `insert into public.alerts (company_id, rule_key, module, record_id, title, message, severity, min_rank, bucket) values ('${companyA}', 'invoices.due', 'invoices', '${uid(1)}', 'x', 'x', 'info', 1, 'x')`)).toMatch(/permission denied/);
    expect(await t.fails(null, 'select * from public.alerts')).toMatch(/permission denied/);
  });

  it('a run touches only its own company', async () => {
    const mine = await put('invoices', companyA, { title: 'Mine', status: 'Sent', due_date: on(-5) });
    const theirs = await put('invoices', companyB, { title: 'Theirs', status: 'Sent', due_date: on(-5) });
    await run(companyA);
    expect(await statusOf('invoices', mine)).toBe('Overdue');
    expect(await statusOf('invoices', theirs)).toBe('Sent');
    expect(await openAlert('invoices.due', theirs)).toBeUndefined();
    await run(companyB);
    expect(await statusOf('invoices', theirs)).toBe('Overdue');
  });

  it('a locked company is skipped, and comes back when it pays', async () => {
    const id = await put('invoices', companyL, { title: 'Locked', status: 'Sent', due_date: on(-5) });
    await t.setLapsed(companyL, true);
    expect(await run(companyL)).toMatchObject({ skipped: true, flips: 0 });
    expect(await statusOf('invoices', id)).toBe('Sent');
    expect(await t.asSystem('select id from public.alerts where company_id = $1', [companyL])).toEqual([]);
    expect(await t.asSystem('select company_id from public.automation_company_state where company_id = $1', [companyL])).toEqual([]);
    await t.setLapsed(companyL, false);
    expect(await run(companyL)).toMatchObject({ skipped: false, flips: 1 });
  });

  describe('alert visibility', () => {
    let invoiceAlert: string;
    let ticketAlert: string;
    let subAlert: string;
    let taskAlert: string;

    beforeAll(async () => {
      const invoice = await put('invoices', companyA, { title: 'Secret invoice', status: 'Sent', due_date: on(-2) });
      const employee = await put('employees', companyA, { title: 'Tessa', status: 'Active', ticket_expiry: on(-2) });
      const sub = await put('sub_compliance', companyA, { title: 'Apex', status: 'Compliant', liability_expiry: on(-2) });
      const task = await put('tasks', companyA, { title: 'Order breakers', status: 'To Do', due_date: on(-2) });
      await run(companyA);
      invoiceAlert = (await openAlert('invoices.due', invoice)).id;
      ticketAlert = (await openAlert('employees.ticket', employee)).id;
      subAlert = (await openAlert('sub_compliance.liability', sub)).id;
      taskAlert = (await openAlert('tasks.due', task)).id;
    });

    const sees = async (who: U, id: string) => (await t.as(who, 'select id from public.alerts where id = $1', [id])).length === 1;

    it.each([
      ['ownerA', true, true, true, true],
      ['adminA', true, true, true, true],
      ['pmA', false, false, true, true],
      ['foremanA', false, false, true, true],
      ['elecA', false, false, false, true],
      ['ownerB', false, false, false, false],
    ] as [U, boolean, boolean, boolean, boolean][])('%s: invoice %s, ticket %s, sub %s, task %s', async (who, invoice, ticket, sub, task) => {
      expect(await sees(who, invoiceAlert)).toBe(invoice);
      expect(await sees(who, ticketAlert)).toBe(ticket);
      expect(await sees(who, subAlert)).toBe(sub);
      expect(await sees(who, taskAlert)).toBe(task);
    });

    it('the list and the count follow the same rules', async () => {
      const list = async (who: U) => (await t.as<{ id: string }>(who, 'select id from public.list_my_alerts($1, 500)', [TODAY])).map((r) => r.id);
      const electrician = await list('elecA');
      expect(electrician).toContain(taskAlert);
      expect(electrician).not.toContain(invoiceAlert);
      expect(await list('ownerA')).toContain(invoiceAlert);
      expect(await list('ownerB')).not.toContain(invoiceAlert);
      const summary = async (who: U) => (await t.as<{ s: { total: number; last_checked: string | null } }>(who, 'select public.my_alert_summary($1) as s', [TODAY]))[0].s;
      expect((await summary('ownerA')).total).toBeGreaterThan((await summary('elecA')).total);
      expect((await summary('elecA')).last_checked).toBeTruthy();
      expect(await t.fails(null, `select public.my_alert_summary('${TODAY}')`)).toMatch(/permission denied/);
    });

    it('snooze and dismiss are one person\'s, and dismiss lasts until the bucket changes', async () => {
      const visible = async (who: U, today = TODAY) => (await t.as<{ id: string }>(who, 'select id from public.list_my_alerts($1, 500)', [today])).map((r) => r.id).includes(subAlert);

      await t.as('foremanA', 'select public.snooze_alert($1, $2)', [subAlert, on(7)]);
      expect(await visible('foremanA')).toBe(false);
      expect(await visible('foremanA', on(6))).toBe(false);
      expect(await visible('foremanA', on(7))).toBe(true);
      expect(await visible('ownerA')).toBe(true);

      await t.as('pmA', 'select public.dismiss_alert($1)', [subAlert]);
      expect(await visible('pmA')).toBe(false);
      expect(await visible('ownerA')).toBe(true);

      // It moved on: the same alert in a new bucket shows again
      await t.asSystem(`update public.alerts set bucket = 'd-99' where id = $1`, [subAlert]);
      expect(await visible('pmA')).toBe(true);
      await t.asSystem(`update public.alerts set bucket = 'd-1' where id = $1`, [subAlert]);
    });

    it('nobody can snooze an alert they cannot see, or change someone else\'s choice', async () => {
      expect(await t.fails('elecA', 'select public.snooze_alert($1, $2)', [invoiceAlert, on(1)])).toMatch(/not found/i);
      expect(await t.fails('ownerB', 'select public.dismiss_alert($1)', [invoiceAlert])).toMatch(/not found/i);
      expect(await t.fails('elecA', `insert into public.alert_member_state (alert_id, user_id, dismissed_bucket) values ('${invoiceAlert}', '${USERS.elecA.id}', 'x')`)).toMatch(/row-level security/);
      expect(await t.as('foremanA', 'select * from public.alert_member_state where user_id <> auth.uid()')).toEqual([]);
      expect(await t.as('ownerA', `select * from public.alert_member_state where user_id = '${USERS.foremanA.id}'`)).toEqual([]);
    });

    it('a resolved alert returns fresh, without the old dismissal', async () => {
      const id = await put('tasks', companyA, { title: 'Comes back', status: 'To Do', due_date: on(-2) });
      await run(companyA);
      const alert = await openAlert('tasks.due', id);
      await t.as('ownerA', 'select public.dismiss_alert($1)', [alert.id]);
      await t.asSystem(`update public.tasks set status = 'Done' where id = $1`, [id]);
      await t.asSystem(`update public.tasks set status = 'To Do' where id = $1`, [id]);
      await run(companyA);
      expect((await t.as<{ id: string }>('ownerA', 'select id from public.list_my_alerts($1, 500)', [TODAY])).map((r) => r.id)).toContain(alert.id);
    });

    it('a lapsed company cannot snooze', async () => {
      const id = await put('tasks', companyL, { title: 'Locked task', status: 'To Do', due_date: on(-1) });
      await run(companyL);
      const alert = await openAlert('tasks.due', id);
      await t.setLapsed(companyL, true);
      expect(await t.fails('ownerL', 'select public.dismiss_alert($1)', [alert.id])).toMatch(/row-level security/);
      await t.setLapsed(companyL, false);
    });
  });
});

describe('alertsForMember', () => {
  const alert = (over: Partial<AlertRow> = {}): AlertRow => ({ id: 'a1', rule_key: 'tasks.due', module: 'tasks', record_id: uid(1), title: 'T', message: 'M', severity: 'warning', min_rank: 1, bucket: 'd0', due_on: null, bucket_changed_at: '2027-03-15T10:00:00Z', ...over });
  const member = { userId: 'u1', rank: 2 };
  const opts = { today: TODAY };

  it('filters on rank, and on the module rank as a second lock', () => {
    expect(alertsForMember([alert({ min_rank: 3 })], member, opts)).toEqual([]);
    expect(alertsForMember([alert({ module: 'invoices', min_rank: 1 })], member, opts)).toEqual([]);
    expect(alertsForMember([alert({ module: 'employees', min_rank: 2 })], member, opts)).toEqual([]);
    expect(alertsForMember([alert({ module: 'no-such-module' })], member, opts)).toEqual([]);
    expect(alertsForMember([alert()], member, opts)).toHaveLength(1);
  });

  it('only what changed since their last digest, not snoozed, not dismissed, not resolved', () => {
    expect(alertsForMember([alert()], member, { ...opts, since: '2027-03-15T10:00:00Z' })).toEqual([]);
    expect(alertsForMember([alert()], member, { ...opts, since: '2027-03-15T09:59:59Z' })).toHaveLength(1);
    expect(alertsForMember([alert({ resolved_at: '2027-03-15T11:00:00Z' })], member, opts)).toEqual([]);
    const state = (over: object) => [{ alert_id: 'a1', user_id: 'u1', snoozed_until: null, dismissed_bucket: null, ...over }];
    expect(alertsForMember([alert()], member, { ...opts, states: state({ dismissed_bucket: 'd0' }) })).toEqual([]);
    expect(alertsForMember([alert()], member, { ...opts, states: state({ dismissed_bucket: 'd+3' }) })).toHaveLength(1);
    expect(alertsForMember([alert()], member, { ...opts, states: state({ snoozed_until: on(1) }) })).toEqual([]);
    expect(alertsForMember([alert()], member, { ...opts, states: state({ snoozed_until: TODAY }) })).toHaveLength(1);
    expect(alertsForMember([alert()], member, { ...opts, states: [{ alert_id: 'a1', user_id: 'someone-else', snoozed_until: on(9), dismissed_bucket: null }] })).toHaveLength(1);
  });
});

describe('the digest job', () => {
  const settings: EmailSettings = { config: { apiKey: 'k', from: 'a@b.ca' }, sender: { business: 'TradeQuote Inc.', address: 'PO Box 1, Regina SK' }, secret: 's3cret', siteUrl: 'https://app.test' };
  const NOW = () => new Date();
  const MEMBERS = [
    { user_id: USERS.ownerA.id, email: USERS.ownerA.email, full_name: 'Olive Owner', role: 'owner' },
    { user_id: USERS.pmA.id, email: USERS.pmA.email, full_name: 'Pat PM', role: 'project_manager' },
    { user_id: USERS.foremanA.id, email: USERS.foremanA.email, full_name: 'Fred Foreman', role: 'foreman' },
    { user_id: USERS.elecA.id, email: USERS.elecA.email, full_name: 'Elly Electrician', role: 'electrician' },
  ];
  const company = { id: uid(500), name: 'Alpha Electric', province: 'SK', subscription_status: 'active', trial_ends_at: '2020-01-01T00:00:00Z', company_users: MEMBERS };

  /** A stand-in database whose alerts came from a real run, with claim and release behaving like the SQL. */
  async function world(extra: Record<string, Record<string, unknown>[]> = {}) {
    const rows = (await t.asSystem<{ j: Record<string, unknown> }>('select to_jsonb(a) as j from public.alerts a where a.company_id = $1 and a.resolved_at is null', [companyA])).map((r) => ({ ...r.j, company_id: company.id, bucket_changed_at: new Date().toISOString() }));
    const tables: Record<string, Record<string, unknown>[]> = { companies: [company], alerts: rows, alert_member_state: [], digest_sends: [], email_unsubscribes: [], automation_runs: [], ...extra };
    const db = fakeSupabase(tables, {
      rpc: (name, args) => {
        const sends = db.tables.digest_sends;
        if (name === 'claim_digest_send') {
          if (sends.some((s) => s.user_id === args.p_user && s.digest_date === args.p_date)) return { data: false, error: null };
          sends.push({ company_id: args.p_company, user_id: args.p_user, digest_date: args.p_date, sent_at: new Date().toISOString() });
          return { data: true, error: null };
        }
        if (name === 'release_digest_send') {
          const i = sends.findIndex((s) => s.user_id === args.p_user && s.digest_date === args.p_date);
          if (i >= 0) sends.splice(i, 1);
          return { data: null, error: null };
        }
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      },
    });
    return db;
  }
  const collector = () => {
    const sent: { to: string; subject: string; text: string; html: string; unsubscribeUrl?: string }[] = [];
    const send: SendFn = async (email) => {
      sent.push(email);
      return { ok: true };
    };
    return { sent, send };
  };

  beforeAll(async () => {
    await run(companyA);
    await put('tasks', companyA, { title: 'Digest task', status: 'To Do', due_date: on(-3) });
    await put('invoices', companyA, { title: 'Digest invoice', status: 'Sent', due_date: on(-3) });
    await put('employees', companyA, { title: 'Digest employee', status: 'Active', ticket_expiry: on(-3) });
    await put('sub_compliance', companyA, { title: 'Digest sub', status: 'Compliant', liability_expiry: on(-3), wcb_clearance_expiry: on(90) });
    await run(companyA);
  });

  it('a foreman never gets invoice or employee alerts, an owner does, an electrician gets no email', async () => {
    const db = await world();
    const { sent, send } = collector();
    const summary = await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    const to = (u: string) => sent.find((e) => e.to === u)!;
    expect(to(USERS.ownerA.email).text).toContain('Digest invoice');
    expect(to(USERS.ownerA.email).text).toContain('Digest employee');
    for (const email of [to(USERS.foremanA.email), to(USERS.pmA.email)]) {
      expect(email.text).toContain('Digest sub');
      expect(email.text).not.toContain('Digest invoice');
      expect(email.html).not.toContain('Digest invoice');
      expect(email.text).not.toContain('Digest employee');
      expect(email.text).not.toContain('Tessa');
    }
    expect(to(USERS.elecA.email)).toBeUndefined();
    expect(sent).toHaveLength(3);
    expect(summary).toMatchObject({ sent: 3, failed: 0 });
  });

  it('a double run sends once', async () => {
    const db = await world();
    const { sent, send } = collector();
    await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    const first = sent.length;
    expect(first).toBeGreaterThan(0);
    await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    expect(sent.length).toBe(first);
  });

  it('two runs at once still send once: the claim decides, even if the since check passes', async () => {
    const db = await world();
    const { sent, send } = collector();
    const today = companyToday('SK');
    db.tables.digest_sends.push({ company_id: company.id, user_id: USERS.ownerA.id, digest_date: today, sent_at: '2000-01-01T00:00:00Z' });
    const summary = await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    expect(sent.some((e) => e.to === USERS.ownerA.email)).toBe(false);
    expect(summary.alreadySent).toBe(1);
  });

  it('a failed send releases the claim, so the next run tries again', async () => {
    const db = await world();
    const failing: SendFn = async () => ({ ok: false, error: 'Resend 500' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const summary = await runDigestJob(db as unknown as Db, settings, failing, { now: NOW });
    error.mockRestore();
    expect(summary.failed).toBeGreaterThan(0);
    expect(db.tables.digest_sends).toEqual([]);
    const { sent, send } = collector();
    await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    expect(sent.length).toBeGreaterThan(0);
  });

  it('a send that throws for one person releases their claim and still reaches the next', async () => {
    const db = await world();
    const reached: string[] = [];
    let threw = false;
    const flaky: SendFn = async (email) => {
      if (!threw) {
        threw = true;
        throw new Error('socket hang up');
      }
      reached.push(email.to);
      return { ok: true };
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const summary = await runDigestJob(db as unknown as Db, settings, flaky, { now: NOW });
    error.mockRestore();
    expect(summary.failed).toBe(1);
    expect(summary.companiesFailed).toBe(0);
    expect(reached.length).toBeGreaterThan(0);
    expect(db.tables.digest_sends).toHaveLength(reached.length);
  });

  it('says "1 needs" and "2 need" in the subject', () => {
    const base = { company: 'Co', name: 'Sam', siteUrl: 'https://app.test', unsubscribeUrl: 'https://app.test/u', sender: { business: 'B', address: 'A' } };
    const alert = { id: '1', rule_key: 'invoices.due', module: 'invoices', record_id: 'r', title: 'T', message: 'M', severity: 'critical', min_rank: 4, bucket: 'd-1', due_on: null, bucket_changed_at: '2027-01-01T00:00:00Z' } as AlertRow;
    expect(renderDigest({ ...base, alerts: [alert] }).subject).toContain('1 needs action');
    expect(renderDigest({ ...base, alerts: [alert, { ...alert, id: '2' }] }).subject).toContain('2 need action');
  });

  it('no email when nothing changed', async () => {
    const db = await world({ alerts: [] });
    const { sent, send } = collector();
    await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    expect(sent).toEqual([]);
    expect(db.tables.digest_sends).toEqual([]);
  });

  it('a marketing unsubscribe never silences alerts; an alerts unsubscribe does, and only alerts', async () => {
    const db = await world({ email_unsubscribes: [{ email: USERS.ownerA.email, scope: 'marketing' }, { email: USERS.foremanA.email, scope: 'alerts' }] });
    const { sent, send } = collector();
    const summary = await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    expect(sent.map((e) => e.to)).toContain(USERS.ownerA.email);
    expect(sent.map((e) => e.to)).not.toContain(USERS.foremanA.email);
    expect(summary.skippedUnsubscribed).toBe(1);
  });

  it('cannot read the unsubscribe list: emails nobody in that company', async () => {
    const rows = await world();
    const db = fakeSupabase(rows.tables, { failOn: ({ table }) => (table === 'email_unsubscribes' ? { message: 'down' } : null), rpc: () => ({ data: true, error: null }) });
    const { sent, send } = collector();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const summary = await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    error.mockRestore();
    expect(sent).toEqual([]);
    expect(summary.companiesFailed).toBe(1);
  });

  it('a snoozed or dismissed alert stays out of that person\'s digest', async () => {
    const db = await world();
    const ownerInvoice = db.tables.alerts.find((a) => a.title === 'Digest invoice')!;
    db.tables.alert_member_state.push({ alert_id: ownerInvoice.id, user_id: USERS.ownerA.id, snoozed_until: '2999-01-01', dismissed_bucket: null });
    const { sent, send } = collector();
    await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    expect(sent.find((e) => e.to === USERS.ownerA.email)!.text).not.toContain('Digest invoice');
  });

  it('a lapsed company gets no digest', async () => {
    const db = await world({ companies: [{ ...company, subscription_status: 'canceled' }] });
    const { sent, send } = collector();
    await runDigestJob(db as unknown as Db, settings, send, { now: NOW });
    expect(sent).toEqual([]);
  });

  it('has the CASL footer and an alerts-only unsubscribe, and escapes record titles', () => {
    const email = renderDigest({
      company: 'A & B <Electric>',
      name: 'Pat',
      alerts: [{ id: 'x', rule_key: 'tasks.due', module: 'tasks', record_id: uid(1), title: '<script>x</script>', message: 'Task overdue', severity: 'critical', min_rank: 1, bucket: 'd-1', due_on: null, bucket_changed_at: '' }],
      siteUrl: 'https://app.test',
      unsubscribeUrl: 'https://app.test/api/email/unsubscribe?e=x&t=y&s=alerts',
      sender: settings.sender,
    });
    expect(email.html).not.toContain('<script>x');
    expect(email.html).toContain('&lt;script&gt;');
    for (const body of [email.text, email.html]) {
      expect(body).toContain('TradeQuote Inc.');
      expect(body).toContain('PO Box 1, Regina SK');
      expect(body).toContain('s=alerts');
    }
  });

  it('the claim functions work in SQL: one claim wins, release frees it', async () => {
    const claim = async () => (await t.asService<{ ok: boolean }>('select public.claim_digest_send($1, $2, $3) as ok', [companyA, USERS.ownerA.id, TODAY]))[0].ok;
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    await t.asService('select public.release_digest_send($1, $2, $3)', [companyA, USERS.ownerA.id, TODAY]);
    expect(await claim()).toBe(true);
    await t.asService('select public.release_digest_send($1, $2, $3)', [companyA, USERS.ownerA.id, TODAY]);
  });

  describe('immediate safety email', () => {
    const safetyAlert = (over: object = {}) => ({ id: uid(700), company_id: company.id, rule_key: 'safety_logs.incident', module: 'safety-logs', record_id: uid(701), title: 'Arc flash', message: 'Critical incident reported.', severity: 'critical', min_rank: 2, bucket: 'open', due_on: null, bucket_changed_at: new Date().toISOString(), immediate: true, emailed_at: null, resolved_at: null, created_at: new Date().toISOString(), ...over });
    const safetyWorld = (extra: object = {}) =>
      fakeSupabase({ alerts: [safetyAlert()], companies: [company], company_users: MEMBERS.map((m) => ({ ...m, company_id: company.id })), email_unsubscribes: [], ...extra } as Record<string, Record<string, unknown>[]>);

    it('goes to rank 3 and up, once', async () => {
      const db = safetyWorld();
      const { sent, send } = collector();
      await sendImmediateAlerts(db as unknown as Db, settings, send, { companyId: company.id });
      expect(sent.map((e) => e.to).sort()).toEqual([USERS.ownerA.email, USERS.pmA.email].sort());
      expect(sent[0].subject).toContain('Arc flash');
      await sendImmediateAlerts(db as unknown as Db, settings, send, { companyId: company.id });
      expect(sent).toHaveLength(2);
    });

    it('is not stopped by a marketing unsubscribe', async () => {
      const db = safetyWorld({ email_unsubscribes: [{ email: USERS.ownerA.email, scope: 'marketing' }, { email: USERS.pmA.email, scope: 'alerts' }] });
      const { sent, send } = collector();
      await sendImmediateAlerts(db as unknown as Db, settings, send, { companyId: company.id });
      expect(sent.map((e) => e.to)).toEqual([USERS.ownerA.email]);
    });

    it('is retried if nobody got it, and not if somebody did', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const db = safetyWorld();
      await sendImmediateAlerts(db as unknown as Db, settings, async () => ({ ok: false, error: 'down' }), { companyId: company.id });
      expect(db.tables.alerts[0].emailed_at).toBeNull();

      let calls = 0;
      const partial: SendFn = async () => (++calls === 1 ? { ok: true } : { ok: false, error: 'down' });
      await sendImmediateAlerts(db as unknown as Db, settings, partial, { companyId: company.id });
      expect(db.tables.alerts[0].emailed_at).not.toBeNull();
      error.mockRestore();
    });

    it('does not send an old backlog', async () => {
      const db = safetyWorld({ alerts: [safetyAlert({ created_at: '2020-01-01T00:00:00Z' })] });
      const { sent, send } = collector();
      await sendImmediateAlerts(db as unknown as Db, settings, send);
      expect(sent).toEqual([]);
    });
  });
});

describe('the cron routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const req = (path: string, secret = 'cron-secret') => new Request(`https://app.test/api/cron/${path}`, { headers: { authorization: `Bearer ${secret}` } });
  const company = (i: number, over: object = {}) => ({ id: `c${String(i).padStart(4, '0')}`, province: 'SK', subscription_status: 'active', trial_ends_at: '2020-01-01T00:00:00Z', name: `Co ${i}`, company_users: [], ...over });
  const quiet = () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  };

  it.each([
    ['automation', automationRoute],
    ['digest', digestRoute],
    ['status', statusRoute],
  ])('%s refuses a wrong secret and fails closed with none set', async (path, route) => {
    quiet();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect((await route(req(path, 'wrong'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await route(req(path))).status).toBe(500);
  });

  it('runs every company in batches, past a failing one, and skips locked ones', async () => {
    quiet();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('RESEND_API_KEY', '');
    const called: string[] = [];
    const companies = Array.from({ length: 450 }, (_, i) => company(i));
    companies[3] = company(3, { subscription_status: 'canceled' });
    mocks.admin = fakeSupabase(
      { companies, automation_runs: [], alerts: [] },
      {
        rpc: (name, args) => {
          if (name === 'automation_housekeeping') return { data: {}, error: null };
          called.push(args.p_company as string);
          return args.p_company === 'c0007' ? { data: null, error: { message: 'boom' } } : { data: { skipped: false, flips: 1, raised: 2, changed: 0, resolved: 0 }, error: null };
        },
      }
    );
    const res = await automationRoute(req('automation'));
    const json = await res.json();
    expect(json).toMatchObject({ checked: 450, ok: 448, failed: 1, skippedLocked: 1, flips: 448, emailConfigured: false });
    expect(called).toHaveLength(449);
    expect(called).not.toContain('c0003');
    expect(called).toContain('c0449');
    const db = mocks.admin as ReturnType<typeof fakeSupabase>;
    expect(db.tables.automation_runs[0]).toMatchObject({ job: 'automation', companies_ok: 448, companies_failed: 1, out_of_time: false });
  });

  it('a company whose call throws is counted and the rest still run', async () => {
    quiet();
    const called: string[] = [];
    const db = fakeSupabase(
      { companies: [company(1), company(2), company(3)], automation_runs: [] },
      {
        rpc: (name, args) => {
          if (name !== 'run_company_automation') return { data: {}, error: null };
          called.push(args.p_company as string);
          if (args.p_company === 'c0002') throw new Error('fetch failed');
          return { data: { skipped: false }, error: null };
        },
      }
    );
    const summary = await runAutomationJob(db as unknown as Db, { now: () => new Date('2027-03-16T10:00:00Z') });
    expect(called).toEqual(['c0001', 'c0002', 'c0003']);
    expect(summary).toMatchObject({ ok: 2, failed: 1 });
  });

  it('passes each company its own local date', async () => {
    quiet();
    const dates: Record<string, unknown> = {};
    const db = fakeSupabase(
      { companies: [company(1, { province: 'BC' }), company(2, { province: 'NL' })], automation_runs: [] },
      {
        rpc: (name, args) => {
          if (name === 'run_company_automation') dates[args.p_company as string] = args.p_today;
          return { data: {}, error: null };
        },
      }
    );
    const now = new Date('2027-01-02T03:00:00Z');
    await runAutomationJob(db as unknown as Db, { now: () => now });
    expect(dates).toEqual({ c0001: '2027-01-01', c0002: '2027-01-01' });
  });

  it('a later run skips who already ran today, so it can finish what ran out of time', async () => {
    quiet();
    const now = new Date('2027-01-05T10:00:00Z');
    const called: string[] = [];
    const db = fakeSupabase(
      { companies: [company(1, { automation_company_state: { last_run_date: '2027-01-05' } }), company(2)], automation_runs: [] },
      { rpc: (_n, args) => (called.push(args.p_company as string), { data: {}, error: null }) }
    );
    expect(await runAutomationJob(db as unknown as Db, { now: () => now })).toMatchObject({ checked: 2, ok: 2, alreadyRun: 1 });
    expect(called).toEqual(['c0002']);
  });

  it('out of time is reported, not hidden', async () => {
    quiet();
    let tick = 0;
    const db = fakeSupabase({ companies: [company(1), company(2)], automation_runs: [] }, { rpc: () => ({ data: {}, error: null }) });
    const summary = await runAutomationJob(db as unknown as Db, { now: () => new Date(1_800_000_000_000 + tick++ * 100), timeBudgetMs: 150 });
    expect(summary.outOfTime).toBe(true);
    expect(db.tables.automation_runs[0]).toMatchObject({ out_of_time: true });
  });

  it('housekeeping runs on Sundays only', async () => {
    quiet();
    const names: string[] = [];
    const db = () => fakeSupabase({ companies: [], automation_runs: [] }, { rpc: (n) => (names.push(n), { data: {}, error: null }) });
    await runAutomationJob(db() as unknown as Db, { now: () => new Date('2027-01-05T10:00:00Z') }); // Tuesday
    expect(names).toEqual([]);
    await runAutomationJob(db() as unknown as Db, { now: () => new Date('2027-01-03T10:00:00Z') }); // Sunday
    expect(names).toEqual(['automation_housekeeping']);
  });

  it('a missing RESEND_API_KEY skips the digest, logs and does not crash', async () => {
    quiet();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('RESEND_API_KEY', '');
    mocks.admin = fakeSupabase({ companies: [company(1)], automation_runs: [] });
    const res = await digestRoute(req('digest'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 0, notConfigured: true });
    expect(console.warn).toHaveBeenCalled();
  });

  describe('health', () => {
    const NOW = new Date('2027-01-05T16:00:00Z');
    const settings: EmailSettings = { config: { apiKey: 'k', from: 'a@b.ca' }, sender: { business: 'B', address: 'A' }, secret: 's', siteUrl: 'https://app.test' };
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const runRow = (over: object) => ({ job: 'automation', run_date: '2027-01-05', companies_ok: 5, companies_failed: 0, out_of_time: false, created_at: ago(3_600_000), ...over });
    const check = async (rows: object[]) => {
      quiet();
      vi.stubEnv('OPERATOR_EMAIL', 'ops@tradequote.ca');
      const sent: string[] = [];
      const db = fakeSupabase({ automation_runs: rows as Record<string, unknown>[] });
      const send: SendFn = async (e) => (sent.push(e.to), { ok: true });
      const health = await checkAutomationHealth(db as unknown as Db, settings, send, { now: NOW });
      return { health, sent, db, send };
    };

    it('a recent clean run is healthy and emails nobody', async () => {
      const { health, sent } = await check([runRow({})]);
      expect(health).toMatchObject({ healthy: true, problems: [] });
      expect(sent).toEqual([]);
    });

    it('26 hours is the line', async () => {
      expect((await check([runRow({ created_at: ago(STALE_AFTER_MS - 1000) })])).health.healthy).toBe(true);
      const stale = await check([runRow({ created_at: ago(STALE_AFTER_MS + 1000) })]);
      expect(stale.health.healthy).toBe(false);
      expect(stale.sent).toEqual(['ops@tradequote.ca']);
    });

    it('failures and running out of time are problems, and no run at all is too', async () => {
      expect((await check([runRow({ companies_failed: 1 }), runRow({ created_at: ago(7_200_000) })])).health.healthy).toBe(false);
      expect((await check([runRow({ out_of_time: true })])).health.healthy).toBe(false);
      expect((await check([])).health.healthy).toBe(false);
    });

    it('tells the operator once a day, and copes with no operator set', async () => {
      const first = await check([]);
      expect(first.sent).toHaveLength(1);
      await checkAutomationHealth(first.db as unknown as Db, settings, first.send, { now: NOW });
      expect(first.sent).toHaveLength(1);

      vi.stubEnv('OPERATOR_EMAIL', '');
      vi.stubEnv('EMAIL_REPLY_TO', '');
      const db = fakeSupabase({ automation_runs: [] });
      expect((await checkAutomationHealth(db as unknown as Db, settings, async () => ({ ok: true }), { now: NOW })).operatorEmailed).toBe(false);
    });

    it('the route answers 503 when unhealthy', async () => {
      quiet();
      vi.stubEnv('CRON_SECRET', 'cron-secret');
      mocks.admin = fakeSupabase({ automation_runs: [] });
      expect((await statusRoute(req('status'))).status).toBe(503);
      mocks.admin = fakeSupabase({ automation_runs: [{ job: 'automation', companies_failed: 0, out_of_time: false, created_at: new Date().toISOString() }] });
      expect((await statusRoute(req('status'))).status).toBe(200);
    });
  });
});

describe('the alerts API', () => {
  const ID = uid(900);
  const signedIn = (over: { role?: string; status?: string; user?: boolean } = {}) => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const db = fakeSupabase(
      { company_users: [{ user_id: uid(1), role: over.role ?? 'foreman', company: { id: uid(2), name: 'Alpha', province: 'SK', subscription_status: over.status ?? 'active', trial_ends_at: '2020-01-01T00:00:00Z' } }] },
      {
        rpc: (name, args) => {
          calls.push({ name, args });
          if (name === 'my_alert_summary') return { data: { total: 2, critical: 1, warning: 1, info: 0, last_checked: null }, error: null };
          if (name === 'list_my_alerts') return { data: [{ id: ID }], error: null };
          if (args.p_alert === uid(901)) return { data: null, error: { code: 'P0002', message: 'Alert not found' } };
          return { data: null, error: null };
        },
      }
    );
    mocks.admin = { ...db, auth: { getUser: async () => ({ data: { user: over.user === false ? null : { id: uid(1), email: 'a@b.ca' } }, error: null }) } };
    return calls;
  };
  const post = (id: string, body: unknown) => alertAction(new Request(`https://app.test/api/alerts/${id}`, { method: 'POST', body: JSON.stringify(body) }), { params: { id } });
  afterEach(() => vi.restoreAllMocks());

  it('needs a signed-in user', async () => {
    signedIn({ user: false });
    expect((await alertsList(new Request('https://app.test/api/alerts'))).status).toBe(401);
    expect((await post(ID, { action: 'dismiss' })).status).toBe(401);
  });

  it('asks with the company-local date; the bell gets counts only', async () => {
    const calls = signedIn();
    const res = await alertsList(new Request('https://app.test/api/alerts?summary=1'));
    expect(await res.json()).toMatchObject({ summary: { total: 2 } });
    expect(calls.map((c) => c.name)).toEqual(['my_alert_summary']);
    expect(calls[0].args.p_today).toBe(companyToday('SK'));

    const full = signedIn();
    expect(await (await alertsList(new Request('https://app.test/api/alerts'))).json()).toMatchObject({ data: [{ id: ID }], summary: { total: 2 } });
    expect(full.map((c) => c.name)).toEqual(['my_alert_summary', 'list_my_alerts']);
  });

  it('snoozes from the company date, and dismisses', async () => {
    const calls = signedIn();
    expect((await post(ID, { action: 'snooze', days: 7 })).status).toBe(200);
    expect(calls[0]).toEqual({ name: 'snooze_alert', args: { p_alert: ID, p_until: addDays(companyToday('SK'), 7) } });
    expect((await post(ID, { action: 'dismiss' })).status).toBe(200);
    expect(calls[1]).toEqual({ name: 'dismiss_alert', args: { p_alert: ID } });
  });

  it('refuses bad input, unknown alerts, and a lapsed company', async () => {
    signedIn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await post('nope', { action: 'dismiss' })).status).toBe(404);
    expect((await post(ID, { action: 'snooze', days: 365 })).status).toBe(400);
    expect((await post(ID, { action: 'delete' })).status).toBe(400);
    expect((await post(uid(901), { action: 'dismiss' })).status).toBe(404);
    signedIn({ status: 'canceled' });
    expect((await post(ID, { action: 'dismiss' })).status).toBe(402);
    expect((await alertsList(new Request('https://app.test/api/alerts'))).status).toBe(200);
  });
});

describe('the bell and panel', () => {
  it('render on the server without touching the network', () => {
    const panel = renderToStaticMarkup(createElement(AlertsPanel));
    expect(panel).toContain('Loading alerts');
    const shell = readFileSync('components/app-shell.tsx', 'utf8');
    expect(shell.match(/<AlertsBell/g)).toHaveLength(2);
  });

  it('the drawer renders on the body: inside the blurred phone header it would be 57px tall', () => {
    expect(readFileSync('components/app-shell.tsx', 'utf8')).toMatch(/<header[^>]*backdrop-blur[\s\S]*?<AlertsBell/);
    const bell = readFileSync('components/alerts-bell.tsx', 'utf8');
    expect(bell).toContain('createPortal(');
    expect(bell).toMatch(/document\.body\s*\n\s*\)\}/);
  });
});

describe('unsubscribe scopes', () => {
  afterEach(() => vi.unstubAllEnvs());
  const page = (query: string, method = 'POST') => new Request(`https://app.test/api/email/unsubscribe?${query}`, { method });

  it('the table holds each scope separately for one address', async () => {
    await t.asSystem(`insert into public.email_unsubscribes (email) values ('both@co.ca')`);
    await t.asSystem(`insert into public.email_unsubscribes (email, scope) values ('both@co.ca', 'alerts')`);
    expect(await t.asSystem(`select scope from public.email_unsubscribes where email = 'both@co.ca' order by scope`)).toEqual([{ scope: 'alerts' }, { scope: 'marketing' }]);
    await expect(t.asSystem(`insert into public.email_unsubscribes (email, scope) values ('both@co.ca', 'other')`)).rejects.toThrow(/check/);
    expect(await t.fails('ownerA', 'select * from public.email_unsubscribes')).toMatch(/permission denied/);
  });

  it('a marketing link writes marketing, and an alerts link writes alerts', async () => {
    vi.stubEnv('CRON_SECRET', 'k');
    const db = fakeSupabase({ email_unsubscribes: [] });
    mocks.admin = db;
    const marketing = new URL(unsubscribeUrl('https://app.test', 'a@b.ca', 'k')).search.slice(1);
    const alerts = new URL(alertsUnsubscribeUrl('https://app.test', 'a@b.ca', 'k')).search.slice(1);
    expect((await unsubPost(page(marketing))).status).toBe(200);
    expect((await unsubPost(page(alerts))).status).toBe(200);
    expect(db.tables.email_unsubscribes).toEqual([{ email: 'a@b.ca', scope: 'marketing' }, { email: 'a@b.ca', scope: 'alerts' }]);
  });

  it('a marketing link cannot be edited into one that stops safety alerts, or the reverse', async () => {
    vi.stubEnv('CRON_SECRET', 'k');
    const db = fakeSupabase({ email_unsubscribes: [] });
    mocks.admin = db;
    const marketing = new URL(unsubscribeUrl('https://app.test', 'a@b.ca', 'k')).search.slice(1);
    const alerts = new URL(alertsUnsubscribeUrl('https://app.test', 'a@b.ca', 'k')).search.slice(1);
    expect((await unsubPost(page(`${marketing}&s=alerts`))).status).toBe(400);
    expect((await unsubPost(page(alerts.replace('&s=alerts', '')))).status).toBe(400);
    expect(db.tables.email_unsubscribes).toEqual([]);
  });

  it('the confirmation page says what stops, and its form keeps the scope', async () => {
    vi.stubEnv('CRON_SECRET', 'k');
    const alerts = new URL(alertsUnsubscribeUrl('https://app.test', 'a@b.ca', 'k')).search.slice(1);
    const html = await (await unsubGet(page(alerts, 'GET'))).text();
    expect(html).toContain('Stop alert emails?');
    expect(html).toContain('s=alerts');
  });

  it('the trial job ignores an alerts-only unsubscribe', () => {
    const route = readFileSync('app/api/cron/trial-emails/route.ts', 'utf8');
    expect(route).toContain("r.scope !== 'alerts'");
  });
});

describe('housekeeping', () => {
  it('removes what is past its retention and keeps what is not', async () => {
    const company = companyX;
    await t.asSystem(`insert into public.invitations (company_id, email, role, expires_at) values ($1, 'old@x.ca', 'foreman', '2000-01-01'), ($1, 'new@x.ca', 'foreman', now() - interval '29 days')`, [company]);
    await t.asSystem(`insert into public.stripe_events (id, type, created_at) values ('old', 'x', now() - interval '91 days'), ('new', 'x', now() - interval '89 days')`);
    await t.asSystem(`insert into public.ai_usage (company_id, day) values ($1, (current_date - interval '14 months')::date), ($1, (current_date - interval '12 months')::date)`, [company]);
    const record = uid(800);
    await t.asSystem(`insert into public.alerts (company_id, rule_key, module, record_id, title, message, severity, min_rank, bucket, resolved_at) values ($1, 'tasks.due', 'tasks', $2, 'Old', 'x', 'info', 1, 'd0', now() - interval '91 days'), ($1, 'rfis.due', 'rfis', $2, 'New', 'x', 'info', 1, 'd0', now() - interval '89 days')`, [company, record]);
    await t.asSystem(`insert into public.automation_events (company_id, run_date, kind, rule_key, table_name, record_id, created_at) values ($1, '2020-01-01', 'status_flip', 'old', 'x', $2, now() - interval '25 months'), ($1, '2020-01-01', 'status_flip', 'new', 'x', $2, now() - interval '23 months')`, [company, record]);
    const today = (await t.asSystem<{ d: string }>(`select current_date::text as d`))[0].d;
    const [{ r }] = await t.asService<{ r: Record<string, number> }>('select public.automation_housekeeping($1) as r', [today]);
    expect(r).toMatchObject({ invitations: 1, stripe_events: 1, ai_usage: 1, alerts: 1, automation_events: 1 });
    expect(await t.asSystem(`select email from public.invitations where email in ('old@x.ca', 'new@x.ca')`)).toEqual([{ email: 'new@x.ca' }]);
    expect(await t.asSystem(`select id from public.stripe_events where id in ('old', 'new')`)).toEqual([{ id: 'new' }]);
    expect(await t.asSystem(`select title from public.alerts where record_id = $1`, [record])).toEqual([{ title: 'New' }]);
    expect(await t.asSystem(`select rule_key from public.automation_events where record_id = $1`, [record])).toEqual([{ rule_key: 'new' }]);
  });
});

describe('browser helpers', () => {
  it('companyToday is the local date, not the UTC one', () => {
    const evening = new Date('2027-03-16T01:30:00Z');
    expect(companyToday('SK', evening)).toBe('2027-03-15');
    expect(companyToday('NL', evening)).toBe('2027-03-15');
    expect(companyToday('ON', new Date('2027-03-16T05:00:00Z'))).toBe('2027-03-16');
    expect(companyToday('BC', new Date('2027-03-16T05:00:00Z'))).toBe('2027-03-15');
  });

  it('deviceToday is YYYY-MM-DD', () => {
    expect(deviceToday(new Date(2027, 0, 5, 23, 0))).toBe('2027-01-05');
  });

  it('overdueWord flags from the row itself, whatever status the last run left', () => {
    expect(overdueWord('invoices', { status: 'Sent', due_date: on(-1) }, TODAY)).toBe('Overdue');
    expect(overdueWord('invoices', { status: 'Overdue', due_date: on(-1) }, TODAY)).toBe('Overdue');
    expect(overdueWord('invoices', { status: 'Sent', due_date: TODAY }, TODAY)).toBeNull();
    expect(overdueWord('invoices', { status: 'Paid', due_date: on(-1) }, TODAY)).toBeNull();
    expect(overdueWord('invoices', { status: 'Sent', due_date: null }, TODAY)).toBeNull();
    expect(overdueWord('sub-compliance', { status: 'Compliant', wcb_clearance_expiry: on(-1) }, TODAY)).toBe('Expired');
    expect(overdueWord('warranty', { status: 'Claimed', expiry_date: on(-1) }, TODAY)).toBeNull();
    expect(overdueWord('crm', { status: 'Lead' }, TODAY)).toBeNull();
    expect(overdueWord('projects', { status: 'Active', revised_end_date: on(-1) }, TODAY)).toBe('Past end date');
  });

  it('every highlighted date column reaches the list', () => {
    for (const rule of AUTOMATION_RULES.filter((r) => r.overdueWord)) {
      const def = MODULES.find((m) => m.slug === rule.module)!.fields.find((f) => f.key === rule.dateColumn)!;
      expect(def.type).toBe('date');
      expect(def.restricted).toBeFalsy();
    }
  });

  it('alertHref opens the detail page where there is one', () => {
    expect(alertHref({ module: 'invoices', record_id: 'x' })).toBe('/invoices/x');
    expect(alertHref({ module: 'tasks', record_id: 'x' })).toBe('/tasks');
  });
});

describe('the service role stays where it belongs', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path.replace(/\\/g, '/')] : [];
  });

  it('only known server files import the admin client', () => {
    const importers = [...walk('app'), ...walk('lib'), ...walk('components')].filter((file) => file !== 'lib/supabase/server.ts' && readFileSync(file, 'utf8').includes('createSupabaseAdminClient'));
    const allowed = new Set([
      'app/api/billing/checkout/route.ts',
      'app/api/cron/automation/route.ts',
      'app/api/cron/digest/route.ts',
      'app/api/cron/status/route.ts',
      'app/api/cron/trial-emails/route.ts',
      'app/api/email/unsubscribe/route.ts',
      'app/api/leads/route.ts',
      'app/api/stripe/webhook/route.ts',
      'app/api/team/route.ts',
      'lib/automation.ts',
      // The client portal's two server-only database calls (see tests/review.security.test.ts for what it may do)
      'lib/portal-server.ts',
    ]);
    // Any cron route may, as long as it checks the cron secret
    const isGuardedCron = (f: string) => f.startsWith('app/api/cron/') && readFileSync(f, 'utf8').includes('requireCron(request)');
    expect(importers.filter((f) => !allowed.has(f) && !isGuardedCron(f))).toEqual([]);
    expect(readFileSync('lib/alerts.ts', 'utf8')).not.toMatch(/supabase\/server|node:crypto|env'/);
  });
});
