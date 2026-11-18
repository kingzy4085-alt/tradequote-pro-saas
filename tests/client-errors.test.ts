// Error reports from the error screens: what the browser sends (lib/error-report.ts), and what
// app/api/client-errors takes, logs and answers. Supabase is a stand-in; the route never queries it
// beyond working out who is calling.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ server: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => mocks.server }));

import { POST } from '@/app/api/client-errors/route';
import { ClientErrorReport, MAX_REPORT_BYTES, MAX_TRACKED_REPORTERS, REPORTS_PER_WINDOW, REPORT_WINDOW_MS, resetReportAllowances, takeReportAllowance, trackedReporters } from '@/lib/client-errors';
import { REPORT_LIMITS, buildErrorReport, reportClientError, reportPath } from '@/lib/error-report';

const USER = { id: '00000000-0000-4000-8000-0000000000e1', email: 'elec@alpha.ca' };
const OTHER = { id: '00000000-0000-4000-8000-0000000000e2', email: 'pm@alpha.ca' };
const COMPANY = { id: '11111111-1111-4111-8111-1111111111e1', name: 'Alpha', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01T00:00:00Z', current_period_end: null };

function signedIn(role = 'electrician', company: Record<string, unknown> = COMPANY, user = USER) {
  const fake = fakeSupabase({ company_users: [{ user_id: user.id, role, company }] });
  mocks.server = Object.assign(fake, { auth: { getUser: async () => ({ data: { user }, error: null }) } });
  return fake;
}

function signedOut() {
  mocks.server = { auth: { getUser: async () => ({ data: { user: null }, error: { name: 'AuthSessionMissingError', status: 400 } }) } };
}

/** Stands in for what an error message might carry, to prove it never comes back. */
const SECRET = 'SECRET_MARKER_7d1f';
const GOOD = { message: `Cannot read properties of undefined (reading '${SECRET}')`, digest: '4242', path: '/estimates/abc' };

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request('https://app.test/api/client-errors', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));

let consoleError: MockInstance<typeof console.error>;
const reportLines = () => consoleError.mock.calls.map((call) => call[0]).filter((line): line is string => typeof line === 'string' && line.includes('"event":"client_error"'));

beforeEach(() => {
  resetReportAllowances();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('who may report', () => {
  it('refuses a signed-out caller and logs nothing', async () => {
    signedOut();
    const res = await post(GOOD);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(SECRET);
    expect(reportLines()).toEqual([]);
  });

  it('refuses someone who has not set up a company yet', async () => {
    const client = signedIn();
    client.tables.company_users = [];
    expect((await post(GOOD)).status).toBe(403);
    expect(reportLines()).toEqual([]);
  });

  it('takes a report from every role', async () => {
    for (const role of ['electrician', 'foreman', 'project_manager', 'admin', 'owner']) {
      signedIn(role);
      expect((await post(GOOD)).status, role).toBe(204);
    }
    expect(reportLines()).toHaveLength(5);
  });

  it('takes a report from a lapsed company, because nothing is written', async () => {
    signedIn('owner', { ...COMPANY, subscription_status: 'canceled', trial_ends_at: '2020-01-01T00:00:00Z' });
    expect((await post(GOOD)).status).toBe(204);
    expect(reportLines()).toHaveLength(1);
  });
});

describe('what is logged and what is answered', () => {
  it('logs one line of JSON with the company, user, role, page, digest and message', async () => {
    signedIn('foreman');
    const res = await post({ ...GOOD, message: `${GOOD.message}\nsecond line` });
    expect(res.status).toBe(204);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [line] = reportLines();
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      event: 'client_error',
      company_id: COMPANY.id,
      user_id: USER.id,
      role: 'foreman',
      path: '/estimates/abc',
      digest: '4242',
      message: `${GOOD.message}\nsecond line`,
    });
  });

  it('a report without a digest logs it as null', async () => {
    signedIn();
    expect((await post({ message: 'x', path: '/' })).status).toBe(204);
    expect(JSON.parse(reportLines()[0]).digest).toBeNull();
  });

  it('never says back what it was sent, whatever happens to the report', async () => {
    signedIn();
    const answers = [
      await post(GOOD),
      await post({ ...GOOD, stack: `at ${SECRET}` }),
      await post({ ...GOOD, message: `${SECRET}${'x'.repeat(500)}` }),
      await post(`{"message":"${SECRET}"`),
      await post({ ...GOOD, pad: SECRET.repeat(1_000) }),
    ];
    expect(answers.map((r) => r.status)).toEqual([204, 400, 400, 400, 413]);
    expect(await answers[0].text()).toBe('');
    for (const res of answers) expect(await res.text()).not.toContain(SECRET);
  });
});

describe('what it refuses', () => {
  beforeEach(() => signedIn());

  it.each([
    ['a message over 500 characters', { ...GOOD, message: 'x'.repeat(REPORT_LIMITS.message + 1) }],
    ['a page over 200 characters', { ...GOOD, path: `/${'a'.repeat(REPORT_LIMITS.path)}` }],
    ['a digest over 100 characters', { ...GOOD, digest: '1'.repeat(REPORT_LIMITS.digest + 1) }],
    ['a page that is not a path', { ...GOOD, path: 'https://evil.example/' }],
    ['no page', { message: GOOD.message }],
    ['no message', { path: '/' }],
    ['a stack', { ...GOOD, stack: 'Error: x\n    at f (app.js:1:1)' }],
    ['cookies', { ...GOOD, cookies: 'sb-access-token=abc' }],
    ['form input', { ...GOOD, input: { email: 'a@b.ca' } }],
    ['a message that is not text', { ...GOOD, message: { text: 'x' } }],
    ['a list', [GOOD]],
    ['null', null],
    ['a bare string', 'just text'],
    ['broken JSON', '{"message":'],
  ])('refuses %s, before logging anything', async (_what, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'That report could not be read' });
    expect(reportLines()).toEqual([]);
  });

  it('refuses a body over the size limit, by its real size and by the size it declares', async () => {
    expect((await post({ ...GOOD, pad: 'x'.repeat(MAX_REPORT_BYTES) })).status).toBe(413);
    expect((await post(GOOD, { 'content-length': String(MAX_REPORT_BYTES + 1) })).status).toBe(413);
    expect(reportLines()).toEqual([]);
  });

  it('takes a report at every limit, even with every character escaped', async () => {
    const control = '\u0001';
    const full = { message: control.repeat(REPORT_LIMITS.message), digest: control.repeat(REPORT_LIMITS.digest), path: `/${control.repeat(REPORT_LIMITS.path - 1)}` };
    expect(Buffer.byteLength(JSON.stringify(full))).toBeGreaterThan(4_000);
    expect((await post(full)).status).toBe(204);
  });
});

describe('the cap per person', () => {
  it(`takes ${REPORTS_PER_WINDOW} reports a person in each window, then refuses until the window ends`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    signedIn();
    for (let i = 0; i < REPORTS_PER_WINDOW; i++) expect((await post(GOOD)).status).toBe(204);
    const refused = await post(GOOD);
    expect(refused.status).toBe(429);
    expect(await refused.text()).not.toContain(SECRET);
    expect(reportLines()).toHaveLength(REPORTS_PER_WINDOW);

    // Someone else in the same company is counted on their own
    signedIn('project_manager', COMPANY, OTHER);
    expect((await post(GOOD)).status).toBe(204);

    signedIn();
    vi.setSystemTime(new Date(Date.now() + REPORT_WINDOW_MS - 1));
    expect((await post(GOOD)).status).toBe(429);
    vi.setSystemTime(new Date(Date.now() + 1));
    expect((await post(GOOD)).status).toBe(204);
  });

  it('refused and unreadable reports do not use up the allowance', async () => {
    signedIn();
    for (let i = 0; i < REPORTS_PER_WINDOW * 2; i++) await post({ ...GOOD, stack: 'x' });
    expect((await post(GOOD)).status).toBe(204);
  });

  it('holds a bounded number of people in memory, forgetting the oldest first', () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_TRACKED_REPORTERS + 50; i++) expect(takeReportAllowance(`user-${i}`, now)).toBe(true);
    expect(trackedReporters()).toBe(MAX_TRACKED_REPORTERS);
    // The newest are still counted
    const newest = `user-${MAX_TRACKED_REPORTERS + 49}`;
    for (let i = 1; i < REPORTS_PER_WINDOW; i++) expect(takeReportAllowance(newest, now)).toBe(true);
    expect(takeReportAllowance(newest, now)).toBe(false);
    // Ended windows are cleared before anyone still counting is forgotten
    expect(takeReportAllowance('late-comer', now + REPORT_WINDOW_MS)).toBe(true);
    expect(trackedReporters()).toBe(1);
  });
});

describe('what the browser sends', () => {
  it('only the message, the digest and the page, cut to size', () => {
    const error = Object.assign(new Error('m'.repeat(600)), { digest: 'd'.repeat(150) });
    error.stack = `Error\n    at ${SECRET}`;
    const report = buildErrorReport(error, `/crm/${'a'.repeat(300)}?search=${SECRET}#top`);
    expect(Object.keys(report).sort()).toEqual(['digest', 'message', 'path']);
    expect(report.message).toHaveLength(REPORT_LIMITS.message);
    expect(report.digest).toHaveLength(REPORT_LIMITS.digest);
    expect(report.path).toHaveLength(REPORT_LIMITS.path);
    expect(JSON.stringify(report)).not.toContain(SECRET);
    // What the browser builds is exactly what the route takes
    expect(ClientErrorReport.safeParse(report).success).toBe(true);
  });

  it('leaves out the query, the hash and a client portal token', () => {
    expect(reportPath('/estimates/1?search=typed#notes')).toBe('/estimates/1');
    expect(reportPath('/portal/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde')).toBe('/portal/[token]');
    expect(reportPath('/portal/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde/print')).toBe('/portal/[token]/print');
    expect(reportPath('')).toBe('/');
  });

  it('copes with something thrown that is not an Error', () => {
    expect(buildErrorReport('plain text thrown', '/')).toEqual({ message: 'plain text thrown', path: '/' });
    expect(buildErrorReport(null, '/x')).toEqual({ message: '', path: '/x' });
    expect(buildErrorReport({ digest: '' }, '/x')).toEqual({ message: '', path: '/x' });
  });

  it('posts each error once, without waiting, and never throws', async () => {
    const sent = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', sent);
    const error = Object.assign(new Error('boom'), { digest: '99' });
    reportClientError(error, '/timecards');
    reportClientError(error, '/timecards');
    expect(sent).toHaveBeenCalledTimes(1);
    const [url, init] = sent.mock.calls[0];
    expect(url).toBe('/api/client-errors');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init.body))).toEqual({ message: 'boom', digest: '99', path: '/timecards' });

    // The same failure again, after "Try again", is a new error and a new report
    reportClientError(new Error('boom'), '/timecards');
    expect(sent).toHaveBeenCalledTimes(2);

    // No network, or no fetch at all: the error screen still shows
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(() => reportClientError(new Error('offline'), '/')).not.toThrow();
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new TypeError('fetch is not a function');
    }));
    expect(() => reportClientError(new Error('no fetch'), '/')).not.toThrow();
    expect(() => reportClientError('thrown text', '/')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('the error screen reports when it shows, after logging to the console', () => {
    const view = readFileSync('components/error-view.tsx', 'utf8');
    expect(view).toMatch(/useEffect\(\(\) => \{\s*console\.error\(error\);\s*reportClientError\(error\);\s*\}, \[error\]\);/);
  });
});
