const PLACEHOLDER_ORIGIN = 'https://tradequote.invalid';

/**
 * Only allow same-site relative paths, so `?next=` can't send users to another site.
 * URL parsers strip tabs and newlines and treat backslashes as slashes, so `/\t/evil.com`
 * can become `//evil.com`. Anything with those characters is refused outright, and what
 * remains must still parse to this site.
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\\]/.test(next)) return fallback;
  try {
    if (new URL(next, PLACEHOLDER_ORIGIN).origin !== PLACEHOLDER_ORIGIN) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
