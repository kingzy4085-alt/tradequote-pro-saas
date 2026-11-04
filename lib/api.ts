import { NextResponse } from 'next/server';
import { getContext, type AppContext } from '@/lib/context';
import { hasRank } from '@/lib/roles';

export function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

/**
 * Returns the caller's context, or the error Response to send back.
 * `minRank` is the lowest role rank allowed; `write` also requires an active subscription or trial.
 */
export async function requireApi(opts: { minRank: number; write?: boolean }): Promise<AppContext | Response> {
  let result;
  try {
    result = await getContext();
  } catch (err) {
    console.error('Context resolution failed', err);
    return jsonError(500, 'Server is not configured correctly');
  }
  if (result.status === 'signed-out') return jsonError(401, 'Sign in required');
  if (result.status === 'error') return jsonError(503, 'We could not reach the server just now. Try again in a moment.');
  if (result.status === 'no-company') return jsonError(403, 'Finish setting up your company first');
  const { ctx } = result;
  if (!hasRank(ctx.role, opts.minRank)) return jsonError(403, 'Your role does not have access to this');
  if (opts.write && !ctx.canWrite) return jsonError(402, 'Your trial or subscription has ended. Update billing to keep editing.');
  return ctx;
}

/** Turns a Supabase/PostgREST error into a safe client response without leaking internals. */
export function dbError(error: { code?: string; message: string }, action: string) {
  console.error(`Database error while ${action}:`, error);
  if (error.code === '42501') return jsonError(403, 'You do not have permission to do that');
  if (error.code === '23505') return jsonError(409, 'That record already exists');
  // Rules the database enforces itself (e.g. a signed daily log) raise P0001 with a message meant for the user
  if (error.code === 'P0001') return jsonError(409, error.message);
  if (error.code === 'P0002') return jsonError(404, 'Not found');
  if (error.code === '22023') return jsonError(400, error.message);
  if (['23502', '23514', '22P02', '22007', '22008', '22003'].includes(error.code ?? '')) {
    return jsonError(400, 'Some values were not valid');
  }
  return jsonError(500, `Could not complete ${action}`);
}

export async function readJson(request: Request, maxBytes = 200_000): Promise<unknown> {
  // Refuse honest oversized requests before buffering them, then check the real size
  if (Number(request.headers.get('content-length')) > maxBytes) throw new RangeError('Request body too large');
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) throw new RangeError('Request body too large');
  return text ? JSON.parse(text) : {};
}
