// Tells a contractor that their client answered a shared proposal. The answer is already saved
// when this runs, so nothing here may fail it: missing email settings mean the email is skipped,
// and a slow mail server is not waited for.
import { alertsUnsubscribeUrl, emailSettings } from './automation';
import { sendEmail } from './email';
import { formatMoney } from './format';

/** What public.portal_notice returns. `to` is null when there is nobody to tell, or they turned alert emails off. */
export interface PortalNotice {
  to: string | null;
  company: string;
  proposal_id: string;
  title: string;
  client_name: string | null;
  total_amount: number | string | null;
  decision: 'accepted' | 'declined';
  signer_name: string | null;
  decline_reason: string | null;
}

/** Long enough for a healthy mail server, short enough that the client's page does not hang on one that isn't. */
export const PORTAL_NOTIFY_WAIT_MS = 2_000;

// What the client typed ends up in a subject line and in HTML, so it is flattened and escaped
const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface PortalNoticeEmail {
  subject: string;
  text: string;
  html: string;
}

/** The email's words. Pure, so the wording and the escaping can be tested. */
export function renderPortalNotice(notice: PortalNotice, links: { siteUrl: string; unsubscribeUrl: string; sender: { business: string; address: string } }): PortalNoticeEmail {
  const title = oneLine(notice.title) || 'Untitled proposal';
  const who = oneLine(notice.signer_name) || oneLine(notice.client_name) || 'Your client';
  const accepted = notice.decision === 'accepted';
  const price = notice.total_amount === null || notice.total_amount === '' ? '' : ` at ${formatMoney(notice.total_amount)}`;
  const reason = oneLine(notice.decline_reason);
  const link = `${links.siteUrl.replace(/\/$/, '')}/proposals/${encodeURIComponent(notice.proposal_id)}`;
  const lines = accepted
    ? [`${who} accepted and signed the proposal "${title}"${price}.`, 'Open it to create the project and start tracking the job.']
    : [`${who} declined the proposal "${title}".`, ...(reason ? [`Their reason: ${reason}`] : [])];
  const footer = `${links.sender.business} · ${links.sender.address}`;
  return {
    subject: `Proposal ${accepted ? 'accepted' : 'declined'}: ${title}`.slice(0, 200),
    text: [...lines, '', link, '', footer, `Stop these emails: ${links.unsubscribeUrl}`].join('\n'),
    html: [
      ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
      `<p><a href="${escapeHtml(link)}">Open the proposal</a></p>`,
      `<p style="color:#666;font-size:12px">${escapeHtml(footer)}<br><a href="${escapeHtml(links.unsubscribeUrl)}">Stop these emails</a></p>`,
    ].join(''),
  };
}

/** Never throws, and returns within PORTAL_NOTIFY_WAIT_MS whatever the mail server does. */
export async function notifyContractorOfAnswer(notice: PortalNotice): Promise<'sent' | 'skipped' | 'failed' | 'slow'> {
  const to = notice.to?.trim().toLowerCase();
  if (!to) return 'skipped';
  const settings = emailSettings();
  if (!settings) return 'skipped';

  const unsubscribeUrl = alertsUnsubscribeUrl(settings.siteUrl, to, settings.secret);
  const email = renderPortalNotice(notice, { siteUrl: settings.siteUrl, unsubscribeUrl, sender: settings.sender });
  const send = sendEmail(settings.config, { to, ...email, unsubscribeUrl })
    .then((result): 'sent' | 'failed' => {
      if (!result.ok) console.error(`Proposal answer email failed: ${result.error}`);
      return result.ok ? 'sent' : 'failed';
    })
    .catch((err): 'failed' => {
      console.error('Proposal answer email failed', err);
      return 'failed';
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([send, new Promise<'slow'>((resolve) => (timer = setTimeout(() => resolve('slow'), PORTAL_NOTIFY_WAIT_MS)))]);
  clearTimeout(timer);
  return outcome;
}
