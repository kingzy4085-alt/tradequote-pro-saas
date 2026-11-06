// The onboarding emails a company owner gets during the 14-day free trial, and
// the pure logic for which one is due. Sent once a day by /api/cron/trial-emails.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TrialStep {
  id: string;
  /** Days after the company was created. */
  day: number;
  subject: string;
  /** Paragraphs; `{name}` and `{company}` are filled in. */
  body: string[];
  cta: { label: string; path: string };
}

export const TRIAL_STEPS: TrialStep[] = [
  {
    id: 'welcome',
    day: 0,
    subject: 'Your TradeQuote PRO trial is on',
    body: [
      'Hi {name},',
      '{company} has 14 days of full access, with no card on file. Three things take about ten minutes and show you most of what the app does:',
      '1. Add one client in Clients.\n2. Build an estimate for a job you bid recently, and compare the total with the one you sent.\n3. Invite your foreman from Settings → Team so they can try the daily log on their phone.',
      'Install it on your phone too: open the app in Chrome (Android) or Safari (iPhone) and choose Install app or Add to Home Screen.',
    ],
    cta: { label: 'Open TradeQuote PRO', path: '/' },
  },
  {
    id: 'estimating',
    day: 2,
    subject: 'Bid once, print the proposal from the same record',
    body: [
      'Hi {name},',
      'Most shops build the bid in a spreadsheet and then re-type it into a proposal. In TradeQuote PRO the estimate already holds the client, the markup and the total, so the proposal comes from the same record and prints with a signature block.',
      'Try it with a real bid: open Estimates, add the job, then turn it into a proposal and press Print.',
    ],
    cta: { label: 'Start an estimate', path: '/estimates' },
  },
  {
    id: 'field',
    day: 5,
    subject: 'Get your crew logging from the truck',
    body: [
      'Hi {name},',
      'The app is only as good as what the field puts in. Daily logs, timecards, tailgate meetings and LOTO permits all work on a phone with big buttons that work with gloves on.',
      'If you have not yet, invite one foreman or electrician from Settings → Team. Electricians only see their own timecards, and they can never reach estimates or finance.',
    ],
    cta: { label: 'Invite your crew', path: '/settings/team' },
  },
  {
    id: 'compliance',
    day: 10,
    subject: "What's about to expire?",
    body: [
      'Hi {name},',
      'The Attention panel on the Command Center flags subcontractor insurance and WCB clearances, employee tickets and warranties as they come up for renewal, and keeps insurance and tickets flagged once they lapse, so you hear about it before an audit or a claim. It checks every day.',
      'Stuck on a code question? Ask the AI Assistant. It answers Canadian Electrical Code and construction questions and names the edition and section so you can check it.',
    ],
    cta: { label: 'Open the Command Center', path: '/' },
  },
  {
    id: 'ending',
    day: 13,
    subject: 'Your trial ends tomorrow',
    body: [
      'Hi {name},',
      "{company}'s free trial ends tomorrow. Nothing is deleted: after that you can still sign in and read everything, but editing stops until you subscribe.",
      'Subscribing takes a minute on the Billing page, and you can cancel any time from the same page.',
    ],
    cta: { label: 'Subscribe', path: '/settings/billing' },
  },
];

const DAY_MS = 86_400_000;

/**
 * The step to send now, or null. Only the newest step that has come due is sent;
 * older unsent ones are skipped so a company that signed up during an outage
 * doesn't get several emails at once.
 */
export function dueStep(companyCreatedAt: Date, trialEndsAt: Date, sent: ReadonlySet<string>, now = new Date()): TrialStep | null {
  if (trialEndsAt <= now) return null;
  const age = Math.floor((now.getTime() - companyCreatedAt.getTime()) / DAY_MS);
  const due = TRIAL_STEPS.filter((s) => s.day <= age).at(-1);
  if (!due || sent.has(due.id)) return null;
  return due;
}

// Unsubscribe links carry the address and an HMAC of it, so nobody can unsubscribe someone else.
export function unsubscribeToken(email: string, secret: string): string {
  return createHmac('sha256', secret).update(email.toLowerCase()).digest('base64url');
}

export function verifyUnsubscribeToken(email: string, token: string, secret: string): boolean {
  const expected = Buffer.from(unsubscribeToken(email, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(siteUrl: string, email: string, secret: string): string {
  const e = encodeURIComponent(email.toLowerCase());
  return `${siteUrl}/api/email/unsubscribe?e=${e}&t=${unsubscribeToken(email, secret)}`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface RenderInput {
  step: TrialStep;
  name: string;
  company: string;
  siteUrl: string;
  unsubscribeUrl: string;
  /** Business name and mailing address, required in every commercial email under CASL. */
  sender: { business: string; address: string };
}

export function renderTrialEmail({ step, name, company, siteUrl, unsubscribeUrl, sender }: RenderInput) {
  const fill = (s: string) => s.replace(/\{name\}/g, name).replace(/\{company\}/g, company);
  const paragraphs = step.body.map(fill);
  const ctaUrl = `${siteUrl}${step.cta.path}`;
  const footer = `${sender.business} · ${sender.address}`;

  const text = [
    ...paragraphs,
    `${step.cta.label}: ${ctaUrl}`,
    '— The TradeQuote PRO team',
    '',
    footer,
    `You're getting this because ${company} started a TradeQuote PRO trial. Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n\n');

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">
<tr><td style="padding:20px 28px;background:#020617;border-radius:12px 12px 0 0;color:#f59e0b;font-weight:bold;font-size:18px">TradeQuote PRO</td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.55">
${paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n')}
<p style="margin:22px 0"><a href="${escapeHtml(ctaUrl)}" style="background:#f59e0b;color:#020617;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block">${escapeHtml(step.cta.label)}</a></p>
<p style="margin:0">— The TradeQuote PRO team</p>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.5">
${escapeHtml(footer)}<br>
You're getting this because ${escapeHtml(company)} started a TradeQuote PRO trial. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a>
</td></tr></table></td></tr></table></body></html>`;

  return { subject: step.subject, text, html };
}
