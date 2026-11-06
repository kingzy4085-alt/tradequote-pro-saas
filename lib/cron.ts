import { timingSafeEqual } from 'node:crypto';
import { jsonError } from '@/lib/api';
import { env } from '@/lib/env';

/** True when the request carries the cron secret Vercel sends. Throws if CRON_SECRET isn't set. */
export function authorizedCron(request: Request): boolean {
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.cronSecret()}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** For the top of a cron route: returns the error to send back, or null when the caller may run the job. */
export function requireCron(request: Request): Response | null {
  try {
    return authorizedCron(request) ? null : jsonError(401, 'Unauthorized');
  } catch (err) {
    console.error('Cron job is not configured', err);
    return jsonError(500, 'Server is not configured correctly');
  }
}
