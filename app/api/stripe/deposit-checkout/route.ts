import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

export async function POST(req: Request) {
  try {
    const { proposalId } = await req.json();
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value; },
        },
      }
    );

    const { data: proposal, error } = await supabase
      .from('proposals')
      .select('*, companies(name)')
      .eq('id', proposalId)
      .single();

    if (error || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const totalAmount = Number(proposal.total_amount || 0);
    const depositPct = Number(proposal.deposit_percentage || 30);
    const depositAmount = Math.round(totalAmount * (depositPct / 100) * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: `Deposit (${depositPct}%) - Proposal #${proposal.proposal_number || proposalId}`,
              description: `Initial deposit for work by ${proposal.companies?.name || 'Trade Contractor'}`,
            },
            unit_amount: depositAmount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/proposals/${proposalId}?deposit=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/proposals/${proposalId}?deposit=cancelled`,
      metadata: { proposalId, type: 'proposal_deposit' },
    });

    await supabase
      .from('proposals')
      .update({ deposit_stripe_session_id: session.id })
      .eq('id', proposalId);

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}