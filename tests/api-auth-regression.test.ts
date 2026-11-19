// Guards the API auth contract: every requireApi call uses a rank that exists, and its result
// (a context, or the 401/402/403 Response it returns rather than throws) is checked before use.
// The three routes from issue #11 are also exercised with Supabase, Twilio and Gemini mocked.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';
import { ROLE_RANK } from '@/lib/roles';

const mocks = vi.hoisted(() => ({ server: null as unknown, sms: vi.fn(), gemini: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => mocks.server }));
vi.mock('@/lib/notifications/sms', () => ({ sendSMSNotification: (...args: unknown[]) => mocks.sms(...args) }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: (...args: unknown[]) => mocks.gemini(...args) };
    }
  },
}));

import { POST as extractScope } from '@/app/api/ai/extract-scope/route';
import { POST as proposalSms } from '@/app/api/proposals/[id]/sms/route';
import { POST as sendProposal } from '@/app/api/send-proposal/route';
import { POST as depositCheckout } from '@/app/api/stripe/deposit-checkout/route';

const MAX_RANK = Math.max(...Object.values(ROLE_RANK));
const MIN_RANK = Math.min(...Object.values(ROLE_RANK));

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === 'route.ts' ? [path] : [];
  });
}
const routes = routeFiles('app/api').map((path) => ({ path, source: readFileSync(path, 'utf8') }));

describe('requireApi usage across app/api', () => {
  it('finds the routes', () => expect(routes.length).toBeGreaterThan(30));

  it('never passes a literal minRank outside the real role ranks', () => {
    for (const { path, source } of routes) {
      for (const m of source.matchAll(/requireApi\(\{\s*minRank:\s*(\d+)/g)) {
        const rank = Number(m[1]);
        expect(rank >= MIN_RANK && rank <= MAX_RANK, `${path} uses minRank ${rank}`).toBe(true);
      }
    }
  });

  it('never ignores the result of requireApi', () => {
    for (const { path, source } of routes) {
      for (const m of source.matchAll(/^[ \t]*(const [A-Za-z]+ = )?await requireApi\(/gm)) {
        expect(m[1], `${path} discards the requireApi result`).toBeTruthy();
      }
      const calls = source.match(/await requireApi\(/g)?.length ?? 0;
      const checks = source.match(/instanceof Response/g)?.length ?? 0;
      expect(checks, `${path} must check requireApi's result with instanceof Response`).toBeGreaterThanOrEqual(calls);
    }
  });

  it('does not hand raw error messages to the client in the issue #11 routes', () => {
    for (const file of ['ai/extract-scope', 'proposals/[id]/sms', 'stripe/deposit-checkout', 'send-proposal']) {
      const source = readFileSync(`app/api/${file}/route.ts`, 'utf8');
      expect(source, file).not.toMatch(/error:\s*(err|error)\.message/);
      expect(source, file).not.toMatch(/: any\b/);
      expect(source, file).not.toMatch(/\.json\(\)/);
    }
  });
});

const ID = '22222222-2222-4222-8222-222222222222';
const COMPANY = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01T00:00:00Z', current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null };

function signedIn(role: string | null, options: Parameters<typeof fakeSupabase>[1] = {}) {
  const user = { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.example' };
  const fake = fakeSupabase(role ? { company_users: [{ user_id: user.id, role, company: COMPANY }] } : {}, options);
  mocks.server = Object.assign(fake, { auth: { getUser: async () => ({ data: { user: role ? user : null }, error: null }) } });
}

const json = (body: unknown) => new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const idParams = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.sms.mockReset().mockResolvedValue({ success: true, sid: 'SM1' });
  mocks.gemini.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.tradequote.example');
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/proposals/[id]/sms', () => {
  it('refuses a signed-out caller with 401 and sends nothing', async () => {
    signedIn(null);
    const res = await proposalSms(json({ phone: '+13065550123' }), idParams);
    expect(res.status).toBe(401);
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('refuses a role below the proposals write rank', async () => {
    signedIn('electrician');
    const res = await proposalSms(json({ phone: '+13065550123' }), idParams);
    expect(res.status).toBe(403);
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('refuses a lapsed company (402)', async () => {
    signedIn('owner');
    mocks.server = Object.assign(fakeSupabase({ company_users: [{ user_id: '00000000-0000-4000-8000-00000000000a', role: 'owner', company: { ...COMPANY, subscription_status: 'canceled', trial_ends_at: '2020-01-01T00:00:00Z' } }] }), { auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-00000000000a', email: 'a@b.example' } }, error: null }) } });
    const res = await proposalSms(json({ phone: '+13065550123' }), idParams);
    expect(res.status).toBe(402);
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('rejects a bad id and a bad phone number', async () => {
    signedIn('project_manager');
    expect((await proposalSms(json({ phone: '+13065550123' }), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
    expect((await proposalSms(json({ phone: 'not a phone' }), idParams)).status).toBe(400);
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('texts the real /portal/<token> link, with a token whose hash the database was given', async () => {
    const rpc = vi.fn(() => ({ data: '2030-01-01T00:00:00Z', error: null }));
    signedIn('project_manager', { rpc });
    const res = await proposalSms(json({ phone: '+13065550123' }), idParams);
    expect(res.status).toBe(200);
    const message = (mocks.sms.mock.calls[0][0] as { message: string }).message;
    const url = message.match(/https:\/\/\S+/)?.[0] ?? '';
    expect(url).toMatch(/^https:\/\/app\.tradequote\.example\/portal\/[A-Za-z0-9_-]{43}$/);
    expect(url).not.toContain('/portal/proposals/');
    expect(rpc).toHaveBeenCalledWith('create_proposal_share', { p_proposal: ID, p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it('does not leak the SMS provider error', async () => {
    mocks.sms.mockResolvedValue({ success: false, error: 'Twilio account AC123 secret detail' });
    signedIn('owner');
    const res = await proposalSms(json({ phone: '+13065550123' }), idParams);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('Twilio account');
  });
});

describe('POST /api/stripe/deposit-checkout', () => {
  it('refuses signed-out and under-ranked callers', async () => {
    signedIn(null);
    expect((await depositCheckout(json({ proposalId: ID }))).status).toBe(401);
    signedIn('foreman');
    expect((await depositCheckout(json({ proposalId: ID }))).status).toBe(403);
  });

  it('validates the body and does not echo internals', async () => {
    signedIn('owner');
    expect((await depositCheckout(json({ proposalId: 'x' }))).status).toBe(400);
    const bad = new NextRequest('http://localhost/api/x', { method: 'POST', body: '{not json' });
    const res = await depositCheckout(bad);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toMatch(/Unexpected|JSON at position/);
    expect((await depositCheckout(json({ proposalId: ID }))).status).toBe(200);
  });
});

describe('POST /api/send-proposal', () => {
  it('refuses a signed-out caller and validates the body', async () => {
    signedIn(null);
    expect((await sendProposal(json({}))).status).toBe(401);
    signedIn('owner');
    expect((await sendProposal(json({ clientEmail: 'nope' }))).status).toBe(400);
  });
});

describe('POST /api/ai/extract-scope', () => {
  function upload(type = 'application/pdf', size = 10) {
    const form = new FormData();
    form.append('file', new File([new Uint8Array(size)], 'scope', { type }));
    return new NextRequest('http://localhost/api/ai/extract-scope', { method: 'POST', body: form });
  }

  it('refuses signed-out and under-ranked callers before any AI call', async () => {
    signedIn(null);
    expect((await extractScope(upload())).status).toBe(401);
    signedIn('electrician');
    expect((await extractScope(upload())).status).toBe(403);
    expect(mocks.gemini).not.toHaveBeenCalled();
  });

  it('answers 503 when Gemini is not configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    signedIn('owner');
    expect((await extractScope(upload())).status).toBe(503);
  });

  it('refuses unsupported types and respects the hourly allowance', async () => {
    signedIn('owner');
    expect((await extractScope(upload('application/zip'))).status).toBe(415);
    signedIn('owner', { rpc: () => ({ data: false, error: null }) });
    expect((await extractScope(upload())).status).toBe(429);
    expect(mocks.gemini).not.toHaveBeenCalled();
  });

  it('returns a validated draft, and hides provider failures', async () => {
    signedIn('project_manager');
    mocks.gemini.mockResolvedValue({ response: { text: () => '{"estimatedLabor": 12, "estimatedMaterials": 450.5, "description": "Panel upgrade"}' } });
    const ok = await extractScope(upload());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ success: true, data: { estimatedLabor: 12, estimatedMaterials: 450.5, description: 'Panel upgrade' } });

    mocks.gemini.mockResolvedValue({ response: { text: () => '{"estimatedLabor": "lots"}' } });
    expect((await extractScope(upload())).status).toBe(502);

    mocks.gemini.mockRejectedValue(new Error('API key AIza-secret quota exceeded'));
    const failed = await extractScope(upload());
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain('AIza');
  });
});
