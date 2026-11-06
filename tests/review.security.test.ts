// Adversarial security review across the engines: tenancy, rank, grants, service role and cron.
// Runs on PGlite as real database roles, because signed-in users hold the anon key and a session
// and can call PostgREST directly, without going through any route in app/api.
//
// The "BUG:" tests fail on purpose until the bug they name is fixed. Everything else is a
// passing check that a seam between engines holds.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootDb, OLD_BASELINE_FIXTURE, type TestDb } from './helpers/db';
import { fakeSupabase } from './helpers/fake-supabase';
import { AUTOMATION_RULES } from '@/lib/alerts';
import { getModule } from '@/lib/modules';

const mocks = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/lib/context', async (original) => ({
  ...(await original<typeof import('@/lib/context')>()),
  getContext: async () => ({ status: 'ok', ctx: mocks.ctx }),
}));

import { GET as companyGet } from '@/app/api/company/route';
import { GET as cronAutomation } from '@/app/api/cron/automation/route';
import { GET as cronDigest } from '@/app/api/cron/digest/route';
import { GET as cronJobCosts } from '@/app/api/cron/job-costs/route';
import { GET as cronStatus } from '@/app/api/cron/status/route';
import { GET as cronTrial } from '@/app/api/cron/trial-emails/route';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const users = {
  ownerA: { id: id(1), email: 'owner@alpha.ca' },
  pmA: { id: id(2), email: 'pm@alpha.ca' },
  foremanA: { id: id(3), email: 'foreman@alpha.ca' },
  elecA: { id: id(4), email: 'elec@alpha.ca' },
  ownerB: { id: id(5), email: 'owner@bravo.ca' },
  ownerC: { id: id(6), email: 'owner@charlie.ca' },
  elecC: { id: id(7), email: 'elec@charlie.ca' },
};
type U = keyof typeof users;
type Row = Record<string, any>;

let t: TestDb<U>;
let companyA: string;
let companyB: string;
let projectA: string;
let projectB: string;
let estimateB: string;
let poB: string;

const ins = async (who: U, table: string, values: Row): Promise<Row> => {
  const keys = Object.keys(values);
  const [row] = await t.as<Row>(who, `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(values));
  return row;
};
const refused = async (work: Promise<unknown>): Promise<string | null> => {
  try {
    await work;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const rollup = async (who: U, project: string): Promise<Row> => {
  const [row] = await t.as<{ r: Row[] }>(who, 'select public.job_cost_rollup($1) as r', [project]);
  return row.r[0];
};

beforeAll(async () => {
  t = await bootDb(users);
  companyA = await t.createCompany('ownerA', 'Alpha');
  companyB = await t.createCompany('ownerB', 'Bravo');
  await t.join('ownerA', 'pmA', 'project_manager');
  await t.join('ownerA', 'foremanA', 'foreman');
  await t.join('ownerA', 'elecA', 'electrician');
  projectA = (await ins('ownerA', 'projects', { title: 'Alpha job', status: 'Active', contract_value: 50000 })).id;
  projectB = (await ins('ownerB', 'projects', { title: 'Bravo job', status: 'Active', contract_value: 90000 })).id;
  estimateB = (await ins('ownerB', 'estimates', { title: 'Bravo secret bid', status: 'Draft', labour_rate: 80, markup_percentage: 20, tax_percentage: 5 })).id;
  await t.as('ownerB', 'select public.save_estimate_items($1, $2)', [estimateB, JSON.stringify([{ description: 'Switchgear', quantity: 1, unit: 'ea', material_unit_cost: 12345, labour_hours_per_unit: 10 }])]);
  poB = (await ins('ownerB', 'purchase_orders', { title: 'Bravo PO', status: 'Issued', project_id: projectB, amount: 7000 })).id;
});

describe('BUG: an update can name another company to get past the link check', () => {
  // guard_record_links compares the target's company with new.company_id. Triggers fire in name
  // order, so *_links runs before *_updated, which is what puts company_id back. A client that
  // sends company_id in the same update passes the check with a value that is then discarded.
  it("job_cost_entries: a project manager cannot put a cost on another company's job", async () => {
    const entry = await ins('pmA', 'job_cost_entries', { project_id: projectA, category: 'Other', description: 'Real cost', amount: 100 });
    await refused(t.as('pmA', 'update public.job_cost_entries set company_id = $1, project_id = $2, amount = 999999 where id = $3', [companyB, projectB, entry.id]));
    const [row] = await t.asSystem<Row>('select project_id from public.job_cost_entries where id = $1', [entry.id]);
    expect(row.project_id).toBe(projectA);
    expect(Number((await rollup('ownerB', projectB)).actual_cost)).toBe(0);
  });

  it("payables: an owner cannot add a bill to another company's job cost", async () => {
    const bill = await ins('ownerA', 'payables', { title: 'Bill', status: 'Approved', amount: 5000, project_id: projectA });
    await refused(t.as('ownerA', 'update public.payables set company_id = $1, project_id = $2 where id = $3', [companyB, projectB, bill.id]));
    expect(Number((await rollup('ownerB', projectB)).actual_material)).toBe(0);
  });

  it("payables: a bill cannot clear what another company's purchase order has committed", async () => {
    const bill = await ins('ownerA', 'payables', { title: 'Bill 2', status: 'To Approve', amount: 1 });
    await refused(t.as('ownerA', 'update public.payables set company_id = $1, purchase_order_id = $2 where id = $3', [companyB, poB, bill.id]));
    expect(Number((await rollup('ownerB', projectB)).committed)).toBe(7000);
  });

  it("projects: a project manager cannot read another company's estimate costs through the budget seed", async () => {
    const mine = await ins('pmA', 'projects', { title: 'Empty job', status: 'Planning' });
    await refused(t.as('pmA', 'update public.projects set company_id = $1, estimate_id = $2 where id = $3', [companyB, estimateB, mine.id]));
    await refused(t.as('pmA', 'select public.seed_job_budget_from_estimate($1)', [mine.id]));
    const job = await rollup('pmA', mine.id);
    expect(Number(job.budget_material)).toBe(0);
    expect(Number(job.budget_labour)).toBe(0);
  });

  it('daily_logs: a row in another company cannot pin a project so its owner can no longer delete it', async () => {
    const victim = await ins('ownerB', 'projects', { title: 'Bravo pinned', status: 'Planning' });
    const log = await ins('elecA', 'daily_logs', { title: 'Log', status: 'Draft' });
    await refused(t.as('elecA', 'update public.daily_logs set company_id = $1, project_id = $2 where id = $3', [companyB, victim.id, log.id]));
    expect(await refused(t.as('ownerB', 'delete from public.projects where id = $1', [victim.id]))).toBeNull();
  });

  it("proposals: a sent proposal built from an estimate keeps the estimate's price", async () => {
    const est = await ins('pmA', 'estimates', { title: 'Bid', status: 'Draft', labour_rate: 0, markup_percentage: 0, tax_percentage: 0 });
    await t.as('pmA', 'select public.save_estimate_items($1, $2)', [est.id, JSON.stringify([{ description: 'x', quantity: 1, unit: 'ea', material_unit_cost: 1000, labour_hours_per_unit: 0 }])]);
    const [{ id: proposal }] = await t.as<Row>('pmA', 'select public.create_proposal_from_estimate($1) as id', [est.id]);
    await t.as('pmA', `update public.proposals set status = 'Sent' where id = $1`, [proposal]);
    // Any uuid will do, it never has to exist: the value is thrown away before the foreign key looks
    await refused(t.as('pmA', 'update public.proposals set company_id = $1, total_amount = 1 where id = $2', [id(999), proposal]));
    const [row] = await t.as<Row>('pmA', 'select total_amount from public.proposals where id = $1', [proposal]);
    expect(Number(row.total_amount)).toBe(1000);
  });
});

describe('BUG: cost and markup reach ranks the money rules keep them from', () => {
  // Contract money and job cost start at project manager (20261104000310, job_cost_rollup).
  // A change order carries the same money line by line, and the company row carries the rate.
  it("a foreman cannot read a change order's markup, costs or price", async () => {
    const co = await ins('pmA', 'change_orders', { title: 'Add VFDs', status: 'Draft', project_id: projectA, material_cost: 1000, labour_hours: 10, labour_rate: 90, markup_pct: 25, tax_pct: 5 });
    for (const column of ['markup_pct', 'material_cost', 'labour_rate', 'budget_cost', 'cost_impact', 'price']) {
      expect((await refused(t.as('foremanA', `select ${column} from public.change_orders where id = $1`, [co.id]))) ?? 'it was readable', column).toMatch(/permission denied/);
    }
  });

  it('crew cannot read the company labour rate or default markup', async () => {
    for (const who of ['elecA', 'foremanA'] as U[]) {
      for (const column of ['default_labour_rate', 'default_markup']) {
        expect((await refused(t.as(who, `select ${column} from public.companies`))) ?? 'it was readable', `${who} ${column}`).toMatch(/permission denied/);
      }
    }
  });

  it('GET /api/company does not hand the labour rate and markup to an electrician', async () => {
    const supabase = fakeSupabase({ companies: [{ id: 'c1', name: 'Alpha', default_labour_rate: 72, default_markup: 15 }] });
    mocks.ctx = { supabase, user: { id: 'u' }, role: 'electrician', company: { id: 'c1' }, canWrite: true };
    const res = await companyGet();
    const asked = supabase.log.find((l) => l.table === 'companies')?.columns ?? '';
    expect(res.status === 403 || !/default_labour_rate|default_markup/.test(asked)).toBe(true);
  });
});

describe('BUG: a rule the route enforces and the database does not', () => {
  it('a lapsed company cannot change member roles by calling the function directly', async () => {
    const lapsed = await t.createCompany('ownerC', 'Lapsed Co');
    await t.join('ownerC', 'elecC', 'electrician');
    await t.setLapsed(lapsed, true);
    await refused(t.as('ownerC', `select public.set_member_role($1, 'foreman')`, [users.elecC.id]));
    const [row] = await t.asSystem<Row>('select role from public.company_users where user_id = $1', [users.elecC.id]);
    expect(row.role).toBe('electrician');
  });
});

describe('seams that hold: tenancy', () => {
  it('links to another company are refused on a plain update and on insert', async () => {
    const log = await ins('elecA', 'daily_logs', { title: 'Plain', status: 'Draft' });
    expect(await refused(t.as('elecA', 'update public.daily_logs set project_id = $1 where id = $2', [projectB, log.id]))).toMatch(/could not be found/);
    expect(await refused(ins('pmA', 'job_cost_entries', { project_id: projectB, category: 'Other', description: 'x', amount: 1 }))).toMatch(/could not be found/);
    expect(await refused(ins('ownerA', 'payables', { title: 'x', status: 'To Approve', purchase_order_id: poB }))).toMatch(/could not be found/);
  });

  it('tables whose own guard runs first refuse or pin a forged company', async () => {
    const card = await ins('foremanA', 'timecards', { title: 'x', status: 'Submitted', employee_name: 'Mike', regular_hours: 8, work_date: '2026-11-02' });
    expect(await refused(t.as('foremanA', 'update public.timecards set company_id = $1, project_id = $2 where id = $3', [companyB, projectB, card.id]))).toMatch(/could not be found/);
    const co = await ins('pmA', 'change_orders', { title: 'x', status: 'Draft' });
    expect(await refused(t.as('pmA', 'update public.change_orders set company_id = $1, project_id = $2 where id = $3', [companyB, projectB, co.id]))).toMatch(/permission/);
    const inv = await ins('ownerA', 'invoices', { title: 'x', status: 'Draft' });
    expect(await refused(t.as('ownerA', 'update public.invoices set company_id = $1, project_id = $2 where id = $3', [companyB, projectB, inv.id]))).toMatch(/permission/);
  });

  it("estimate lines cannot reach another company's estimate", async () => {
    expect(await refused(ins('ownerA', 'estimate_items', { estimate_id: estimateB, description: 'x', quantity: 1, unit: 'ea', material_unit_cost: 1, labour_hours_per_unit: 0 }))).toMatch(/row-level security/);
    expect(await refused(t.as('ownerA', 'select public.save_estimate_items($1, $2)', [estimateB, '[]']))).toMatch(/not found/i);
  });

  it("invoice lines cannot bill another company's change order or draw", async () => {
    const co = await ins('ownerB', 'change_orders', { title: 'B change', status: 'Draft', project_id: projectB, material_cost: 10 });
    const inv = await ins('ownerA', 'invoices', { title: 'y', status: 'Draft' });
    expect(await refused(t.as('ownerA', 'select public.save_invoice($1, $2, $3)', [inv.id, '{}', JSON.stringify([{ type: 'change_order', change_order_id: co.id }])]))).toMatch(/could not be found/);
    const draw = await ins('ownerB', 'progress_billing', { title: 'B draw', status: 'Draft', project_id: projectB, amount_billed: 10 });
    expect(await refused(t.as('ownerA', 'select public.save_invoice($1, $2, $3)', [inv.id, '{}', JSON.stringify([{ type: 'draw', progress_billing_id: draw.id }])]))).toMatch(/could not be found/);
  });

  it("every function taking an id answers only for the caller's company", async () => {
    const [{ r: money }] = await t.as<Row>('ownerA', 'select public.project_money($1) as r', [[projectB]]);
    expect(money).toEqual([]);
    const [{ r: costs }] = await t.as<Row>('ownerA', 'select public.job_cost_rollup($1) as r', [projectB]);
    expect(costs).toEqual([]);
    const card = await ins('ownerB', 'timecards', { title: 'x', status: 'Submitted', employee_name: 'Bea', regular_hours: 1, work_date: '2026-11-02' });
    const [{ r: pay }] = await t.as<Row>('ownerA', 'select public.timecard_pay($1) as r', [[card.id]]);
    expect(pay).toEqual([]);
    const [{ r: decided }] = await t.as<Row>('ownerA', `select public.decide_timecards($1, 'approve') as r`, [[card.id]]);
    expect(decided.done).toBe(0);
    expect(await refused(t.as('ownerA', 'select public.set_job_budget($1, 0, 1, 1, 1)', [projectB]))).toMatch(/not found/i);
    expect(await refused(t.as('ownerA', 'select public.set_job_closed($1, true)', [projectB]))).toMatch(/not found/i);
    expect(await refused(t.as('ownerA', 'select public.seed_job_budget_from_estimate($1)', [projectB]))).toMatch(/not found/i);
    expect(await refused(t.as('ownerA', 'select public.create_invoice_from_project($1)', [projectB]))).toMatch(/not found/i);
    expect(await refused(t.as('ownerA', 'select public.create_draw_from_project($1)', [projectB]))).toMatch(/not found/i);
    expect(await refused(t.as('ownerA', 'select public.create_proposal_from_estimate($1)', [estimateB]))).toMatch(/not found/i);
    const permit = await ins('ownerB', 'loto_permits', { title: 'B', status: 'Draft', equipment_isolated: 'x', authorized_person: 'y' });
    expect(await refused(t.as('ownerA', `select public.sign_safety_record('loto-permits', $1, 'lock_on', 'Me', 'data:image/png;base64,AAAA')`, [permit.id]))).toMatch(/not found/i);
    expect(await refused(t.as('ownerA', `select public.reopen_safety_record('loto-permits', $1, 'why')`, [permit.id]))).toMatch(/not found/i);
  });

  it("alerts stay in their company, and one person's snooze is only theirs", async () => {
    const [{ r }] = await t.as<Row>('ownerB', `insert into public.safety_logs (title, status, severity) values ('Fall', 'Open', 'Critical') returning id as r`);
    const [alert] = await t.asSystem<Row>('select id, company_id from public.alerts where record_id = $1', [r]);
    expect(alert.company_id).toBe(companyB);
    expect(await t.as('ownerA', 'select id from public.alerts where id = $1', [alert.id])).toEqual([]);
    expect(await refused(t.as('ownerA', `select public.dismiss_alert($1)`, [alert.id]))).toMatch(/not found/i);
    expect(await refused(t.as('ownerA', `select public.snooze_alert($1, '2030-01-01')`, [alert.id]))).toMatch(/not found/i);
    expect(await refused(t.as('ownerA', 'insert into public.alert_member_state (alert_id, user_id) values ($1, $2)', [alert.id, users.ownerA.id]))).toMatch(/row-level security/);
    await t.as('ownerB', 'select public.dismiss_alert($1)', [alert.id]);
    expect(await refused(t.as('ownerB', 'insert into public.alert_member_state (alert_id, user_id) values ($1, $2)', [alert.id, users.ownerA.id]))).toMatch(/row-level security/);
  });

  it("storage is by company folder, and paths only open on the caller's own open records", async () => {
    const name = `${companyB}/daily-logs/${id(50)}/a.jpg`;
    await t.asSystem(`insert into storage.objects (bucket_id, name, owner_id) values ('job-photos', $1, 'x')`, [name]);
    expect(await t.as('ownerA', 'select name from storage.objects where name = $1', [name])).toEqual([]);
    expect(await t.as('ownerA', 'delete from storage.objects where name = $1 returning id', [name])).toEqual([]);
    expect(await refused(t.as('ownerA', `insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [`${companyB}/daily-logs/${id(50)}/b.jpg`]))).toMatch(/row-level security/);
    const log = await ins('ownerB', 'daily_logs', { title: 'B', status: 'Draft' });
    expect(await refused(t.as('ownerA', `insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [`${companyA}/daily-logs/${log.id}/b.jpg`]))).toMatch(/row-level security/);
    const permit = await ins('ownerB', 'loto_permits', { title: 'B2', status: 'Draft', equipment_isolated: 'x', authorized_person: 'y' });
    expect(await refused(t.as('ownerA', `insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [`${companyA}/loto-permits/${permit.id}/b.jpg`]))).toMatch(/row-level security/);
    expect((await t.asSystem<Row>(`select public from storage.buckets where id = 'job-photos'`))[0].public).toBe(false);
  });
});

describe('seams that hold: rank', () => {
  it('pay and contract columns are closed to every signed-in user, and the functions to the wrong rank', async () => {
    for (const who of ['ownerA', 'pmA', 'foremanA', 'elecA'] as U[]) {
      expect(await refused(t.as(who, 'select hourly_cost from public.timecards'))).toMatch(/permission denied/);
      expect(await refused(t.as(who, 'select labour_cost from public.timecards'))).toMatch(/permission denied/);
      expect(await refused(t.as(who, 'select contract_value from public.projects'))).toMatch(/permission denied/);
      expect(await refused(t.as(who, 'select revised_contract from public.projects'))).toMatch(/permission denied/);
      expect(await refused(t.as(who, 'select * from public.timecards'))).toMatch(/permission denied/);
    }
    for (const who of ['foremanA', 'elecA'] as U[]) {
      for (const sql of ['select public.project_money($1)', 'select public.timecard_pay($1)']) expect(await refused(t.as(who, sql, [[projectA]])), sql).toMatch(/project manager/);
      expect(await refused(t.as(who, 'select public.job_cost_rollup()'))).toMatch(/project manager/);
      expect(await refused(t.as(who, `select public.export_timecards('2020-01-01', '2030-01-01', true)`))).toMatch(/project manager/);
      expect(await refused(t.as(who, 'select public.project_balance($1)', [projectA]))).toMatch(/project manager/);
      expect(await t.as(who, 'select id from public.job_costing')).toEqual([]);
      expect(await t.as(who, 'select id from public.job_cost_entries')).toEqual([]);
      expect(await t.as(who, 'select id from public.employees')).toEqual([]);
      expect(await t.as(who, 'select id from public.estimate_items')).toEqual([]);
    }
    for (const who of ['pmA', 'foremanA', 'elecA'] as U[]) {
      expect(await t.as(who, 'select id from public.invoices')).toEqual([]);
      expect(await t.as(who, 'select id from public.payables')).toEqual([]);
      expect(await t.as(who, 'select id from public.receivables')).toEqual([]);
    }
  });

  it('dashboard figures leave out what a rank may not see', async () => {
    const figures = async (who: U) => (await t.as<Row>(who, `select public.dashboard_figures('2026-11-04', 'America/Regina') as r`))[0].r;
    expect(Object.keys(await figures('elecA')).sort()).toEqual(['labour']);
    expect(Object.keys(await figures('foremanA')).sort()).toEqual(['labour', 'timecards']);
    expect(Object.keys(await figures('pmA')).sort()).toEqual(['labour', 'pipeline', 'timecards']);
  });

  it('no alert rule shows a record to a rank that cannot read its module', async () => {
    const rules = await t.asSystem<Row>('select key, module, min_rank from public.automation_rules');
    expect(rules.length).toBe(AUTOMATION_RULES.length);
    for (const rule of rules) expect(rule.min_rank, rule.key).toBeGreaterThanOrEqual(getModule(rule.module)!.read);
  });

  it('computed and billing columns cannot be set by hand', async () => {
    const card = await ins('elecA', 'timecards', { title: 'x', status: 'Submitted', employee_name: 'Me', regular_hours: 8, work_date: '2026-11-03', hourly_cost: 500, labour_cost: 5000 });
    const [row] = await t.asSystem<Row>('select hourly_cost, labour_cost, worker_user_id from public.timecards where id = $1', [card.id]);
    expect(row.hourly_cost).toBeNull();
    expect(row.labour_cost).toBeNull();
    expect(row.worker_user_id).toBe(users.elecA.id);
    expect(await refused(t.as('elecA', `update public.timecards set status = 'Approved' where id = $1`, [card.id]))).toMatch(/foreman or above/);
    expect(await refused(t.as('ownerA', `update public.companies set subscription_status = 'active'`))).toMatch(/permission denied/);
    expect(await refused(t.as('ownerA', `update public.company_users set role = 'owner'`))).toMatch(/permission denied/);
    expect(await refused(t.as('pmA', `update public.job_costing set budget = 1`))).toMatch(/permission denied/);
    expect(await refused(t.as('ownerA', `insert into public.alerts (company_id, rule_key, module, record_id, title, message, severity, min_rank, bucket) values ($1, 'tasks.due', 'tasks', $1, 't', 'm', 'info', 1, 'd0')`, [companyA]))).toMatch(/permission denied/);
    expect(await refused(t.as('ownerA', `insert into public.invitations (company_id, email, role) values ($1, 'y@alpha.ca', 'owner')`, [companyA]))).toMatch(/check constraint/);
  });
});

describe('seams that hold: grants and row security', () => {
  it('every table has row security, and nothing is open to anon', async () => {
    const tables = await t.asSystem<Row>(`select c.relname, c.relrowsecurity as rls, has_table_privilege('anon', c.oid, 'select, insert, update, delete') as anon
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`);
    expect(tables.length).toBeGreaterThan(60);
    expect(tables.filter((r) => !r.rls).map((r) => r.relname)).toEqual([]);
    expect(tables.filter((r) => r.anon).map((r) => r.relname)).toEqual([]);
    expect(await t.asSystem(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')`)).toEqual([]);
  });

  it('server-only tables are closed to signed-in users', async () => {
    for (const table of ['automation_rules', 'automation_events', 'automation_runs', 'digest_sends', 'company_counters', 'email_unsubscribes', 'trial_emails', 'rate_limits', 'stripe_events', 'leads']) {
      expect(await refused(t.as('ownerA', `select 1 from public.${table}`)), table).toMatch(/permission denied/);
    }
    for (const op of ['update public.alerts set title = $1', 'delete from public.automation_company_state where $1::text is not null']) {
      expect(await refused(t.as('ownerA', op, ['x'])), op).toMatch(/permission denied/);
    }
  });

  it('every write policy checks company and lapse, except the two kept on purpose', async () => {
    const policies = await t.asSystem<Row>(`select tablename, policyname, cmd, coalesce(qual, '') || coalesce(with_check, '') as body from pg_policies where schemaname = 'public'`);
    const noCompany = policies.filter((p) => !/user_company_id/.test(p.body)).map((p) => p.policyname);
    expect(noCompany.every((p) => p.startsWith('alert_member_state_'))).toBe(true);
    const noLapse = policies.filter((p) => p.cmd !== 'SELECT' && !/company_can_write/.test(p.body)).map((p) => p.policyname).sort();
    expect(noLapse).toEqual(['companies_update', 'invitations_delete']);
  });

  it('no function runs for anon, and every definer function a user can call has a rank or company check', async () => {
    const fns = await t.asSystem<Row>(`select p.oid::regprocedure::text as sig, p.proname, p.prosecdef, p.prosrc, p.proconfig,
        has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth, pg_get_function_result(p.oid) as result
      from pg_proc p where p.pronamespace = 'public'::regnamespace`);
    expect(fns.filter((f) => f.anon).map((f) => f.sig)).toEqual([]);
    const definers = fns.filter((f) => f.prosecdef);
    expect(definers.filter((f) => !f.proconfig?.includes('search_path=""')).map((f) => f.sig)).toEqual([]);
    const callable = definers.filter((f) => f.auth && f.result !== 'trigger');
    // Each of these reads only the caller's own session, or checks it through a helper
    for (const f of callable) {
      expect(/user_company_id|user_rank|auth\.uid\(\)|auth\.jwt\(\)/.test(f.prosrc), `${f.sig} has no company check`).toBe(true);
    }
    expect(callable.map((f) => f.proname).sort()).toEqual([
      'accept_invitation', 'change_order_money', 'company_billing_ids', 'company_can_write', 'company_rates', 'consume_ai_message', 'consume_user_rate_limit', 'create_company', 'export_timecards', 'job_cost_rollup', 'job_photo_log_open',
      'pending_invitations', 'project_money', 'remove_member', 'safety_photo_open', 'seed_job_budget_from_estimate', 'set_job_budget', 'set_job_closed', 'set_member_role', 'timecard_pay', 'timecard_workers', 'user_company_id', 'user_rank',
    ]);
  });

  it('a database upgraded from the old baseline ends up with the same security as a new one', async () => {
    const snapshot = async (db: TestDb<U>) => ({
      policies: await db.asSystem(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname in ('public', 'storage') order by 1, 2`),
      columns: await db.asSystem(`select table_name, column_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3`),
      functions: await db.asSystem(`select p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig::text, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
      triggers: await db.asSystem(`select tgrelid::regclass::text as tbl, tgname, tgenabled from pg_trigger where not tgisinternal order by 1, 2`),
    });
    const upgraded = await bootDb(users, { baselineSql: readFileSync(OLD_BASELINE_FIXTURE, 'utf8') });
    const [a, b] = [await snapshot(t), await snapshot(upgraded)];
    expect(b.policies).toEqual(a.policies);
    expect(b.columns).toEqual(a.columns);
    expect(b.functions).toEqual(a.functions);
    expect(b.triggers).toEqual(a.triggers);
  }, 120_000);
});

describe('seams that hold: routes and the service role', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const routes = walk('app/api').filter((f) => f.endsWith('route.ts')).map((f) => ({ path: f.replace(/\\/g, '/'), src: readFileSync(f, 'utf8') }));

  afterEach(() => vi.unstubAllEnvs());

  it('only the allowed files touch the service role', () => {
    const uses = [...walk('app'), ...walk('lib'), ...walk('components')]
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /createSupabaseAdminClient|SUPABASE_SERVICE_ROLE|supabaseServiceRoleKey/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(/\\/g, '/'))
      .sort();
    expect(uses).toEqual([
      'app/api/billing/checkout/route.ts',
      'app/api/cron/automation/route.ts',
      'app/api/cron/digest/route.ts',
      'app/api/cron/job-costs/route.ts',
      'app/api/cron/status/route.ts',
      'app/api/cron/trial-emails/route.ts',
      'app/api/email/unsubscribe/route.ts',
      'app/api/leads/route.ts',
      'app/api/stripe/webhook/route.ts',
      'app/api/team/route.ts',
      'lib/automation.ts',
      'lib/env.ts',
      'lib/supabase/server.ts',
    ]);
  });

  it('no browser component imports the server client or the automation jobs', () => {
    const client = [...walk('app'), ...walk('components')].filter((f) => /\.tsx?$/.test(f)).filter((f) => /^\s*['"]use client['"]/m.test(readFileSync(f, 'utf8')));
    expect(client.length).toBeGreaterThan(0);
    for (const f of client) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from '@\/lib\/(supabase\/server|automation|cron|env|crud|context)'/);
  });

  it('every route says who may call it', () => {
    const open = new Set(['app/api/health/route.ts', 'app/api/leads/route.ts', 'app/api/email/unsubscribe/route.ts', 'app/api/stripe/webhook/route.ts']);
    for (const { path, src } of routes) {
      if (open.has(path)) continue;
      expect(/requireApi\(|requireCron\(|auth\.getUser\(|from '@\/lib\/crud'/.test(src), path).toBe(true);
    }
    expect(routes.find((r) => r.path.endsWith('stripe/webhook/route.ts'))!.src).toContain('constructEvent');
    expect(routes.find((r) => r.path.endsWith('email/unsubscribe/route.ts'))!.src).toContain('verifyUnsubscribeToken');
  });

  it('every write route is closed to a lapsed company, except those that have to stay open', () => {
    const exempt = ['app/api/assistant/route.ts', 'app/api/billing/checkout/route.ts', 'app/api/billing/portal/route.ts', 'app/api/company/route.ts', 'app/api/team/route.ts', 'app/api/timecards/export/route.ts'];
    for (const { path, src } of routes) {
      if (!/requireApi\(/.test(src) || exempt.includes(path)) continue;
      const handlers = src.split(/export async function /).filter((s) => /^(POST|PUT|PATCH|DELETE)/.test(s));
      for (const h of handlers) expect(/requireApi\(\{[^}]*write: true/.test(h), `${path} ${h.slice(0, 6)}`).toBe(true);
    }
    const crud = readFileSync('lib/crud.ts', 'utf8');
    for (const name of ['createRecord', 'updateRecord', 'deleteRecord']) {
      expect(crud.split(`export async function ${name}`)[1].split('export async function')[0], name).toMatch(/write: true/);
    }
  });

  it('every cron route refuses a missing or wrong secret, and refuses when none is set', async () => {
    const crons = { cronAutomation, cronDigest, cronJobCosts, cronStatus, cronTrial };
    const call = (fn: (r: Request) => Promise<Response>, auth?: string) => fn(new Request('http://x/api/cron', { headers: auth ? { authorization: auth } : {} }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const [name, fn] of Object.entries(crons)) {
      vi.stubEnv('CRON_SECRET', '');
      expect((await call(fn)).status, name).toBe(500);
      expect((await call(fn, 'Bearer ')).status, name).toBe(500);
      vi.stubEnv('CRON_SECRET', 'right-secret');
      expect((await call(fn)).status, name).toBe(401);
      expect((await call(fn, 'Bearer wrong-secret!')).status, name).toBe(401);
      expect((await call(fn, 'right-secret')).status, name).toBe(401);
    }
    expect(walk('app/api/cron').filter((f) => f.endsWith('route.ts'))).toHaveLength(Object.keys(crons).length);
  });
});
