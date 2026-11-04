// Route and helper tests for the hardening work, with Supabase mocked. Security
// rules themselves are tested on real Postgres in tests/hardening.test.ts.
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ admin: null as unknown, server: null as unknown, ctx: null as unknown, send: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mocks.admin, createSupabaseServerClient: () => mocks.server }));
vi.mock('@/lib/email', () => ({ sendEmail: (...args: unknown[]) => (mocks.send as (...a: unknown[]) => unknown)(...args) }));

import { GET as authCallback } from '@/app/(auth)/auth/callback/route';
import { GET as trialCron } from '@/app/api/cron/trial-emails/route';
import { POST as leads } from '@/app/api/leads/route';
import { POST as onboarding } from '@/app/api/onboarding/route';
import { DELETE as teamDelete, PATCH as teamPatch, POST as teamInvite } from '@/app/api/team/route';
import ModulePage from '@/components/module-page';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { capHistory, MAX_HISTORY_TOKENS } from '@/lib/assistant';
import { dbError, readJson, requireApi } from '@/lib/api';
import { companyHasLiveSubscription } from '@/lib/billing';
import { inSentence } from '@/lib/format';
import { MODULES, getModule } from '@/lib/modules';
import { getContext, getPageContext, resolveContext } from '@/lib/context';
import { deleteRecord, listColumns, listRecords } from '@/lib/crud';
import { mergePages, parsePage } from '@/lib/pagination';
import { clientIp } from '@/lib/rate-limit';
import { safeNext } from '@/lib/safe-redirect';
import { isTransientAuthError } from '@/lib/supabase/auth-error';
import { isCalendarDate, parseRecord } from '@/lib/validation';
import { config as middlewareConfig, isPublicPath, middleware } from '@/middleware';

const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' };
const COMPANY = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Alpha',
  province: 'SK',
  subscription_status: 'active',
  trial_ends_at: '2030-01-01T00:00:00Z',
  current_period_end: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
};

/** A signed-in Supabase client: `membership` is the company_users row getContext reads. */
function signedIn(tables: Record<string, Record<string, unknown>[]> = {}, role = 'owner', company: Record<string, unknown> = COMPANY, options: Parameters<typeof fakeSupabase>[1] = {}) {
  const fake = fakeSupabase({ company_users: [{ user_id: USER.id, role, company }], ...tables }, options);
  const client = Object.assign(fake, { auth: { getUser: async () => ({ data: { user: USER }, error: null }) } });
  mocks.server = client;
  return client;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('safeNext', () => {
  it.each([
    ['tab', '/\t/evil.com'],
    ['newline', '/\n/evil.com'],
    ['carriage return', '/\r/evil.com'],
    ['leading tab', '\t/evil.com'],
    ['null byte', '/\u0000/evil.com'],
    ['delete', '/\u007f/evil.com'],
    ['C1 control', '/\u0085/evil.com'],
    ['backslash after slash', '/\\evil.com'],
    ['backslash inside', '/foo\\..\\..\\evil.com'],
    ['protocol-relative', '//evil.com'],
    ['absolute', 'https://evil.com'],
    ['javascript', 'javascript:alert(1)'],
    ['triple slash', '///evil.com'],
  ])('refuses %s', (_name, value) => {
    expect(safeNext(value)).toBe('/');
  });

  it('keeps real paths and queries', () => {
    expect(safeNext('/estimates?x=1&y=2#z')).toBe('/estimates?x=1&y=2#z');
    expect(safeNext('/update-password?next=%2Fonboarding')).toBe('/update-password?next=%2Fonboarding');
    expect(safeNext('/a/b/../c')).toBe('/a/b/../c');
    expect(safeNext(undefined, '/onboarding')).toBe('/onboarding');
  });
});

describe('auth callback', () => {
  function call(query: string, verifyError: unknown = null) {
    const verifyOtp = vi.fn(async () => ({ error: verifyError }));
    const exchangeCodeForSession = vi.fn(async () => ({ error: verifyError }));
    mocks.server = { auth: { verifyOtp, exchangeCodeForSession } };
    return { verifyOtp, exchangeCodeForSession, response: authCallback(new Request(`https://app.test/auth/callback?${query}`)) };
  }
  const target = async (r: Response | Promise<Response>) => (await r).headers.get('location');

  it('verifies token_hash and type', async () => {
    const { verifyOtp, exchangeCodeForSession, response } = call('token_hash=abc&type=email&next=/estimates');
    expect(await target(response)).toBe('https://app.test/estimates');
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'email' });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('still supports the PKCE code', async () => {
    const { verifyOtp, exchangeCodeForSession, response } = call('code=xyz&next=/settings/team');
    expect(await target(response)).toBe('https://app.test/settings/team');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('sends invited people to choose a password, then on to onboarding', async () => {
    expect(await target(call('token_hash=abc&type=invite&next=/onboarding').response)).toBe('https://app.test/update-password?next=%2Fonboarding');
    expect(await target(call('token_hash=abc&type=invite').response)).toBe('https://app.test/update-password?next=%2Fonboarding');
  });

  it('sends password resets to choose a password', async () => {
    expect(await target(call('token_hash=abc&type=recovery').response)).toBe('https://app.test/update-password');
    expect(await target(call('code=xyz&type=recovery').response)).toBe('https://app.test/update-password');
    expect(await target(call('code=xyz&next=/update-password').response)).toBe('https://app.test/update-password');
    expect(await target(call('token_hash=abc&type=recovery&next=/update-password').response)).toBe('https://app.test/update-password');
  });

  it('never redirects off-site', async () => {
    expect(await target(call('token_hash=abc&type=email&next=/%09/evil.com').response)).toBe('https://app.test/');
    expect(await target(call('token_hash=abc&type=invite&next=//evil.com').response)).toBe('https://app.test/update-password?next=%2Fonboarding');
  });

  it('sends a bad or unknown link to login with a message', async () => {
    const bad = call('token_hash=abc&type=email', { message: 'expired' });
    expect(await target(bad.response)).toMatch(/^https:\/\/app\.test\/login\?error=/);
    const unknown = call('token_hash=abc&type=admin');
    expect(await target(unknown.response)).toMatch(/\/login\?error=/);
    expect(unknown.verifyOtp).not.toHaveBeenCalled();
    expect(await target(call('').response)).toMatch(/\/login\?error=/);
  });
});

describe('middleware', () => {
  const PROJECT = 'https://abcd.supabase.test';
  const COOKIE = 'sb-abcd-auth-token';

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROJECT);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  });
  afterEach(() => vi.unstubAllGlobals());

  function jwt(extra = '') {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256' })}.${b64({ sub: USER.id, exp: 4_000_000_000, pad: extra })}.sig`;
  }
  const session = (accessToken: string, expires: number) => JSON.stringify({ access_token: accessToken, refresh_token: 'r1', token_type: 'bearer', expires_in: 3600, expires_at: expires, user: { id: USER.id, email: USER.email } });

  /** Supabase Auth: refreshing returns a session large enough to span several cookies. */
  function stubAuth(opts: { user?: boolean; down?: boolean } = {}) {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      if (opts.down) throw new TypeError('fetch failed');
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/token')) {
        return new Response(JSON.stringify({ access_token: jwt('x'.repeat(9000)), refresh_token: 'r2', token_type: 'bearer', expires_in: 3600, expires_at: 4_000_000_000, user: { id: USER.id, email: USER.email } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/user') && opts.user !== false) return new Response(JSON.stringify({ id: USER.id, email: USER.email, aud: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ message: 'no' }), { status: 401, headers: { 'content-type': 'application/json' } });
    });
  }

  const request = (path: string, cookies: Record<string, string> = {}) =>
    new NextRequest(`https://app.test${path}`, { headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') } });

  const expired = () => ({ [COOKIE]: session(jwt(), 1) });

  it('keeps every chunk of a large refreshed session', async () => {
    stubAuth();
    const res = await middleware(request('/estimates', expired()));
    const names = res.cookies.getAll().filter((c) => c.value).map((c) => c.name);
    expect(names).toContain(`${COOKIE}.0`);
    expect(names).toContain(`${COOKIE}.1`);
    expect(names.length).toBeGreaterThanOrEqual(3);
    const joined = res.cookies.getAll().filter((c) => c.name.startsWith(`${COOKIE}.`) && c.value).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((c) => c.value).join('');
    expect(joined.startsWith('base64-')).toBe(true);
    expect(JSON.parse(Buffer.from(joined.slice('base64-'.length), 'base64url').toString()).refresh_token).toBe('r2');
  });

  it('clears leftover chunks when the session shrinks', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = url.includes('/token')
        ? { access_token: jwt(), refresh_token: 'r2', token_type: 'bearer', expires_in: 3600, expires_at: 4_000_000_000, user: { id: USER.id, email: USER.email } }
        : { id: USER.id, email: USER.email, aud: 'authenticated' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    // A real three-chunk session: the refreshed one is small enough that .2 has to go
    const whole = session(jwt(), 1);
    const third = Math.ceil(whole.length / 3);
    const chunks = [whole.slice(0, third), whole.slice(third, third * 2), whole.slice(third * 2)];
    const res = await middleware(
      new NextRequest('https://app.test/estimates', {
        headers: { cookie: chunks.map((c, i) => `${COOKIE}.${i}=${encodeURIComponent(c)}`).join('; ') },
      })
    );
    const stale = res.cookies.getAll().find((c) => c.name === `${COOKIE}.2`);
    expect(stale?.value).toBe('');
    expect(stale?.maxAge).toBe(0);
    const live = res.cookies.getAll().filter((c) => c.value).map((c) => c.name);
    expect(live).not.toContain(`${COOKIE}.2`);
    expect(live.length).toBeGreaterThan(0);
  });

  it('copies rotated cookies onto a redirect', async () => {
    stubAuth();
    const res = await middleware(request('/login', expired()));
    expect(res.headers.get('location')).toBe('https://app.test/');
    expect(res.cookies.getAll().filter((c) => c.value).map((c) => c.name)).toContain(`${COOKIE}.0`);
  });

  it('copies rotated cookies onto a signed-out redirect when the token is rejected', async () => {
    stubAuth({ user: false });
    const res = await middleware(request('/estimates', { [COOKIE]: session(jwt(), 4_000_000_000) }));
    expect(res.headers.get('location')).toBe(`https://app.test/login?next=${encodeURIComponent('/estimates')}`);
  });

  it('signed-out visitors to the root go to pricing; other pages go to login; API gets 401', async () => {
    stubAuth();
    expect((await middleware(request('/'))).headers.get('location')).toBe('https://app.test/pricing');
    expect((await middleware(request('/estimates?x=1'))).headers.get('location')).toBe(`https://app.test/login?next=${encodeURIComponent('/estimates?x=1')}`);
    expect((await middleware(request('/api/modules/rfis'))).status).toBe(401);
  });

  it('signed-in visitors stay on the root', async () => {
    stubAuth();
    const res = await middleware(request('/', { [COOKIE]: session(jwt(), 4_000_000_000) }));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('an unreachable auth server does not look like being signed out', async () => {
    stubAuth({ down: true });
    const res = await middleware(request('/estimates', { [COOKIE]: session(jwt(), 4_000_000_000) }));
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  it.each(['/api/health', '/api/stripe/webhook', '/robots.txt', '/sitemap.xml'])('%s works with no Supabase settings', async (path) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const res = await middleware(request(path));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('other pages report the missing settings', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect((await middleware(request('/estimates'))).status).toBe(500);
  });

  it('closes the image optimizer', async () => {
    expect((await middleware(request('/_next/image?url=/x.svg&w=64&q=75'))).status).toBe(404);
    const matcher = new RegExp(`^${middlewareConfig.matcher[0].replace('/((', '/((')}$`);
    expect(matcher.test('/_next/image')).toBe(true);
    expect(matcher.test('/_next/static/chunks/a.js')).toBe(false);
  });

  it('robots and sitemap are public; the rest stays private', () => {
    for (const p of ['/robots.txt', '/sitemap.xml', '/api/health', '/api/cron/x', '/api/email/unsubscribe', '/pricing', '/about', '/api/leads']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/', '/estimates', '/robots.txt.bak', '/api/modules/rfis']) expect(isPublicPath(p)).toBe(false);
  });
});

describe('robots and sitemap', () => {
  it('points crawlers at public pages only', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.example.ca/');
    const r = robots();
    expect(r.sitemap).toBe('https://app.example.ca/sitemap.xml');
    expect(r.rules).toMatchObject({ disallow: '/' });
    expect(sitemap().map((s) => s.url)).toEqual(['https://app.example.ca/pricing', 'https://app.example.ca/about', 'https://app.example.ca/legal/terms', 'https://app.example.ca/legal/privacy']);
  });
});

describe('context', () => {
  it('a database failure is an error, not "no company"', async () => {
    signedIn({}, 'owner', COMPANY, { failOn: ({ table }) => (table === 'company_users' ? { message: 'connection lost' } : null) });
    expect((await resolveContext()).status).toBe('error');
  });

  it('an auth outage is an error; a missing session is signed out', async () => {
    mocks.server = { auth: { getUser: async () => ({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0 } }) } };
    expect((await resolveContext()).status).toBe('error');
    mocks.server = { auth: { getUser: async () => ({ data: { user: null }, error: { name: 'AuthSessionMissingError', status: 400 } }) } };
    expect((await resolveContext()).status).toBe('signed-out');
    expect(isTransientAuthError(null)).toBe(false);
    expect(isTransientAuthError({ status: 503 })).toBe(true);
  });

  it('no membership is still "no company"', async () => {
    const client = signedIn();
    client.tables.company_users = [];
    expect((await resolveContext()).status).toBe('no-company');
  });

  it('API callers get 503 during an outage, not a setup message', async () => {
    signedIn({}, 'owner', COMPANY, { failOn: () => ({ message: 'connection lost' }) });
    const res = await requireApi({ minRank: 1 });
    expect((res as Response).status).toBe(503);
  });

  it('pages throw during an outage so the error boundary shows', async () => {
    signedIn({}, 'owner', COMPANY, { failOn: () => ({ message: 'connection lost' }) });
    await expect(getPageContext()).rejects.toThrow(/Could not load your account/);
    expect((await getContext()).status).toBe('error');
  });
});

describe('module lists', () => {
  const rfis = getModule('rfis')!;
  const logs = getModule('daily-logs')!;
  const params = (module: string, id?: string) => ({ params: { module, id } });
  const row = (i: number) => ({ id: `id-${String(i).padStart(3, '0')}`, title: `RFI ${i}`, status: 'Open', created_at: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}` });

  it('selects explicit columns, so a list never returns signature images', () => {
    const columns = listColumns(logs).split(', ');
    expect(columns).not.toContain('signature');
    expect(columns).not.toContain('photos');
    expect(columns).toEqual(expect.arrayContaining(['id', 'title', 'status', 'notes', 'created_at', 'log_date']));
  });

  it('pages through every row with offset', async () => {
    signedIn({ rfis: Array.from({ length: 120 }, (_, i) => row(i)) });
    const seen = new Set<string>();
    for (let offset = 0; offset < 120; offset += 50) {
      const res = await listRecords(new Request(`https://app.test/api/modules/rfis?limit=50&offset=${offset}`), params('rfis'));
      const json = await res.json();
      expect(json.count).toBe(120);
      for (const r of json.data) seen.add(r.id);
    }
    expect(seen.size).toBe(120);
  });

  it('sends explicit columns and a stable order to the database', async () => {
    const client = signedIn({ rfis: [row(1)] });
    await listRecords(new Request('https://app.test/api/modules/rfis?offset=10'), params('rfis'));
    const call = client.log.find((c) => c.table === 'rfis')!;
    expect(call.columns).toBe(listColumns(rfis));
    expect(call.range).toEqual([10, 109]);
    expect(call.order).toEqual(['created_at', 'id']);
  });

  it('clamps paging values', () => {
    const p = (s: string) => parsePage(new URLSearchParams(s));
    expect(p('')).toEqual({ limit: 100, offset: 0 });
    expect(p('limit=9999&offset=-5')).toEqual({ limit: 200, offset: 0 });
    expect(p('limit=junk&offset=junk')).toEqual({ limit: 100, offset: 0 });
    expect(p('limit=0&offset=2.5')).toEqual({ limit: 100, offset: 2 });
  });

  it('merging pages drops rows seen twice', () => {
    expect(mergePages([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('module page labels', () => {
  const html = (slug: string) => renderToStaticMarkup(createElement(ModulePage, { slug, canWrite: true, canDelete: true }));

  it('the Estimates button says estimate, while its title field still says project', () => {
    const page = html('estimates');
    expect(page).toContain('+ New Estimate');
    expect(page).not.toContain('New Project');
    expect(getModule('estimates')!.titleLabel).toBe('Project');
  });

  it('other modules keep their own wording', () => {
    expect(html('projects')).toContain('+ New Project');
    expect(html('invoices')).toContain('+ New Invoice');
    expect(html('crm')).toContain('+ New Client');
  });

  // The title field's label names one field of a record, which often isn't the record itself
  it.each([
    ['daily-logs', 'Daily Log', 'Log Title'],
    ['timecards', 'Timecard', 'Job / Cost Code'],
    ['crew-schedule', 'Schedule Entry', 'Crew / Worker'],
    ['rfis', 'RFI', 'Question'],
    ['change-orders', 'Change Order', 'Change'],
    ['drawings', 'Drawing', 'Sheet Title'],
    ['employees', 'Employee', 'Name'],
    ['hiring', 'Candidate', 'Candidate / Position'],
  ])('%s: the button names the record, the form field keeps its label', (slug, record, field) => {
    const page = html(slug);
    expect(page).toContain(`+ New ${record}<`);
    expect(page).not.toContain(`+ New ${field}<`);
    expect(getModule(slug)!.titleLabel).toBe(field);
  });

  it('no module button is named after a field', () => {
    for (const m of MODULES) expect(m.recordLabel ?? m.titleLabel, m.slug).not.toMatch(/Title|Name|\//);
  });

  it('labels read properly mid-sentence', () => {
    expect(inSentence('Daily Log')).toBe('daily log');
    expect(inSentence('RFI')).toBe('RFI');
    expect(inSentence('PO')).toBe('PO');
  });
});

describe('deleting records', () => {
  const ID = '22222222-2222-4222-8222-222222222222';
  const params = (module: string) => ({ params: { module, id: ID } });
  const del = (module: string) => deleteRecord(new Request('https://app.test/x', { method: 'DELETE' }), params(module));

  it('is refused for a lapsed company', async () => {
    signedIn({ rfis: [{ id: ID }] }, 'owner', { ...COMPANY, subscription_status: 'canceled' });
    expect((await del('rfis')).status).toBe(402);
  });

  it('removes a log\'s photos before the log', async () => {
    const client = signedIn({ daily_logs: [{ id: ID, photos: ['a/b.jpg'], signed_at: null }] });
    expect((await del('daily-logs')).status).toBe(200);
    expect(client.removed).toEqual([['a/b.jpg']]);
    expect(client.tables.daily_logs).toEqual([]);
  });

  it('refuses a signed log and leaves its photos alone', async () => {
    const client = signedIn({ daily_logs: [{ id: ID, photos: ['a/b.jpg'], signed_at: '2026-01-01' }] });
    const res = await del('daily-logs');
    expect(res.status).toBe(409);
    expect(client.removed).toEqual([]);
    expect(client.tables.daily_logs.length).toBe(1);
  });

  it('keeps the log if its photos could not be removed', async () => {
    const client = signedIn({ daily_logs: [{ id: ID, photos: ['a/b.jpg'], signed_at: null }] });
    client.storage.from = () => ({ remove: async () => ({ data: null, error: { message: 'storage down' } }) }) as never;
    expect((await del('daily-logs')).status).toBe(502);
    expect(client.tables.daily_logs.length).toBe(1);
  });
});

describe('validation and error mapping', () => {
  it('checks real calendar dates', () => {
    for (const d of ['2026-01-31', '2028-02-29', '2026-12-31']) expect(isCalendarDate(d)).toBe(true);
    for (const d of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1', 'nonsense']) expect(isCalendarDate(d)).toBe(false);
  });

  it('module forms reject an impossible date', () => {
    const logs = getModule('daily-logs')!;
    expect(parseRecord(logs, { title: 'x', log_date: '2026-02-31' }, 'create')).toMatchObject({ ok: false, errors: { log_date: 'That date does not exist' } });
    expect(parseRecord(logs, { title: 'x', log_date: '2026-02-28' }, 'create').ok).toBe(true);
  });

  it.each(['22008', '22003', '22007', '22P02', '23514'])('maps database error %s to a 400 with no internals', async (code) => {
    const res = dbError({ code, message: 'internal detail' }, 'saving');
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toContain('internal');
  });

  it('readJson counts bytes and refuses by declared size', async () => {
    await expect(readJson(new Request('https://app.test', { method: 'POST', body: JSON.stringify('é'.repeat(60)) }), 100)).rejects.toThrow(RangeError);
    await expect(readJson(new Request('https://app.test', { method: 'POST', headers: { 'content-length': '999999' }, body: '{}' }), 100)).rejects.toThrow(RangeError);
    expect(await readJson(new Request('https://app.test', { method: 'POST', body: '{"a":1}' }), 100)).toEqual({ a: 1 });
  });
});

describe('team route', () => {
  const post = (body: unknown) => teamInvite(new Request('https://app.test/api/team', { method: 'POST', body: JSON.stringify(body) }));
  const MEMBER = '33333333-3333-4333-8333-333333333333';

  function withAdmin(inviteError: unknown = null) {
    mocks.admin = { auth: { admin: { inviteUserByEmail: vi.fn(async () => ({ error: inviteError })) } } };
  }

  it('reports a duplicate pending invitation as a conflict', async () => {
    withAdmin();
    signedIn({ invitations: [] }, 'owner', COMPANY, { failOn: ({ table, op }) => (table === 'invitations' && op === 'insert' ? { code: '23505', message: 'duplicate key value violates unique constraint "invitations_pending_unique"' } : null) });
    const res = await post({ email: 'dup@alpha.ca', role: 'foreman' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/pending invitation/);
  });

  it('clears an expired invitation before sending a new one', async () => {
    withAdmin();
    const client = signedIn({ invitations: [{ company_id: COMPANY.id, email: 'old@alpha.ca', accepted_at: null, expires_at: '2020-01-01T00:00:00Z' }] });
    expect((await post({ email: 'old@alpha.ca', role: 'foreman' })).status).toBe(200);
    expect(client.tables.invitations.length).toBe(1);
    expect(client.tables.invitations[0].role).toBe('foreman');
  });

  it('never returns a raw database message', async () => {
    const leak = 'relation "company_users" does not exist';
    signedIn({}, 'owner', COMPANY, { rpc: () => ({ data: null, error: { code: '42P01', message: leak } }) });
    const patch = await teamPatch(new Request('https://app.test/api/team', { method: 'PATCH', body: JSON.stringify({ userId: MEMBER, role: 'foreman' }) }));
    expect(patch.status).toBe(500);
    expect(JSON.stringify(await patch.json())).not.toContain('company_users');
    const remove = await teamDelete(new Request('https://app.test/api/team', { method: 'DELETE', body: JSON.stringify({ userId: MEMBER }) }));
    expect(remove.status).toBe(500);
    expect(JSON.stringify(await remove.json())).not.toContain('company_users');
  });

  it('keeps the rules written for people', async () => {
    signedIn({}, 'owner', COMPANY, { rpc: () => ({ data: null, error: { code: '42501', message: 'You cannot remove yourself' } }) });
    const res = await teamDelete(new Request('https://app.test/api/team', { method: 'DELETE', body: JSON.stringify({ userId: MEMBER }) }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('You cannot remove yourself');
  });

  it('maps a missing member to 404', async () => {
    signedIn({}, 'owner', COMPANY, { rpc: () => ({ data: null, error: { code: 'P0002', message: 'Member not found' } }) });
    const res = await teamPatch(new Request('https://app.test/api/team', { method: 'PATCH', body: JSON.stringify({ userId: MEMBER, role: 'foreman' }) }));
    expect(res.status).toBe(404);
  });

  it('limits invitations', async () => {
    withAdmin();
    const client = signedIn({ invitations: [] }, 'owner', COMPANY, { rpc: (name, args) => ({ data: !(name === 'consume_user_rate_limit' && args.p_bucket === 'invite'), error: null }) });
    expect((await post({ email: 'new@alpha.ca', role: 'foreman' })).status).toBe(429);
    expect(client.tables.invitations).toEqual([]);
  });
});

describe('rate limited public endpoints', () => {
  const lead = { name: 'Ann', company: 'Co', email: 'ann@co.ca' };
  const postLead = (body: unknown = lead, headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }) => leads(new Request('https://app.test/api/leads', { method: 'POST', headers, body: JSON.stringify(body) }));

  it('saves a lead while under the limit', async () => {
    const calls: string[] = [];
    const admin = fakeSupabase({ leads: [] }, { rpc: (_n, a) => (calls.push(a.p_key as string), { data: true, error: null }) });
    mocks.admin = admin;
    expect((await postLead()).status).toBe(200);
    expect(admin.tables.leads.length).toBe(1);
    expect(calls[0]).toMatch(/^leads:ip:[0-9a-f]{32}$/);
    expect(calls[1]).toMatch(/^leads:email:[0-9a-f]{32}$/);
    expect(calls.join()).not.toContain('203.0.113.9');
    expect(calls.join()).not.toContain('ann@co.ca');
  });

  it('refuses a lead over the limit without saving it', async () => {
    const admin = fakeSupabase({ leads: [] }, { rpc: () => ({ data: false, error: null }) });
    mocks.admin = admin;
    expect((await postLead()).status).toBe(429);
    expect(admin.tables.leads).toEqual([]);
  });

  it('still saves a lead if the limiter itself fails', async () => {
    const admin = fakeSupabase({ leads: [] }, { rpc: () => ({ data: null, error: { message: 'function missing' } }) });
    mocks.admin = admin;
    expect((await postLead()).status).toBe(200);
    expect(admin.tables.leads.length).toBe(1);
  });

  it('honeypot submissions cost no database work', async () => {
    const admin = fakeSupabase({ leads: [] }, { rpc: () => { throw new Error('should not be called'); } });
    mocks.admin = admin;
    expect((await postLead({ ...lead, website: 'http://spam' })).status).toBe(200);
    expect(admin.tables.leads).toEqual([]);
  });

  it('limits onboarding', async () => {
    signedIn({}, 'owner', COMPANY, { rpc: (name) => ({ data: name === 'consume_user_rate_limit' ? false : 'x', error: null }) });
    const res = await onboarding(new Request('https://app.test/api/onboarding', { method: 'POST', body: JSON.stringify({ action: 'create', fullName: 'A', companyName: 'B', province: 'SK' }) }));
    expect(res.status).toBe(429);
  });

  it('reads the caller address from the proxy headers', () => {
    expect(clientIp(new Request('https://x.test', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }))).toBe('1.2.3.4');
    expect(clientIp(new Request('https://x.test', { headers: { 'x-real-ip': '9.9.9.9' } }))).toBe('9.9.9.9');
    expect(clientIp(new Request('https://x.test'))).toBe('unknown');
  });
});

describe('AI history budget', () => {
  const msg = (role: 'user' | 'assistant', chars: number) => ({ role, content: 'x'.repeat(chars) });

  it('leaves a short conversation alone', () => {
    const history = [msg('user', 100), msg('assistant', 100), msg('user', 100)];
    expect(capHistory(history)).toEqual(history);
  });

  it('keeps the latest messages within the budget', () => {
    const history = Array.from({ length: 39 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', 8000));
    const kept = capHistory(history);
    const tokens = kept.reduce((sum, m) => sum + m.content.length / 4, 0);
    expect(tokens).toBeLessThanOrEqual(MAX_HISTORY_TOKENS);
    expect(kept.length).toBeLessThan(history.length);
    expect(kept.at(-1)).toBe(history.at(-1));
  });

  it('always starts with a user message and keeps the question', () => {
    const history = [msg('user', 10), msg('assistant', 44_000), msg('assistant', 4_000), msg('user', 40)];
    const kept = capHistory(history);
    expect(kept[0].role).toBe('user');
    expect(kept.at(-1)).toBe(history.at(-1));
    expect(capHistory([msg('user', 8000)], 1).length).toBe(1);
  });
});

describe('billing helpers', () => {
  it('knows which companies already have a subscription', () => {
    const c = (subscription_status: string, stripe_subscription_id: string | null = null) => ({ subscription_status, stripe_subscription_id });
    expect(companyHasLiveSubscription(c('active'))).toBe(true);
    expect(companyHasLiveSubscription(c('past_due'))).toBe(true);
    expect(companyHasLiveSubscription(c('trialing'))).toBe(false);
    expect(companyHasLiveSubscription(c('canceled', 'sub_1'))).toBe(false);
    expect(companyHasLiveSubscription(c('incomplete', 'sub_1'))).toBe(false);
    expect(companyHasLiveSubscription(c('trialing', 'sub_1'))).toBe(true);
  });
});

describe('trial email job', () => {
  const COMPANY_ROW = (i: number, email = `owner${i}@co.ca`) => ({
    id: `c${String(i).padStart(4, '0')}`,
    name: `Co ${i}`,
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    trial_ends_at: new Date(Date.now() + 13 * 86_400_000).toISOString(),
    subscription_status: 'trialing',
    company_users: [{ email, full_name: 'Ann Lee', role: 'owner' }],
    trial_emails: [],
  });
  const run = () => trialCron(new Request('https://app.test/api/cron/trial-emails', { headers: { authorization: 'Bearer cron-secret' } }));

  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'hello@example.ca');
    vi.stubEnv('BUSINESS_NAME', 'TradeQuote PRO Inc.');
    vi.stubEnv('BUSINESS_MAILING_ADDRESS', 'PO Box 1');
    mocks.send = vi.fn(async () => ({ ok: true }));
  });

  it('requires the cron secret', async () => {
    mocks.admin = fakeSupabase({ companies: [] });
    const res = await trialCron(new Request('https://app.test/api/cron/trial-emails', { headers: { authorization: 'Bearer wrong-secret' } }));
    expect(res.status).toBe(401);
  });

  it('sends nothing at all if unsubscribes cannot be read', async () => {
    mocks.admin = fakeSupabase({ companies: [COMPANY_ROW(1)], trial_emails: [] }, { failOn: ({ table }) => (table === 'email_unsubscribes' ? { message: 'read failed' } : null) });
    const res = await run();
    expect(res.status).toBe(500);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('skips unsubscribed owners, reading only this batch', async () => {
    const admin = fakeSupabase({ companies: [COMPANY_ROW(1), COMPANY_ROW(2)], trial_emails: [], email_unsubscribes: [{ email: 'owner1@co.ca' }, { email: 'someone-else@co.ca' }] });
    mocks.admin = admin;
    const json = await (await run()).json();
    expect(json).toMatchObject({ checked: 2, sent: 1, skipped: 1, failed: 0 });
    const read = admin.log.find((c) => c.table === 'email_unsubscribes')!;
    expect(read.filters[0]).toEqual(['in', 'email', ['owner1@co.ca', 'owner2@co.ca']]);
  });

  it('reaches every company past the first batch', async () => {
    const admin = fakeSupabase({ companies: Array.from({ length: 450 }, (_, i) => COMPANY_ROW(i)), trial_emails: [], email_unsubscribes: [] });
    mocks.admin = admin;
    const json = await (await run()).json();
    expect(json.checked).toBe(450);
    expect(json.sent).toBe(450);
    const reads = admin.log.filter((c) => c.table === 'companies');
    expect(reads.length).toBe(3);
    expect(reads.every((r) => r.limit === 200 && r.order[0] === 'id')).toBe(true);
    expect(reads[1].filters.at(-1)).toEqual(['gt', 'id', 'c0199']);
  });

  it('skips the job rather than crashing when email is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    mocks.admin = fakeSupabase({ companies: [COMPANY_ROW(1)] });
    const res = await run();
    expect(res.status).toBe(200);
    expect((await res.json()).notConfigured).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('releases a step if sending fails', async () => {
    mocks.send = vi.fn(async () => ({ ok: false, error: 'bounced' }));
    const admin = fakeSupabase({ companies: [COMPANY_ROW(1)], trial_emails: [], email_unsubscribes: [] });
    mocks.admin = admin;
    expect((await (await run()).json()).failed).toBe(1);
    expect(admin.tables.trial_emails).toEqual([]);
  });
});

describe('repo settings', () => {
  it('pins Node 22 in .nvmrc and engines', () => {
    expect(readFileSync('.nvmrc', 'utf8').trim()).toBe('22');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).engines.node).toMatch(/22/);
  });

  it('pins migrations to LF', () => {
    expect(readFileSync('.gitattributes', 'utf8')).toContain('supabase/migrations/*.sql text eol=lf');
  });

  it('the launcher binds locally, fails on a bad build and never reads secrets', () => {
    const script = readFileSync('launch-tradequote.ps1', 'utf8');
    expect(script).toContain('$hostAddress = "127.0.0.1"');
    expect(script).toMatch(/"-H", \$hostAddress/);
    expect(script).toMatch(/npm run build[^\n]*\n\s*if \(\$LASTEXITCODE -ne 0\)/);
    expect(script).toContain('Test-Path (Join-Path $projectDir ".env.local")');
    expect(script).not.toMatch(/Get-Content[^\n]*\.env/);
    expect(script).toContain('$env:NEXT_PUBLIC_SITE_URL = $url');
    expect(script).toMatch(/\$port = 3001/);
    for (const source of ['"components"', '"middleware.ts"', '"next.config.js"', '"package-lock.json"']) expect(script).toContain(source);
  });
});
