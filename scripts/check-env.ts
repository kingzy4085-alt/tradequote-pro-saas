// Checks a production deployment has its settings before Vercel builds it, so a missing key fails the
// deploy instead of the first customer's click. Reports names and rules only, never a value.
//
// Runs from `npm run build`. Production builds check every setting; Preview builds only check the public
// Supabase settings. Other builds are skipped. To try it by hand:
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

// The values .env.example ships with, which would otherwise pass as "set"
const isPlaceholder = (value: string) => value.includes('...') || /your[-_]/i.test(value);

const PREVIEW_REQUIRED = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

// Preview deployments need a working Supabase connection, but not the production-only integrations
export function checkPreviewEnv(env: Env): { problems: string[]; warnings: string[] } {
  const problems = PREVIEW_REQUIRED.filter((name) => !env[name]?.trim()).map((name) => `${name} is not set`);
  return { problems, warnings: [] };
}

export function checkProductionEnv(env: Env): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];

  for (const { name, rule } of REQUIRED) {
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

  if (env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    problems.push('SUPABASE_SERVICE_ROLE_KEY must not be the same as NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const warnings: string[] = [];

  if (!env.UNSUBSCRIBE_SECRET) {
    warnings.push('UNSUBSCRIBE_SECRET is not set, so CRON_SECRET signs unsubscribe links');
  } else if (env.UNSUBSCRIBE_SECRET === env.CRON_SECRET) {
    warnings.push('UNSUBSCRIBE_SECRET is the same as CRON_SECRET');
  }

  if (!env.OPERATOR_EMAIL && !env.EMAIL_REPLY_TO) {
    warnings.push('OPERATOR_EMAIL is not set, so nobody is emailed when the daily automation fails');
  }

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
    console.log(`check-env: ${preview ? 'preview' : 'production'} settings look right.`);
    return 0;
  }

  console.error('check-env: this build has settings to fix. See .env.example and the README.');
  for (const problem of problems) console.error(`  - ${problem}`);

  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = run(process.env, process.argv.slice(2));
}
