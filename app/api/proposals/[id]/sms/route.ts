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

// International format, e.g. +13065550123
const Body = z.object({ phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/) });

// Texts the client a fresh portal link. Only the link's hash is stored, so a new link is made for each send
// and any earlier link for this proposal stops working (same as POST /api/proposals/[id]/share).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'Not found');

  let raw: unknown;
  try {
    raw = await readJson(request);
  } catch (err) {
    if (err instanceof RangeError) return jsonError(413, 'That request is too large');
    return jsonError(400, 'Send a valid JSON body');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError(400, 'Enter the phone number with the country code, like +13065550123');

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
