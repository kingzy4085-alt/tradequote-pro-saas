import { NextResponse } from 'next/server';
import { jsonError, readJson } from '@/lib/api';
import { LeadSchema } from '@/lib/leads';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

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

  const { error } = await createSupabaseAdminClient().from('leads').insert(lead);
  if (error) {
    console.error('Could not save lead', error);
    return jsonError(500, 'Could not save your signup. Try again.');
  }
  return NextResponse.json({ ok: true });
}
