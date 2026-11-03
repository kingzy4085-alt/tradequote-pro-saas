// Server-side configuration. Each getter throws a clear error when a required
// variable is missing, instead of failing later with an opaque network error.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
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
};
