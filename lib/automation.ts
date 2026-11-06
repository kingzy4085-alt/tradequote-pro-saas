// The server side of the daily automation: the jobs behind /api/cron/automation, /digest and
// /status, and the immediate safety email. All of it runs as the service role, so nothing here
// may be reachable without the cron secret, except notifyImmediateAlerts, which takes only a
// company the caller already belongs to and sends only what the database says is waiting.
//
// Retention (see automation_housekeeping): expired invitations 30 days, Stripe events 90 days,
// AI usage counts 13 months, resolved alerts 90 days, automation events 24 months, automation
// runs 13 months, digest sends 90 days. The privacy page states these, so change it with them.
import { sendEmail, type EmailConfig, type OutgoingEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { AUTOMATION_RULES, REJECTED_CARD_RULE, alertHref, alertsForMember, companyToday, groupBySeverity, moduleLabel, SEVERITY_LABEL, type AlertMemberState, type AlertRow } from '@/lib/alerts';
import { subscriptionAllowsWrite } from '@/lib/context';
import { ROLE_RANK, isRole } from '@/lib/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { unsubscribeToken } from '@/lib/trial-emails';

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };
// A chainable query from supabase-js. Only the methods used here, so tests can use a stand-in.
export interface Db {
  from(table: string): any;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult> | any;
}

export type SendFn = (email: OutgoingEmail) => Promise<{ ok: true } | { ok: false; error: string }>;

export interface EmailSettings {
  config: EmailConfig;
  sender: { business: string; address: string };
  secret: string;
  siteUrl: string;
}

const BATCH_SIZE = 200;
const DAY_MS = 86_400_000;
export const STALE_AFTER_MS = 26 * 3_600_000;
const MEMBER_DIGEST_RANK = 2;
const IMMEDIATE_EMAIL_RANK = 3;
const MAX_DIGEST_LINES = 50;
const ALERT_COLUMNS = 'id, company_id, rule_key, module, record_id, title, message, severity, min_rank, bucket, due_on, bucket_changed_at, resolved_at';

/** Modules where a save can raise an immediate alert, so the save also tries to send its email. */
export const IMMEDIATE_MODULES = new Set(AUTOMATION_RULES.filter((r) => r.immediate).map((r) => r.module));

/** Email settings, or null when they aren't all there. The caller skips the email and says so; it never crashes. */
export function emailSettings(): EmailSettings | null {
  try {
    return {
      config: { apiKey: env.resendApiKey(), from: env.emailFrom(), replyTo: env.emailReplyTo() },
      sender: { business: env.businessName(), address: env.businessAddress() },
      secret: env.unsubscribeSecret(),
      siteUrl: env.siteUrl(),
    };
  } catch (err) {
    console.warn('Alert email skipped: email is not configured.', err instanceof Error ? err.message : err);
    return null;
  }
}

export const sendWith = (settings: EmailSettings): SendFn => (email) => sendEmail(settings.config, email);

/** A send that throws counts as a failed send, so its claim is released and the next person still gets theirs. */
async function trySend(send: SendFn, email: OutgoingEmail): ReturnType<SendFn> {
  try {
    return await send(email);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const utcDate = (now: Date) => now.toISOString().slice(0, 10);
const rankOf = (role: unknown) => (isRole(role) ? ROLE_RANK[role] : 0);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Stops alert emails only. Signed separately from the marketing link, so one can't be turned into the other. */
export function alertsUnsubscribeUrl(siteUrl: string, email: string, secret: string): string {
  const lower = email.toLowerCase();
  return `${siteUrl}/api/email/unsubscribe?e=${encodeURIComponent(lower)}&t=${unsubscribeToken(`alerts:${lower}`, secret)}&s=alerts`;
}

/** Addresses that turned off alert emails. Unsubscribing from trial emails doesn't count: that's the marketing scope. */
async function alertOptOuts(db: Db, addresses: string[]): Promise<Set<string>> {
  if (!addresses.length) return new Set();
  const { data, error } = await db.from('email_unsubscribes').select('email, scope').in('email', addresses);
  if (error) throw new Error(`Could not read unsubscribes: ${error.message}`);
  return new Set(((data ?? []) as { email: string; scope?: string }[]).filter((r) => r.scope === 'alerts').map((r) => r.email));
}

function layout(heading: string, bodyHtml: string, footerText: string, unsubscribeLink: string) {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px">
<tr><td style="padding:20px 28px;background:#020617;border-radius:12px 12px 0 0;color:#f59e0b;font-weight:bold;font-size:18px">TradeQuote PRO</td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.5"><h1 style="font-size:18px;margin:0 0 14px">${escapeHtml(heading)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.5">${escapeHtml(footerText)}<br><a href="${escapeHtml(unsubscribeLink)}" style="color:#64748b">Stop alert emails</a>. They will still show in the app.</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderDigest(input: { company: string; name: string; alerts: AlertRow[]; siteUrl: string; unsubscribeUrl: string; sender: { business: string; address: string } }) {
  const { company, name, alerts, siteUrl, unsubscribeUrl, sender } = input;
  const shown = alerts.slice(0, MAX_DIGEST_LINES);
  const hidden = alerts.length - shown.length;
  const groups = groupBySeverity(shown);
  const urgent = alerts.filter((a) => a.severity === 'critical').length;
  const count = `${alerts.length} ${alerts.length === 1 ? 'item' : 'items'}`;
  const subject = urgent ? `${company}: ${urgent} ${urgent === 1 ? 'needs' : 'need'} action today, ${count} in all` : `${company}: ${count} to look at`;
  const footer = `${sender.business} · ${sender.address}`;
  const intro = `Hi ${name}, here's what changed for ${company} since your last summary.`;
  const moreText = hidden ? `...and ${hidden} more in the app.` : '';

  const text = [
    intro,
    ...groups.map((g) => [g.severity === 'critical' ? SEVERITY_LABEL.critical.toUpperCase() : SEVERITY_LABEL[g.severity], ...g.alerts.map((a) => `- ${moduleLabel(a.module)}: ${a.title}. ${a.message} ${siteUrl}${alertHref(a)}`)].join('\n')),
    moreText,
    `Open TradeQuote PRO: ${siteUrl}/`,
    footer,
    `Stop alert emails: ${unsubscribeUrl}`,
  ].filter(Boolean).join('\n\n');

  const body = groups
    .map((g) => {
      const colour = g.severity === 'critical' ? '#b91c1c' : g.severity === 'warning' ? '#b45309' : '#475569';
      const items = g.alerts.map(
        (a) => `<li style="margin:0 0 10px"><a href="${escapeHtml(`${siteUrl}${alertHref(a)}`)}" style="color:#0f172a;font-weight:bold">${escapeHtml(a.title)}</a><br><span style="color:#475569;font-size:13px">${escapeHtml(moduleLabel(a.module))}: ${escapeHtml(a.message)}</span></li>`
      );
      return `<h2 style="font-size:14px;margin:18px 0 8px;color:${colour}">${escapeHtml(SEVERITY_LABEL[g.severity])}</h2><ul style="margin:0;padding:0 0 0 18px">${items.join('')}</ul>`;
    })
    .join('');
  const html = layout(
    subject,
    `<p style="margin:0 0 6px">${escapeHtml(intro)}</p>${body}${hidden ? `<p>${escapeHtml(moreText)}</p>` : ''}<p style="margin:22px 0 0"><a href="${escapeHtml(`${siteUrl}/`)}" style="background:#f59e0b;color:#020617;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block">Open TradeQuote PRO</a></p>`,
    footer,
    unsubscribeUrl
  );
  return { subject, text, html };
}

export function renderImmediate(input: { company: string; alert: AlertRow; siteUrl: string; unsubscribeUrl: string; sender: { business: string; address: string } }) {
  const { company, alert, siteUrl, unsubscribeUrl, sender } = input;
  const link = `${siteUrl}${alertHref(alert)}`;
  const footer = `${sender.business} · ${sender.address}`;
  const subject = `Safety alert at ${company}: ${alert.title}`;
  const text = [`${moduleLabel(alert.module)}: ${alert.title}`, alert.message, `Open it: ${link}`, footer, `Stop alert emails: ${unsubscribeUrl}`].join('\n\n');
  const html = layout(
    subject,
    `<p style="margin:0 0 8px;font-weight:bold">${escapeHtml(moduleLabel(alert.module))}: ${escapeHtml(alert.title)}</p><p style="margin:0 0 18px">${escapeHtml(alert.message)}</p><p style="margin:0"><a href="${escapeHtml(link)}" style="background:#f59e0b;color:#020617;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block">Open the record</a></p>`,
    footer,
    unsubscribeUrl
  );
  return { subject, text, html };
}

async function recordRun(db: Db, row: { run_date: string; job: string; companies_ok: number; companies_failed: number; duration_ms: number; out_of_time: boolean; summary?: unknown }) {
  const { error } = await db.from('automation_runs').insert(row);
  if (error) console.error(`Could not record the ${row.job} run`, error);
}

// The daily run -----------------------------------------------------------------------

export interface AutomationSummary {
  checked: number;
  ok: number;
  failed: number;
  skippedLocked: number;
  alreadyRun: number;
  flips: number;
  raised: number;
  changed: number;
  resolved: number;
  outOfTime: boolean;
}

type CompanyRow = {
  id: string;
  province: string;
  subscription_status: string;
  trial_ends_at: string;
  automation_company_state?: { last_run_date: string } | { last_run_date: string }[] | null;
};

/** Every company in id order, a batch at a time. One company failing is logged and the rest still run. */
export async function runAutomationJob(db: Db, options: { now?: () => Date; timeBudgetMs?: number } = {}): Promise<AutomationSummary> {
  const clock = options.now ?? (() => new Date());
  const startedAt = clock();
  const started = startedAt.getTime();
  const budget = options.timeBudgetMs ?? 270_000;
  const summary: AutomationSummary = { checked: 0, ok: 0, failed: 0, skippedLocked: 0, alreadyRun: 0, flips: 0, raised: 0, changed: 0, resolved: 0, outOfTime: false };

  let cursor: string | null = null;
  batches: for (;;) {
    let query = db.from('companies').select('id, province, subscription_status, trial_ends_at, automation_company_state(last_run_date)').order('id', { ascending: true }).limit(BATCH_SIZE);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) {
      console.error('Automation could not load companies', error);
      summary.failed++;
      break;
    }
    const companies = (data ?? []) as CompanyRow[];
    for (const company of companies) {
      if (clock().getTime() - started > budget) {
        // The next scheduled run skips whoever finished, so it picks up from here
        summary.outOfTime = true;
        console.error('Automation ran out of time; the remaining companies wait for the next run');
        break batches;
      }
      summary.checked++;
      if (!subscriptionAllowsWrite(company, clock())) {
        summary.skippedLocked++;
        continue;
      }
      let result: unknown;
      // Inside a try: an error thrown for one company must not stop the ones after it
      try {
        const today = companyToday(company.province, clock());
        if (one(company.automation_company_state)?.last_run_date === today) {
          summary.alreadyRun++;
          summary.ok++;
          continue;
        }
        const { data, error: runError } = await db.rpc('run_company_automation', { p_company: company.id, p_today: today });
        if (runError) throw runError;
        result = data;
      } catch (err) {
        summary.failed++;
        console.error(`Automation failed for company ${company.id}`, err);
        continue;
      }
      const r = (result ?? {}) as { skipped?: boolean; flips?: number; raised?: number; changed?: number; resolved?: number };
      if (r.skipped) {
        summary.skippedLocked++;
        continue;
      }
      summary.ok++;
      summary.flips += r.flips ?? 0;
      summary.raised += r.raised ?? 0;
      summary.changed += r.changed ?? 0;
      summary.resolved += r.resolved ?? 0;
    }
    if (companies.length < BATCH_SIZE) break;
    cursor = companies[companies.length - 1].id;
  }

  // Sundays, by the server's date. It only needs to happen about once a week.
  if (startedAt.getUTCDay() === 0) {
    const { data, error } = await db.rpc('automation_housekeeping', { p_today: utcDate(startedAt) });
    if (error) console.error('Automation housekeeping failed', error);
    else console.log('Automation housekeeping removed', data);
  }

  console.log('Automation run finished', summary);
  await recordRun(db, {
    run_date: utcDate(startedAt),
    job: 'automation',
    companies_ok: summary.ok,
    companies_failed: summary.failed,
    duration_ms: clock().getTime() - started,
    out_of_time: summary.outOfTime,
    summary,
  });
  return summary;
}

// Immediate safety alerts ---------------------------------------------------------------

export interface ImmediateSummary {
  alerts: number;
  sent: number;
  failed: number;
}

/**
 * Sends each safety alert still waiting for its email, once. The save that raised it calls
 * this, and the daily jobs sweep up anything that failed then. An alert is claimed before
 * sending. It's released only if nobody got it, so a retry can't double up on the people who did.
 */
export async function sendImmediateAlerts(db: Db, settings: EmailSettings, send: SendFn, options: { companyId?: string; now?: Date } = {}): Promise<ImmediateSummary> {
  const now = options.now ?? new Date();
  const summary: ImmediateSummary = { alerts: 0, sent: 0, failed: 0 };
  // Old ones stay in the app. A company turning email on, or upgrading, shouldn't get a backlog of
  // "immediate" news: created_at is when the alert was raised, and no_email_reason covers an alert
  // the daily run raised on a record that was already old.
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  let query = db.from('alerts').select(ALERT_COLUMNS).eq('immediate', true).is('emailed_at', null).is('resolved_at', null).is('no_email_reason', null).gt('created_at', since).order('created_at', { ascending: true }).limit(100);
  if (options.companyId) query = query.eq('company_id', options.companyId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load safety alerts: ${error.message}`);

  for (const alert of (data ?? []) as AlertRow[]) {
    const companyId = alert.company_id!;
    const [{ data: company }, { data: members, error: membersError }] = await Promise.all([
      db.from('companies').select('name').eq('id', companyId).maybeSingle(),
      db.from('company_users').select('email, role').eq('company_id', companyId),
    ]);
    if (membersError) {
      summary.failed++;
      console.error(`Could not load who to tell about safety alert ${alert.id}`, membersError);
      continue;
    }
    // Projects don't record a PM, so every PM hears about it along with the owner and admins
    const addresses = [...new Set(((members ?? []) as { email: string | null; role: string }[]).filter((m) => rankOf(m.role) >= IMMEDIATE_EMAIL_RANK && m.email).map((m) => m.email!.toLowerCase()))];
    let optedOut: Set<string>;
    try {
      optedOut = await alertOptOuts(db, addresses);
    } catch (err) {
      summary.failed++;
      console.error(`Safety alert ${alert.id} not sent`, err);
      continue;
    }
    const recipients = addresses.filter((a) => !optedOut.has(a));

    const { data: claimed, error: claimError } = await db.from('alerts').update({ emailed_at: now.toISOString() }).eq('id', alert.id).is('emailed_at', null).select('id');
    if (claimError || !(claimed as unknown[] | null)?.length) continue;
    summary.alerts++;
    if (!recipients.length) console.warn(`Safety alert ${alert.id} is in the app, but nobody at company ${companyId} has alert emails on`);

    let delivered = 0;
    for (const to of recipients) {
      const unsubscribeUrl = alertsUnsubscribeUrl(settings.siteUrl, to, settings.secret);
      const rendered = renderImmediate({ company: (company as { name?: string } | null)?.name ?? 'your company', alert, siteUrl: settings.siteUrl, unsubscribeUrl, sender: settings.sender });
      const result = await trySend(send, { to, ...rendered, unsubscribeUrl });
      if (result.ok) {
        delivered++;
        summary.sent++;
      } else {
        summary.failed++;
        console.error(`Safety alert ${alert.id} to one recipient failed: ${result.error}`);
      }
    }
    if (recipients.length && delivered === 0) {
      const { error: releaseError } = await db.from('alerts').update({ emailed_at: null }).eq('id', alert.id);
      if (releaseError) console.error(`Could not release safety alert ${alert.id}`, releaseError);
    }
  }
  return summary;
}

/** Called after a save that may have raised a safety alert. Never throws: the record is saved whatever happens to the email. */
export async function notifyImmediateAlerts(companyId: string): Promise<void> {
  try {
    const settings = emailSettings();
    if (!settings) return;
    await sendImmediateAlerts(createSupabaseAdminClient(), settings, sendWith(settings), { companyId });
  } catch (err) {
    console.error('Safety alert email failed; the daily job will try again', err);
  }
}

// The digest ----------------------------------------------------------------------------

export interface DigestSummary {
  companies: number;
  companiesFailed: number;
  sent: number;
  skippedEmpty: number;
  skippedUnsubscribed: number;
  alreadySent: number;
  failed: number;
  outOfTime: boolean;
  notConfigured?: boolean;
}

type DigestMember = { user_id: string; email: string | null; full_name: string | null; role: string };
type DigestCompany = CompanyRow & { name: string; company_users: DigestMember[] };

/**
 * One email per member at foreman or above, listing what changed since their last one. Nothing
 * changed means no email. Claimed before sending, released if it fails.
 */
export async function runDigestJob(db: Db, settings: EmailSettings, send: SendFn, options: { now?: () => Date; timeBudgetMs?: number } = {}): Promise<DigestSummary> {
  const clock = options.now ?? (() => new Date());
  const startedAt = clock();
  const started = startedAt.getTime();
  const budget = options.timeBudgetMs ?? 270_000;
  const lookback = new Date(started - 14 * DAY_MS).toISOString();
  const firstDigestSince = new Date(started - 2 * DAY_MS).toISOString();
  const summary: DigestSummary = { companies: 0, companiesFailed: 0, sent: 0, skippedEmpty: 0, skippedUnsubscribed: 0, alreadySent: 0, failed: 0, outOfTime: false };

  let cursor: string | null = null;
  batches: for (;;) {
    let query = db.from('companies').select('id, name, province, subscription_status, trial_ends_at, company_users(user_id, email, full_name, role)').order('id', { ascending: true }).limit(BATCH_SIZE);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) {
      console.error('Digest could not load companies', error);
      summary.companiesFailed++;
      break;
    }
    const companies = (data ?? []) as DigestCompany[];

    for (const company of companies) {
      if (!subscriptionAllowsWrite(company, startedAt)) continue;
      const members = (company.company_users ?? []).filter((m) => rankOf(m.role) >= MEMBER_DIGEST_RANK && m.email);
      if (!members.length) continue;
      summary.companies++;
      try {
        const today = companyToday(company.province, startedAt);
        const { data: alertRows, error: alertError } = await db.from('alerts').select(ALERT_COLUMNS).eq('company_id', company.id).is('resolved_at', null).gt('bucket_changed_at', lookback).order('bucket_changed_at', { ascending: false }).limit(2000);
        if (alertError) throw new Error(alertError.message);
        const alerts = (alertRows ?? []) as AlertRow[];
        if (!alerts.length) {
          summary.skippedEmpty += members.length;
          continue;
        }
        const { data: stateRows, error: stateError } = await db.from('alert_member_state').select('alert_id, user_id, snoozed_until, dismissed_bucket').in('user_id', members.map((m) => m.user_id));
        if (stateError) throw new Error(stateError.message);
        const { data: sendRows, error: sendsError } = await db.from('digest_sends').select('user_id, sent_at').eq('company_id', company.id).gt('sent_at', lookback).order('sent_at', { ascending: false }).limit(5000);
        if (sendsError) throw new Error(sendsError.message);
        const lastSent = new Map<string, string>();
        for (const row of (sendRows ?? []) as { user_id: string; sent_at: string }[]) if (!lastSent.has(row.user_id)) lastSent.set(row.user_id, row.sent_at);
        const rejected = alerts.filter((a) => a.rule_key === REJECTED_CARD_RULE).map((a) => a.record_id);
        const { data: ownerRows, error: ownerError } = rejected.length ? await db.from('timecards').select('id, worker_user_id').in('id', rejected) : { data: [], error: null };
        if (ownerError) throw new Error(ownerError.message);
        const cardOwners = new Map(((ownerRows ?? []) as { id: string; worker_user_id: string | null }[]).map((c) => [c.id, c.worker_user_id]));
        // If this can't be read nobody in the company is emailed: mailing someone who opted out breaks CASL
        const optedOut = await alertOptOuts(db, [...new Set(members.map((m) => m.email!.toLowerCase()))]);

        for (const member of members) {
          if (clock().getTime() - started > budget) {
            summary.outOfTime = true;
            console.error('Digest ran out of time; the rest get these items in the next digest');
            break batches;
          }
          const to = member.email!.toLowerCase();
          const forMember = alertsForMember(alerts, { userId: member.user_id, rank: rankOf(member.role) }, { today, since: lastSent.get(member.user_id) ?? firstDigestSince, states: (stateRows ?? []) as AlertMemberState[], cardOwners });
          if (!forMember.length) {
            summary.skippedEmpty++;
            continue;
          }
          if (optedOut.has(to)) {
            summary.skippedUnsubscribed++;
            continue;
          }
          const { data: claimed, error: claimError } = await db.rpc('claim_digest_send', { p_company: company.id, p_user: member.user_id, p_date: today });
          if (claimError) {
            summary.failed++;
            console.error(`Could not claim a digest in company ${company.id}`, claimError);
            continue;
          }
          if (!claimed) {
            summary.alreadySent++;
            continue;
          }
          const unsubscribeUrl = alertsUnsubscribeUrl(settings.siteUrl, to, settings.secret);
          const name = member.full_name?.trim().split(/\s+/)[0] || 'there';
          const email = renderDigest({ company: company.name, name, alerts: forMember, siteUrl: settings.siteUrl, unsubscribeUrl, sender: settings.sender });
          const result = await trySend(send, { to, ...email, unsubscribeUrl });
          if (result.ok) {
            summary.sent++;
          } else {
            summary.failed++;
            console.error(`Digest for a member of company ${company.id} failed: ${result.error}`);
            const { error: releaseError } = await db.rpc('release_digest_send', { p_company: company.id, p_user: member.user_id, p_date: today });
            if (releaseError) console.error(`Could not release a digest in company ${company.id}`, releaseError);
          }
        }
      } catch (err) {
        summary.companiesFailed++;
        console.error(`Digest failed for company ${company.id}`, err);
      }
    }
    if (companies.length < BATCH_SIZE) break;
    cursor = companies[companies.length - 1].id;
  }

  console.log('Digest finished', summary);
  await recordRun(db, {
    run_date: utcDate(startedAt),
    job: 'digest',
    companies_ok: summary.companies - summary.companiesFailed,
    companies_failed: summary.companiesFailed + (summary.failed ? 1 : 0),
    duration_ms: clock().getTime() - started,
    out_of_time: summary.outOfTime,
    summary,
  });
  return summary;
}

// Health --------------------------------------------------------------------------------

export interface AutomationHealth {
  healthy: boolean;
  lastSuccessAt: string | null;
  problems: string[];
  operatorEmailed: boolean;
}

/**
 * Vercel doesn't retry a failed cron job, so a broken one would leave compliance statuses
 * stale in silence. Emails the operator at most once a day when something's wrong.
 */
export async function checkAutomationHealth(db: Db, settings: EmailSettings | null, send: SendFn | null, options: { now?: Date } = {}): Promise<AutomationHealth> {
  const now = options.now ?? new Date();
  const { data, error } = await db.from('automation_runs').select('job, companies_ok, companies_failed, out_of_time, created_at').in('job', ['automation', 'digest']).order('created_at', { ascending: false }).limit(60);
  const problems: string[] = [];
  let lastSuccessAt: string | null = null;
  if (error) {
    console.error('Could not read automation runs', error);
    problems.push('Could not read the automation run history.');
  } else {
    const runs = (data ?? []) as { job: string; companies_failed: number; out_of_time: boolean; created_at: string }[];
    const automation = runs.filter((r) => r.job === 'automation');
    lastSuccessAt = automation.find((r) => !r.companies_failed && !r.out_of_time)?.created_at ?? null;
    if (!lastSuccessAt) problems.push('The automation job has no successful run on record.');
    else if (now.getTime() - new Date(lastSuccessAt).getTime() > STALE_AFTER_MS) problems.push(`The last successful automation run was at ${lastSuccessAt}, more than 26 hours ago.`);
    for (const job of ['automation', 'digest']) {
      const latest = runs.find((r) => r.job === job);
      if (latest?.companies_failed) problems.push(`The latest ${job} run had ${latest.companies_failed} failure(s). See the server logs.`);
      if (latest?.out_of_time) problems.push(`The latest ${job} run ran out of time before finishing.`);
    }
  }

  let operatorEmailed = false;
  if (problems.length) {
    console.error('Automation health check found problems', problems);
    const to = env.operatorEmail();
    if (!to || !settings || !send) {
      console.warn('No operator email was sent: set OPERATOR_EMAIL and the email settings.');
    } else {
      const runDate = utcDate(now);
      const { data: told, error: toldError } = await db.from('automation_runs').select('id').eq('job', 'operator-alert').eq('run_date', runDate).limit(1);
      if (!toldError && !(told as unknown[] | null)?.length) {
        const text = [`TradeQuote PRO automation needs a look.`, ...problems, `Status: ${settings.siteUrl}/api/cron/status`].join('\n\n');
        const unsubscribeUrl = alertsUnsubscribeUrl(settings.siteUrl, to, settings.secret);
        const result = await send({ to, subject: 'TradeQuote PRO automation needs a look', text, html: `<p>${problems.map(escapeHtml).join('</p><p>')}</p>`, unsubscribeUrl });
        if (result.ok) {
          operatorEmailed = true;
          await recordRun(db, { run_date: runDate, job: 'operator-alert', companies_ok: 0, companies_failed: 0, duration_ms: 0, out_of_time: false, summary: { problems } });
        } else {
          console.error(`Operator email failed: ${result.error}`);
        }
      }
    }
  }
  return { healthy: problems.length === 0, lastSuccessAt, problems, operatorEmailed };
}
