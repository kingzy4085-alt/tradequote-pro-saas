import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeNext } from '@/lib/safe-redirect';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const OTP_TYPES = new Set<string>(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']);

// These people arrive with a session but need to choose a password before anything else
const NEEDS_PASSWORD = new Set<string>(['invite', 'recovery']);

const INVALID_LINK = 'That link is invalid or has expired. Sign in, or request a new link.';
const OTHER_BROWSER = 'That link has expired, was already used, or was opened in a different browser from the one that asked for it. Request a new link and open it in the same browser, or sign in.';

/** Where to go after a valid link. Keeps `next` as the stop after the password page. */
function destination(type: string | null, next: string): string {
  if (!type || !NEEDS_PASSWORD.has(type) || next.startsWith('/update-password')) return next;
  const after = next === '/' && type === 'invite' ? '/onboarding' : next;
  return after === '/' ? '/update-password' : `/update-password?next=${encodeURIComponent(after)}`;
}

/** 303 so a form POST is followed with a GET. Supabase's own error text is never passed on. */
function toLogin(origin: string, message = INVALID_LINK): NextResponse {
  const login = new URL('/login', origin);
  login.searchParams.set('error', message);
  return NextResponse.redirect(login, { status: 303 });
}

async function verifyTokenHash(tokenHash: string, type: string): Promise<boolean> {
  const { error } = await createSupabaseServerClient().auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
  return !error;
}

/**
 * Landing point for email confirmation, invite and password-reset links.
 * `token_hash` + `type` is what the email templates in the README send, and works
 * on any device. `code` is the PKCE flow, which only works in the browser that asked,
 * because its code verifier is a cookie there.
 *
 * Password-reset links are not used up here: mail security scanners open every link
 * before the person does, and a GET that verified would spend the one-time token on the
 * scanner. They go to /auth/confirm, where the person presses a button that POSTs back.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const rawNext = url.searchParams.get('next');
  const next = safeNext(rawNext);

  if (tokenHash && type && OTP_TYPES.has(type)) {
    if (type === 'recovery') {
      const confirm = new URL('/auth/confirm', url.origin);
      confirm.searchParams.set('token_hash', tokenHash);
      confirm.searchParams.set('type', type);
      if (rawNext && next === rawNext) confirm.searchParams.set('next', next);
      return NextResponse.redirect(confirm, { status: 303 });
    }
    if (await verifyTokenHash(tokenHash, type)) return NextResponse.redirect(new URL(destination(type, next), url.origin));
    return toLogin(url.origin);
  }
  if (code) {
    const { error } = await createSupabaseServerClient().auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destination(type, next), url.origin));
    return toLogin(url.origin, OTHER_BROWSER);
  }
  return toLogin(url.origin);
}

/** The /auth/confirm button. Verifies the one-time token and signs this browser in. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  // Forms only come from our own pages; a cross-site post could sign someone into another account
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return toLogin(url.origin);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return toLogin(url.origin);
  }
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' && value ? value : null;
  };
  const tokenHash = field('token_hash');
  const type = field('type');
  const next = safeNext(field('next'));

  if (!tokenHash || !type || !OTP_TYPES.has(type)) return toLogin(url.origin);
  if (!(await verifyTokenHash(tokenHash, type))) return toLogin(url.origin);
  return NextResponse.redirect(new URL(destination(type, next), url.origin), { status: 303 });
}
