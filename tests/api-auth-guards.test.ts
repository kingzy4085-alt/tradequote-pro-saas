// Regression tests for issue #11: ignored requireApi() results and impossible ranks.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  require: vi.fn(),
  rate: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), requireApi: mocks.require }));
vi.mock('@/lib/rate-limit', () => ({ consumeUserRateLimit: mocks.rate }));

import { POST as extractScope } from '@/app/api/ai/extract-scope/route';

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
const ctx = { supabase: {} };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.require.mockResolvedValue(ctx);
  mocks.rate.mockResolvedValue(true);
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
