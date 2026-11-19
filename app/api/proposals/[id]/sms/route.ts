import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { env } from '@/lib/env';
import { getModule } from '@/lib/modules';
import { sendSMSNotification } from '@/lib/notifications/sms';
import { hashPortalToken, newPortalToken, portalUrl } from '@/lib/portal';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const proposals = getModule('proposals')!;
type Params = { params: { id: string } };

// International format only (+ and 8 to 15 digits), so a typo can't text the wrong kind of number
const bodySchema = z.object({ phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Enter the number with country code, like +14035550123') });

/**
 * Texts the client a link to the proposal portal. The portal only opens with a share token (only its
 * hash is stored), so this makes a fresh link the same way the Share button does. That replaces any
 * earlier link for this proposal.
 */
export async function POST(request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;

  let raw: unknown;
  try {
    raw = await readJson(request, 10_000);
  } catch (err) {
    if (err instanceof RangeError) return jsonError(413, 'That request is too large');
    return jsonError(400, 'Send a valid phone number');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? 'Send a valid phone number');

  const token = newPortalToken();
  const { error } = await ctx.supabase.rpc('create_proposal_share', { p_proposal: params.id, p_token_hash: hashPortalToken(token) });
  if (error) return dbError(error, 'creating the client link');

  const result = await sendSMSNotification({
    to: parsed.data.phone,
    message: `You have a new project proposal ready for review: ${portalUrl(env.siteUrl(), token)}`,
  });
  if (!result.success) return jsonError(502, 'We could not send the text message. Check the number and try again.');

  return NextResponse.json({ success: true });
}
