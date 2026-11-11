import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Postgres-backed limits (see 20261104000050_hardening.sql). If the check itself
 * fails, the request goes through and the failure is logged: a limiter outage
 * should not stop a contractor signing up, and the database would be the next
 * thing to fail anyway.
 */

/** Server only, with the service-role client. Returns false when over the limit. */
export async function checkRateLimit(admin: SupabaseClient, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc('check_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    console.error('Rate limit check failed', error);
    return true;
  }
  return data !== false;
}

/** The signed-in user's own allowance, with limits set in the database. */
export async function consumeUserRateLimit(supabase: SupabaseClient, bucket: 'invite' | 'onboarding'): Promise<boolean> {
  const { data, error } = await supabase.rpc('consume_user_rate_limit', { p_bucket: bucket });
  if (error) {
    console.error('Rate limit check failed', error);
    return true;
  }
  return data !== false;
}

/** Hashed so limiter rows hold no addresses. */
export function hashForLimit(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/** The caller's address as reported by the hosting proxy. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}
