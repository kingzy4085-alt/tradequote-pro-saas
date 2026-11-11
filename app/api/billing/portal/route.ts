import { NextResponse } from 'next/server';
import { jsonError, requireApi } from '@/lib/api';
import { getStripe, withBillingIds } from '@/lib/billing';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

// Opens Stripe's customer portal: update card, download invoices, cancel.
export async function POST() {
  const ctx = await requireApi({ minRank: 4 });
  if (ctx instanceof Response) return ctx;
  const company = await withBillingIds(ctx);
  if (!company) return jsonError(503, 'Could not load your billing details. Try again in a moment.');
  if (!company.stripe_customer_id) return jsonError(400, 'Subscribe first to manage billing');
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: company.stripe_customer_id,
      return_url: `${env.siteUrl()}/settings/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Billing portal failed', err);
    return jsonError(502, 'Could not open billing. Try again shortly.');
  }
}
