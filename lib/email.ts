// Sends email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
// Any provider with an HTTP API would do; this is the only place that knows about it.

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  unsubscribeUrl: string;
}

export interface EmailConfig {
  apiKey: string;
  from: string;
  replyTo?: string;
}

export async function sendEmail(config: EmailConfig, email: OutgoingEmail): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: config.from,
        to: [email.to],
        reply_to: config.replyTo || undefined,
        subject: email.subject,
        text: email.text,
        html: email.html,
        // One-click unsubscribe in Gmail and Outlook
        headers: { 'List-Unsubscribe': `<${email.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
