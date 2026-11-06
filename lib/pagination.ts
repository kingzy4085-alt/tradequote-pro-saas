export const PAGE_SIZE = 50;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 200;
const MAX_OFFSET = 1_000_000;
/** How many projects or clients a picker lists. A record linked past this still shows its link. */
export const LINK_OPTION_LIMIT = 1000;

/** Reads `limit` and `offset` from a list request, clamped to safe values. */
export function parsePage(params: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(Number(params.get('limit'))) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.min(Math.max(Math.trunc(Number(params.get('offset'))) || 0, 0), MAX_OFFSET);
  return { limit, offset };
}

/** Adds a later page. A record created meanwhile shifts rows down, so drop any seen twice. */
export function mergePages<T extends { id: string }>(loaded: T[], page: T[]): T[] {
  const seen = new Set(loaded.map((r) => r.id));
  return [...loaded, ...page.filter((r) => !seen.has(r.id))];
}
