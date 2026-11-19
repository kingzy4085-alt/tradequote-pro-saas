// Regression tests for issue #11: ignored requireApi() results and impossible ranks.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  require: vi.fn(),
  sms: vi.fn(),
  rpc: vi.fn(),
  rate: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), requireApi: mocks.require }));
vi.mock('@/lib/notifications/sms', () => ({ sendSMSNotification: mocks.sms }));
vi.mock('@/lib/rate-limit', () => ({ consumeUserRateLimit: mocks.rate }));

import { POST as extractScope } from '@/app/api/ai/extract-scope/route';
import { POST as proposalSms } from '@/app/api/proposals/[id]/sms/route';
import { POST as depositCheckout } from '@/app/api/stripe/deposit-checkout/route';

const API_DIR = join(process.cwd(), 'app', 'api');
const routeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === 'route.ts' ? [path] : [];
  });

describe('every requireApi call', () => {
  const files = routeFiles(API_DIR);

  it('finds the routes', () => expect(files.length).toBeGreaterThan(30));

  it('uses a rank that exists (1 to 5) when it gives a number', () => {
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/requireApi\(\{\s*minRank:\s*(\d+)/g)) {
        const rank = Number(match[1]);
        expect(rank, `${file} uses minRank ${rank}`).toBeGreaterThanOrEqual(1);
        expect(rank, `${file} uses minRank ${rank}`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('keeps the result and returns it when it is a Response', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const calls = source.match(/requireApi\(/g)?.length ?? 0;
      if (!calls) continue;
      const kept = source.match(/(?:const|let)\s+ctx\s*=\s*await\s+requireApi\(/g)?.length ?? 0;
      const checked = source.match(/ctx instanceof Response\)/g)?.length ?? 0;
      expect(kept, `${file} must keep the requireApi result`).toBe(calls);
      expect(checked, `${file} must return a Response result`).toBeGreaterThanOrEqual(calls);
    }
  });
});

const denied = () => new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401 });
const ctx = { supabase: { rpc: mocks.rpc } };
const ID = '22222222-2222-4222-8222-222222222222';
const json = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.require.mockResolvedValue(ctx);
  mocks.rpc.mockResolvedValue({ data: '2030-01-01', error: null });
  mocks.sms.mockResolvedValue({ success: true });
  mocks.rate.mockResolvedValue(true);
});

describe('proposal SMS', () => {
  const call = (body: unknown, id = ID) => proposalSms(json(body), { params: { id } });

  it('stops signed-out callers before doing anything', async () => {
    mocks.require.mockResolvedValue(denied());
    expect((await call({ phone: '+14035550123' })).status).toBe(401);
    expect(mocks.sms).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('asks for a real proposals write rank', async () => {
    await call({ phone: '+14035550123' });
    const { minRank, write } = mocks.require.mock.calls[0][0];
    expect(minRank).toBeLessThanOrEqual(5);
    expect(write).toBe(true);
  });

  it('rejects a bad id and a bad number without sending', async () => {
    expect((await call({ phone: '+14035550123' }, 'nope')).status).toBe(404);
    expect((await call({ phone: 'not a number' })).status).toBe(400);
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('texts the real portal route (/portal/<token>), not a proposal id path', async () => {
    const res = await call({ phone: '+14035550123' });
    expect(res.status).toBe(200);
    const { to, message } = mocks.sms.mock.calls[0][0];
    expect(to).toBe('+14035550123');
    expect(message).toMatch(/\/portal\/[A-Za-z0-9_-]{20,}/);
    expect(message).not.toContain('/portal/proposals/');
    expect(message).not.toContain(ID);
    expect(mocks.rpc).toHaveBeenCalledWith('create_proposal_share', expect.objectContaining({ p_proposal: ID }));
  });

  it('does not leak provider error text', async () => {
    mocks.sms.mockResolvedValue({ success: false, error: 'Twilio account SID AC123 is invalid' });
    const res = await call({ phone: '+14035550123' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/Twilio|AC123/);
  });
});

describe('deposit checkout', () => {
  it('stops callers who are refused', async () => {
    mocks.require.mockResolvedValue(denied());
    expect((await depositCheckout(json({ proposalId: ID }))).status).toBe(401);
  });

  it('uses a real rank and validates the proposal id', async () => {
    expect((await depositCheckout(json({ proposalId: 'x' }))).status).toBe(400);
    expect(mocks.require.mock.calls[0][0].minRank).toBeLessThanOrEqual(5);
    expect((await depositCheckout(json({ proposalId: ID }))).status).toBe(200);
  });
});

describe('AI scope extraction', () => {
  const upload = (type = 'application/pdf', size = 10) => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(size)], { type }), 'scope');
    return new Request('http://localhost/x', { method: 'POST', body: form });
  };

  it('stops refused callers before any AI call or rate-limit use', async () => {
    mocks.require.mockResolvedValue(denied());
    expect((await extractScope(upload())).status).toBe(401);
    expect(mocks.rate).not.toHaveBeenCalled();
  });

  it('uses a real rank', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    await extractScope(upload());
    expect(mocks.require.mock.calls[0][0].minRank).toBeLessThanOrEqual(5);
    vi.unstubAllEnvs();
  });

  it('is plain-spoken when not configured, with no AI call', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const res = await extractScope(upload());
    expect(res.status).toBe(503);
    expect(mocks.rate).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('refuses unsupported file types and enforces the hourly allowance', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fake-test-key');
    expect((await extractScope(upload('application/x-msdownload'))).status).toBe(415);
    mocks.rate.mockResolvedValue(false);
    expect((await extractScope(upload())).status).toBe(429);
    vi.unstubAllEnvs();
  });
});
