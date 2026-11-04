import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, readJson } from '@/lib/api';
import { PROVINCES } from '@/lib/provinces';
import { consumeUserRateLimit } from '@/lib/rate-limit';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const fullName = z.string().trim().min(1, 'Enter your name').max(120);
const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    fullName,
    companyName: z.string().trim().min(1, 'Enter your company name').max(200),
    province: z.enum(PROVINCES.map((p) => p.code) as [string, ...string[]]),
  }),
  z.object({ action: z.literal('accept'), fullName, token: z.string().regex(/^[a-f0-9]{64}$/) }),
]);

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError(401, 'Sign in required');

  let parsed;
  try {
    parsed = Body.safeParse(await readJson(request, 5_000));
  } catch {
    return jsonError(400, 'Invalid request');
  }
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? 'Invalid request');
  const body = parsed.data;

  if (!(await consumeUserRateLimit(supabase, 'onboarding'))) return jsonError(429, 'Too many attempts. Try again in an hour.');

  const { error } =
    body.action === 'create'
      ? await supabase.rpc('create_company', { p_name: body.companyName, p_province: body.province, p_full_name: body.fullName })
      : await supabase.rpc('accept_invitation', { p_token: body.token, p_full_name: body.fullName });

  if (error) {
    if (error.code === '23505') return jsonError(409, 'You already belong to a company.');
    if (error.code === 'P0002') return jsonError(404, 'That invitation has expired. Ask for a new one.');
    console.error('Onboarding failed', error);
    return jsonError(500, 'Could not finish setup. Try again.');
  }
  return NextResponse.json({ ok: true });
}
