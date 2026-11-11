// Found by the local end-to-end run: Next's Data Cache served cron and webhook database calls from
// a stored response, so a route could report work it never did and never see a new company.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: () => undefined }) }));

import { sendEmail } from '@/lib/email';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const seen: { url: string; cache: unknown }[] = [];

beforeEach(() => {
  seen.length = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    seen.push({ url: String(input), cache: init?.cache });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('nothing a server route fetches is cached by Next', () => {
  it('the service-role client asks for no-store on reads and writes', async () => {
    const db = createSupabaseAdminClient();
    await db.from('companies').select('id');
    await db.rpc('run_company_automation', { p_company: 'x', p_today: '2026-11-04' });
    expect(seen.length).toBe(2);
    expect(seen.every((s) => s.cache === 'no-store')).toBe(true);
  });

  it('the signed-in client asks for no-store', async () => {
    await createSupabaseServerClient().from('projects').select('id');
    expect(seen.map((s) => s.cache)).toEqual(['no-store']);
  });

  it('sending an email asks for no-store', async () => {
    await sendEmail({ apiKey: 'k', from: 'a@b.test' }, { to: 'c@d.test', subject: 's', text: 't', html: 'h' });
    expect(seen.map((s) => s.cache)).toEqual(['no-store']);
  });
});
