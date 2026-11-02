import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/**
 * Supabase client acting as the signed-in user (anon key + their session cookie).
 * Every query runs under row level security, so it can only reach that user's company.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Server components can't set cookies; middleware refreshes the session instead.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {}
      },
    },
  });
}

/**
 * Service-role client that BYPASSES row level security. Only for the Stripe webhook,
 * billing customer records and sending invites — never with user-supplied filters.
 */
export function createSupabaseAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
