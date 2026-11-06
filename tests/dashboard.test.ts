// The Command Center and what it can show each rank, one plan on the pricing pages, the button
// words, and the set_updated_at fix. What the database refuses is run on PGlite as the signed-in
// user. What the pages show is rendered with a stand-in database.
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';
import { bootDb, type TestDb } from './helpers/db';

const mocks = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('@/lib/context', () => ({
  getContext: async () => mocks.result,
  getPageContext: async () => mocks.result,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import CommandCenter from '@/app/(app)/page';
import AlertsPage from '@/app/(app)/alerts/page';
import BillingPage from '@/app/(app)/settings/billing/page';
import PricingView from '@/app/pricing/pricing-view';
import { AUTOMATION_RULES, companyToday, overdueWord, type AlertRow } from '@/lib/alerts';
import { listRecords } from '@/lib/crud';
import { alertCountsByModule, attentionOrder, checkIsStale, dashboardAccess, isOverdueAlert, summariseJobs } from '@/lib/dashboard';
import type { JobCost } from '@/lib/job-cost';
import { listViewFilter, listViewLabel } from '@/lib/list-views';
import { MODULES } from '@/lib/modules';
import { FOUNDING_OFFER, PLAN_FEATURES, PLAN_PRICE_MONTHLY_CAD, foundingPriceLabel, planPriceLabel } from '@/lib/plan';
import { TRIAL_STEPS } from '@/lib/trial-emails';
import type { Role } from '@/lib/roles';

const uid = (n: number) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;
const USERS = {
  owner: { id: uid(1), email: 'owner@alpha.ca' },
  admin: { id: uid(2), email: 'admin@alpha.ca' },
  pm: { id: uid(3), email: 'pm@alpha.ca' },
  foreman: { id: uid(4), email: 'foreman@alpha.ca' },
  elec: { id: uid(5), email: 'elec@alpha.ca' },
  elec2: { id: uid(6), email: 'elec2@alpha.ca' },
  rival: { id: uid(7), email: 'owner@rival.ca' },
  gone: { id: uid(8), email: 'gone@alpha.ca' },
  nobody: { id: uid(9), email: 'nobody@nowhere.ca' },
};
type U = keyof typeof USERS;
type Row = Record<string, any>;

const TODAY = '2026-11-04'; // a Wednesday
const MONDAY = '2026-11-02';
const ZONE = 'America/Regina';

describe('the database gates the figures by rank', () => {
  let t: TestDb<U>;
  let company: string;
  let rivalCompany: string;
  const figures = async (who: U) => (await t.as<{ f: Row }>(who, 'select public.dashboard_figures($1, $2) as f', [TODAY, ZONE]))[0].f;

  beforeAll(async () => {
    t = await bootDb(USERS);
    company = await t.createCompany('owner', 'Alpha Electric');
    rivalCompany = await t.createCompany('rival', 'Rival Electric');
    await t.join('owner', 'admin', 'admin');
    await t.join('owner', 'pm', 'project_manager');
    await t.join('owner', 'foreman', 'foreman');
    await t.join('owner', 'elec', 'electrician');
    await t.join('owner', 'elec2', 'electrician');
    await t.join('owner', 'gone', 'project_manager');

    const card = (who: U, date: string, regular: number, overtime: number) =>
      t.as(who, `insert into public.timecards (title, status, employee_name, work_date, regular_hours, overtime_hours, worker_user_id) values ('J', 'Submitted', $1, $2, $3, $4, $5)`, [who, date, regular, overtime, USERS[who].id]);
    await card('elec', MONDAY, 8, 2); // this week
    await card('elec', '2026-11-08', 4, 0); // the Sunday still counts
    await card('elec', '2026-11-01', 10, 0); // the Sunday before does not
    await card('elec2', TODAY, 7, 0);
    // Rejected hours aren't hours
    const [rejected] = await t.as<{ id: string }>('elec2', `insert into public.timecards (title, status, employee_name, work_date, regular_hours, worker_user_id) values ('J', 'Submitted', 'elec2', $1, 10, $2) returning id`, [TODAY, USERS.elec2.id]);
    await t.as('owner', `select public.decide_timecards($1::uuid[], 'reject', 'wrong job')`, [[rejected.id]]);

    // Sent proposals, a submitted estimate with nothing sent, one already counted through its proposal, and a draft
    await t.as('pm', `insert into public.proposals (title, status, total_amount) values ('Sent', 'Sent', 1000), ('Hand draft', 'Draft', 999)`);
    await t.as('pm', `insert into public.estimates (title, status) values ('Lone', 'Submitted'), ('Quoted', 'Submitted'), ('Unsent', 'Draft')`);
    await t.asSystem(`update public.estimates set total_amount = 500 where title = 'Lone' and company_id = $1`, [company]).catch(() => undefined);

    // Money only an admin should see totals of
    const [{ id: past }] = await t.as<{ id: string }>('owner', `insert into public.receivables (title, status, amount, due_date) values ('Late', 'Current', 400, '2026-09-01') returning id`);
    await t.as('owner', `insert into public.receivables (title, status, amount, due_date) values ('On time', 'Current', 250, $1), ('Due today', 'Current', 75, $2)`, ['2026-12-01', TODAY]);
    expect(past).toBeTruthy();
    const [{ id: invoice }] = await t.as<{ id: string }>('owner', `insert into public.invoices (title, status, tax_pct, holdback_pct, holdback_release_date, due_date, lines) values ('INV', 'Draft', 0, 10, '2026-10-01', '2026-12-01', $1) returning id`, [JSON.stringify([{ type: 'free', description: 'x', amount: 1000 }])]);
    await t.as('owner', `update public.invoices set status = 'Sent' where id = $1`, [invoice]);

    await t.as('rival', `insert into public.receivables (title, status, amount, due_date) values ('Theirs', 'Current', 9999, '2026-01-01')`);
    await t.as('rival', `insert into public.proposals (title, status, total_amount) values ('Theirs', 'Sent', 9999)`);
    expect(rivalCompany).toBeTruthy();
  });

  it('an electrician gets their own hours and no money or crew figures', async () => {
    const f = await figures('elec');
    expect(Object.keys(f)).toEqual(['labour']);
    expect(Number(f.labour.regular)).toBe(12);
    expect(Number(f.labour.overtime)).toBe(2);
    expect(f.labour.week_start).toBe(MONDAY);
    expect(JSON.stringify(f)).not.toMatch(/total|overdue|holdback|pipeline/);
  });

  it('a foreman adds the crew and timecards, still no money', async () => {
    const f = await figures('foreman');
    expect(Object.keys(f).sort()).toEqual(['labour', 'timecards']);
    expect(Number(f.labour.regular)).toBe(19);
    expect(Number(f.timecards.total)).toBe(4);
  });

  it('a project manager adds quotes, but not receivables or holdback', async () => {
    const f = await figures('pm');
    expect(Object.keys(f).sort()).toEqual(['labour', 'pipeline', 'timecards']);
    expect(Number(f.pipeline.proposals)).toBe(1);
    expect(Number(f.pipeline.estimates)).toBe(2);
    expect(Number(f.pipeline.total)).toBeGreaterThanOrEqual(1000);
    // Another company's proposal never gets in
    expect(Number(f.pipeline.total)).toBeLessThan(9999);
  });

  it('an estimate counts once: through its proposal when sent, not at all when declined', async () => {
    const [{ id: estimate }] = await t.as<{ id: string }>('pm', `select id from public.estimates where title = 'Quoted'`);
    const [{ id: proposal }] = await t.as<{ id: string }>('pm', `select public.create_proposal_from_estimate($1) as id`, [estimate]);
    expect(Number((await figures('pm')).pipeline.estimates)).toBe(2); // only a draft so far
    await t.as('pm', `update public.proposals set status = 'Sent' where id = $1`, [proposal]);
    let f = await figures('pm');
    expect(Number(f.pipeline.estimates)).toBe(1);
    expect(Number(f.pipeline.proposals)).toBe(2);
    await t.as('pm', `update public.proposals set status = 'Declined' where id = $1`, [proposal]);
    f = await figures('pm');
    expect(Number(f.pipeline.estimates)).toBe(1);
    expect(Number(f.pipeline.proposals)).toBe(1);
  });

  it('an admin and an owner get receivables and holdback, counted from the date', async () => {
    for (const who of ['admin', 'owner'] as const) {
      const f = await figures(who);
      // Due today isn't overdue. Sept 1 is 64 days back. The rival's receivable is not here.
      expect(Number(f.receivables.overdue), who).toBe(400);
      expect(Number(f.receivables.overdue_count), who).toBe(1);
      expect(Number(f.receivables.over_30), who).toBe(400);
      expect(Number(f.receivables.over_60), who).toBe(400);
      expect(Number(f.receivables.over_90), who).toBe(0);
      expect(Number(f.holdback.total), who).toBe(100);
      expect(Number(f.holdback.past_release), who).toBe(100);
    }
  });

  it('job costs stay refused below project manager, the same line the page draws', async () => {
    for (const who of ['foreman', 'elec'] as const) {
      expect(await t.fails(who, 'select public.job_cost_rollup()')).toMatch(/project manager/i);
      expect(dashboardAccess(who === 'foreman' ? 2 : 1).jobMoney).toBe(false);
    }
    expect(dashboardAccess(3)).toEqual({ crew: true, jobMoney: true, finance: false });
    expect(dashboardAccess(4)).toEqual({ crew: true, jobMoney: true, finance: true });
    expect(dashboardAccess(2)).toEqual({ crew: true, jobMoney: false, finance: false });
    expect(dashboardAccess(1)).toEqual({ crew: false, jobMoney: false, finance: false });
  });

  it('visitors and people with no company get nothing', async () => {
    expect(await t.fails(null, 'select public.dashboard_figures($1, $2)', [TODAY, ZONE])).toMatch(/permission denied/);
    expect(await t.fails('nobody', 'select public.dashboard_figures($1, $2)', [TODAY, ZONE])).toMatch(/Sign in to a company/);
    expect(await t.fails('owner', 'select public.dashboard_figures($1, $2)', [null, ZONE])).toMatch(/date is required/);
  });

  it('ages timecards from the company-local day they were entered, so the buckets meet the alert', async () => {
    // 22:00 on Oct 31 in Regina is already Nov 1 in UTC: that's 4 days old on Nov 4, not 3
    const ages: [string, string][] = [
      ['2026-11-01 04:00:00+00', 'waiting'],
      ['2026-11-01 07:00:00+00', 'fresh'],
      ['2026-10-28 12:00:00+00', 'waiting'],
      ['2026-10-27 12:00:00+00', 'old'],
    ];
    const before = (await figures('owner')).timecards;
    const counts = { fresh: Number(before.fresh), waiting: Number(before.waiting), old: Number(before.old) } as Record<string, number>;
    for (const [at, bucket] of ages) {
      await t.asSystem(`insert into public.timecards (company_id, title, status, employee_name, regular_hours, work_date, created_at) values ($1, 'Aged', 'Submitted', 'X', 1, '2026-10-20', $2)`, [company, at]);
      counts[bucket]++;
    }
    const after = (await figures('owner')).timecards;
    expect({ fresh: Number(after.fresh), waiting: Number(after.waiting), old: Number(after.old) }).toEqual(counts);
    expect(after.oldest_work_date).toBe('2026-10-20');
  });

  it('runs as the caller, with no pay column in reach', async () => {
    const [{ prosecdef }] = await t.asSystem<{ prosecdef: boolean }>(`select prosecdef from pg_proc where proname = 'dashboard_figures'`);
    expect(prosecdef).toBe(false);
    const source = readFileSync('supabase/migrations/20261104000300_cleanups.sql', 'utf8');
    expect(source).not.toMatch(/\b(hourly_cost|labour_cost)\b/);
  });

  describe('alerts on the panel are read as the user', () => {
    beforeAll(async () => {
      const rule = (key: string) => AUTOMATION_RULES.find((r) => r.key === key)!;
      const add = (co: string, key: string, due: string | null) => {
        const r = rule(key);
        return t.asSystem(`insert into public.alerts (company_id, rule_key, module, record_id, title, message, severity, min_rank, bucket, due_on) values ($1, $2, $3, gen_random_uuid(), $4, 'm', $5, $6, 'b', $7)`, [co, key, r.module, key, r.severity, r.minRank, due]);
      };
      await add(company, 'invoices.due', '2026-10-01');
      await add(company, 'rfis.due', '2026-11-03');
      await add(rivalCompany, 'rfis.due', '2026-11-03');
    });
    const titles = async (who: U) => (await t.as<{ title: string }>(who, 'select title from public.list_my_alerts($1, 100)', [TODAY])).map((r) => r.title);

    it('an invoice alert never reaches a foreman or electrician, and another company never shows', async () => {
      expect(await titles('owner')).toEqual(expect.arrayContaining(['invoices.due', 'rfis.due']));
      expect(await titles('owner')).toHaveLength(2);
      expect(await titles('foreman')).toEqual(['rfis.due']);
      expect(await titles('elec')).toEqual(['rfis.due']);
    });
  });

  describe('set_updated_at and a deleted login', () => {
    it('clears created_by and leaves updated_at, on a module that has no trigger of its own', async () => {
      const [row] = await t.as<Row>('gone', `insert into public.rfis (title, status) values ('Asked', 'Open') returning id`);
      await t.asSystem(`update public.rfis set updated_at = '2026-01-01' where id = $1`, [row.id]).catch(() => undefined);
      const [before] = await t.asSystem<Row>('select updated_at from public.rfis where id = $1', [row.id]);
      await t.asSystem('delete from auth.users where id = $1', [USERS.gone.id]);
      const [after] = await t.asSystem<Row>('select created_by, updated_at from public.rfis where id = $1', [row.id]);
      expect(after.created_by).toBeNull();
      expect(after.updated_at).toEqual(before.updated_at);
    });

    it('still will not let a person change or blank the author', async () => {
      const [row] = await t.as<Row>('pm', `insert into public.rfis (title, status) values ('Mine', 'Open') returning id`);
      await t.as('owner', 'update public.rfis set created_by = null where id = $1', [row.id]);
      await t.as('owner', 'update public.rfis set created_by = $2 where id = $1', [row.id, USERS.foreman.id]);
      const [after] = await t.asSystem<Row>('select created_by from public.rfis where id = $1', [row.id]);
      expect(after.created_by).toBe(USERS.pm.id);
    });

    it('still stamps updated_at and keeps the company on an ordinary edit', async () => {
      const [row] = await t.as<Row>('pm', `insert into public.rfis (title, status) values ('Edit me', 'Open') returning id, company_id, updated_at`);
      await t.asSystem(`select pg_sleep(0.01)`);
      await t.as('pm', `update public.rfis set title = 'Edited', company_id = $2 where id = $1`, [row.id, rivalCompany]).catch(() => undefined);
      const [after] = await t.asSystem<Row>('select company_id, title, updated_at from public.rfis where id = $1', [row.id]);
      expect(after.company_id).toBe(company);
      expect(after.title).toBe('Edited');
      expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(row.updated_at).getTime());
    });

    it('the migration clears ids already left behind, can run again, and switches triggers back on', async () => {
      const [row] = await t.as<Row>('foreman', `insert into public.rfis (title, status) values ('Old dangling', 'Open') returning id`);
      await t.asSystem(`alter table public.rfis drop constraint rfis_created_by_fkey`);
      await t.asSystem(`alter table public.rfis disable trigger user`);
      await t.asSystem(`update public.rfis set created_by = $2 where id = $1`, [row.id, '00000000-0000-4000-8000-000000000999']);
      await t.asSystem(`alter table public.rfis enable trigger user`);
      await t.asSystem(`alter table public.rfis add constraint rfis_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null not valid`);
      await t.pg.exec(readFileSync('supabase/migrations/20261104000300_cleanups.sql', 'utf8'));
      const [after] = await t.asSystem<Row>('select created_by from public.rfis where id = $1', [row.id]);
      expect(after.created_by).toBeNull();
      const [{ enabled }] = await t.asSystem<{ enabled: string }>(`select tgenabled as enabled from pg_trigger where tgname = 'rfis_updated'`);
      expect(enabled).toBe('O');
    });
  });
});

describe('dates and order on the Attention panel', () => {
  const alert = (id: string, severity: AlertRow['severity'], due_on: string | null) => ({ id, severity, due_on });

  it('a lapsed item stays and counts as overdue from the day after its date', () => {
    expect(isOverdueAlert({ due_on: '2026-11-03' }, TODAY)).toBe(true);
    expect(isOverdueAlert({ due_on: TODAY }, TODAY)).toBe(false);
    expect(isOverdueAlert({ due_on: '2026-11-05' }, TODAY)).toBe(false);
    expect(isOverdueAlert({ due_on: null }, TODAY)).toBe(false);
  });

  it('puts overdue first, most serious and oldest at the top, then what is coming', () => {
    const list = [alert('soon-critical', 'critical', '2026-11-20'), alert('late-info', 'info', '2026-10-01'), alert('late-warning', 'warning', '2026-11-01'), alert('late-critical-new', 'critical', '2026-11-03'), alert('late-critical-old', 'critical', '2026-09-01'), alert('soon-warning', 'warning', '2026-11-05'), alert('undated-info', 'info', null)];
    expect(attentionOrder(list, TODAY).map((a) => a.id)).toEqual(['late-critical-old', 'late-critical-new', 'late-warning', 'late-info', 'soon-critical', 'soon-warning', 'undated-info']);
  });

  it('a critical incident with no date sits with the overdue ones', () => {
    const order = attentionOrder([alert('late-warning', 'warning', '2026-11-01'), alert('incident', 'critical', null), alert('soon', 'warning', '2026-11-06')], TODAY);
    expect(order.map((a) => a.id)).toEqual(['incident', 'late-warning', 'soon']);
  });

  it('uses the company day, not the UTC one: 7pm in Regina on Nov 4 is Nov 5 in UTC', () => {
    const evening = new Date('2026-11-05T01:00:00Z');
    expect(evening.toISOString().slice(0, 10)).toBe('2026-11-05');
    expect(companyToday('SK', evening)).toBe('2026-11-04');
    expect(isOverdueAlert({ due_on: '2026-11-04' }, companyToday('SK', evening))).toBe(false);
  });

  it('counts by module, busiest first', () => {
    expect(alertCountsByModule([{ module: 'rfis' }, { module: 'tasks' }, { module: 'tasks' }])).toEqual([{ module: 'tasks', count: 2 }, { module: 'rfis', count: 1 }]);
  });

  it('flags a check that was missed, and not one that never ran or ran today', () => {
    const now = new Date('2026-11-04T18:00:00Z');
    expect(checkIsStale(null, now)).toBe(false);
    expect(checkIsStale('2026-11-04T10:00:00Z', now)).toBe(false);
    expect(checkIsStale('2026-11-03T10:00:00Z', now)).toBe(true);
  });
});

describe('list views', () => {
  it('match the rows the list highlights, for every module that has a date rule', () => {
    for (const rule of AUTOMATION_RULES.filter((r) => r.overdueWord)) {
      const filter = listViewFilter(rule.module, 'overdue', TODAY)!;
      expect(filter, rule.key).toContain(`${rule.dateColumn}.lt.${TODAY}`);
      expect(listViewLabel(rule.module, 'overdue'), rule.key).toMatch(/ only$/);
      const row = { status: rule.statuses?.[0] ?? 'Anything', [rule.dateColumn!]: '2026-11-03' };
      expect(overdueWord(rule.module, row, TODAY), rule.key).toBeTruthy();
      expect(overdueWord(rule.module, { ...row, [rule.dateColumn!]: TODAY }, TODAY), rule.key).toBeNull();
    }
  });

  it('quotes statuses with spaces and keeps each date rule to its own statuses', () => {
    expect(listViewFilter('rfis', 'overdue', TODAY)).toBe(`and(due_date.lt.${TODAY},status.in.("Open"))`);
    expect(listViewFilter('tasks', 'overdue', TODAY)).toBe(`and(due_date.lt.${TODAY},status.in.("To Do","In Progress"))`);
    expect(listViewFilter('sub-compliance', 'overdue', TODAY)).toBe(`liability_expiry.lt.${TODAY},wcb_clearance_expiry.lt.${TODAY}`);
  });

  it('refuses a view a module does not have, and a date that is not one', () => {
    expect(listViewFilter('crm', 'overdue', TODAY)).toBeNull();
    expect(listViewLabel('crm', 'overdue')).toBeNull();
    expect(listViewFilter('rfis', 'holdback', TODAY)).toBeNull();
    expect(listViewFilter('rfis', 'whatever', TODAY)).toBeNull();
    expect(listViewFilter('rfis', 'overdue', '2026-11-04),id.neq.(0')).toBeNull();
  });

  describe('the list route', () => {
    const list = async (query: string) => {
      const supabase = fakeSupabase({ rfis: [] });
      mocks.result = { status: 'ok', ctx: { role: 'owner', canWrite: true, user: { id: uid(1) }, supabase, company: { id: 'c', name: 'A', province: 'SK' } } };
      const res = await listRecords(new Request(`http://x/api/modules/rfis?${query}`), { params: { module: 'rfis' } });
      return { res, filters: supabase.log[0]?.filters ?? [] };
    };

    it('applies the view with the company date, and several statuses at once', async () => {
      const { filters } = await list('view=overdue');
      expect(filters).toContainEqual(['or', '', listViewFilter('rfis', 'overdue', companyToday('SK'))]);
      expect((await list('status=Open&status=Closed')).filters).toContainEqual(['in', 'status', ['Open', 'Closed']]);
      expect((await list('status=Open')).filters).toContainEqual(['eq', 'status', 'Open']);
    });

    it('ignores a status or view it does not know', async () => {
      const { filters } = await list('status=Nope&view=nope');
      expect(filters).toEqual([]);
    });
  });
});

const job = (over: Partial<JobCost>): JobCost =>
  ({ id: 'j', company_id: 'c', project_id: 'p', status: 'On Track', project_title: 'A', project_status: 'Active', client_name: null, contract_value: 0, approved_changes: 0, revised_contract: 0, budget: 0, budget_labour_hours: 0, budget_labour: 0, budget_material: 0, budget_other: 0, co_revenue: 0, co_cost: 0, co_labour_hours: 0, actual_cost: 0, actual_labour_hours: 0, actual_labour: 0, actual_material: 0, actual_other: 0, committed: 0, billed_amount: 0, paid_amount: 0, margin: 0, margin_pct: null, cost_used_pct: null, entries: {}, ...over }) as JobCost;

describe('the job summary', () => {
  it('counts active jobs only for contract and billing, and over budget wherever it is', () => {
    const s = summariseJobs([
      job({ project_id: '1', project_title: 'Thin', revised_contract: '1000.10', billed_amount: '200.05', margin: '100', margin_pct: 10 }),
      job({ project_id: '2', project_title: 'Fat', revised_contract: 500, billed_amount: 700, margin: 250, margin_pct: 50, status: 'Over Budget' }),
      job({ project_id: '3', project_title: 'No contract', revised_contract: 0, margin_pct: null }),
      job({ project_id: '4', project_title: 'On hold', project_status: 'On Hold', revised_contract: 9000, status: 'Over Budget' }),
      job({ project_id: '5', project_title: 'Closed', status: 'Closed', revised_contract: 7000 }),
    ]);
    expect(s.activeJobs).toBe(3);
    expect(s.contract).toBe(1500.1);
    expect(s.billed).toBe(900.05);
    // Billing over on Fat doesn't hide what's left on Thin
    expect(s.remaining).toBe(800.05);
    expect(s.overBudget).toBe(2);
    expect(s.byMargin.map((j) => j.project_title)).toEqual(['Thin', 'Fat', 'No contract']);
    expect(s.margin).toBe(350);
    expect(s.marginPct).toBe(23.33);
  });

  it('copes with no jobs', () => {
    expect(summariseJobs([])).toMatchObject({ activeJobs: 0, contract: 0, remaining: 0, overBudget: 0, marginPct: null });
  });
});

const COMPANY = { id: '33333333-3333-4333-8333-333333333333', name: 'Alpha Electric', province: 'SK', subscription_status: 'trialing', trial_ends_at: '2099-01-01', current_period_end: null, stripe_customer_id: null };
const FIGURES = {
  labour: { week_start: MONDAY, regular: 40, overtime: 2, cards: 5 },
  timecards: { total: 3, fresh: 1, waiting: 1, old: 1, oldest_work_date: '2026-10-21' },
  pipeline: { total: 77777, proposals: 2, estimates: 1 },
  receivables: { outstanding: 66666, overdue: 55555, overdue_count: 2, over_30: 11111, over_60: 0, over_90: 0 },
  holdback: { total: 44444, invoices: 3, past_release: 0 },
};
const FIGURE_KEYS: Record<Role, (keyof typeof FIGURES)[]> = {
  electrician: ['labour'],
  foreman: ['labour', 'timecards'],
  project_manager: ['labour', 'timecards', 'pipeline'],
  admin: ['labour', 'timecards', 'pipeline', 'receivables', 'holdback'],
  owner: ['labour', 'timecards', 'pipeline', 'receivables', 'holdback'],
};
const ROLLUP = [job({ project_id: '11111111-1111-4111-8111-111111111111', project_title: 'Unit 3 MCC', revised_contract: 33333, billed_amount: 22222, margin: 8888, margin_pct: 26 })];
const ALERT: AlertRow = { id: 'a1', rule_key: 'rfis.due', module: 'rfis', record_id: 'r1', title: 'Feeder size', message: 'Answer overdue by 2 days', severity: 'warning', min_rank: 1, bucket: 'b', due_on: '2020-01-01', bucket_changed_at: '2020-01-01' };

function dashboardAs(role: Role, opts: { failFigures?: boolean; failAlerts?: boolean; alerts?: AlertRow[]; lastChecked?: string | null } = {}) {
  const calls: string[] = [];
  const supabase = fakeSupabase(
    { rfis: [], tasks: [] },
    {
      rpc: (name, args) => {
        calls.push(name);
        if (name === 'dashboard_figures') {
          if (opts.failFigures) return { data: null, error: { message: 'boom' } };
          expect(args.p_zone).toBe('America/Regina');
          // What the database would return at this rank
          return { data: Object.fromEntries(FIGURE_KEYS[role].map((k) => [k, FIGURES[k]])), error: null };
        }
        if (name === 'job_cost_rollup') return { data: ROLLUP, error: null };
        if (name === 'list_my_alerts') return opts.failAlerts ? { data: null, error: { message: 'boom' } } : { data: opts.alerts ?? [], error: null };
        if (name === 'my_alert_summary') {
          const list = opts.alerts ?? [];
          return { data: { total: list.length, critical: list.filter((a) => a.severity === 'critical').length, warning: list.filter((a) => a.severity === 'warning').length, info: list.filter((a) => a.severity === 'info').length, last_checked: opts.lastChecked ?? null }, error: null };
        }
        return { data: null, error: { message: `unexpected ${name}` } };
      },
    }
  );
  mocks.result = { status: 'ok', ctx: { role, canWrite: true, user: { id: uid(1) }, supabase, company: COMPANY } };
  return { supabase, calls };
}

const render = async (page: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await page);

describe('what the Command Center shows each role', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an electrician sees hours and overdue work, and not a dollar', async () => {
    const { calls } = dashboardAs('electrician');
    const html = await render(CommandCenter());
    expect(calls).not.toContain('job_cost_rollup');
    expect(html).toContain('Your Hours This Week');
    expect(html).toContain('/rfis?view=overdue');
    expect(html).not.toContain('$');
    for (const label of ['Quotes Out', 'Active Contract Value', 'Billed vs Remaining', 'Jobs Over Budget', 'Receivables Overdue', 'Holdback Withheld', 'Margin by Project', 'Timecards to Approve', 'Open Estimates', 'Proposals Out']) expect(html, label).not.toContain(label);
  });

  it('a foreman adds timecards by age, linked to the oldest week, and still not a dollar', async () => {
    const { calls } = dashboardAs('foreman');
    const html = await render(CommandCenter());
    expect(calls).not.toContain('job_cost_rollup');
    expect(html).toContain('Labour Hours This Week');
    expect(html).toContain('Timecards to Approve');
    expect(html).toContain('1 under 4 days, 1 at 4 to 7 days, 1 over a week');
    expect(html).toContain('/timecards?week=2026-10-19');
    expect(html).not.toContain('$');
  });

  it('a project manager sees the job money and margin, but not receivables or holdback', async () => {
    dashboardAs('project_manager');
    const html = await render(CommandCenter());
    expect(html).toContain('Active Contract Value');
    expect(html).toContain('$33,333');
    expect(html).toContain('$22,222');
    expect(html).toContain('Quotes Out');
    expect(html).toContain('$77,777');
    expect(html).toContain('Margin by Project');
    expect(html).toContain('Unit 3 MCC');
    expect(html).not.toContain('Receivables Overdue');
    expect(html).not.toContain('Holdback Withheld');
    expect(html).not.toContain('receivables?view');
  });

  it('an admin sees it all, linked to filtered lists', async () => {
    dashboardAs('admin');
    const html = (await render(CommandCenter())).replace(/&amp;/g, '&');
    expect(html).toContain('$55,555');
    expect(html).toContain('$44,444');
    expect(html).toContain('/receivables?view=overdue');
    expect(html).toContain('/invoices?view=holdback');
    expect(html).toContain('/job-costing?status=Over+Budget');
    expect(html).toContain('/safety-logs?status=Open&status=Under+Investigation');
    expect(html).toContain('/proposals?status=Sent');
  });

  it('never says "this period"', async () => {
    dashboardAs('owner');
    expect(await render(CommandCenter())).not.toMatch(/this period/i);
  });

  it('a figure that fails shows a dash and says so, never a zero', async () => {
    dashboardAs('owner', { failFigures: true });
    const html = await render(CommandCenter());
    expect(html).toContain('Some figures could not be loaded');
    expect(html).toContain('—');
    expect(html).not.toContain('$0.00</p>');
  });

  it('the panel lists alerts with counts, links and when it last checked', async () => {
    dashboardAs('foreman', { alerts: [ALERT], lastChecked: new Date().toISOString() });
    const html = await render(CommandCenter());
    expect(html).toContain('Feeder size');
    expect(html).toContain('/alerts?severity=warning');
    expect(html).toContain('/alerts?module=rfis');
    expect(html).toContain('1 item is past due');
    expect(html).toContain('Last checked');
    expect(html).not.toContain('may be behind');
  });

  it('the panel owns up to a missed check, one that never ran, and failing to load', async () => {
    dashboardAs('foreman', { alerts: [ALERT], lastChecked: '2020-01-01T00:00:00Z' });
    expect(await render(CommandCenter())).toContain('may be behind');
    dashboardAs('foreman');
    const empty = await render(CommandCenter());
    expect(empty).toContain('Nothing needs your attention');
    expect(empty).toContain('Not checked yet');
    dashboardAs('foreman', { failAlerts: true });
    expect(await render(CommandCenter())).toContain('Your alerts could not be loaded');
  });

  it('the alerts page accepts its filters and ignores nonsense', async () => {
    dashboardAs('foreman');
    expect(await render(AlertsPage({ searchParams: { module: 'rfis' } }))).toContain('Alerts: RFIs');
    expect(await render(AlertsPage({ searchParams: { module: 'nope', severity: 'loud' } }))).toContain('>Alerts</h1>');
  });
});

describe('one plan, sold honestly', () => {
  const pages = async () => {
    dashboardAs('owner');
    return { pricing: renderToStaticMarkup(createElement(PricingView)), billing: await render(BillingPage({ searchParams: {} })) };
  };

  it('both pages show the one price from lib/plan.ts, and the default is what was asked for', async () => {
    expect(PLAN_PRICE_MONTHLY_CAD).toBe(299);
    const { pricing, billing } = await pages();
    for (const html of [pricing, billing]) {
      expect(html).toContain(planPriceLabel());
      expect(html).toContain('CAD / month');
      for (const f of PLAN_FEATURES) expect(html.replace(/&amp;/g, '&')).toContain(f);
    }
    expect(pricing).not.toMatch(/\$(99|699|1,500|19|499|750)\b/);
  });

  it('promises no tiers, seat caps or extras, and nothing the scope parked', async () => {
    const { pricing, billing } = await pages();
    const sold = `${pricing} ${billing} ${PLAN_FEATURES.join(' ')} ${JSON.stringify(TRIAL_STEPS)}`;
    expect(sold).not.toMatch(/Up to \d+ users|Extra users|Enterprise from|Contractor<|Most popular|Annual|per year|CAD \/ year|2 months free|Unlimited team/i);
    expect(sold).not.toMatch(/coming soon|client portal|AI estimat|AI proposal|cost prediction|material catalog|Guided onboarding|Data import/i);
  });

  it('keeps the founding offer to what one Stripe coupon can honour', async () => {
    expect(FOUNDING_OFFER).toEqual({ enabled: true, percentOff: 40, spots: 25 });
    expect(foundingPriceLabel()).toBe('$179.40');
    expect(readFileSync('app/api/billing/checkout/route.ts', 'utf8')).toContain('allow_promotion_codes: true');
    const { pricing } = await pages();
    expect(pricing).toContain('$179.40');
    expect(pricing).toContain('code to enter at checkout');
    expect(pricing).not.toMatch(/for life/i);
  });

  it('no hard-coded price or module count is left in the copy', () => {
    for (const file of ['app/pricing/pricing-view.tsx', 'app/(app)/settings/billing/page.tsx', 'app/about/page.tsx', 'app/(app)/help/page.tsx', 'lib/trial-emails.ts', 'README.md']) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\b44 modules\b|\$299|all 44/i);
    }
  });

  it('the trial email no longer promises a 30-day list', () => {
    const step = TRIAL_STEPS.find((s) => s.id === 'compliance')!;
    expect(step.subject).not.toMatch(/30 days/);
    expect(step.body.join(' ')).toContain('Attention panel');
  });
});

describe('button words', () => {
  it('every New button reads as a thing you make', () => {
    for (const mod of MODULES) {
      const label = mod.recordLabel ?? mod.titleLabel;
      expect(label, mod.slug).not.toMatch(/\/|Title|^Name$|^Item$|^Check$|^Test$|^Entry$|^Question$|^Request$/);
    }
  });
});

describe('.env.example', () => {
  it('lists every setting the scheduled jobs and emails read', () => {
    const example = readFileSync('.env.example', 'utf8');
    for (const name of ['CRON_SECRET', 'UNSUBSCRIBE_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'BUSINESS_NAME', 'BUSINESS_MAILING_ADDRESS', 'OPERATOR_EMAIL']) expect(example, name).toContain(`${name}=`);
  });
});
