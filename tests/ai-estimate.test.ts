// POST /api/ai/estimate with Supabase faked and the Anthropic SDK mocked: no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ server: null as unknown, stream: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => mocks.server }));
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    beta = { messages: { stream: (...args: unknown[]) => (mocks.stream as (...a: unknown[]) => unknown)(...args) } };
  }
  // Keep the real error classes so instanceof checks in the code under test work
  for (const [key, value] of Object.entries(actual)) {
    if (key !== 'default' && /Error$/.test(key)) Object.defineProperty(FakeAnthropic, key, { value });
  }
  return { ...actual, default: FakeAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';
import { POST } from '@/app/api/ai/estimate/route';
import { DraftSchema, MAX_FILE_BYTES, MAX_SCOPE_CHARS, priceDraft } from '@/lib/ai-estimate';
import { CATALOG, getRegion, priceTakeoff } from '@/lib/costbook';
import { getModule } from '@/lib/modules';

const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'pm@alpha.ca' };
const COMPANY = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Alpha',
  province: 'AB',
  subscription_status: 'active',
  trial_ends_at: '2030-01-01T00:00:00Z',
  current_period_end: null,
};
const ITEM = CATALOG[0];

function signedIn(opts: { role?: string; company?: Record<string, unknown>; tables?: Record<string, Record<string, unknown>[]>; usage?: object | null; usageError?: boolean; hourlyLimitReached?: boolean } = {}) {
  const usage = opts.usage === undefined ? { allowed: true, used: 1, daily_limit: 50 } : opts.usage;
  const fake = fakeSupabase({ company_users: [{ user_id: USER.id, role: opts.role ?? 'project_manager', company: opts.company ?? COMPANY }], ...opts.tables });
  const rpc = vi.fn((name: string) => {
    // consume_user_rate_limit('ai') is the hourly per-user limit; consume_ai_message is the daily allowance
    const result =
      name === 'consume_user_rate_limit'
        ? { data: !opts.hourlyLimitReached, error: null }
        : opts.usageError
          ? { data: null, error: { message: 'secret db detail' } }
          : { data: usage, error: null };
    return Object.assign(Promise.resolve(result), { single: () => Promise.resolve(result) });
  });
  const client = Object.assign(fake, { rpc, auth: { getUser: async () => ({ data: { user: USER }, error: null }) } });
  mocks.server = client;
  return client;
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]);
const file = (data: Buffer, name: string, type: string) => new File([new Uint8Array(data)], name, { type });

function post(parts: { scope?: string; files?: File[] } = { scope: 'Install 12 pot lights' }, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (parts.scope !== undefined) form.append('scope', parts.scope);
  for (const f of parts.files ?? []) form.append('files', f);
  return POST(new Request('http://app.test/api/ai/estimate', { method: 'POST', body: form, headers }));
}

const goodDraft = () => ({
  summary: 'Twelve pot lights in a finished basement.',
  trade: 'electrical',
  assumptions: ['Ceiling is drywall'],
  exclusions: ['Drywall repair'],
  questions_for_client: ['Is the panel full?'],
  lines: [
    { code: ITEM.code, description: 'Pot light', quantity: 12, unit: ITEM.unit, labour_class: 'electrician', note: 'LED' },
    { code: 'MADE-UP-CODE', description: 'Odd item', quantity: 2, unit: 'ea' },
  ],
});
const reply = (body: unknown, stop_reason = 'end_turn') => ({ finalMessage: async () => ({ stop_reason, content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }] }) });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  mocks.stream = vi.fn(() => reply(goodDraft()));
});
afterEach(() => vi.unstubAllEnvs());

const called = () => (mocks.stream as ReturnType<typeof vi.fn>).mock.calls.length;

describe('who may draft', () => {
  it('needs a signed-in user', async () => {
    mocks.server = Object.assign(fakeSupabase({}), { auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
    expect((await post()).status).toBe(401);
    expect(called()).toBe(0);
  });

  it('needs the rank that can write estimates', async () => {
    const need = getModule('estimates')!.write;
    expect(need).toBeGreaterThan(1);
    for (const role of ['electrician', 'foreman']) {
      signedIn({ role });
      expect((await post()).status).toBe(403);
    }
    signedIn({ role: 'project_manager' });
    expect((await post()).status).toBe(200);
    expect(called()).toBe(1);
  });

  it('is closed to a company whose trial or subscription has ended, without using the allowance', async () => {
    const client = signedIn({ company: { ...COMPANY, subscription_status: 'canceled' } });
    const res = await post();
    expect(res.status).toBe(402);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(called()).toBe(0);
  });

  it("stops at the hourly 'ai' limit before spending the daily allowance or calling the model", async () => {
    const client = signedIn({ hourlyLimitReached: true });
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain('this hour');
    expect(client.rpc).toHaveBeenCalledWith('consume_user_rate_limit', { p_bucket: 'ai' });
    expect(client.rpc).not.toHaveBeenCalledWith('consume_ai_message');
    expect(called()).toBe(0);
  });

  it('refuses when the daily allowance is used up', async () => {
    signedIn({ usage: { allowed: false, used: 50, daily_limit: 50 } });
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("today's 50");
    expect(called()).toBe(0);
    signedIn({ usage: { allowed: false, used: 0, daily_limit: 0 } });
    expect((await (await post()).json()).error).toContain('active trial or subscription');
  });

  it('does not leak a failed allowance check', async () => {
    signedIn({ usageError: true });
    const res = await post();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});

describe('what may be uploaded', () => {
  const rejects = async (parts: Parameters<typeof post>[0], headers?: Record<string, string>, status = 400) => {
    const client = signedIn();
    const res = await post(parts, headers);
    expect(res.status).toBe(status);
    expect(called()).toBe(0);
    // Bad uploads do not cost an allowance
    expect(client.rpc).not.toHaveBeenCalled();
  };

  it('needs a scope or a file', async () => rejects({ scope: '   ' }));
  it('limits the scope to 20,000 characters', async () => {
    await rejects({ scope: 'x'.repeat(MAX_SCOPE_CHARS + 1) });
    signedIn();
    expect((await post({ scope: 'x'.repeat(MAX_SCOPE_CHARS) })).status).toBe(200);
  });
  it('allows at most three files', async () => rejects({ files: Array.from({ length: 4 }, (_, i) => file(PNG, `p${i}.png`, 'image/png')) }));
  it('rejects other file types', async () => {
    await rejects({ files: [file(Buffer.from('hello'), 'a.txt', 'text/plain')] });
    await rejects({ files: [file(PNG, 'a.gif', 'image/gif')] });
    await rejects({ files: [file(Buffer.from('<svg/>'), 'a.svg', 'image/svg+xml')] });
  });
  it('rejects files over 10 MB', async () => rejects({ files: [file(Buffer.concat([PDF, Buffer.alloc(MAX_FILE_BYTES)]), 'big.pdf', 'application/pdf')] }));
  it('rejects a file whose contents do not match its type', async () => rejects({ files: [file(Buffer.from('not a pdf at all'), 'a.pdf', 'application/pdf')] }));
  it('rejects an oversized request before reading it', async () => rejects({ scope: 'x' }, { 'content-length': String(100 * 1024 * 1024) }, 413));

  it('sends PDFs and images to Claude as document and image blocks', async () => {
    signedIn();
    const res = await post({ scope: 'Panel upgrade', files: [file(PDF, 'plan.pdf', 'application/pdf'), file(PNG, 'panel.png', 'image/png')] });
    expect(res.status).toBe(200);
    const [params] = (mocks.stream as ReturnType<typeof vi.fn>).mock.calls[0];
    const content = params.messages[0].content;
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
    expect(content[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    expect(content[2]).toMatchObject({ type: 'text' });
    expect(content[2].text).toContain('Panel upgrade');
    expect(params).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('the draft', () => {
  it('prices lines with the catalog, company prices and the company region, and saves nothing', async () => {
    const client = signedIn({ tables: { material_price_book: [{ company_id: COMPANY.id, item_code: ITEM.code, description: 'Our pot light', unit: ITEM.unit, unit_cost: 9.5 }] } });
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.summary).toContain('pot lights');
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).toMatchObject({ code: ITEM.code, quantity: 12, materialUnitCost: 9.5, priceSource: 'company' });
    // An invented code is not trusted: the line stays, unpriced
    expect(body.lines[1]).toMatchObject({ code: null, description: 'Odd item', priceSource: 'none', materialUnitCost: 0 });
    expect(body.estimateLines[0]).toEqual({ description: expect.any(String), quantity: 12, unit: ITEM.unit, material_unit_cost: 9.5, labour_hours_per_unit: expect.any(Number) });
    expect(body.estimateLines).toHaveLength(2);
    expect(client.log.every((l) => l.op === 'select')).toBe(true);
  });

  it("uses the company's own labour hours from its price book, not only its price", async () => {
    signedIn({ tables: { material_price_book: [{ company_id: COMPANY.id, item_code: ITEM.code, description: 'Our pot light', unit: ITEM.unit, unit_cost: 9.5, labour_hours: 0.85 }] } });
    const body = await (await post()).json();
    expect(body.lines[0]).toMatchObject({ code: ITEM.code, materialUnitCost: 9.5, labourHoursPerUnit: 0.85, priceSource: 'company' });
    expect(body.estimateLines[0]).toMatchObject({ material_unit_cost: 9.5, labour_hours_per_unit: 0.85 });
  });

  it('skips a saved price that is not a usable number instead of pricing the line at zero', async () => {
    signedIn({ tables: { material_price_book: [{ company_id: COMPANY.id, item_code: ITEM.code, description: 'Broken row', unit: ITEM.unit, unit_cost: 'not a price', labour_hours: 0.85 }] } });
    const body = await (await post()).json();
    expect(body.lines[0].priceSource).toBe('reference');
    expect(body.lines[0].materialUnitCost).toBeGreaterThan(0);
  });

  it('falls back to reference prices when the price book is unreadable', async () => {
    signedIn();
    const body = await (await post()).json();
    expect(body.lines[0].priceSource).toBe('reference');
    expect(body.lines[0].materialUnitCost).toBe(priceTakeoff([{ code: ITEM.code, description: '', quantity: 1, unit: '' }], { region: getRegion('AB').code })[0].materialUnitCost);
  });

  it('priceDraft converts feet to the catalog metre before pricing, and drops a code whose unit cannot be reconciled', () => {
    const base = { summary: 'Basement circuits', trade: 'electrical' as const, assumptions: [], exclusions: [], questions_for_client: [] };
    // NMD90 is priced per metre: 328.084 ft is 100 m, never 328 m at the per-metre price
    const feet = priceDraft({ ...base, lines: [{ code: 'NMD90-14-2', description: 'NMD90 14/2', quantity: 328.084, unit: 'ft' }] }, { province: 'ON' });
    expect(feet.lines[0]).toMatchObject({ code: 'NMD90-14-2', quantity: 100, unit: 'm', priceSource: 'reference' });
    expect(feet.lines[0].note).toContain('Converted from 328.084 ft');
    // Spelled-out units still match
    const metres = priceDraft({ ...base, lines: [{ code: 'NMD90-14-2', description: 'NMD90 14/2', quantity: 50, unit: 'metres' }] }, { province: 'ON' });
    expect(metres.lines[0]).toMatchObject({ code: 'NMD90-14-2', quantity: 50, unit: 'm' });
    // A count that cannot become metres keeps the line but not the catalog price
    const boxes = priceDraft({ ...base, lines: [{ code: 'NMD90-14-2', description: 'NMD90 14/2', quantity: 2, unit: 'coil' }] }, { province: 'ON' });
    expect(boxes.lines[0]).toMatchObject({ code: null, quantity: 2, unit: 'coil', priceSource: 'none' });
    expect(boxes.lines[0].note).toContain('price it by hand');
  });

  it('priceDraft drops zero-quantity lines from the estimate lines only', () => {
    const draft = DraftSchema.parse(goodDraft());
    const out = priceDraft(draft, { province: 'ON' });
    expect(out.lines).toHaveLength(2);
    expect(out.estimateLines).toHaveLength(2);
  });

  it.each([
    ['not JSON', 'sorry, here is some prose'],
    ['a missing summary', { ...goodDraft(), summary: '' }],
    ['a negative quantity', { ...goodDraft(), lines: [{ description: 'x', quantity: -1, unit: 'ea' }] }],
    ['an unknown trade', { ...goodDraft(), trade: 'astrology' }],
    ['an unknown labour class', { ...goodDraft(), lines: [{ description: 'x', quantity: 1, unit: 'ea', labour_class: 'wizard' }] }],
  ])('rejects %s from the model with a short message', async (_n, bad) => {
    signedIn();
    mocks.stream = vi.fn(() => reply(bad));
    const res = await post();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/could not use/);
  });

  it('reports a refusal and a cut-off answer plainly', async () => {
    signedIn();
    mocks.stream = vi.fn(() => reply('', 'refusal'));
    expect((await post()).status).toBe(422);
    mocks.stream = vi.fn(() => reply(goodDraft(), 'max_tokens'));
    expect((await (await post()).json()).error).toContain('too big');
  });
});

describe('errors never leak internals', () => {
  const SECRET = 'sk-ant-SECRET at /srv/app/lib/ai-estimate.ts';
  const headers = new Headers();
  it.each([
    ['a generic failure', () => new Error(SECRET), 500],
    ['a rate limit', () => new Anthropic.RateLimitError(429, { error: { message: SECRET } }, SECRET, headers), 503],
    ['bad credentials', () => new Anthropic.AuthenticationError(401, { error: { message: SECRET } }, SECRET, headers), 503],
    ['a server error', () => new Anthropic.InternalServerError(500, { error: { message: SECRET } }, SECRET, headers), 503],
    ['a bad request', () => new Anthropic.BadRequestError(400, { error: { message: SECRET } }, SECRET, headers), 422],
  ])('maps %s to a short message', async (_n, make, status) => {
    signedIn();
    mocks.stream = vi.fn(() => ({ finalMessage: async () => Promise.reject(make()) }));
    const res = await post();
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('/srv/');
    expect(console.error).toHaveBeenCalled();
  });

  it('is not configured without an API key', async () => {
    signedIn();
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await post()).status).toBe(503);
  });
});

describe('estimate prompt guardrails', () => {
  it('forbids code numbers and requires unchecked size assumptions', async () => {
    const { ESTIMATE_SYSTEM_PROMPT } = await import('@/lib/ai-estimate');
    expect(ESTIMATE_SYSTEM_PROMPT).toContain('Never cite a code rule number, section or table number in any field');
    expect(ESTIMATE_SYSTEM_PROMPT).toContain('size assumed, not checked against the code');
  });
});
