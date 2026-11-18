import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { env } from '@/lib/env';
import { getModule } from '@/lib/modules';
import { hashPortalToken, newPortalToken, portalUrl, shareStatus, type ShareRow } from '@/lib/portal';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const proposals = getModule('proposals')!;
type Params = { params: { id: string } };

const SHARE_COLUMNS = 'created_at, expires_at, revoked_at, first_viewed_at, decided_at, decision, signer_name, decline_reason';

// Where the newest client link for this proposal stands. Never the link itself: only its hash is kept.
export async function GET(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: proposals.read });
  if (ctx instanceof Response) return ctx;
  const { data, error } = await ctx.supabase.from('proposal_shares').select(SHARE_COLUMNS).eq('proposal_id', params.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return dbError(error, 'loading the client link');
  const share = (data as ShareRow | null) ?? null;
  return NextResponse.json({ data: { status: shareStatus(share), share } });
}

// Makes a new link and returns it once. Any earlier link for this proposal stops working.
export async function POST(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;

  const token = newPortalToken();
  const { data: expires, error } = await ctx.supabase.rpc('create_proposal_share', { p_proposal: params.id, p_token_hash: hashPortalToken(token) });
  if (error) return dbError(error, 'creating the client link');
  return NextResponse.json({ data: { url: portalUrl(env.siteUrl(), token), expires_at: expires } }, { status: 201 });
}

// Turns the link off
export async function DELETE(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;
  const { error } = await ctx.supabase.rpc('revoke_proposal_share', { p_proposal: params.id });
  if (error) return dbError(error, 'turning off the client link');
  return NextResponse.json({ ok: true });
}
