// The only place the client portal reaches the database. A visitor has no session and the
// database runs nothing for the public key, so these two calls use the service role. They
// can do exactly two things: read one shared proposal and record one answer to it, both by
// the hash of the link's token. Keep it that way: nothing else belongs in this file.
import { hashPortalToken, type PortalDecision, type PortalView } from './portal';
import { checkRateLimit, hashForLimit } from './rate-limit';
import { createSupabaseAdminClient } from './supabase/server';

const HOUR = 3_600;

/** The visitor's address as the hosting proxy reports it, or 'unknown'. */
export function portalIp(headers: { get(name: string): string | null }): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * A limit per address. With no proxy reporting addresses every visitor would share one
 * allowance, so that case gets a single, much larger one: it still caps a flood without
 * locking real clients out.
 */
function addressLimit(bucket: string, ip: string, perAddress: number, shared: number): [key: string, limit: number] {
  return ip === 'unknown' ? [`portal:${bucket}:unknown`, shared] : [`portal:${bucket}:${hashForLimit(ip)}`, perAddress];
}

export type PortalLoad = { status: 'ok'; view: PortalView | null } | { status: 'limited' } | { status: 'error' };

/** What the link shows right now. `view` is null for a link that does not exist. */
export async function loadPortal(token: string, ip: string): Promise<PortalLoad> {
  const admin = createSupabaseAdminClient();
  // Slows anyone trying links at random; a real client opens theirs a handful of times
  const [key, limit] = addressLimit('view', ip, 120, 3_000);
  if (!(await checkRateLimit(admin, key, limit, HOUR))) return { status: 'limited' };
  const { data, error } = await admin.rpc('portal_view', { p_token_hash: hashPortalToken(token) });
  if (error) {
    console.error('Portal view failed', error);
    return { status: 'error' };
  }
  return { status: 'ok', view: (data as PortalView | null) ?? null };
}

export type PortalAnswer = { ok: true } | { ok: false; status: number; error: string };

// Refusals the database worded for the client to read. Anything else is logged and kept vague.
const CLIENT_CODES: Record<string, number> = { P0001: 409, P0002: 404, '22023': 400 };

/** Records the client's answer. The database decides whether the link is still open and unanswered. */
export async function answerPortal(token: string, decision: PortalDecision, ip: string, agent: string | null): Promise<PortalAnswer> {
  const admin = createSupabaseAdminClient();
  const tokenHash = hashPortalToken(token);
  // Per address, then per link. Counted in their own transactions, so a refused answer still counts.
  const [key, limit] = addressLimit('answer', ip, 30, 600);
  const allowed = (await checkRateLimit(admin, key, limit, HOUR)) && (await checkRateLimit(admin, `portal:link:${tokenHash.slice(0, 32)}`, 10, HOUR));
  if (!allowed) return { ok: false, status: 429, error: 'Too many attempts. Try again in an hour.' };

  const { error } = await admin.rpc('portal_decide', {
    p_token_hash: tokenHash,
    p_decision: decision.decision,
    p_name: decision.name ?? null,
    p_signature: decision.decision === 'accepted' ? decision.signature : null,
    p_reason: decision.decision === 'declined' ? decision.reason ?? null : null,
    p_ip: ip.slice(0, 100),
    p_agent: agent?.slice(0, 500) ?? null,
  });
  if (error) {
    const status = CLIENT_CODES[error.code ?? ''];
    if (status) return { ok: false, status, error: error.message };
    console.error('Portal decision failed', error);
    return { ok: false, status: 500, error: 'Your answer could not be saved. Try again, or contact the company.' };
  }
  return { ok: true };
}
