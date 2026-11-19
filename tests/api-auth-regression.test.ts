// Guards the API auth pattern: every requireApi() call uses a real role rank and its result is
// checked, so a 401/402/403 Response is returned instead of being ignored. Mocks Supabase only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ server: null as unknown, sms: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: () => mocks.server, createSupabaseAdminClient: () => mocks.server }));
vi.mock('@/lib/notifications/sms', () => ({ sendSMSNotification: (...args: unknown[]) => mocks.sms(...args) }));

import { POST as depositCheckout } from '@/app/api/stripe/deposit-checkout/route';
import { POST as extractScope } from '@/app/api/ai/extract-scope/route';
import { POST as proposalSms } from '@/app/api/proposals/[id]/sms/route';
import { POST as sendProposal } from '@/app/api/send-proposal/route';

const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@example.test' };
const COMPANY = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01T00:00:00Z', current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null };
const PROPOSAL = '22222222-2222-4222-8222-222222222222';

function signedIn(role: string, options: Parameters<typeof fakeSupabase>[1] = {}, company: Record<string, unknown> = COMPANY) {
  const client = Object.assign(fakeSupabase({ company_users: [{ user_id: USER.id, role, company }] }, options), {
    auth: { getUser: async () => ({ data: { user: USER }, error: null }) },
  });
  mocks.server = client;
  return client;
}
function signedOut() {
  mocks.server = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
}

const json = (body: unknown) => new Request('http://localhost/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const smsParams = { params: Promise.resolve({ id: PROPOSAL }) };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

beforeEach(() => {
  mocks.sms.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('requireApi usage in every route', () => {
  const routes = walk('app/api').filter((f) => f.endsWith('route.ts'));
  const calls = routes.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/(.{0,40})requireApi\(\{([^}]*)\}\)/g)].map((m) => ({ file, before: m[1], args: m[2], source }));
  });

  it('finds the calls', () => expect(calls.length).toBeGreaterThan(40));

  it('never uses a literal rank outside 1 to 5', () => {
    for (const { file, args } of calls) {
      const literal = /minRank:\s*(\d+)\s*[,}]?/.exec(args + ' ');
      if (literal) expect([1, 2, 3, 4, 5], `${file} minRank ${literal[1]}`).toContain(Number(literal[1]));
    }
  });

  it('always keeps the result and returns it when it is a Response', () => {
    for (const { file, before, source } of calls) {
      expect(/(const|let)\s+\w+\s*=\s*await\s*$/.test(before), `${file} ignores the requireApi result`).toBe(true);
      expect(source, `${file} never checks the result`).toMatch(/instanceof Response\)\s*(return|\{)/);
    }
  });
});

describe('POST /api/proposals/[id]/sms', () => {
  it('returns 401 signed out, and never texts', async () => {
    signedOut();
    expect((await proposalSms(json({ phone: '+13065550123' }), smsParams)).status).toBe(401);
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('returns 403 below project manager', async () => {
    signedIn('foreman');
    expect((await proposalSms(json({ phone: '+13065550123' }), smsParams)).status).toBe(403);
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('returns 402 when the trial has ended', async () => {
    signedIn('owner', {}, { ...COMPANY, subscription_status: 'canceled', trial_ends_at: '2020-01-01T00:00:00Z' });
    expect((await proposalSms(json({ phone: '+13065550123' }), smsParams)).status).toBe(402);
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('rejects a bad id and a bad phone number before anything is made or sent', async () => {
    signedIn('project_manager');
    expect((await proposalSms(json({ phone: '+13065550123' }), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
    expect((await proposalSms(json({ phone: 'call me' }), smsParams)).status).toBe(400);
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('texts the real portal link (/portal/<token>), and not the proposal id', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.example.test');
    mocks.sms.mockResolvedValue({ success: true });
    const client = signedIn('project_manager');
    const rpc = vi.spyOn(client, 'rpc').mockResolvedValue({ data: null, error: null } as never);
    const res = await proposalSms(json({ phone: '+13065550123' }), smsParams);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('create_proposal_share', expect.objectContaining({ p_proposal: PROPOSAL }));
    const { message, to } = mocks.sms.mock.calls[0][0] as { message: string; to: string };
    expect(to).toBe('+13065550123');
    expect(message).toMatch(/https:\/\/app\.example\.test\/portal\/[A-Za-z0-9_-]{43}(\s|$)/);
    expect(message).not.toContain('/portal/proposals/');
    expect(message).not.toContain(PROPOSAL);
  });

  it('does not pass the provider error text to the client', async () => {
    mocks.sms.mockResolvedValue({ success: false, error: 'Twilio account SID AC123 is invalid' });
    const client = signedIn('owner');
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: null, error: null } as never);
    const res = await proposalSms(json({ phone: '+13065550123' }), smsParams);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('AC123');
  });
});

describe('POST /api/stripe/deposit-checkout', () => {
  it('returns 401 signed out and 403 below project manager', async () => {
    signedOut();
    expect((await depositCheckout(json({ proposalId: PROPOSAL }))).status).toBe(401);
    signedIn('electrician');
    expect((await depositCheckout(json({ proposalId: PROPOSAL }))).status).toBe(403);
  });

  it('a project manager gets a validated answer, and bad input gets plain 400s', async () => {
    signedIn('project_manager');
    expect((await depositCheckout(json({ proposalId: PROPOSAL }))).status).toBe(200);
    const bad = await depositCheckout(json({ proposalId: 'x' }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'A valid proposal ID is required' });
    expect((await depositCheckout(new Request('http://localhost/api/x', { method: 'POST', body: '{nope' }))).status).toBe(400);
  });
});

describe('POST /api/ai/extract-scope', () => {
  const upload = () => {
    const form = new FormData();
    form.set('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'scope.pdf');
    return new Request('http://localhost/api/ai/extract-scope', { method: 'POST', body: form });
  };

  it('returns 401 signed out, and 403 for an electrician (estimates need project manager)', async () => {
    signedOut();
    expect((await extractScope(upload())).status).toBe(401);
    signedIn('electrician');
    expect((await extractScope(upload())).status).toBe(403);
  });

  it('refuses a file type the AI should not be sent, before any paid call', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
    signedIn('project_manager');
    const form = new FormData();
    form.set('file', new Blob(['hi'], { type: 'text/html' }), 'x.html');
    const res = await extractScope(new Request('http://localhost/api/ai/extract-scope', { method: 'POST', body: form }));
    expect(res.status).toBe(415);
  });
});

describe('POST /api/send-proposal', () => {
  it('requires sign-in and does not leak the exception message', async () => {
    signedOut();
    expect((await sendProposal(json({}))).status).toBe(401);
    signedIn('owner');
    const res = await sendProposal(new Request('http://localhost/api/send-proposal', { method: 'POST', body: '{broken json' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Unable to send proposal' });
  });
});
