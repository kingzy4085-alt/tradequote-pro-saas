import { describe, expect, it } from 'vitest';
import { isPublicPath } from '@/middleware';
import { TRIAL_STEPS, dueStep, renderTrialEmail, unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from '@/lib/trial-emails';

const DAY = 86_400_000;
const created = new Date('2026-11-01T18:00:00Z');
const trialEnd = new Date(created.getTime() + 14 * DAY);
const at = (days: number) => new Date(created.getTime() + days * DAY + 60_000);

describe('trial email schedule', () => {
  it('sends the welcome email on day 0', () => {
    expect(dueStep(created, trialEnd, new Set(), at(0))?.id).toBe('welcome');
  });

  it('sends each step on its day, once', () => {
    expect(dueStep(created, trialEnd, new Set(['welcome']), at(1))).toBeNull();
    expect(dueStep(created, trialEnd, new Set(['welcome']), at(2))?.id).toBe('estimating');
    expect(dueStep(created, trialEnd, new Set(['welcome', 'estimating']), at(2))).toBeNull();
    expect(dueStep(created, trialEnd, new Set(['welcome', 'estimating']), at(5))?.id).toBe('field');
    expect(dueStep(created, trialEnd, new Set(['welcome', 'estimating', 'field']), at(13))?.id).toBe('ending');
  });

  it('skips missed steps instead of sending a backlog', () => {
    expect(dueStep(created, trialEnd, new Set(), at(10))?.id).toBe('compliance');
  });

  it('sends nothing after the trial ends', () => {
    expect(dueStep(created, trialEnd, new Set(), at(14))).toBeNull();
    expect(dueStep(created, new Date(created.getTime() + 3 * DAY), new Set(['welcome', 'estimating']), at(5))).toBeNull();
  });

  it('has unique ids, increasing days and the last email before day 14', () => {
    expect(new Set(TRIAL_STEPS.map((s) => s.id)).size).toBe(TRIAL_STEPS.length);
    TRIAL_STEPS.forEach((s, i) => i && expect(s.day).toBeGreaterThan(TRIAL_STEPS[i - 1].day));
    expect(TRIAL_STEPS.at(-1)!.day).toBeLessThan(14);
  });
});

describe('unsubscribe links', () => {
  it('verify only for the same address and secret', () => {
    const t = unsubscribeToken('Owner@Alpha.ca', 's3cret');
    expect(verifyUnsubscribeToken('owner@alpha.ca', t, 's3cret')).toBe(true);
    expect(verifyUnsubscribeToken('someone@else.ca', t, 's3cret')).toBe(false);
    expect(verifyUnsubscribeToken('owner@alpha.ca', t, 'other')).toBe(false);
    expect(verifyUnsubscribeToken('owner@alpha.ca', 'short', 's3cret')).toBe(false);
  });

  it('builds a link to the unsubscribe route', () => {
    expect(unsubscribeUrl('https://app.example.ca', 'a+b@c.ca', 'k')).toMatch(/^https:\/\/app\.example\.ca\/api\/email\/unsubscribe\?e=a%2Bb%40c\.ca&t=[A-Za-z0-9_-]{43}$/);
  });

  it('the job and unsubscribe routes are reachable without signing in', () => {
    expect(isPublicPath('/api/cron/trial-emails')).toBe(true);
    expect(isPublicPath('/api/email/unsubscribe')).toBe(true);
    expect(isPublicPath('/api/email/send')).toBe(false);
  });
});

describe('rendered email', () => {
  const email = renderTrialEmail({
    step: TRIAL_STEPS[0],
    name: 'Alex',
    company: 'Alpha <Electric> & Sons',
    siteUrl: 'https://app.example.ca',
    unsubscribeUrl: 'https://app.example.ca/api/email/unsubscribe?e=x&t=y',
    sender: { business: 'TradeQuote PRO Inc.', address: 'PO Box 123, Regina SK S4P 0A1' },
  });

  it('fills in the name and company', () => {
    expect(email.text).toContain('Hi Alex,');
    expect(email.text).toContain('Alpha <Electric> & Sons has 14 days');
  });

  it('includes the business, mailing address and unsubscribe link (CASL)', () => {
    for (const body of [email.text, email.html]) {
      expect(body).toContain('TradeQuote PRO Inc.');
      expect(body).toContain('PO Box 123, Regina SK S4P 0A1');
      expect(body).toContain('/api/email/unsubscribe?e=x');
    }
  });

  it('escapes HTML from company names', () => {
    expect(email.html).toContain('Alpha &lt;Electric&gt; &amp; Sons');
    expect(email.html).not.toContain('<Electric>');
  });
});
