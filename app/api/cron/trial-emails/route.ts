import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { dueStep, renderTrialEmail, unsubscribeUrl } from '@/lib/trial-emails';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.cronSecret()}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily job (vercel.json → crons) that sends each trialing company's owner the
 * onboarding email that's due. Safe to run more than once a day: a step is
 * claimed in trial_emails before it's sent, and released again if sending fails.
 */
export async function GET(request: Request) {
  try {
    if (!authorized(request)) return jsonError(401, 'Unauthorized');
  } catch (err) {
    console.error('Trial email job is not configured', err);
    return jsonError(500, 'Server is not configured correctly');
  }

  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - 16 * 86_400_000).toISOString();
  const { data: companies, error } = await admin
    .from('companies')
    .select('id, name, created_at, trial_ends_at, company_users(email, full_name, role), trial_emails(step)')
    .eq('subscription_status', 'trialing')
    .gt('trial_ends_at', new Date().toISOString())
    .gt('created_at', since)
    .limit(500);
  if (error) {
    console.error('Trial email job could not load companies', error);
    return jsonError(500, 'Could not load companies');
  }

  const { data: unsubscribed } = await admin.from('email_unsubscribes').select('email');
  const optedOut = new Set((unsubscribed ?? []).map((r) => r.email as string));
  const config = { apiKey: env.resendApiKey(), from: env.emailFrom(), replyTo: env.emailReplyTo() };
  const sender = { business: env.businessName(), address: env.businessAddress() };
  const siteUrl = env.siteUrl();
  const secret = env.unsubscribeSecret();

  const summary = { checked: companies.length, sent: 0, skipped: 0, failed: 0 };
  for (const c of companies) {
    const owner = (c.company_users as { email: string | null; full_name: string | null; role: string }[]).find((u) => u.role === 'owner');
    const to = owner?.email?.toLowerCase();
    const sent = new Set((c.trial_emails as { step: string }[]).map((s) => s.step));
    const step = dueStep(new Date(c.created_at), new Date(c.trial_ends_at), sent);
    if (!step) continue;
    if (!to || optedOut.has(to)) {
      summary.skipped++;
      continue;
    }

    // Claim the step first so a second run at the same time can't send it again
    const { data: claim, error: claimError } = await admin
      .from('trial_emails')
      .upsert({ company_id: c.id, step: step.id, recipient: to }, { onConflict: 'company_id,step', ignoreDuplicates: true })
      .select('step');
    if (claimError || !claim?.length) continue;

    const unsub = unsubscribeUrl(siteUrl, to, secret);
    const firstName = owner?.full_name?.trim().split(/\s+/)[0] || 'there';
    const email = renderTrialEmail({ step, name: firstName, company: c.name, siteUrl, unsubscribeUrl: unsub, sender });
    const result = await sendEmail(config, { to, ...email, unsubscribeUrl: unsub });
    if (result.ok) {
      summary.sent++;
    } else {
      summary.failed++;
      console.error(`Trial email ${step.id} to company ${c.id} failed: ${result.error}`);
      await admin.from('trial_emails').delete().eq('company_id', c.id).eq('step', step.id);
    }
  }

  return NextResponse.json(summary);
}
