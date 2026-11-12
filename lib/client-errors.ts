import { z } from 'zod';
import type { AppContext } from '@/lib/context';
import { REPORT_LIMITS } from '@/lib/error-report';

// The server side of the error reports error screens send (lib/error-report.ts, app/api/client-errors).

/** A whole report fits in well under this, even with every character escaped. */
export const MAX_REPORT_BYTES = 8_192;

/** Exactly what the browser sends. Anything else, a stack included, is refused. */
export const ClientErrorReport = z.strictObject({
  message: z.string().max(REPORT_LIMITS.message),
  digest: z.string().min(1).max(REPORT_LIMITS.digest).optional(),
  path: z.string().min(1).max(REPORT_LIMITS.path).startsWith('/'),
});
export type ClientErrorReport = z.infer<typeof ClientErrorReport>;

// A simple cap per person, held in this server's memory: no table, so nothing to migrate. Each server
// instance counts on its own, which is fine for keeping one person's error loop out of the logs.
export const REPORTS_PER_WINDOW = 10;
export const REPORT_WINDOW_MS = 10 * 60_000;
/** Bounds the memory the cap can use. Past it, the oldest windows are forgotten first. */
export const MAX_TRACKED_REPORTERS = 5_000;

const windows = new Map<string, { start: number; count: number }>();

/** Counts one report for this person. False once they are over the cap for the current window. */
export function takeReportAllowance(userId: string, now = Date.now()): boolean {
  const current = windows.get(userId);
  if (current && now - current.start < REPORT_WINDOW_MS) {
    if (current.count >= REPORTS_PER_WINDOW) return false;
    current.count += 1;
    return true;
  }
  windows.delete(userId);
  if (windows.size >= MAX_TRACKED_REPORTERS) forgetOld(now);
  windows.set(userId, { start: now, count: 1 });
  return true;
}

function forgetOld(now: number) {
  for (const [id, window] of windows) if (now - window.start >= REPORT_WINDOW_MS) windows.delete(id);
  // Map keeps insertion order and a window is re-inserted when it starts, so the first is the oldest
  for (const id of windows.keys()) {
    if (windows.size < MAX_TRACKED_REPORTERS) break;
    windows.delete(id);
  }
}

/** For tests. */
export function trackedReporters(): number {
  return windows.size;
}

/** For tests. */
export function resetReportAllowances(): void {
  windows.clear();
}

/** One line of JSON, so a message with line breaks in it still logs as a single line. */
export function clientErrorLogLine(ctx: Pick<AppContext, 'company' | 'user' | 'role'>, report: ClientErrorReport): string {
  return JSON.stringify({
    event: 'client_error',
    company_id: ctx.company.id,
    user_id: ctx.user.id,
    role: ctx.role,
    path: report.path,
    digest: report.digest ?? null,
    message: report.message,
  });
}
