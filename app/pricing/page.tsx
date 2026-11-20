import { pageMeta } from '@/components/marketing/seo';
import { env } from '@/lib/env';
import PricingView from './pricing-view';

export const metadata = pageMeta({
  title: 'Pricing: one flat CAD price and a 14-day free trial',
  description: 'Estimating, timecards, invoicing, safety sign-offs and job costing for Canadian electrical and industrial contractors. One flat CAD price and a 14-day free trial.',
  path: '/pricing',
});

// The page renders PricingView as it is: tests/support-contact.test.ts pins its footer as the last thing on the page.
export default function PricingPage() {
  return <PricingView supportEmail={env.supportEmail()} />;
}
