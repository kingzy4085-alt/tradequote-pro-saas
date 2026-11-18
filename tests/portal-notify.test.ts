// The email a contractor gets when a client answers a shared proposal: its wording, that what a
// client typed cannot break out of it, and that sending it can never fail the client's answer.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => null }));

import { notifyContractorOfAnswer, renderPortalNotice, type PortalNotice } from '@/lib/portal-notify';

const notice = (over: Partial<PortalNotice> = {}): PortalNotice => ({
  to: 'owner@alpha.ca', company: 'Alpha Electric', proposal_id: '7b0e7a52-6c5e-4d0e-9a55-0f6f3d2b9d11', title: 'Panel upgrade',
  client_name: 'Cargill', total_amount: 12500, decision: 'accepted', signer_name: 'Dana Smith', decline_reason: null, ...over,
});
const links = { siteUrl: 'https://app.example.ca/', unsubscribeUrl: 'https://app.example.ca/api/email/unsubscribe?e=x&t=y', sender: { business: 'TradeQuote', address: '1 Main St, Regina SK' } };

describe('the words', () => {
  it('say who accepted, what and for how much, and link to the proposal', () => {
    const email = renderPortalNotice(notice(), links);
    expect(email.subject).toBe('Proposal accepted: Panel upgrade');
    expect(email.text).toContain('Dana Smith accepted and signed the proposal "Panel upgrade" at $12,500.00.');
    expect(email.text).toContain('https://app.example.ca/proposals/7b0e7a52-6c5e-4d0e-9a55-0f6f3d2b9d11');
    expect(email.html).toContain('href="https://app.example.ca/proposals/7b0e7a52-6c5e-4d0e-9a55-0f6f3d2b9d11"');
  });

  it('carry the sender and a way to stop these emails, as every email from the app does', () => {
    const email = renderPortalNotice(notice(), links);
    for (const part of [email.text, email.html]) {
      expect(part).toContain('TradeQuote · 1 Main St, Regina SK');
      expect(part).toContain('unsubscribe?e=x&');
    }
  });

  it('say who declined and why, naming the client when nobody signed', () => {
    const email = renderPortalNotice(notice({ decision: 'declined', signer_name: null, decline_reason: 'Went with\nanother bid' }), links);
    expect(email.subject).toBe('Proposal declined: Panel upgrade');
    expect(email.text).toContain('Cargill declined the proposal "Panel upgrade".');
    expect(email.text).toContain('Their reason: Went with another bid');
    expect(renderPortalNotice(notice({ decision: 'declined', signer_name: null, client_name: ' ' }), links).text).toContain('Your client declined');
  });

  it('leave the price out when the proposal has none', () => {
    expect(renderPortalNotice(notice({ total_amount: null }), links).text).toContain('the proposal "Panel upgrade".');
  });

  it('cannot be given a second header line or markup by what a client typed', () => {
    const email = renderPortalNotice(notice({ title: 'Job\r\nBcc: evil@x.ca', signer_name: '<script>alert(1)</script>', decision: 'declined', decline_reason: '<img src=x onerror=alert(1)>' }), links);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).not.toMatch(/<script|<img/);
    expect(email.html).toContain('&lt;script&gt;');
    expect(renderPortalNotice(notice({ title: 'x'.repeat(500) }), links).subject.length).toBeLessThanOrEqual(200);
  });
});

describe('sending it', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const SETTINGS = { RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'TradeQuote <no-reply@example.ca>', BUSINESS_NAME: 'TradeQuote', BUSINESS_MAILING_ADDRESS: '1 Main St, Regina SK', UNSUBSCRIBE_SECRET: 'u'.repeat(40), NEXT_PUBLIC_SITE_URL: 'https://app.example.ca' };
  const configure = (over: Record<string, string> = {}) => {
    for (const [key, value] of Object.entries({ ...SETTINGS, ...over })) vi.stubEnv(key, value);
  };

  it('is skipped, without an error, when email is not set up or there is nobody to tell', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    configure({ RESEND_API_KEY: '' });
    expect(await notifyContractorOfAnswer(notice())).toBe('skipped');
    configure();
    expect(await notifyContractorOfAnswer(notice({ to: null }))).toBe('skipped');
    expect(await notifyContractorOfAnswer(notice({ to: '  ' }))).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('goes to the contractor, with a one-click unsubscribe header', async () => {
    configure();
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response('{"id":"1"}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await notifyContractorOfAnswer(notice({ to: ' Owner@Alpha.ca ' }))).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = String(fetchMock.mock.calls[0][1]?.body);
    expect(sent).toContain('owner@alpha.ca');
    expect(sent).toContain('Proposal accepted: Panel upgrade');
    expect(sent).toContain('List-Unsubscribe');
    expect(sent).toContain('s=alerts');
  });

  it('reports a mail server that refuses or cannot be reached, and never throws', async () => {
    configure();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"bad key"}', { status: 401 })));
    expect(await notifyContractorOfAnswer(notice())).toBe('failed');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    expect(await notifyContractorOfAnswer(notice())).toBe('failed');
  });
});
