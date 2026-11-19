// Checks a Vercel deployment has its settings before it builds, so a missing key fails the deploy
// instead of the first customer's click. Reports names and rules only, never a value.
//
// Runs from `npm run build`. Production builds need every setting below. Preview builds only need the
// public Supabase sign-in settings, so a preview can't look healthy while nobody can sign in.
// Anything else (local, CI) is skipped. To try it by hand:
//   node --env-file=.env.local scripts/check-env.ts --force
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Env = Record<string, string | undefined>;
type Rule = (value: string) => string | null;

const startsWith =
  (...prefixes: string[]): Rule =>
  (value) =>
    prefixes.some((p) => value.startsWith(p)) ? null : `must start with ${prefixes.join(' or ')}`;

const publicHttps: Rule = (value) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'must be a full https:// address';
  }
  if (url.protocol !== 'https:') return 'must be a full https:// address';
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'must not point at this computer';
  return null;
};

const atLeast =
  (length: number): Rule =>
  (value) =>
    value.length >= length ? null : `must be at least ${length} characters`;

const REQUIRED: Array<{ name: string; rule?: Rule }> = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', rule: publicHttps },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY' },
  { name: 'NEXT_PUBLIC_SITE_URL', rule: publicHttps },
  { name: 'STRIPE_SECRET_KEY', rule: startsWith('sk_live_', 'rk_live_') },
  { name: 'STRIPE_WEBHOOK_SECRET', rule: startsWith('whsec_') },
  { name: 'STRIPE_PRICE_ID', rule: startsWith('price_') },
  { name: 'ANTHROPIC_API_KEY' },
  { name: 'GEMINI_API_KEY' },
  { name: 'CRON_SECRET', rule: atLeast(32) },
  { name: 'RESEND_API_KEY' },
  { name: 'EMAIL_FROM' },
  { name: 'BUSINESS_NAME' },
  { name: 'BUSINESS_MAILING_ADDRESS' },
];

// Preview builds only need what sign-in cannot work without
const PREVIEW_REQUIRED = REQUIRED.filter(({ name }) => name === 'NEXT_PUBLIC_SUPABASE_URL' || name === 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

// Text-message settings go together: a half-filled set would make every send fail
const TWILIO_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'] as const;
const e164: Rule = (value) => (/^\+[1-9]\d{7,14}$/.test(value) ? null : 'must be a phone number like +13065550123');

// The values .env.example ships with, which would otherwise pass as "set"
const isPlaceholder = (value: string) => value.includes('...') || /your[-_]/i.test(value);

function checkRequired(env: Env, required: Array<{ name: string; rule?: Rule }>): string[] {
  const problems: string[] = [];
  for (const { name, rule } of required) {
    const value = env[name]?.trim();
    if (!value) {
      problems.push(`${name} is not set`);
    } else if (isPlaceholder(value)) {
      problems.push(`${name} is still the example value`);
    } else {
      const broken = rule?.(value);
      if (broken) problems.push(`${name} ${broken}`);
    }
  }
  return problems;
}

/** Preview builds: only the public Supabase sign-in settings are required. */
export function checkPreviewEnv(env: Env): { problems: string[]; warnings: string[] } {
  return { problems: checkRequired(env, PREVIEW_REQUIRED), warnings: [] };
}

export function checkProductionEnv(env: Env): { problems: string[]; warnings: string[] } {
  const problems = checkRequired(env, REQUIRED);
  const twilioSet = TWILIO_KEYS.filter((name) => env[name]?.trim());
  if (twilioSet.length > 0) {
    problems.push(...checkRequired(env, TWILIO_KEYS.map((name) => ({ name, rule: name === 'TWILIO_PHONE_NUMBER' ? e164 : undefined }))));
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    problems.push('SUPABASE_SERVICE_ROLE_KEY must not be the same as NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const warnings: string[] = [];
  if (twilioSet.length === 0) warnings.push('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER are not set, so texting proposals to clients will not work');
  if (!env.UNSUBSCRIBE_SECRET) warnings.push('UNSUBSCRIBE_SECRET is not set, so CRON_SECRET signs unsubscribe links');
  else if (env.UNSUBSCRIBE_SECRET === env.CRON_SECRET) warnings.push('UNSUBSCRIBE_SECRET is the same as CRON_SECRET');
  if (!env.OPERATOR_EMAIL && !env.EMAIL_REPLY_TO) warnings.push('OPERATOR_EMAIL is not set, so nobody is emailed when the daily automation fails');
  return { problems, warnings };
}

export function run(env: Env, args: string[]): number {
  const preview = env.VERCEL_ENV === 'preview' && !args.includes('--force');
  if (env.VERCEL_ENV !== 'production' && !preview && !args.includes('--force')) {
    console.log('check-env: skipped, this is not a Vercel preview or production build.');
    return 0;
  }
  const { problems, warnings } = preview ? checkPreviewEnv(env) : checkProductionEnv(env);
  for (const warning of warnings) console.warn(`check-env warning: ${warning}`);
  if (problems.length === 0) {
    console.log(`check-env: ${preview ? 'preview sign-in' : 'production'} settings look right.`);
    return 0;
  }
  console.error('check-env: this build has settings to fix. See .env.example and the README.');
  for (const problem of problems) console.error(`  - ${problem}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = run(process.env, process.argv.slice(2));
}
