import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { env } from '@/lib/env';
import { getModule } from '@/lib/modules';
import { hashPortalToken, newPortalToken, portalUrl } from '@/lib/portal';
import { sendSMSNotification } from '@/lib/notifications/sms';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const proposals = getModule('proposals')!;
type Params = { params: Promise<{ id: string }> | { id: string } };

const Body = z.object({ phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use the full number with country code, like +13065550123') });

/**
 * Texts the client their portal link. The link is a one-time token (only its hash is stored), so this makes a
 * fresh one the same way POST /api/proposals/[id]/share does; any earlier link for the proposal stops working.
 */
export async function POST(request: Request, context: Params) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 10_000);
  } catch {
    return jsonError(400, 'Send the phone number as JSON');
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? 'Enter a valid phone number');

  const token = newPortalToken();
  const { error } = await ctx.supabase.rpc('create_proposal_share', { p_proposal: id, p_token_hash: hashPortalToken(token) });
  if (error) return dbError(error, 'creating the client link');

  const result = await sendSMSNotification({
    to: parsed.data.phone,
    message: `You have a new project proposal ready for review: ${portalUrl(env.siteUrl(), token)}`,
  });
  if (!result.success) return jsonError(502, 'We could not send the text message. Check the number and try again.');

  return NextResponse.json({ success: true });
}
