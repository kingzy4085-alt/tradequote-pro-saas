import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    // '/$' is the root page only; everything not listed stays closed
    rules: { userAgent: '*', allow: ['/$', '/demo', '/tools', '/pricing', '/about', '/legal/'], disallow: '/' },
    sitemap: `${env.siteUrl()}/sitemap.xml`,
  };
}
