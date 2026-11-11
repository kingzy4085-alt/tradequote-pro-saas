import { NextResponse } from 'next/server';
import { jsonError, readJson } from '@/lib/api';
import { PortalDecision, isPortalToken } from '@/lib/portal';
import { answerPortal, portalIp } from '@/lib/portal-server';

export const dynamic = 'force-dynamic';

type Params = { params: { token: string } };

// Public: no session. The client's answer to a shared proposal. The link's token is the only
// credential; lib/portal-server.ts rate-limits it, and the database decides everything else
// (the link exists, is open and unanswered, and the proposal is still Sent).
export async function POST(request: Request, { params }: Params) {
  if (!isPortalToken(params.token)) return jsonError(404, 'This link is not valid.');

  let body: unknown;
  try {
    // A drawn signature is the bulk of it: see MAX_SIGNATURE_LENGTH
    body = await readJson(request, 320_000);
  } catch (err) {
    return jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'That signature is too large. Clear it and sign again.' : 'Invalid request');
  }
  const parsed = PortalDecision.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? 'Invalid request');

  const result = await answerPortal(params.token, parsed.data, portalIp(request.headers), request.headers.get('user-agent'));
  if (!result.ok) return jsonError(result.status, result.error);
  return NextResponse.json({ ok: true, decision: parsed.data.decision });
}
