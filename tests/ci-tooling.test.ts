import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkProductionEnv, run } from '../scripts/check-env.ts';
import { migrationProblems, MIGRATIONS_DIR } from '../scripts/check-migrations.ts';

const GOOD = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-value',
  NEXT_PUBLIC_SITE_URL: 'https://app.tradequote.example',
  STRIPE_SECRET_KEY: 'sk_live_value',
  STRIPE_WEBHOOK_SECRET: 'whsec_value',
  STRIPE_PRICE_ID: 'price_value',
  ANTHROPIC_API_KEY: 'anthropic-value',
  CRON_SECRET: 'c'.repeat(32),
  UNSUBSCRIBE_SECRET: 'u'.repeat(32),
  RESEND_API_KEY: 'resend-value',
  EMAIL_FROM: 'TradeQuote PRO <hello@tradequote.example>',
  BUSINESS_NAME: 'Acme Ltd.',
  BUSINESS_MAILING_ADDRESS: 'PO Box 1, Regina SK',
  OPERATOR_EMAIL: 'ops@tradequote.example',
};

describe('check-env', () => {
  it('passes complete production settings', () => {
    expect(checkProductionEnv(GOOD)).toEqual({ problems: [], warnings: [] });
  });

  it('names everything that is missing', () => {
    const { problems } = checkProductionEnv({});
    expect(problems).toContain('STRIPE_SECRET_KEY is not set');
    expect(problems).toContain('CRON_SECRET is not set');
    expect(problems).toHaveLength(13);
  });

  it.each([
    ['NEXT_PUBLIC_SITE_URL', 'http://app.tradequote.example', 'https'],
    ['NEXT_PUBLIC_SITE_URL', 'https://localhost:3000', 'this computer'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'not a url', 'https'],
    ['STRIPE_SECRET_KEY', 'sk_test_value', 'sk_live_'],
    ['STRIPE_WEBHOOK_SECRET', 'value', 'whsec_'],
    ['STRIPE_PRICE_ID', 'value', 'price_'],
    ['CRON_SECRET', 'short', '32'],
    ['STRIPE_PRICE_ID', 'price_...', 'example value'],
    ['EMAIL_FROM', 'TradeQuote PRO <hello@your-domain.ca>', 'example value'],
  ])('refuses %s = %s', (name, value, reason) => {
    const { problems } = checkProductionEnv({ ...GOOD, [name]: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
    expect(problems[0]).toContain(reason);
  });

  it('refuses the anon key used as the service key', () => {
    expect(checkProductionEnv({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: GOOD.NEXT_PUBLIC_SUPABASE_ANON_KEY }).problems).toHaveLength(1);
  });

  it('warns, without failing, about a shared unsubscribe secret and no operator', () => {
    const { problems, warnings } = checkProductionEnv({ ...GOOD, UNSUBSCRIBE_SECRET: GOOD.CRON_SECRET, OPERATOR_EMAIL: undefined });
    expect(problems).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it('only runs for a Vercel production build, or when forced', () => {
    expect(run({}, [])).toBe(0);
    expect(run({ VERCEL_ENV: 'preview' }, [])).toBe(0);
    expect(run({ VERCEL_ENV: 'production' }, [])).toBe(1);
    expect(run({}, ['--force'])).toBe(1);
    expect(run({ ...GOOD, VERCEL_ENV: 'production' }, [])).toBe(0);
  });

  it('as a real command, fails the build and prints no value', () => {
    const value = 'sk_test_DO_NOT_PRINT_THIS';
    const result = spawnSync(process.execPath, ['scripts/check-env.ts'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, VERCEL_ENV: 'production', STRIPE_SECRET_KEY: value, CRON_SECRET: 'DO_NOT_PRINT_THIS_EITHER' } as unknown as NodeJS.ProcessEnv,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('RESEND_API_KEY is not set');
    expect(result.stderr).toContain('STRIPE_SECRET_KEY must start with');
    expect(result.stdout + result.stderr).not.toContain('DO_NOT_PRINT');
  });

  it('an untouched .env.example fails every required setting', () => {
    const example = Object.fromEntries(
      [...readFileSync('.env.example', 'utf8').matchAll(/^([A-Z_0-9]+)=(.*?)\r?$/gm)].map((m) => [m[1], m[2]]),
    );
    expect(checkProductionEnv(example).problems).toHaveLength(13);
  });
});

describe('check-migrations', () => {
  it('passes unique versions', () => {
    expect(migrationProblems(['20261101000000_a.sql', '20261101000100_b.sql'])).toEqual([]);
  });

  it('fails on a duplicate version and names both files', () => {
    const [problem, ...rest] = migrationProblems(['20261101000100_a.sql', '20261101000100_b.sql']);
    expect(rest).toEqual([]);
    expect(problem).toContain('20261101000100_a.sql and 20261101000100_b.sql');
  });

  it('fails on a file with no version', () => {
    expect(migrationProblems(['fix.sql', '2026_short.sql'])).toHaveLength(2);
  });

  it('the real migrations pass', () => {
    expect(migrationProblems(readdirSync(MIGRATIONS_DIR))).toEqual([]);
  });
});

describe('the CI workflow', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

  it.each(['pull_request:', 'push:', 'node-version-file: .nvmrc', 'npm ci', 'npm run db:check', 'npm run typecheck', 'npm test', 'npm run build', 'gitleaks/gitleaks-action'])('has %s', (step) => {
    expect(ci).toContain(step);
  });

  it('lets only the audit fail without failing the run', () => {
    expect(ci.match(/continue-on-error: true/g)).toHaveLength(1);
    expect(ci).toMatch(/continue-on-error: true\s+run: npm audit --audit-level=high/);
  });

});

describe('the build', () => {
  it('checks production settings before building', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(scripts.build).toBe('node scripts/check-env.ts && next build');
  });
});
