// Tells the business about a new signup on the pricing page. The address stays on the server.
import { sendEmail, type EmailConfig } from '@/lib/email';
import { env } from '@/lib/env';

export interface LeadDetails {
  name: string;
  company: string;
  email: string;
  phone?: string;
}

/** Long enough for a healthy mail server on a serverless host, short enough that a visitor doesn't notice one that isn't. */
export const LEAD_NOTIFY_WAIT_MS = 2_000;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Never throws, and returns within LEAD_NOTIFY_WAIT_MS whatever the mail server does. Not configured means skipped and logged. */
export async function notifyOperatorOfLead(lead: LeadDetails): Promise<void> {
  const to = env.operatorEmail();
  let config: EmailConfig;
  try {
    config = { apiKey: env.resendApiKey(), from: env.emailFrom(), replyTo: lead.email };
  } catch {
    config = { apiKey: '', from: '' };
  }
  if (!to || !config.apiKey) {
    console.warn('New lead email skipped: set OPERATOR_EMAIL and the email settings.');
    return;
  }

  const details = [`Name: ${lead.name}`, `Company: ${lead.company}`, `Email: ${lead.email}`, ...(lead.phone ? [`Phone: ${lead.phone}`] : [])];
  const send = sendEmail(config, {
    to,
    subject: `New TradeQuote PRO lead: ${lead.company.replace(/\s+/g, ' ')}`,
    text: ['Someone joined the list on the pricing page.', ...details].join('\n'),
    html: `<p>Someone joined the list on the pricing page.</p><p>${details.map(escapeHtml).join('<br>')}</p>`,
  })
    .then((result) => {
      if (!result.ok) console.error(`New lead email failed: ${result.error}`);
    })
    .catch((err) => console.error('New lead email failed', err));

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([send, new Promise((resolve) => (timer = setTimeout(resolve, LEAD_NOTIFY_WAIT_MS)))]);
  clearTimeout(timer);
}
