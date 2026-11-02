import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/safe-redirect';

// Landing point for email confirmation, invite and password-reset links.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  if (code) {
    const { error } = await createSupabaseServerClient().auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  const login = new URL('/login', url.origin);
  login.searchParams.set('error', 'That link is invalid or has expired. Sign in, or request a new link.');
  return NextResponse.redirect(login);
}
