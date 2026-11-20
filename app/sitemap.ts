import type { MetadataRoute } from 'next';
import { CALCULATORS } from '@/lib/calc/registry';
import { env } from '@/lib/env';

// Only the public marketing, tool and legal pages; everything else is behind sign-in.
const PUBLIC_PAGES = ['/', '/demo', '/tools', '/pricing', '/about', '/legal/terms', '/legal/privacy'];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = env.siteUrl();
  return [...PUBLIC_PAGES, ...CALCULATORS.map((c) => `/tools/${c.id}`)].map((path) => ({ url: `${site}${path === '/' ? '' : path}` }));
}
