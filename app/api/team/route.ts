import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, readJson, requireApi } from '@/lib/api';
import { env } from '@/lib/env';
import { consumeUserRateLimit } from '@/lib/rate-limit';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ADMIN = 4;
const INVITABLE = ['admin', 'project_manager', 'foreman', 'electrician'] as const;

const InviteBody = z.object({ email: z.string().trim().toLowerCase().email().max(320), role: z.enum(INVITABLE) });
const RoleBody = z.object({ userId: z.string().uuid(), role: z.enum(INVITABLE) });
const RemoveBody = z.object({ userId: z.string().uuid().optional(), invitationId: z.string().uuid().optional() });

// Written for people, in set_member_role and remove_member. Any other database message stays in the logs.
const TEAM_RULES = new Set([
  'Only owners and admins can change roles',
  'Only owners and admins can remove members',
  'You cannot change your own role',
  'You cannot remove yourself',
  'Only the owner can make admins',
]);

function teamError(error: { code?: string; message: string }, action: string) {
  if (error.code === 'P0002') return jsonError(404, 'That person is not on your team');
  if (TEAM_RULES.has(error.message)) return jsonError(403, error.message);
  console.error(`Team ${action} failed`, error);
  if (error.code === '42501') return jsonError(403, 'You do not have permission to do that');
  return jsonError(500, `Could not ${action}. Try again.`);
}

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

  if (!(await consumeUserRateLimit(ctx.supabase, 'invite'))) return jsonError(429, 'Too many invitations for now. Try again in an hour.');

  const { data: existing } = await ctx.supabase.from('company_users').select('user_id').eq('email', input.email).maybeSingle();
  if (existing) return jsonError(409, 'That person is already on your team');

  // An expired invitation must not block sending a fresh one
  await ctx.supabase.from('invitations').delete().eq('company_id', ctx.company.id).eq('email', input.email).is('accepted_at', null).lt('expires_at', new Date().toISOString());

  const { error } = await ctx.supabase.from('invitations').insert({ company_id: ctx.company.id, email: input.email, role: input.role, invited_by: ctx.user.id });
  if (error) {
    if (error.code === '23505') return jsonError(409, 'That person already has a pending invitation. Revoke it to send a new one.');
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
  if (error) return teamError(error, 'change that role');
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
    if (error) return teamError(error, 'remove that person');
    return NextResponse.json({ ok: true });
  }
  return jsonError(400, 'Nothing to remove');
}
