import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeNext } from '@/lib/safe-redirect';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const OTP_TYPES = new Set<string>(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']);

// These people arrive with a session but need to choose a password before anything else
const NEEDS_PASSWORD = new Set<string>(['invite', 'recovery']);

/** Where to go after a valid link. Keeps `next` as the stop after the password page. */
function destination(type: string | null, next: string): string {
  if (!type || !NEEDS_PASSWORD.has(type) || next.startsWith('/update-password')) return next;
  const after = next === '/' && type === 'invite' ? '/onboarding' : next;
  return after === '/' ? '/update-password' : `/update-password?next=${encodeURIComponent(after)}`;
}

/**
 * Landing point for email confirmation, invite and password-reset links.
 * `token_hash` + `type` is what the email templates in the README send, and works
 * on any device. `code` is the PKCE flow, which only works in the browser that asked.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = safeNext(url.searchParams.get('next'));

  let verified = false;
  if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await createSupabaseServerClient().auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    verified = !error;
  } else if (code) {
    const { error } = await createSupabaseServerClient().auth.exchangeCodeForSession(code);
    verified = !error;
  }
  if (verified) return NextResponse.redirect(new URL(destination(type, next), url.origin));

  const login = new URL('/login', url.origin);
  login.searchParams.set('error', 'That link is invalid or has expired. Sign in, or request a new link.');
  return NextResponse.redirect(login);
}
