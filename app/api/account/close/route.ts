import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { getStripe, withBillingIds } from '@/lib/billing';
import { cancelCompanySubscriptions, mayStillBill, removeCompanyFiles } from '@/lib/company-closure';

export const dynamic = 'force-dynamic';
// Stripe, the stored files and the delete, one after another
export const maxDuration = 60;

const WRONG_NAME = 'Type the company name exactly as it is shown to confirm.';

/** Stripe, when this server has a key for it. */
function stripeIfConfigured(): Stripe | null {
  return process.env.STRIPE_SECRET_KEY ? getStripe() : null;
}

// The owner only: closes the company account for good. Not limited to a company that can still
// make changes: a company whose trial or subscription has ended can always leave.
// Order matters: nothing is deleted until billing has stopped, and a mistyped name stops everything.
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: 5 });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 2_000);
  } catch {
    return jsonError(400, 'Invalid request');
  }
  const typed = (body as { confirm_name?: unknown } | null)?.confirm_name;
  const confirmName = typeof typed === 'string' ? typed : '';

  // The database checks the name again; checking here first means a typo never reaches Stripe
  const { data: company, error: readError } = await ctx.supabase.from('companies').select('name').eq('id', ctx.company.id).maybeSingle();
  if (readError) return dbError(readError, 'loading the company');
  if (!company) return jsonError(404, 'Not found');
  if (confirmName !== (company as { name: string }).name) return jsonError(400, WRONG_NAME);

  // 1. Billing stops first
  const billing = await withBillingIds(ctx);
  if (!billing) return jsonError(503, 'Could not load your billing details, so nothing was deleted. Try again in a moment.');
  let stripe: Stripe | null;
  try {
    stripe = stripeIfConfigured();
  } catch (err) {
    console.error('Stripe is not configured', err);
    stripe = null;
  }
  if (!stripe && mayStillBill(billing)) {
    return jsonError(409, 'This company still has a subscription, and billing is not connected here, so it cannot be cancelled. Nothing was deleted. Contact support to close the account.');
  }
  let cancelled: string[] = [];
  if (stripe && (billing.stripe_customer_id || billing.stripe_subscription_id)) {
    try {
      cancelled = await cancelCompanySubscriptions(stripe, billing);
    } catch (err) {
      console.error('Could not cancel the subscription while closing a company', err);
      return jsonError(502, 'Your subscription could not be cancelled with Stripe just now, so nothing was deleted. Try again in a few minutes.');
    }
  }

  // 2. The stored files the owner may remove. Files the storage rules protect stay, and are counted.
  const files = await removeCompanyFiles(ctx.supabase, ctx.company.id);

  // 3. The company and every row it owns
  const { error: closeError } = await ctx.supabase.rpc('close_company', { p_confirm_name: confirmName });
  if (closeError) {
    if (['42501', '22023', 'P0002'].includes(closeError.code ?? '')) return dbError(closeError, 'closing the company account');
    console.error('Could not close the company account', closeError);
    return jsonError(
      500,
      cancelled.length
        ? 'Your subscription was cancelled, so there will be no more charges, but the company account could not be closed. Try again in a moment.'
        : 'The company account could not be closed. Try again in a moment.'
    );
  }
  if (files.left.length || !files.complete) {
    // Nobody signed in can open these any more. Listed for whoever clears storage with the service key.
    console.warn(`Closed company ${ctx.company.id}: ${files.left.length} stored files could not be removed${files.complete ? '' : ', and some folders were not checked'}`, files.left);
  }

  // 4. Signed out everywhere: the account they were signed in to is gone
  try {
    const { error } = await ctx.supabase.auth.signOut();
    if (error) console.error('Sign-out after closing the company failed', error);
  } catch (err) {
    console.error('Sign-out after closing the company failed', err);
  }

  return NextResponse.json({
    data: {
      closed: true,
      subscriptions_cancelled: cancelled.length,
      files_removed: files.removed,
      files_left: files.left.length,
      files_checked: files.complete,
    },
  });
}
