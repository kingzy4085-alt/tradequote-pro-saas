// The public marketing site: routing in middleware, the sitemap, and that the demo's figures are the
// cost engine's own. Nothing here touches the database.
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';
import { JOB_TEMPLATES } from '@/components/marketing/job-templates';
import { buildQuote } from '@/components/marketing/quote-math';
import { CALCULATORS } from '@/lib/calc/registry';
import { CORE_ITEMS, REGIONS, billingRate, priceTakeoff, salesTax, toEstimateLines } from '@/lib/costbook';
import { estimateTotals } from '@/lib/estimate-math';
import { isMarketingPath, isPublicPath, middleware } from '@/middleware';

const request = (path: string, cookie?: string) => new NextRequest(`https://app.test${path}`, cookie ? { headers: { cookie } } : undefined);

describe('marketing routing', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcd.supabase.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    // Any call to Supabase would be a bug for these paths
    vi.stubGlobal('fetch', async () => {
      throw new Error('Supabase must not be called');
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rewrites a signed-out visit to / to the landing page and keeps the URL', async () => {
    const res = await middleware(request('/'));
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://app.test/welcome');
    expect(res.headers.get('location')).toBeNull();
  });

  it('does not rewrite / for a signed-in visitor', async () => {
    const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'u1', exp: 4_000_000_000 })).toString('base64url')}.sig`;
    const session = JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4_000_000_000, user: { id: 'u1', email: 'a@b.ca' } });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ id: 'u1', email: 'a@b.ca', aud: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const res = await middleware(request('/', `sb-abcd-auth-token=${encodeURIComponent(session)}`));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it.each(['/', '/welcome', '/demo', '/tools', '/tools/concrete-slab', '/pricing', '/about'])('%s renders with no Supabase settings', async (path) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const res = await middleware(request(path));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next') === '1' || res.headers.get('x-middleware-rewrite') === 'https://app.test/welcome').toBe(true);
  });

  it('keeps every other path protected', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ message: 'no' }), { status: 401, headers: { 'content-type': 'application/json' } }));
    expect((await middleware(request('/estimates'))).headers.get('location')).toContain('/login?next=');
    expect((await middleware(request('/api/modules/rfis'))).status).toBe(401);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect((await middleware(request('/estimates'))).status).toBe(500);
    expect((await middleware(request('/toolsmith'))).status).toBe(500);
    for (const p of ['/', '/estimates', '/tools-admin', '/demo-data', '/welcome/x']) expect(isMarketingPath(p) && p !== '/welcome').toBe(false);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/tools/concrete-slab')).toBe(true);
  });
});

describe('sitemap and robots', () => {
  it('lists every public page and every calculator', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.test');
    const urls = sitemap().map((s) => s.url);
    for (const p of ['', '/demo', '/tools', '/pricing', '/about', '/legal/privacy', '/legal/terms']) expect(urls).toContain(`https://site.test${p}`);
    for (const c of CALCULATORS) expect(urls).toContain(`https://site.test/tools/${c.id}`);
    expect(new Set(urls).size).toBe(urls.length);
    const rules = robots().rules as { allow: string[]; disallow: string };
    expect(rules.disallow).toBe('/');
    for (const p of ['/$', '/demo', '/tools', '/pricing', '/about']) expect(rules.allow).toContain(p);
    vi.unstubAllEnvs();
  });
});

describe('the quote builder and demo use the real engine', () => {
  it('every template uses real catalog codes', () => {
    for (const t of JOB_TEMPLATES) for (const part of t.parts) for (const l of part.lines) expect(CORE_ITEMS[l.code], `${t.id} ${l.code}`).toBeDefined();
  });

  it.each(JOB_TEMPLATES.map((t) => [t.id, t] as const))('%s totals equal estimateTotals for the same lines', (_id, t) => {
    for (const region of REGIONS.slice(0, 4).map((r) => r.code)) {
      const q = buildQuote({ templateId: t.id, region, markupPct: 22 });
      const lines = toEstimateLines(priceTakeoff(q.parts.flatMap((p) => p.lines), { region }));
      const tax = salesTax(q.province).total;
      expect(q.totals).toEqual(estimateTotals(lines, billingRate(t.labourClass, q.province), 22, tax));
      expect(q.taxPct).toBe(tax);
      // Printed lines add up to the printed price before tax, to the cent
      expect(Math.round(q.rows.reduce((s, r) => s + r.sell, 0) * 100)).toBe(Math.round(q.totals.beforeTax * 100));
      expect(q.rows.length).toBeGreaterThan(0);
    }
  });

  it('edits flow through: markup, rate, size and quantity', () => {
    const base = buildQuote({ templateId: 'pot-light-retrofit', region: 'ON', markupPct: 0 });
    const more = buildQuote({ templateId: 'pot-light-retrofit', region: 'ON', markupPct: 0, size: base.template.scale.max });
    expect(more.rows[0].line.quantity).toBeGreaterThan(base.rows[0].line.quantity);
    expect(buildQuote({ templateId: 'pot-light-retrofit', region: 'ON', markupPct: 50 }).totals.markup).toBeGreaterThanOrEqual(base.totals.markup);
    const zeroed = buildQuote({ templateId: 'pot-light-retrofit', region: 'ON', markupPct: 0, qty: { 0: 0 } });
    expect(zeroed.rows[0].line.quantity).toBe(0);
    expect(zeroed.rows.length).toBe(base.rows.length);
    expect(buildQuote({ templateId: 'nope', region: 'zz', markupPct: Number.NaN, labourRate: Number.NaN }).totals.total).toBeGreaterThanOrEqual(0);
  });
});
