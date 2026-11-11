import { NextResponse } from 'next/server';
import { jsonError, readJson } from '@/lib/api';
import { notifyOperatorOfLead } from '@/lib/lead-notify';
import { LeadSchema } from '@/lib/leads';
import { checkRateLimit, clientIp, hashForLimit } from '@/lib/rate-limit';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const HOUR = 3_600;

// Public: no session. Only the validated form fields are stored, by the server.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readJson(request, 5_000);
  } catch {
    return jsonError(400, 'Invalid request');
  }
  const parsed = LeadSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? 'Invalid request');
  const { website, ...lead } = parsed.data;
  // Bots fill the hidden field; pretend it worked so they don't retry
  if (website) return NextResponse.json({ ok: true });

  const admin = createSupabaseAdminClient();
  const allowed =
    (await checkRateLimit(admin, `leads:ip:${hashForLimit(clientIp(request))}`, 5, HOUR)) &&
    (await checkRateLimit(admin, `leads:email:${hashForLimit(lead.email.toLowerCase())}`, 3, 24 * HOUR));
  if (!allowed) return jsonError(429, 'Too many signups from here. Try again in an hour.');

  const { error } = await admin.from('leads').insert(lead);
  if (error) {
    console.error('Could not save lead', error);
    return jsonError(500, 'Could not save your signup. Try again.');
  }
  // The signup is saved. The email can't fail it, and a slow mail server can't hold up the visitor.
  await notifyOperatorOfLead(lead);
  return NextResponse.json({ ok: true });
}
