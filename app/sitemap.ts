import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

// Only the public marketing and legal pages; everything else is behind sign-in.
const PUBLIC_PAGES = ['/pricing', '/about', '/legal/terms', '/legal/privacy'];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = env.siteUrl();
  return PUBLIC_PAGES.map((path) => ({ url: `${site}${path}` }));
}
