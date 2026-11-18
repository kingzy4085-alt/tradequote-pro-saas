// The support contact: where the address comes from, and every screen that shows it. Error screens link
// to it when it is set and say who else to ask when it is not. The help page and the pricing page add it
// only when it is set, and otherwise stay exactly as they were.
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  usePathname: () => '/',
}));

import AppError from '@/app/(app)/error';
import HelpPage from '@/app/(app)/help/page';
import RootError from '@/app/error';
import GlobalError from '@/app/global-error';
import NotFound from '@/app/not-found';
import PricingPage from '@/app/pricing/page';
import PricingView from '@/app/pricing/pricing-view';
import { SupportEmailProvider } from '@/components/support-contact';
import { env } from '@/lib/env';
import { checkProductionEnv } from '../scripts/check-env.ts';

const ADDRESS = 'help@tradequote.example';
const FALLBACK = 'Contact the company that set up your account';
const error = Object.assign(new Error('Something broke'), { digest: '4242' });
const reset = () => {};

afterEach(() => vi.unstubAllEnvs());

/** Blank counts as not set, which is how an untouched .env.example leaves them. */
function configure(support = '', replyTo = '') {
  vi.stubEnv('SUPPORT_EMAIL', support);
  vi.stubEnv('EMAIL_REPLY_TO', replyTo);
}

/** As the root layout renders every page: the address from the server, handed down to the error screens. */
const inLayout = (email: string | undefined, screen: ReactElement) => renderToStaticMarkup(createElement(SupportEmailProvider, { email, children: screen }));

const mailtoClasses = (html: string) => [...html.matchAll(/<a href="mailto:[^"]*" class="([^"]*)"/g)].map((m) => m[1]);

describe('the support address', () => {
  it('is SUPPORT_EMAIL, else EMAIL_REPLY_TO, else nothing', () => {
    configure('help@alpha.ca', 'reply@alpha.ca');
    expect(env.supportEmail()).toBe('help@alpha.ca');
    configure('', 'reply@alpha.ca');
    expect(env.supportEmail()).toBe('reply@alpha.ca');
    configure();
    expect(env.supportEmail()).toBeUndefined();
    configure('   ', '  ');
    expect(env.supportEmail()).toBeUndefined();
  });

  it('takes the address out of a display name, as EMAIL_REPLY_TO is often written', () => {
    configure(' TradeQuote Support <help@alpha.ca> ');
    expect(env.supportEmail()).toBe('help@alpha.ca');
    configure('', 'Alpha Office <office@alpha.ca>');
    expect(env.supportEmail()).toBe('office@alpha.ca');
  });

  it('is never something that would make a broken or unsafe link', () => {
    for (const bad of ['call us', 'help@', 'help@alpha', 'help@alpha.ca?bcc=x@y.ca', 'javascript:alert(1)//@alpha.ca', '"><script>x</script>@alpha.ca', 'a b@alpha.ca']) {
      configure(bad);
      expect(env.supportEmail(), bad).toBeUndefined();
    }
    // A setting that is not an address gives way to the next one
    configure('ask the office', 'reply@alpha.ca');
    expect(env.supportEmail()).toBe('reply@alpha.ca');
  });

  it('is listed, optional, in .env.example and the README', () => {
    expect(readFileSync('.env.example', 'utf8')).toMatch(/^# SUPPORT_EMAIL=\r?$/m);
    expect(readFileSync('README.md', 'utf8')).toContain('| `SUPPORT_EMAIL` |');
    // A production deploy never fails for want of it, even with nothing else set
    expect(checkProductionEnv({}).problems.join('\n')).not.toContain('SUPPORT_EMAIL');
  });
});

describe('error screens', () => {
  const boundaries = [
    ['app/(app)/error.tsx', AppError],
    ['app/error.tsx', RootError],
  ] as const;

  it.each(boundaries)('%s links to the support address when it is set', (_file, Screen) => {
    const html = inLayout(ADDRESS, createElement(Screen, { error, reset }));
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Reference: 4242');
    // The reference goes in the subject, so the email can be matched to the logged report
    expect(html).toContain(`href="mailto:${ADDRESS}?subject=TradeQuote%20PRO%20error%2C%20reference%204242"`);
    expect(html).toContain(`>${ADDRESS}</a>`);
    expect(html).toContain('Still not working? Email ');
    expect(html).not.toContain(FALLBACK);
  });

  it.each(boundaries)('%s says who to ask when no address is set', (_file, Screen) => {
    const html = inLayout(undefined, createElement(Screen, { error, reset }));
    expect(html).toContain(`Still not working? ${FALLBACK}.`);
    expect(html).not.toContain('mailto:');
  });

  it('a screen with no reference still links, with a plain subject', () => {
    const html = inLayout(ADDRESS, createElement(AppError, { error: new Error('No digest'), reset }));
    expect(html).toContain(`href="mailto:${ADDRESS}?subject=TradeQuote%20PRO%20error"`);
    expect(html).not.toContain('Reference');
  });

  it('the global error screen, which replaces the root layout, uses the address the layout last had', () => {
    inLayout(ADDRESS, createElement('div'));
    const html = renderToStaticMarkup(createElement(GlobalError, { error, reset }));
    expect(html.startsWith('<html')).toBe(true);
    expect(html).toContain(`href="mailto:${ADDRESS}?subject=`);
    expect(html).not.toContain(FALLBACK);

    inLayout(undefined, createElement('div'));
    const without = renderToStaticMarkup(createElement(GlobalError, { error, reset }));
    expect(without).toContain(FALLBACK);
    expect(without).not.toContain('mailto:');
  });

  it('the not-found screen links to the support address when it is set, and says who to ask when not', () => {
    configure(ADDRESS);
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toContain(`href="mailto:${ADDRESS}?subject=TradeQuote%20PRO%20page%20not%20found"`);
    expect(html).not.toContain(FALLBACK);
    configure();
    const without = renderToStaticMarkup(createElement(NotFound));
    expect(without).toContain(`Think this page should be here? ${FALLBACK}.`);
    expect(without).not.toContain('mailto:');
  });

  it('the address is shown as text, never as markup', () => {
    const html = inLayout('<img src=x onerror=alert(1)>', createElement(AppError, { error, reset }));
    expect(html).not.toContain('<img');
  });

  it('the root layout hands the server address to every error screen below it', () => {
    expect(readFileSync('app/layout.tsx', 'utf8')).toContain('<SupportEmailProvider email={env.supportEmail()}>{children}</SupportEmailProvider>');
    // Error boundaries render the shared view, which reads the address and reports the error
    for (const file of ['app/(app)/error.tsx', 'app/error.tsx', 'app/global-error.tsx']) expect(readFileSync(file, 'utf8'), file).toContain('<ErrorView error={error} reset={reset} />');
  });
});

describe('the help page', () => {
  it('ends with the support address when one is set', () => {
    configure(ADDRESS);
    const html = renderToStaticMarkup(createElement(HelpPage));
    expect(html).toContain('Need help?');
    expect(html).toContain(`href="mailto:${ADDRESS}?subject=TradeQuote%20PRO%20help"`);
  });

  it('adds nothing when none is set', () => {
    configure();
    const html = renderToStaticMarkup(createElement(HelpPage));
    expect(html).not.toContain('Need help?');
    expect(html).not.toContain('mailto:');
  });
});

describe('the pricing page', () => {
  it('has a footer with the support address when one is set', () => {
    configure(ADDRESS);
    const html = renderToStaticMarkup(createElement(PricingPage));
    const footer = html.slice(html.indexOf('<footer'));
    expect(html.indexOf('<footer')).toBeGreaterThan(html.indexOf('Questions</h2>'));
    expect(footer).toContain('Questions before you start? Email ');
    expect(footer).toContain(`href="mailto:${ADDRESS}?subject=TradeQuote%20PRO%20question"`);
    expect(footer).toMatch(/<\/footer><\/main>$/);
  });

  it('stays exactly as it was when none is set', () => {
    configure();
    const html = renderToStaticMarkup(createElement(PricingPage));
    expect(html).not.toContain('<footer');
    expect(html).not.toContain('mailto:');
    expect(html).toBe(renderToStaticMarkup(createElement(PricingView)));
  });
});

describe('touch targets', () => {
  it('every support link is 48px tall on a phone', () => {
    configure(ADDRESS);
    const pages = [
      inLayout(ADDRESS, createElement(AppError, { error, reset })),
      renderToStaticMarkup(createElement(NotFound)),
      renderToStaticMarkup(createElement(HelpPage)),
      renderToStaticMarkup(createElement(PricingPage)),
    ];
    const classes = pages.flatMap(mailtoClasses);
    expect(classes).toHaveLength(pages.length);
    for (const cls of classes) expect(cls).toContain('min-h-[48px] lg:min-h-0');
  });
});
