import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: ['/pricing', '/about', '/legal/'], disallow: '/' },
    sitemap: `${env.siteUrl()}/sitemap.xml`,
  };
}
