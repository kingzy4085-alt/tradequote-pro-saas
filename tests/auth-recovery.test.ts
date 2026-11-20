// Password-recovery links, end to end through the real @supabase/ssr + auth-js clients.
// Supabase Auth is a small fake (single-use tokens, PKCE S256 check) behind a stubbed fetch,
// and `cookies()` is one browser's cookie jar, so these show which browser a link works in.
import { createHash, randomUUID } from 'node:crypto';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Jar = Map<string, string>;
const browser = vi.hoisted(() => ({ jar: new Map<string, string>() as Map<string, string> }));

vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [...browser.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => (value ? browser.jar.set(name, value) : browser.jar.delete(name)),
  }),
}));

import { GET, POST } from '@/app/(auth)/auth/callback/route';
import ConfirmPage from '@/app/(auth)/auth/confirm/page';

const PROJECT = 'https://abcd.supabase.test';
const APP = 'https://app.test';
const USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'person@example.test', aud: 'authenticated', role: 'authenticated' };

/** Supabase Auth, reduced to what recovery needs. Every token and code works once. */
function fakeAuth() {
  const state = { challenge: '', codes: new Set<string>(), hashes: new Set<string>(), verifyCalls: 0 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const session = () => ({ access_token: `at-${randomUUID()}`, refresh_token: `rt-${randomUUID()}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
  const expired = () => json({ code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' }, 403);

  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/auth/v1/recover') {
      state.challenge = body.code_challenge ?? '';
      return json({});
    }
    if (url.pathname === '/auth/v1/verify') {
      state.verifyCalls++;
      if (!state.hashes.delete(body.token_hash)) return expired();
      return json(session());
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      const s256 = createHash('sha256').update(String(body.code_verifier ?? '')).digest('base64url');
      if (!body.code_verifier || s256 !== state.challenge || !state.codes.delete(body.auth_code)) return expired();
      return json(session());
    }
    return json({ msg: 'not found' }, 404);
  });

  return {
    state,
    /** What the email link carries: a one-time token hash, and a one-time PKCE code for the default template. */
    issue() {
      const hash = `pkce_${randomUUID()}`;
      const code = randomUUID();
      state.hashes.add(hash);
      state.codes.add(code);
      return { hash, code };
    },
  };
}

/** A browser's own Supabase client, writing to that browser's cookie jar. */
function browserClient(jar: Jar) {
  return createServerClient(PROJECT, 'anon', {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value } of cookies) (value ? jar.set(name, value) : jar.delete(name));
      },
    },
  });
}

/** Opens a URL in the browser whose cookies are `jar`. */
function open(path: string, jar: Jar) {
  browser.jar = jar;
  return GET(new Request(`${APP}${path}`));
}

/** Submits the confirm page's form from the browser whose cookies are `jar`. */
function submit(fields: Record<string, string>, jar: Jar, origin: string | null = APP) {
  browser.jar = jar;
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (origin) headers.origin = origin;
  return POST(new Request(`${APP}/auth/callback`, { method: 'POST', headers, body: new URLSearchParams(fields).toString() }));
}

const where = (r: Response) => r.headers.get('location') ?? '';
const signedIn = (jar: Jar) => [...jar.keys()].some((k) => /^sb-abcd-auth-token(\.\d+)?$/.test(k));
const TEMPLATE_LINK = (hash: string) => `/auth/callback?token_hash=${hash}&type=recovery`;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROJECT);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('password recovery with the default {{ .ConfirmationURL }} template (PKCE code)', () => {
  async function requestReset(jar: Jar) {
    const { error } = await browserClient(jar).auth.resetPasswordForEmail(USER.email, { redirectTo: `${APP}/auth/callback?next=/update-password` });
    expect(error).toBeNull();
  }

  it('works only in the browser that asked, because the code verifier is a cookie there', async () => {
    const auth = fakeAuth();
    const asked: Jar = new Map();
    await requestReset(asked);
    expect([...asked.keys()].some((k) => k.endsWith('-code-verifier'))).toBe(true);

    const { code } = auth.issue();
    const res = await open(`/auth/callback?next=/update-password&code=${code}`, asked);
    expect(where(res)).toBe(`${APP}/update-password`);
    expect(signedIn(asked)).toBe(true);
  });

  it('fails on another browser or device (email app, phone) — the reported symptom', async () => {
    const auth = fakeAuth();
    await requestReset(new Map());
    const { code } = auth.issue();

    const other: Jar = new Map();
    const res = await open(`/auth/callback?next=/update-password&code=${code}`, other);
    expect(where(res)).toMatch(/^https:\/\/app\.test\/login\?error=/);
    expect(signedIn(other)).toBe(false);
    // The message says what to do, and never echoes Supabase's error or the code
    const message = new URL(where(res)).searchParams.get('error') ?? '';
    expect(message).toMatch(/same browser/i);
    expect(message).not.toContain(code);
    expect(message).not.toMatch(/verifier|pkce|otp/i);
  });

  it('fails once a link scanner has opened Supabase\'s link first (otp_expired comes back as an error)', async () => {
    fakeAuth();
    const res = await open('/auth/callback?next=/update-password&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', new Map());
    expect(where(res)).toMatch(/\/login\?error=/);
    expect(where(res)).not.toMatch(/otp_expired|access_denied/);
  });
});

describe('password recovery with the README token_hash template', () => {
  it('a link scanner opening the link first no longer uses it up', async () => {
    const auth = fakeAuth();
    const { hash } = auth.issue();

    // Mail security scanners (e.g. Microsoft Safe Links) GET every link before the person does
    const scanned = await open(TEMPLATE_LINK(hash), new Map());
    expect(scanned.status).toBe(303);
    expect(auth.state.verifyCalls).toBe(0);

    // The person then opens it on a different device from the one that asked: still works
    const phone: Jar = new Map();
    const landed = await open(TEMPLATE_LINK(hash), phone);
    const confirm = new URL(where(landed));
    expect(confirm.pathname).toBe('/auth/confirm');
    expect(confirm.searchParams.get('token_hash')).toBe(hash);
    expect(confirm.searchParams.get('type')).toBe('recovery');
    expect(signedIn(phone)).toBe(false);

    const res = await submit({ token_hash: hash, type: 'recovery', next: '' }, phone);
    expect(res.status).toBe(303);
    expect(where(res)).toBe(`${APP}/update-password`);
    expect(signedIn(phone)).toBe(true);
    expect(auth.state.verifyCalls).toBe(1);
  });

  it('still works only once', async () => {
    const auth = fakeAuth();
    const { hash } = auth.issue();
    expect(where(await submit({ token_hash: hash, type: 'recovery' }, new Map()))).toBe(`${APP}/update-password`);
    const again = await submit({ token_hash: hash, type: 'recovery' }, new Map());
    expect(again.status).toBe(303);
    expect(where(again)).toMatch(/^https:\/\/app\.test\/login\?error=/);
  });

  it('keeps next as the stop after the password page, and never off-site', async () => {
    const auth = fakeAuth();
    expect(where(await submit({ token_hash: auth.issue().hash, type: 'recovery', next: '/onboarding' }, new Map()))).toBe(`${APP}/update-password?next=%2Fonboarding`);
    expect(where(await submit({ token_hash: auth.issue().hash, type: 'recovery', next: '//evil.com' }, new Map()))).toBe(`${APP}/update-password`);
    const deferred = new URL(where(await open('/auth/callback?token_hash=abc&type=recovery&next=//evil.com', new Map())));
    expect(deferred.origin).toBe(APP);
    expect(deferred.searchParams.has('next')).toBe(false);
  });

  it('refuses a form posted from another site', async () => {
    const auth = fakeAuth();
    const { hash } = auth.issue();
    const res = await submit({ token_hash: hash, type: 'recovery' }, new Map(), 'https://evil.example');
    expect(where(res)).toMatch(/\/login\?error=/);
    expect(auth.state.verifyCalls).toBe(0);
  });

  it('refuses a post with no token or an unknown type', async () => {
    const auth = fakeAuth();
    expect(where(await submit({ type: 'recovery' }, new Map()))).toMatch(/\/login\?error=/);
    expect(where(await submit({ token_hash: 'abc', type: 'admin' }, new Map()))).toMatch(/\/login\?error=/);
    expect(auth.state.verifyCalls).toBe(0);
  });

  it('the confirm page posts the link back without exposing it elsewhere', () => {
    const html = renderToStaticMarkup(createElement(ConfirmPage, { searchParams: { token_hash: 'pkce_abc', type: 'recovery', next: '/onboarding' } }));
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/auth/callback"');
    expect(html).toContain('value="pkce_abc"');
    expect(html).toContain('value="/onboarding"');
    const broken = renderToStaticMarkup(createElement(ConfirmPage, { searchParams: { type: 'recovery' } }));
    expect(broken).not.toContain('<form');
    expect(broken).toContain('/reset-password');
  });
});

describe('other email links are unchanged', () => {
  it('signup, invite and magic links still verify straight from the link', async () => {
    for (const [type, next, expected] of [
      ['email', '/onboarding', `${APP}/onboarding`],
      ['invite', '/onboarding', `${APP}/update-password?next=%2Fonboarding`],
      ['magiclink', '', `${APP}/`],
    ]) {
      const auth = fakeAuth();
      const jar: Jar = new Map();
      const res = await open(`/auth/callback?token_hash=${auth.issue().hash}&type=${type}${next ? `&next=${next}` : ''}`, jar);
      expect(where(res)).toBe(expected);
      expect(signedIn(jar)).toBe(true);
    }
  });
});
