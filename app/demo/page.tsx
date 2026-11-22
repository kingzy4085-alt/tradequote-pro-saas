import { Suspense } from 'react';
import { SiteShell } from '@/components/marketing/site-footer';
import { pageMeta } from '@/components/marketing/seo';
import DemoClient from './demo-client';

export const metadata = pageMeta({
  title: 'Live demo: price a job, get it signed, see what happens next',
  description: 'Walk through a real TradeQuote PRO quote in your browser: pick a job, size it with calculators, apply regional prices and labour, add markup and tax, and sign the client proposal. No signup.',
  path: '/demo',
});

export default function DemoPage() {
  return (
    <SiteShell>
      <Suspense fallback={<div className="min-h-[100dvh]" />}>
        <DemoClient />
      </Suspense>
    </SiteShell>
  );
}
