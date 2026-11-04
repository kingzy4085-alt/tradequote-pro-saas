import { timingSafeEqual } from 'node:crypto';
import { env } from './env';

/**
 * True when a scheduled job's request carries CRON_SECRET, which Vercel sends as a bearer token.
 * Throws if CRON_SECRET isn't set, so a route can answer 500 "not configured" rather than 401.
 */
export function authorizedCron(request: Request): boolean {
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.cronSecret()}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
