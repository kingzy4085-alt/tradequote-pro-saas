/**
 * True when Supabase Auth could not answer (network failure or a 5xx), as opposed
 * to a missing or rejected session. Kept free of imports so middleware can use it.
 */
export function isTransientAuthError(error: { name?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  return error.name === 'AuthRetryableFetchError' || (typeof error.status === 'number' && error.status >= 500);
}
