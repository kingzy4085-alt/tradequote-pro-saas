// The last gaps in the money loop: what a stale draft can bill, who reads contract money, lead
// emails, upgrading old rows, definer search paths, and the honest wording around them.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASELINE_FILE, OLD_BASELINE_FIXTURE, bootDb, migrationFiles, readMigration, type TestDb } from './helpers/db';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ admin: null as unknown, server: null as unknown, send: null as unknown, pageContext: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mocks.admin, createSupabaseServerClient: () => mocks.server }));
vi.mock('@/lib/email', () => ({ sendEmail: (...args: unknown[]) => (mocks.send as (...a: unknown[]) => unknown)(...args) }));
vi.mock('@/lib/context', async (original) => ({ ...(await original<typeof import('@/lib/context')>()), getPageContext: async () => mocks.pageContext }));

import { POST as leads } from '@/app/api/leads/route';
import PrintEstimate from '@/app/print/estimate/[id]/page';
import { runRecordSearch } from '@/lib/assistant';
import { getRecord, listColumns, listRecords, recordColumns } from '@/lib/crud';
import { LEAD_NOTIFY_WAIT_MS, notifyOperatorOfLead } from '@/lib/lead-notify';
import { getModule } from '@/lib/modules';
import { withProjectMoney } from '@/lib/project-money';
import { generateMigration, generateSync } from '../scripts/generate-migration';

const users = {
  owner: { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' },
  admin: { id: '00000000-0000-4000-8000-00000000000b', email: 'admin@alpha.ca' },
  pm: { id: '00000000-0000-4000-8000-00000000000c', email: 'pm@alpha.ca' },
  foreman: { id: '00000000-0000-4000-8000-00000000000d', email: 'foreman@alpha.ca' },
  elec: { id: '00000000-0000-4000-8000-00000000000e', email: 'elec@alpha.ca' },
  rival: { id: '00000000-0000-4000-8000-00000000000f', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;
type Row = Record<string, unknown>;

const refused = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const FIXTURE = () => readFileSync(OLD_BASELINE_FIXTURE, 'utf8');
const MONEY = ['contract_value', 'approved_changes', 'revised_contract'];

describe('on the database', () => {
  let t: TestDb<U>;

  beforeAll(async () => {
    t = await bootDb(users);
    await t.createCompany('owner', 'Alpha Electric');
    await t.join('owner', 'admin', 'admin');
    await t.join('owner', 'pm', 'project_manager');
    await t.join('owner', 'foreman', 'foreman');
    await t.join('owner', 'elec', 'electrician');
    await t.createCompany('rival', 'Bravo Electric', 'AB');
  }, 120_000);

  const project = async (contract: number) =>
    (await t.as<{ id: string }>('pm', `insert into public.projects (title, status, contract_value) values ('Job', 'Active', $1) returning id`, [contract]))[0].id;
  const invoice = async (projectId: string, lines: unknown[]) =>
    (await t.as<{ id: string }>('admin', `insert into public.invoices (title, status, project_id, tax_pct, holdback_pct, lines) values ('Inv', 'Draft', $1, 5, 10, $2::jsonb) returning id`, [projectId, JSON.stringify(lines)]))[0].id;
  const send = (id: string) => t.as('admin', `update public.invoices set status = 'Sent' where id = $1`, [id]);
  const row = async (id: string) => (await t.asSystem<Row>('select * from public.invoices where id = $1', [id]))[0];
  const typedSent = async (projectId: string, amount: number) => {
    const id = await invoice(projectId, [{ type: 'free', description: 'Part', amount }]);
    await send(id);
    return id;
  };
  const balanceDraft = async (projectId: string) => (await t.as<{ id: string }>('admin', 'select public.create_invoice_from_project($1) as id', [projectId]))[0].id;
  const BALANCE = (amount: number) => ({ type: 'free', description: 'Balance of contract', amount });

  describe('a stale draft cannot bill past the contract', () => {
    it('brings an old balance down to what is left, and every total with it', async () => {
      const p = await project(1000);
      const stale = await invoice(p, [BALANCE(1000)]);
      await typedSent(p, 600);
      await send(stale);
      const inv = await row(stale);
      expect(inv.status).toBe('Sent');
      expect(inv.lines).toEqual([BALANCE(400)]);
      expect(Number(inv.amount)).toBe(400);
      expect(Number(inv.gst)).toBe(20);
      expect(Number(inv.holdback_amount)).toBe(40);
      expect(Number(inv.total)).toBe(380);
      // What is owed and what the job shows follow the repriced amount, not the stale one
      const [owed] = await t.asSystem<{ amount: string }>('select amount from public.receivables where invoice_id = $1', [stale]);
      expect(Number(owed.amount)).toBe(380);
      const [job] = await t.asSystem<{ billed_amount: string }>('select billed_amount from public.job_costing where project_id = $1', [p]);
      expect(Number(job.billed_amount)).toBe(1000);
    });

    it('refuses a balance when nothing is left, and leaves the draft as it was', async () => {
      const p = await project(1000);
      const stale = await balanceDraft(p);
      await typedSent(p, 1000);
      expect(await refused(send(stale))).toMatch(/nothing left to bill/);
      const inv = await row(stale);
      expect(inv.status).toBe('Draft');
      expect(Number(inv.amount)).toBe(1000);
    });

    it('follows a contract that was cut after the draft was made', async () => {
      const p = await project(1000);
      const stale = await balanceDraft(p);
      await t.as('pm', 'update public.projects set contract_value = 700 where id = $1', [p]);
      await send(stale);
      expect(Number((await row(stale)).amount)).toBe(700);
    });

    it('never raises a balance past what the person saw on the draft', async () => {
      const p = await project(1000);
      const low = await invoice(p, [BALANCE(200)]);
      await send(low);
      expect(Number((await row(low)).amount)).toBe(200);
    });

    it('lets only the first of two old balances through', async () => {
      const p = await project(1000);
      const [a, b] = [await invoice(p, [BALANCE(1000)]), await invoice(p, [BALANCE(1000)])];
      await send(a);
      expect(Number((await row(a)).amount)).toBe(1000);
      expect(await refused(send(b))).toMatch(/nothing left to bill/);
    });

    it('reprices a percent line at the contract of the day it is sent', async () => {
      const p = await project(1000);
      const draft = await invoice(p, [{ type: 'percent', percent: 50 }]);
      expect(Number((await row(draft)).amount)).toBe(500);
      await t.as('pm', 'update public.projects set contract_value = 2000 where id = $1', [p]);
      await send(draft);
      expect(Number((await row(draft)).amount)).toBe(1000);
    });

    it('refuses a percent line that would go past 100% of the contract', async () => {
      const p = await project(1000);
      const draft = await invoice(p, [{ type: 'percent', percent: 100 }]);
      await typedSent(p, 500);
      expect(await refused(send(draft))).toMatch(/past the contract/);
      expect((await row(draft)).status).toBe('Draft');
    });

    it('leaves hand-typed work alone: it is not the contract', async () => {
      const p = await project(1000);
      const extra = await invoice(p, [{ type: 'free', description: 'Extra work', amount: 5000 }]);
      await send(extra);
      expect(Number((await row(extra)).amount)).toBe(5000);
    });
  });

  describe('contract money is for project managers and up', () => {
    let job: string;
    beforeAll(async () => {
      job = await project(88888);
    });

    it.each(['foreman', 'elec'] as const)('%s cannot read it directly, by any column or filter', async (who) => {
      for (const column of MONEY) {
        expect(await refused(t.as(who, `select ${column} from public.projects`)), column).toMatch(/permission denied/);
        expect(await refused(t.as(who, `select id from public.projects where ${column} > 0`)), column).toMatch(/permission denied/);
      }
      expect(await refused(t.as(who, 'select * from public.projects'))).toMatch(/permission denied/);
      expect(await refused(t.as(who, 'select p from public.projects p'))).toMatch(/permission denied/);
    });

    it.each(['foreman', 'elec'] as const)('%s is refused by the functions that would tell them', async (who) => {
      expect(await refused(t.as(who, 'select public.project_money($1)', [[job]]))).toMatch(/project manager/);
      expect(await refused(t.as(who, 'select public.project_balance($1)', [job]))).toMatch(/project manager/);
      expect(await refused(t.as(who, 'select public.create_invoice_from_project($1)', [job]))).toBeTruthy();
      expect(await refused(t.as(who, 'select * from public.job_cost_rollup($1)', [job]))).toBeTruthy();
    });

    it.each(['foreman', 'elec'] as const)('%s still reads the project through the columns the app asks for', async (who) => {
      const mod = getModule('projects')!;
      for (const columns of [listColumns(mod), recordColumns(mod)]) {
        const rows = await t.as<Row>(who, `select ${columns} from public.projects where id = $1`, [job]);
        expect(rows).toHaveLength(1);
        for (const column of MONEY) expect(rows[0]).not.toHaveProperty(column);
      }
      await t.as(who, `select public.dashboard_figures(current_date, 'America/Regina')`);
    });

    it.each(['pm', 'admin', 'owner'] as const)('%s gets it through project_money', async (who) => {
      const [{ money }] = await t.as<{ money: Row[] }>(who, 'select public.project_money($1) as money', [[job]]);
      expect(money).toHaveLength(1);
      expect(money[0]).toMatchObject({ id: job, contract_value: 88888, approved_changes: 0, revised_contract: 88888 });
    });

    it('another company gets nothing back', async () => {
      const [{ money }] = await t.as<{ money: Row[] }>('rival', 'select public.project_money($1) as money', [[job]]);
      expect(money).toEqual([]);
    });

    it('a project manager can still set the contract and read it back', async () => {
      const mod = getModule('projects')!;
      const [saved] = await t.as<Row>('pm', `update public.projects set contract_value = 90000 where id = $1 returning ${recordColumns(mod)}`, [job]);
      expect(saved.id).toBe(job);
      const [{ money }] = await t.as<{ money: Row[] }>('pm', 'select public.project_money($1) as money', [[job]]);
      expect(money[0].revised_contract).toBe(90000);
    });
  });

  it('every security definer function pins an empty search path on a new database', async () => {
    const open = await t.asSystem<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig, '{}') @> array['search_path=""']`
    );
    expect(open).toEqual([]);
  });
});

describe('a database on the old baseline', () => {
  const OWNER = '00000000-0000-4000-8000-0000000000a1';
  const COMPANY = '11111111-1111-4111-8111-1111111111a1';
  const BILLING = '20261104000110_billing.sql';
  const PHOTOS = '20261101000100_job_photos_storage.sql';
  const GUARD = /^\s*when p_due is null or p_due = 'infinity'::date then 'Current'\n\s*when p_due = '-infinity'::date then '90\+ Days'\n/m;
  let old: TestDb<never>;
  let withoutGuard = '';

  beforeAll(async () => {
    old = (await bootDb({}, { include: (f) => f === BASELINE_FILE || f === PHOTOS, baselineSql: FIXTURE() })) as unknown as TestDb<never>;
    await old.pg.exec(`
      insert into auth.users (id, email) values ('${OWNER}', 'owner@old.ca');
      insert into public.companies (id, name, province, subscription_status, trial_ends_at) values ('${COMPANY}', 'Old', 'SK', 'active', now() + interval '1 year');
      insert into public.company_users (user_id, company_id, role) values ('${OWNER}', '${COMPANY}', 'owner');
      insert into public.projects (company_id, title, status, contract_value) values ('${COMPANY}', 'Old Job', 'Active', 5000);
      insert into public.invoices (company_id, title, status, amount, gst, due_date) values
        ('${COMPANY}', 'Never due', 'Sent', 1000, 50, 'infinity'),
        ('${COMPANY}', 'Always due', 'Sent', 2000, 100, '-infinity'),
        ('${COMPANY}', 'Normal', 'Sent', 3000, 150, current_date - 45);
    `);
    const files = migrationFiles().filter((f) => f !== BASELINE_FILE && f !== PHOTOS);
    for (const f of files.filter((x) => x < BILLING)) await old.pg.exec(readMigration(f));

    // The upgrade as it was before the guard, in a transaction that is thrown away
    const billing = readMigration(BILLING).replace(/\r\n/g, '\n');
    const stripped = billing.replace(GUARD, "when p_due is null then 'Current'\n");
    expect(stripped).not.toBe(billing);
    await old.pg.exec('begin');
    withoutGuard = (await refused(old.pg.exec(stripped))) ?? '';
    await old.pg.exec('rollback');

    for (const f of files.filter((x) => x >= BILLING)) await old.pg.exec(readMigration(f));
  }, 240_000);

  it('would have stopped the billing backfill on an infinite due date', () => {
    expect(withoutGuard).toMatch(/infinite|out of range/i);
  });

  it('now gets through it, and every old sent invoice is owed', async () => {
    const rows = await old.asSystem<{ title: string; status: string; amount: string }>(
      `select i.title, r.status, r.amount from public.receivables r join public.invoices i on i.id = r.invoice_id order by i.title`
    );
    expect(rows.map((r) => [r.title, r.status])).toEqual([
      ['Always due', '90+ Days'],
      ['Never due', 'Current'],
      ['Normal', '30 Days'],
    ]);
  });

  it('pins every definer function on the same empty search path as a new database', async () => {
    const open = await old.asSystem<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig, '{}') @> array['search_path=""']`
    );
    expect(open).toEqual([]);
  });

  it('hides contract money there too', async () => {
    const [{ can }] = await old.asSystem<{ can: boolean }>(`select has_column_privilege('authenticated', 'public.projects', 'contract_value', 'select') as can`);
    expect(can).toBe(false);
  });
});

describe('the baseline functions, upgraded onto the empty search path', () => {
  const people = { boss: { id: '00000000-0000-4000-8000-0000000000b1', email: 'boss@old.ca' }, hand: { id: '00000000-0000-4000-8000-0000000000b2', email: 'hand@old.ca' } };
  let up: TestDb<keyof typeof people>;

  beforeAll(async () => {
    up = await bootDb(people, { baselineSql: FIXTURE() });
  }, 180_000);

  it('still do their jobs, with no lookup through the search path', async () => {
    const company = await up.createCompany('boss', 'Upgraded Electric');
    await up.join('boss', 'hand', 'electrician');
    expect((await up.as<{ id: string }>('hand', 'select public.user_company_id() as id'))[0].id).toBe(company);
    expect((await up.as<{ r: number }>('hand', 'select public.user_rank() as r'))[0].r).toBe(1);
    expect((await up.as<{ w: boolean }>('hand', 'select public.company_can_write() as w'))[0].w).toBe(true);
    await up.as('boss', 'select public.set_member_role($1, $2)', [people.hand.id, 'foreman']);
    expect((await up.as<{ r: number }>('hand', 'select public.user_rank() as r'))[0].r).toBe(2);
    await up.as('boss', 'select public.consume_ai_message()');
    await up.as('boss', 'select public.remove_member($1)', [people.hand.id]);
    expect((await up.as<{ id: string | null }>('hand', 'select public.user_company_id() as id'))[0].id).toBeNull();
  });

  it('are set by the generated sync, and new databases are born that way', () => {
    const sync = generateSync();
    for (const f of ['user_company_id()', 'user_rank()', 'company_can_write()', 'create_company(text, text, text)', 'pending_invitations()', 'accept_invitation(text, text)', 'set_member_role(uuid, text)', 'remove_member(uuid)', 'consume_ai_message()']) {
      expect(sync, f).toContain(`alter function public.${f} set search_path = '';`);
    }
    expect(generateMigration()).not.toMatch(/security definer\s+set search_path = public/);
  });
});

describe('around the database', () => {
  const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' };
  const COMPANY = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01T00:00:00Z', current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null };
  const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('the project routes, by rank', () => {
    const signedIn = (role: string) => {
      const rpc = vi.fn((name: string) => (name === 'project_money' ? { data: [{ id: PROJECT_ID, contract_value: 90000, approved_changes: 10000, revised_contract: 100000 }], error: null } : { data: null, error: null }));
      const fake = fakeSupabase({ company_users: [{ user_id: USER.id, role, company: COMPANY }], projects: [{ id: PROJECT_ID, title: 'Unit 3', status: 'Active', created_at: '2026-11-01T00:00:00Z' }] }, { rpc });
      mocks.server = Object.assign(fake, { auth: { getUser: async () => ({ data: { user: USER }, error: null }) } });
      return { fake, rpc };
    };
    const list = () => listRecords(new Request('https://app.test/api/modules/projects'), { params: { module: 'projects' } });
    const one = () => getRecord(new Request('https://app.test/x'), { params: { module: 'projects', id: PROJECT_ID } });

    it.each(['foreman', 'electrician'])('%s gets the list and the record, without the money and without asking for it', async (role) => {
      const { fake, rpc } = signedIn(role);
      for (const res of [await list(), await one()]) {
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Unit 3');
        for (const column of MONEY) expect(text).not.toContain(column);
      }
      expect(rpc).not.toHaveBeenCalledWith('project_money', expect.anything());
      for (const call of fake.log.filter((c) => c.table === 'projects')) for (const column of MONEY) expect(call.columns).not.toContain(column);
    });

    it.each(['project_manager', 'admin', 'owner'])('%s gets the money filled in', async (role) => {
      signedIn(role);
      for (const res of [await list(), await one()]) {
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('"revised_contract":100000');
      }
    });

    it('a failure reading the money is an error, not a blank contract a form would save', async () => {
      const result = await withProjectMoney({ rpc: async () => ({ data: null, error: { message: 'boom' } }) }, 'project_manager', [{ id: PROJECT_ID }]);
      expect(result).toEqual({ error: { message: 'boom' } });
    });

    it('the assistant tells crew about the job but not the money', async () => {
      const crew = signedIn('foreman');
      const asked = await runRecordSearch(mocks.server as never, 'foreman', { module: 'projects' });
      expect(asked.isError).toBe(false);
      expect(asked.content).toContain('Unit 3');
      for (const column of MONEY) expect(asked.content).not.toContain(column);
      expect(crew.rpc).not.toHaveBeenCalledWith('project_money', expect.anything());

      signedIn('project_manager');
      const pm = await runRecordSearch(mocks.server as never, 'project_manager', { module: 'projects' });
      expect(pm.content).toContain('"revised_contract":100000');
    });
  });

  describe('new lead email', () => {
    const lead = { name: 'Ann <b>', company: 'Co\nInjected: yes', email: 'ann@co.ca', phone: '306-555-0100' };
    const OPERATOR = 'ops-private@tradequote.ca';
    const post = (body: unknown = { ...lead, company: 'Co' }) => leads(new Request('https://app.test/api/leads', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify(body) }));
    const configured = () => {
      vi.stubEnv('OPERATOR_EMAIL', OPERATOR);
      vi.stubEnv('RESEND_API_KEY', 'test-key');
      vi.stubEnv('EMAIL_FROM', 'TradeQuote <hello@tradequote.ca>');
    };
    const adminOk = () => {
      mocks.admin = fakeSupabase({ leads: [] }, { rpc: () => ({ data: true, error: null }) });
      return mocks.admin as ReturnType<typeof fakeSupabase>;
    };

    it('goes to the operator with the details, and the visitor never sees the address', async () => {
      configured();
      const admin = adminOk();
      const send = vi.fn(async () => ({ ok: true }));
      mocks.send = send;
      const res = await post();
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain(OPERATOR);
      expect(admin.tables.leads).toHaveLength(1);
      expect(send).toHaveBeenCalledOnce();
      const [config, email] = send.mock.calls[0] as unknown as [{ replyTo: string; apiKey: string }, { to: string; subject: string; text: string; html: string }];
      expect(email.to).toBe(OPERATOR);
      expect(config.replyTo).toBe('ann@co.ca');
      expect(email.text).toContain('306-555-0100');
    });

    it('escapes what the visitor typed, and a line break cannot reach the subject', async () => {
      configured();
      const send = vi.fn(async () => ({ ok: true }));
      mocks.send = send;
      await notifyOperatorOfLead(lead);
      const [, email] = send.mock.calls[0] as unknown as [unknown, { subject: string; html: string }];
      expect(email.html).toContain('Ann &lt;b&gt;');
      expect(email.html).not.toContain('<b>');
      expect(email.subject).not.toMatch(/[\r\n]/);
    });

    it.each([
      ['no operator address', { OPERATOR_EMAIL: '', EMAIL_REPLY_TO: '', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'a@b.ca' }],
      ['no mail key', { OPERATOR_EMAIL: OPERATOR, RESEND_API_KEY: '', EMAIL_FROM: 'a@b.ca' }],
    ])('is skipped cleanly with %s, and the signup still saves', async (_name, vars) => {
      for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
      const admin = adminOk();
      const send = vi.fn();
      mocks.send = send;
      expect((await post()).status).toBe(200);
      expect(admin.tables.leads).toHaveLength(1);
      expect(send).not.toHaveBeenCalled();
    });

    it('a failed send cannot fail the signup', async () => {
      configured();
      const admin = adminOk();
      for (const send of [async () => ({ ok: false, error: 'Resend 500' }), async () => Promise.reject(new Error('down'))]) {
        mocks.send = send;
        expect((await post()).status).toBe(200);
      }
      expect(admin.tables.leads).toHaveLength(2);
    });

    it('a mail server that hangs cannot hold up the visitor', async () => {
      configured();
      mocks.send = () => new Promise(() => {});
      vi.useFakeTimers();
      try {
        let done = false;
        const waiting = notifyOperatorOfLead(lead).then(() => (done = true));
        await vi.advanceTimersByTimeAsync(LEAD_NOTIFY_WAIT_MS - 1);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await waiting;
        expect(done).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a bot gets no email', async () => {
      configured();
      adminOk();
      const send = vi.fn();
      mocks.send = send;
      expect((await post({ ...lead, company: 'Co', website: 'http://spam' })).status).toBe(200);
      expect(send).not.toHaveBeenCalled();
    });

    it('the address is a server setting, not one a page can read', () => {
      expect(readFileSync('lib/env.ts', 'utf8')).not.toMatch(/NEXT_PUBLIC_OPERATOR/);
      expect(readFileSync('.env.example', 'utf8')).toMatch(/OPERATOR_EMAIL=/);
    });
  });

  describe('one client document called Proposal', () => {
    it('the estimate print page says it is a quote preview, with no validity date and nowhere to sign', async () => {
      const id = '33333333-3333-4333-8333-333333333333';
      const supabase = fakeSupabase({
        estimates: [{ id, title: 'Unit 3 MCC', client_name: 'Cargill', labour_rate: 80, markup_percentage: 10, tax_percentage: 5, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }],
        estimate_items: [],
        companies: [{ id: COMPANY.id, name: 'Alpha' }],
      });
      mocks.pageContext = { status: 'ok', ctx: { supabase, role: 'project_manager', company: COMPANY } };
      const html = renderToStaticMarkup(await PrintEstimate({ params: { id } }));
      expect(html).toContain('Quote preview');
      expect(html).toContain('Not an offer');
      expect(html).not.toMatch(/proposal/i);
      expect(html).not.toMatch(/valid/i);
      expect(html).not.toMatch(/signature|accepted by/i);
    });

    it('the proposal is the one that is called Proposal', () => {
      expect(readFileSync('app/print/proposal/[id]/page.tsx', 'utf8')).toMatch(/document="Proposal"/);
    });
  });

  it('git ignores the local tooling files', () => {
    const ignored = readFileSync('.gitignore', 'utf8').split(/\r?\n/);
    expect(ignored).toContain('supabase/.temp/');
    expect(ignored).toContain('.claude/launch.json');
  });

  describe('the privacy page', () => {
    const page = readFileSync('app/legal/privacy/page.tsx', 'utf8');
    const job = readMigration('20261104000210_automation.sql');

    it('has no retention placeholder left', () => {
      expect(page).not.toContain('[period]');
    });

    // Each line of the page against the delete that makes it true
    it.each([
      ['Invitations nobody accepted: 30 days after they expire', 'i.expires_at < p_today - 30'],
      ['Payment event records from Stripe: 90 days', 'e.created_at < p_today - 90'],
      ['Alerts that have been resolved: 90 days after they are resolved', 'a.resolved_at < p_today - 90'],
      ['Records of which digest emails were sent: 90 days', 'd.digest_date < p_today - 90'],
      ['Daily AI Assistant usage counts and automation run logs: 13 months', "u.day < (p_today - interval '13 months')"],
      ['Daily AI Assistant usage counts and automation run logs: 13 months', "r.created_at < p_today - interval '13 months'"],
      ['Automation event logs: 24 months', "e.created_at < p_today - interval '24 months'"],
    ])('states "%s", as the housekeeping does', (line, rule) => {
      expect(page).toContain(line);
      expect(job).toContain(rule);
    });
  });
});
