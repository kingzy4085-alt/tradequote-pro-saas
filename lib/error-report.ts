// What an error screen sends to /api/client-errors, so a customer's failure reaches the logs: the
// error's message and digest and the page it happened on, each cut to size. Never the stack, anything
// typed into the page, the query string or cookies. Runs in the browser; the route checks it again.

export const REPORT_LIMITS = { message: 500, digest: 100, path: 200 } as const;

export interface ErrorReport {
  message: string;
  digest?: string;
  path: string;
}

/** The page without its query or hash. A client portal link's token is a credential, so it is taken out. */
export function reportPath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/';
  return path.replace(/^\/portal\/[^/]*/, '/portal/[token]').slice(0, REPORT_LIMITS.path);
}

export function buildErrorReport(error: unknown, pathname: string): ErrorReport {
  const { message, digest } = (typeof error === 'object' && error !== null ? error : { message: error }) as { message?: unknown; digest?: unknown };
  return {
    message: typeof message === 'string' ? message.slice(0, REPORT_LIMITS.message) : '',
    ...(typeof digest === 'string' && digest ? { digest: digest.slice(0, REPORT_LIMITS.digest) } : {}),
    path: reportPath(pathname),
  };
}

const reported = new WeakSet<object>();

/**
 * Sends one report per error and never waits or throws: the error screen has to show whatever happens
 * here. keepalive lets it finish if the person leaves the page straight away.
 */
export function reportClientError(error: unknown, pathname?: string): void {
  if (typeof error === 'object' && error !== null) {
    if (reported.has(error)) return;
    reported.add(error);
  }
  try {
    const body = JSON.stringify(buildErrorReport(error, pathname ?? (typeof location === 'undefined' ? '/' : location.pathname)));
    fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    // No fetch, or it threw before sending: there is nowhere left to report to
  }
}
