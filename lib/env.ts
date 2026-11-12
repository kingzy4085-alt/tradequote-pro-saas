// Server-side configuration. Each getter throws a clear error when a required
// variable is missing, instead of failing later with an opaque network error.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

// Conservative on purpose: whatever passes is safe to put after "mailto:" as it is
const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** The bare address from "help@x.ca" or "Support <help@x.ca>". Anything else, blank included, is no address. */
function emailAddress(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const address = (/<([^<>]*)>$/.exec(text)?.[1] ?? text).trim();
  return PLAIN_ADDRESS.test(address) ? address : undefined;
}

export const env = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  siteUrl: () => (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  stripeSecretKey: () => required('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: () => required('STRIPE_WEBHOOK_SECRET'),
  stripePriceId: () => required('STRIPE_PRICE_ID'),
  anthropicModel: () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  cronSecret: () => required('CRON_SECRET'),
  resendApiKey: () => required('RESEND_API_KEY'),
  emailFrom: () => required('EMAIL_FROM'),
  emailReplyTo: () => process.env.EMAIL_REPLY_TO || undefined,
  businessName: () => required('BUSINESS_NAME'),
  businessAddress: () => required('BUSINESS_MAILING_ADDRESS'),
  /** Signs unsubscribe links; falls back to CRON_SECRET so one secret is enough to start. */
  unsubscribeSecret: () => process.env.UNSUBSCRIBE_SECRET || required('CRON_SECRET'),
  /** Who hears when the daily automation fails or goes quiet. Optional: without one it is only logged. */
  operatorEmail: () => process.env.OPERATOR_EMAIL || process.env.EMAIL_REPLY_TO || undefined,
  /**
   * Where customers write for help: SUPPORT_EMAIL, else EMAIL_REPLY_TO. Optional: without one, error
   * screens tell people to contact the company that set up their account.
   */
  supportEmail: () => emailAddress(process.env.SUPPORT_EMAIL) ?? emailAddress(process.env.EMAIL_REPLY_TO),
};
