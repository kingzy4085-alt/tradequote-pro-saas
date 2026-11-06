import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { requireCron } from '@/lib/cron';
import { sendEmail, type EmailConfig } from '@/lib/email';
import { env } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { dueStep, renderTrialEmail, unsubscribeUrl } from '@/lib/trial-emails';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_SIZE = 200;
// Sending is one request at a time, so stop in time to answer. Vercel runs this
// once a day and dueStep skips a missed step rather than sending a backlog.
const TIME_BUDGET_MS = 50_000;

type Member = { email: string | null; full_name: string | null; role: string };
type CompanyRow = { id: string; name: string; created_at: string; trial_ends_at: string; company_users: Member[]; trial_emails: { step: string }[] };

const ownerOf = (c: CompanyRow) => c.company_users.find((u) => u.role === 'owner');

/**
 * Daily job (vercel.json → crons) that sends each trialing company's owner the
 * onboarding email that's due. Safe to run more than once a day: a step is
 * claimed in trial_emails before it's sent, and released again if sending fails.
 */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;

  // Missing email settings skip the job and say so; they never crash it
  let config: EmailConfig;
  let sender: { business: string; address: string };
  let secret: string;
  try {
    config = { apiKey: env.resendApiKey(), from: env.emailFrom(), replyTo: env.emailReplyTo() };
    sender = { business: env.businessName(), address: env.businessAddress() };
    secret = env.unsubscribeSecret();
  } catch (err) {
    console.error('Trial email job skipped: email is not configured', err);
    return NextResponse.json({ checked: 0, sent: 0, skipped: 0, failed: 0, notConfigured: true });
  }

  const admin = createSupabaseAdminClient();
  const started = Date.now();
  const nowIso = new Date(started).toISOString();
  const since = new Date(started - 16 * 86_400_000).toISOString();
  const siteUrl = env.siteUrl();
  const summary = { checked: 0, sent: 0, skipped: 0, failed: 0, outOfTime: false };

  let cursor: string | null = null;
  for (;;) {
    let query = admin
      .from('companies')
      .select('id, name, created_at, trial_ends_at, company_users(email, full_name, role), trial_emails(step)')
      .eq('subscription_status', 'trialing')
      .gt('trial_ends_at', nowIso)
      .gt('created_at', since)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) {
      console.error('Trial email job could not load companies', error);
      return jsonError(500, 'Could not load companies');
    }
    const companies = (data ?? []) as unknown as CompanyRow[];
    summary.checked += companies.length;

    // Only this batch's owners, so the list can't outgrow a single read. If it can't be
    // read at all, stop: emailing someone who unsubscribed breaks CASL.
    const addresses = [...new Set(companies.flatMap((c) => ownerOf(c)?.email?.toLowerCase() ?? []))];
    let optedOut = new Set<string>();
    if (addresses.length) {
      const { data: unsubscribed, error: unsubError } = await admin.from('email_unsubscribes').select('email, scope').in('email', addresses);
      if (unsubError) {
        console.error('Trial email job could not read unsubscribes', unsubError);
        return jsonError(500, 'Could not read unsubscribes');
      }
      // Someone who only turned off alert emails can still get these
      optedOut = new Set((unsubscribed ?? []).filter((r) => r.scope !== 'alerts').map((r) => r.email as string));
    }

    for (const c of companies) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        summary.outOfTime = true;
        console.warn('Trial email job ran out of time; remaining companies wait for the next run');
        return NextResponse.json(summary);
      }
      const owner = ownerOf(c);
      const to = owner?.email?.toLowerCase();
      const sent = new Set(c.trial_emails.map((s) => s.step));
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

    if (companies.length < BATCH_SIZE) break;
    cursor = companies[companies.length - 1].id;
  }

  return NextResponse.json(summary);
}
