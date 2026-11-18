// Closing a company account: the database function that deletes everything the company owns,
// tested as the real roles on PGlite; the steps before it (Stripe, stored files); and the route
// on the account page that runs them in order.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';
import { bootDb, type TestDb } from './helpers/db';
import { rowCounts, seedCompany } from './helpers/seed-company';

const mocks = vi.hoisted(() => ({ server: null as unknown, stripe: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => mocks.server }));
vi.mock('@/lib/billing', async (original) => ({ ...(await original<typeof import('@/lib/billing')>()), getStripe: () => mocks.stripe }));

import { POST as closeAccount } from '@/app/api/account/close/route';
import { COMPANY_FILE_BUCKETS, cancelCompanySubscriptions, mayStillBill, removeCompanyFiles } from '@/lib/company-closure';

const uid = (n: number) => `00000000-0000-4000-8000-0000000014${String(n).padStart(2, '0')}`;
const users = {
  ownerA: { id: uid(1), email: 'owner@alpha.ca' },
  adminA: { id: uid(2), email: 'admin@alpha.ca' },
  pmA: { id: uid(3), email: 'pm@alpha.ca' },
  foremanA: { id: uid(4), email: 'foreman@alpha.ca' },
  elecA: { id: uid(5), email: 'elec@alpha.ca' },
  ownerB: { id: uid(6), email: 'owner@bravo.ca' },
  pmB: { id: uid(7), email: 'pm@bravo.ca' },
  ownerC: { id: uid(8), email: 'owner@lapsed.ca' },
};
type U = keyof typeof users;

const CLOSE = 'select public.close_company($1)';

describe('close_company in the database', () => {
  let t: TestDb<U>;
  let alpha: string;
  let bravo: string;
  let lapsed: string;
  let bravoBefore: Record<string, number>;

  beforeAll(async () => {
    t = await bootDb(users);
    alpha = await t.createCompany('ownerA', 'Alpha Electric');
    bravo = await t.createCompany('ownerB', 'Bravo Power');
    lapsed = await t.createCompany('ownerC', 'Lapsed Co');
    await t.join('ownerA', 'adminA', 'admin');
    await t.join('ownerA', 'pmA', 'project_manager');
    await t.join('ownerA', 'foremanA', 'foreman');
    await t.join('ownerA', 'elecA', 'electrician');
    await t.join('ownerB', 'pmB', 'project_manager');
    await t.as('ownerA', `update public.companies set default_labour_rate = 100 where id = $1`, [alpha]);
    await seedCompany(t, { owner: 'ownerA', pm: 'pmA', foreman: 'foremanA', elec: 'elecA' });
    await seedCompany(t, { owner: 'ownerB', pm: 'pmB', foreman: 'pmB', elec: 'pmB' });
    bravoBefore = await rowCounts(t, bravo);
  }, 240_000);

  it('the seeded company really has rows in the tables that guard their own deletes', async () => {
    const counts = await rowCounts(t, alpha);
    for (const table of ['daily_logs', 'loto_permits', 'tailgate_logs', 'timecards', 'change_orders', 'invoices', 'receivables', 'proposal_shares', 'estimate_items', 'job_costing', 'job_cost_entries', 'assemblies', 'assembly_lines', 'alerts', 'invitations', 'company_users', 'ai_usage']) {
      expect(counts[table], table).toBeGreaterThan(0);
    }
    // A signed-in user cannot delete those records one by one
    expect(await t.fails('ownerA', `delete from public.daily_logs where signed_at is not null`)).toMatch(/signed/);
    expect(await t.fails('ownerA', `delete from public.loto_permits where status = 'Released'`)).toMatch(/signed/);
  });

  it('only the owner may close it: admins, project managers and crew are refused and nothing changes', async () => {
    for (const who of ['adminA', 'pmA', 'foremanA', 'elecA'] as const) {
      expect(await t.fails(who, CLOSE, ['Alpha Electric']), who).toMatch(/Only the owner/);
    }
    expect((await rowCounts(t, alpha)).companies).toBe(1);
  });

  it('visitors who are not signed in cannot call it at all', async () => {
    expect(await t.fails(null, CLOSE, ['Alpha Electric'])).toMatch(/permission denied/);
  });

  it('the owner has to type the exact company name: a wrong name, other capitals, extra spaces or nothing are refused', async () => {
    for (const typed of ['Alpha', 'alpha electric', 'ALPHA ELECTRIC', ' Alpha Electric', 'Alpha Electric ', 'Alpha  Electric', '', null]) {
      expect(await t.fails('ownerA', CLOSE, [typed]), String(typed)).toMatch(/exactly/);
    }
    expect((await rowCounts(t, alpha)).companies).toBe(1);
  });

  it("another company's owner cannot close this one by typing its name", async () => {
    expect(await t.fails('ownerB', CLOSE, ['Alpha Electric'])).toMatch(/exactly/);
    expect((await rowCounts(t, alpha)).companies).toBe(1);
    expect(await rowCounts(t, bravo)).toEqual(bravoBefore);
  });

  it('with the right name it deletes the company and every row it owned, signed and approved records included', async () => {
    const before = await rowCounts(t, alpha);
    await t.as('ownerA', CLOSE, ['Alpha Electric']);
    const after = await rowCounts(t, alpha);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    // Rows that hang off company rows without a company_id of their own go too
    expect(await t.asSystem(`select 1 from public.alert_member_state s where not exists (select 1 from public.alerts a where a.id = s.alert_id)`)).toEqual([]);
    expect(Object.keys(before).length).toBeGreaterThan(50);
  });

  it('another company is untouched, row for row', async () => {
    expect(await rowCounts(t, bravo)).toEqual(bravoBefore);
    expect((await t.as<{ name: string }>('ownerB', 'select name from public.companies'))[0].name).toBe('Bravo Power');
  });

  it('the people stay as logins but no longer belong to a company, so they can start again', async () => {
    expect(await t.asSystem('select user_id from public.company_users where user_id = any($1)', [[users.ownerA.id, users.pmA.id, users.elecA.id]])).toEqual([]);
    expect((await t.asSystem('select id from auth.users where id = any($1)', [[users.ownerA.id, users.pmA.id]])).length).toBe(2);
    expect(await t.as('ownerA', 'select public.user_company_id() as id')).toEqual([{ id: null }]);
    expect(await t.fails('ownerA', CLOSE, ['Alpha Electric'])).toMatch(/Only the owner/);
    const [{ id }] = await t.as<{ id: string }>('ownerA', `select public.create_company('Alpha Electric 2', 'SK', 'Owner') as id`);
    expect(id).not.toBe(alpha);
  });

  it('a company whose trial has ended can still close its account', async () => {
    await t.setLapsed(lapsed, true);
    await t.as('ownerC', CLOSE, ['Lapsed Co']);
    expect((await rowCounts(t, lapsed)).companies).toBe(0);
  });

  it('runs as its definer with an empty search path, and only signed-in users may call it', async () => {
    const [fn] = await t.asSystem<{ secdef: boolean; config: string[]; anon: boolean; auth: boolean }>(
      `select p.prosecdef as secdef, p.proconfig as config, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
       from pg_proc p where p.oid = 'public.close_company(text)'::regprocedure`
    );
    expect(fn).toEqual({ secdef: true, config: ['search_path=""'], anon: false, auth: true });
  });
});

// The steps before the delete --------------------------------------------------------------------

type Sub = { id: string; status: string; customer: string };

/** Just enough of Stripe's subscriptions API, paging like the real one. */
function fakeStripe(subs: Sub[], log: string[] = [], options: { failList?: boolean; failCancel?: boolean; pageSize?: number } = {}) {
  const cancelled: { id: string; key?: string }[] = [];
  const stripe = {
    subscriptions: {
      list: async (params: { customer: string; limit: number; starting_after?: string }) => {
        log.push('stripe:list');
        if (options.failList) throw Object.assign(new Error('Stripe is down'), { type: 'StripeConnectionError' });
        if (!subs.some((s) => s.customer === params.customer) && params.customer === 'cus_deleted') throw Object.assign(new Error('No such customer'), { code: 'resource_missing' });
        const mine = subs.filter((s) => s.customer === params.customer);
        const start = params.starting_after ? mine.findIndex((s) => s.id === params.starting_after) + 1 : 0;
        const size = Math.min(params.limit, options.pageSize ?? params.limit);
        return { data: mine.slice(start, start + size), has_more: start + size < mine.length };
      },
      retrieve: async (id: string) => {
        log.push(`stripe:retrieve:${id}`);
        const sub = subs.find((s) => s.id === id);
        if (!sub) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
        return sub;
      },
      cancel: async (id: string, _params: unknown, opts?: { idempotencyKey?: string }) => {
        log.push(`stripe:cancel:${id}`);
        if (options.failCancel) throw Object.assign(new Error('Stripe is down'), { type: 'StripeConnectionError' });
        cancelled.push({ id, key: opts?.idempotencyKey });
        const sub = subs.find((s) => s.id === id)!;
        sub.status = 'canceled';
        return sub;
      },
    },
  };
  return { stripe, cancelled };
}

/** Storage with folders, as Supabase lists them: a folder is an entry with no id. `protect` files can't be removed. */
function fakeStorage(files: Record<string, string[]>, log: string[] = [], options: { protect?: string[]; failList?: boolean } = {}) {
  const buckets = new Map(Object.entries(files).map(([bucket, paths]) => [bucket, new Set(paths)]));
  const listed: string[] = [];
  const storage = {
    from: (bucket: string) => {
      const objects = buckets.get(bucket) ?? buckets.set(bucket, new Set()).get(bucket)!;
      return {
        list: async (folder: string, opts: { limit: number; offset: number }) => {
          listed.push(`${bucket}:${folder}`);
          if (options.failList) return { data: null, error: { message: 'storage is down' } };
          const entries = new Map<string, { name: string; id: string | null }>();
          for (const path of objects) {
            if (!path.startsWith(`${folder}/`)) continue;
            const [name, ...rest] = path.slice(folder.length + 1).split('/');
            entries.set(name, { name, id: rest.length ? null : `id-${name}` });
          }
          const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
          return { data: sorted.slice(opts.offset, opts.offset + opts.limit), error: null };
        },
        remove: async (paths: string[]) => {
          log.push(`storage:remove:${bucket}`);
          const gone = paths.filter((p) => objects.has(p) && !options.protect?.includes(p));
          for (const p of gone) objects.delete(p);
          return { data: gone.map((name) => ({ name })), error: null };
        },
      };
    },
  };
  return { storage, buckets, listed };
}

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const billing = (over: Partial<{ subscription_status: string; stripe_customer_id: string | null; stripe_subscription_id: string | null }> = {}) => ({
  id: COMPANY_ID,
  subscription_status: 'active',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  ...over,
});

describe('which companies Stripe may still charge', () => {
  it.each([
    ['active', null, true],
    ['past_due', null, true],
    ['trialing', null, false],
    ['trialing', 'sub_1', true],
    ['incomplete', 'sub_1', true],
    ['incomplete', null, false],
    ['canceled', 'sub_1', false],
    ['canceled', null, false],
  ])('%s with subscription %s: %s', (status, sub, expected) => {
    expect(mayStillBill({ subscription_status: status, stripe_subscription_id: sub })).toBe(expected);
  });
});

describe('cancelling the subscriptions', () => {
  it("cancels every subscription of the company's customer that has not ended, page by page, with an idempotency key", async () => {
    const subs = [
      { id: 'sub_1', status: 'active', customer: 'cus_1' },
      { id: 'sub_2', status: 'past_due', customer: 'cus_1' },
      { id: 'sub_3', status: 'canceled', customer: 'cus_1' },
      { id: 'sub_4', status: 'incomplete', customer: 'cus_1' },
      { id: 'sub_5', status: 'incomplete_expired', customer: 'cus_1' },
      { id: 'sub_9', status: 'active', customer: 'cus_other' },
    ];
    const { stripe, cancelled } = fakeStripe(subs, [], { pageSize: 2 });
    expect(await cancelCompanySubscriptions(stripe as never, billing())).toEqual(['sub_1', 'sub_2', 'sub_4']);
    expect(cancelled).toEqual([
      { id: 'sub_1', key: `close-company:${COMPANY_ID}:sub_1` },
      { id: 'sub_2', key: `close-company:${COMPANY_ID}:sub_2` },
      { id: 'sub_4', key: `close-company:${COMPANY_ID}:sub_4` },
    ]);
    expect(subs.find((s) => s.id === 'sub_9')!.status).toBe('active');
  });

  it('also cancels the subscription on the company row, but never one that belongs to another customer', async () => {
    const mine = fakeStripe([{ id: 'sub_1', status: 'active', customer: 'cus_1' }]);
    expect(await cancelCompanySubscriptions(mine.stripe as never, billing({ stripe_customer_id: null }))).toEqual(['sub_1']);
    const theirs = fakeStripe([{ id: 'sub_1', status: 'active', customer: 'cus_other' }]);
    expect(await cancelCompanySubscriptions(theirs.stripe as never, billing())).toEqual([]);
    expect(theirs.cancelled).toEqual([]);
  });

  it('a subscription or customer Stripe no longer has is nothing to cancel', async () => {
    const { stripe, cancelled } = fakeStripe([]);
    expect(await cancelCompanySubscriptions(stripe as never, billing({ stripe_customer_id: 'cus_deleted', stripe_subscription_id: 'sub_gone' }))).toEqual([]);
    expect(cancelled).toEqual([]);
  });

  it('an outage is thrown, so closing stops before anything is deleted', async () => {
    await expect(cancelCompanySubscriptions(fakeStripe([], [], { failList: true }).stripe as never, billing())).rejects.toThrow(/down/);
    await expect(cancelCompanySubscriptions(fakeStripe([{ id: 'sub_1', status: 'active', customer: 'cus_1' }], [], { failCancel: true }).stripe as never, billing())).rejects.toThrow(/down/);
  });
});

describe('removing the stored files', () => {
  const photos = [`${COMPANY_ID}/daily-logs/log-1/a.jpg`, `${COMPANY_ID}/daily-logs/log-1/b.jpg`, `${COMPANY_ID}/daily-logs/log-2/c.jpg`, `${COMPANY_ID}/loto-permits/permit-1/d.jpg`];
  const theirs = [`${OTHER_ID}/daily-logs/log-9/z.jpg`];

  it('finds every file in every folder of both buckets, removes what storage allows and reports the rest', async () => {
    const { storage, buckets } = fakeStorage(
      { 'job-photos': [...photos, ...theirs], 'company-logos': [`${COMPANY_ID}/logo-1.png`, `${OTHER_ID}/logo-2.png`] },
      [],
      { protect: [`${COMPANY_ID}/daily-logs/log-2/c.jpg`] }
    );
    const result = await removeCompanyFiles({ storage } as never, COMPANY_ID);
    expect(result).toEqual({ removed: 4, left: [`${COMPANY_ID}/daily-logs/log-2/c.jpg`], complete: true });
    expect([...buckets.get('job-photos')!].sort()).toEqual([`${COMPANY_ID}/daily-logs/log-2/c.jpg`, ...theirs].sort());
    expect([...buckets.get('company-logos')!]).toEqual([`${OTHER_ID}/logo-2.png`]);
    expect(COMPANY_FILE_BUCKETS).toEqual(['job-photos', 'company-logos']);
  });

  it('reads past the first thousand files in a folder and removes them in batches', async () => {
    const many = Array.from({ length: 1201 }, (_, i) => `${COMPANY_ID}/daily-logs/log-1/${String(i).padStart(5, '0')}.jpg`);
    const log: string[] = [];
    const { storage, buckets } = fakeStorage({ 'job-photos': many }, log);
    expect(await removeCompanyFiles({ storage } as never, COMPANY_ID)).toEqual({ removed: 1201, left: [], complete: true });
    expect(buckets.get('job-photos')!.size).toBe(0);
    expect(log.filter((l) => l === 'storage:remove:job-photos')).toHaveLength(3);
  });

  it('says so when a folder could not be listed or time ran out, instead of claiming it is clean', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = fakeStorage({ 'job-photos': photos }, [], { failList: true });
    expect(await removeCompanyFiles({ storage: down.storage } as never, COMPANY_ID)).toEqual({ removed: 0, left: [], complete: false });
    const slow = fakeStorage({ 'job-photos': photos });
    expect((await removeCompanyFiles({ storage: slow.storage } as never, COMPANY_ID, { timeLimitMs: -1 })).complete).toBe(false);
    vi.restoreAllMocks();
  });
});

// The route on the account page ------------------------------------------------------------------

const USER = { id: 'user-1', email: 'owner@alpha.ca' };
const ACTIVE = { id: COMPANY_ID, name: 'Alpha Electric', province: 'SK', subscription_status: 'active', trial_ends_at: '2020-01-01T00:00:00Z', current_period_end: null };

function signedIn(options: { role?: string; company?: typeof ACTIVE; ids?: { stripe_customer_id: string | null; stripe_subscription_id: string | null }; closeError?: { code?: string; message: string }; files?: Record<string, string[]>; protect?: string[] } = {}) {
  const log: string[] = [];
  const company = options.company ?? ACTIVE;
  const fake = fakeSupabase(
    { company_users: [{ user_id: USER.id, role: options.role ?? 'owner', company }], companies: [{ id: company.id, name: company.name }] },
    {
      rpc: (name, args) => {
        log.push(`rpc:${name}`);
        if (name === 'company_billing_ids') return { data: options.ids ?? { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }, error: null };
        if (name === 'close_company') return { data: null, error: options.closeError ?? (args.p_confirm_name === company.name ? null : { code: '22023', message: 'Type the company name exactly as it is shown to confirm.' }) };
        return { data: null, error: null };
      },
    }
  );
  const { storage, buckets } = fakeStorage(options.files ?? {}, log, { protect: options.protect });
  const signOut = vi.fn(async () => {
    log.push('auth:signOut');
    return { error: null };
  });
  mocks.server = Object.assign(fake, { storage, auth: { getUser: async () => ({ data: { user: USER }, error: null }), signOut } });
  return { log, buckets, signOut };
}

const close = (confirm_name: unknown = 'Alpha Electric') => closeAccount(new Request('https://app.test/api/account/close', { method: 'POST', body: JSON.stringify({ confirm_name }) }));

describe('POST /api/account/close', () => {
  let subs: Sub[];
  let log: string[];

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_value');
    subs = [
      { id: 'sub_1', status: 'active', customer: 'cus_1' },
      { id: 'sub_2', status: 'canceled', customer: 'cus_1' },
    ];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const useStripe = (options: Parameters<typeof fakeStripe>[2] = {}) => {
    const fake = fakeStripe(subs, log, options);
    mocks.stripe = fake.stripe;
    return fake;
  };

  it('is for the owner alone: an admin and crew are refused before anything happens', async () => {
    for (const role of ['admin', 'project_manager', 'electrician']) {
      ({ log } = signedIn({ role }));
      const { cancelled } = useStripe();
      expect((await close()).status, role).toBe(403);
      expect(cancelled).toEqual([]);
      expect(log).toEqual([]);
    }
  });

  it('a name that is not exactly the company name stops it before Stripe, storage or the database', async () => {
    for (const typed of ['alpha electric', 'Alpha Electric ', 'Alpha', '', 42, null]) {
      ({ log } = signedIn({ files: { 'job-photos': [`${COMPANY_ID}/daily-logs/l/a.jpg`] } }));
      const { cancelled } = useStripe();
      const res = await close(typed);
      expect(res.status, String(typed)).toBe(400);
      expect((await res.json()).error).toMatch(/exactly/);
      expect(cancelled).toEqual([]);
      expect(log.filter((l) => !l.startsWith('rpc:company_billing_ids'))).toEqual([]);
    }
  });

  it('cancels the subscription first, then removes the files, then deletes the company, then signs the owner out', async () => {
    let buckets: Map<string, Set<string>>;
    ({ log, buckets } = signedIn({ files: { 'job-photos': [`${COMPANY_ID}/daily-logs/l/a.jpg`, `${OTHER_ID}/daily-logs/x/b.jpg`], 'company-logos': [`${COMPANY_ID}/logo-1.png`] } }));
    const { cancelled } = useStripe();
    const res = await close();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ closed: true, subscriptions_cancelled: 1, files_removed: 2, files_left: 0, files_checked: true });
    expect(cancelled.map((c) => c.id)).toEqual(['sub_1']);
    const steps = log.filter((l) => /^(stripe:cancel|storage:remove|rpc:close_company|auth:signOut)/.test(l));
    expect(steps).toEqual(['stripe:cancel:sub_1', 'storage:remove:job-photos', 'storage:remove:company-logos', 'rpc:close_company', 'auth:signOut']);
    // Another company's files are never touched
    expect([...buckets.get('job-photos')!]).toEqual([`${OTHER_ID}/daily-logs/x/b.jpg`]);
  });

  it('when Stripe cannot cancel, nothing is deleted and the owner is told to try again', async () => {
    ({ log } = signedIn({ files: { 'job-photos': [`${COMPANY_ID}/daily-logs/l/a.jpg`] } }));
    useStripe({ failCancel: true });
    const res = await close();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/nothing was deleted/);
    expect(log.some((l) => l.startsWith('storage:remove') || l === 'rpc:close_company' || l === 'auth:signOut')).toBe(false);
  });

  it('refuses, with a clear message, to leave a paying subscription behind when Stripe is not set up here', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    ({ log } = signedIn());
    const res = await close();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/still has a subscription[\s\S]*Nothing was deleted/);
    expect(log).not.toContain('rpc:close_company');
  });

  it('a company on its free trial, with no subscription, closes without Stripe', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    ({ log } = signedIn({ company: { ...ACTIVE, subscription_status: 'trialing', trial_ends_at: '2099-01-01T00:00:00Z' }, ids: { stripe_customer_id: null, stripe_subscription_id: null } }));
    const res = await close();
    expect(res.status).toBe(200);
    expect((await res.json()).data.subscriptions_cancelled).toBe(0);
    expect(log).toContain('rpc:close_company');
  });

  it('a company whose trial has ended can still close its account', async () => {
    ({ log } = signedIn({ company: { ...ACTIVE, subscription_status: 'trialing', trial_ends_at: '2020-01-01T00:00:00Z' }, ids: { stripe_customer_id: null, stripe_subscription_id: null } }));
    useStripe();
    expect((await close()).status).toBe(200);
    expect(log).toContain('rpc:close_company');
  });

  it('reports the files the storage rules kept, and still closes', async () => {
    const kept = `${COMPANY_ID}/daily-logs/signed-log/a.jpg`;
    ({ log } = signedIn({ files: { 'job-photos': [kept, `${COMPANY_ID}/daily-logs/open-log/b.jpg`] }, protect: [kept] }));
    useStripe();
    const res = await close();
    expect((await res.json()).data).toMatchObject({ files_removed: 1, files_left: 1, files_checked: true });
    expect(log).toContain('rpc:close_company');
  });

  it('if the database cannot delete the company the owner hears that billing has stopped, and stays signed in', async () => {
    ({ log } = signedIn({ closeError: { code: 'XX000', message: 'internal' } }));
    useStripe();
    const res = await close();
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).toMatch(/subscription was cancelled/);
    expect(error).not.toMatch(/internal/);
    expect(log).not.toContain('auth:signOut');
  });

  it('a refusal from the database is passed on in plain words', async () => {
    ({ log } = signedIn({ closeError: { code: '42501', message: 'Only the owner can close the company account.' } }));
    useStripe();
    expect((await close()).status).toBe(403);
  });
});
