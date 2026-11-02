import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, readJson, requireApi } from '@/lib/api';
import { env } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ADMIN = 4;
const INVITABLE = ['admin', 'project_manager', 'foreman', 'electrician'] as const;

const InviteBody = z.object({ email: z.string().trim().toLowerCase().email().max(320), role: z.enum(INVITABLE) });
const RoleBody = z.object({ userId: z.string().uuid(), role: z.enum(INVITABLE) });
const RemoveBody = z.object({ userId: z.string().uuid().optional(), invitationId: z.string().uuid().optional() });

async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  try {
    const parsed = schema.safeParse(await readJson(request, 5_000));
    return parsed.success ? parsed.data : jsonError(400, parsed.error.issues[0]?.message ?? 'Invalid request');
  } catch {
    return jsonError(400, 'Invalid request');
  }
}

/** Invite someone by email. The invitation row is written as the caller, so RLS enforces admin rights. */
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: ADMIN, write: true });
  if (ctx instanceof Response) return ctx;
  const input = await body(request, InviteBody);
  if (input instanceof Response) return input;
  if (input.role === 'admin' && ctx.role !== 'owner') return jsonError(403, 'Only the owner can invite admins');

  const { data: existing } = await ctx.supabase.from('company_users').select('user_id').eq('email', input.email).maybeSingle();
  if (existing) return jsonError(409, 'That person is already on your team');

  const { error } = await ctx.supabase.from('invitations').insert({ company_id: ctx.company.id, email: input.email, role: input.role, invited_by: ctx.user.id });
  if (error) {
    console.error('Invitation insert failed', error);
    return jsonError(error.code === '42501' ? 403 : 500, 'Could not create the invitation');
  }

  // Sends Supabase's invite email. Someone who already has an account just signs in and sees the invitation.
  const { error: mailError } = await createSupabaseAdminClient().auth.admin.inviteUserByEmail(input.email, {
    redirectTo: `${env.siteUrl()}/auth/callback?next=/onboarding`,
  });
  const alreadyRegistered = mailError && /already|registered|exists/i.test(mailError.message);
  if (mailError && !alreadyRegistered) {
    console.error('Invite email failed', mailError);
    return NextResponse.json({ ok: true, warning: 'Invitation saved, but the email could not be sent. Ask them to sign up with this email address.' });
  }
  return NextResponse.json({
    ok: true,
    message: alreadyRegistered ? 'They already have an account — the invitation appears when they sign in.' : `Invitation sent to ${input.email}.`,
  });
}

/** Change a member's role (owner/admin only; enforced again inside set_member_role). */
export async function PATCH(request: Request) {
  const ctx = await requireApi({ minRank: ADMIN, write: true });
  if (ctx instanceof Response) return ctx;
  const input = await body(request, RoleBody);
  if (input instanceof Response) return input;
  const { error } = await ctx.supabase.rpc('set_member_role', { p_user: input.userId, p_role: input.role });
  if (error) return jsonError(error.code === 'P0002' ? 404 : 403, error.message);
  return NextResponse.json({ ok: true });
}

/** Remove a member, or revoke a pending invitation. */
export async function DELETE(request: Request) {
  const ctx = await requireApi({ minRank: ADMIN });
  if (ctx instanceof Response) return ctx;
  const input = await body(request, RemoveBody);
  if (input instanceof Response) return input;

  if (input.invitationId) {
    const { data, error } = await ctx.supabase.from('invitations').delete().eq('id', input.invitationId).select('id');
    if (error || !data?.length) return jsonError(404, 'Invitation not found');
    return NextResponse.json({ ok: true });
  }
  if (input.userId) {
    const { error } = await ctx.supabase.rpc('remove_member', { p_user: input.userId });
    if (error) return jsonError(error.code === 'P0002' ? 404 : 403, error.message);
    return NextResponse.json({ ok: true });
  }
  return jsonError(400, 'Nothing to remove');
}
