import type { Metadata } from 'next';
import { env } from '@/lib/env';

/** Metadata for a public page: canonical URL, social card and the site base the card image resolves against. */
export function pageMeta({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const site = env.siteUrl();
  return {
    metadataBase: new URL(site),
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: 'TradeQuote PRO', title, description, url: path, locale: 'en_CA' },
    twitter: { card: 'summary_large_image', title, description },
  };
}
