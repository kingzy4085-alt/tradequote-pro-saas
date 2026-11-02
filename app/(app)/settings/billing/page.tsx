import { notFound, redirect } from 'next/navigation';
import { Alert, PageHeader, Panel } from '@/components/ui';
import { getContext } from '@/lib/context';
import { hasRank } from '@/lib/roles';
import BillingActions from './billing-actions';

export const dynamic = 'force-dynamic';

const STATUS_TEXT: Record<string, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment past due',
  canceled: 'Cancelled',
  incomplete: 'Payment incomplete',
};

export default async function BillingPage({ searchParams }: { searchParams: { checkout?: string } }) {
  const result = await getContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;
  if (!hasRank(ctx.role, 4)) notFound();
  const c = ctx.company;

  const trialEnd = new Date(c.trial_ends_at);
  const detail =
    c.subscription_status === 'trialing'
      ? trialEnd > new Date()
        ? `Your trial ends ${trialEnd.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}.`
        : 'Your trial has ended. Subscribe to keep editing records.'
      : c.current_period_end
        ? `Current period ends ${new Date(c.current_period_end).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}.`
        : '';

  return (
    <>
      <PageHeader title="Billing" subtitle="One plan, every module, your whole crew." back={{ href: '/', label: 'Back to Command Center' }} />
      {searchParams.checkout === 'success' && (
        <div className="mb-6">
          <Alert tone="success">Thanks — your subscription is being activated. This page updates within a minute.</Alert>
        </div>
      )}
      {searchParams.checkout === 'cancelled' && (
        <div className="mb-6">
          <Alert tone="info">Checkout was cancelled. Nothing was charged.</Alert>
        </div>
      )}
      <Panel title="TradeQuote PRO">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</p>
        <p className="text-2xl font-bold text-white mt-1">{STATUS_TEXT[c.subscription_status] ?? c.subscription_status}</p>
        {detail && <p className="text-sm text-slate-400 mt-1">{detail}</p>}
        <ul className="mt-6 space-y-2 text-sm text-slate-300">
          <li>All 44 modules — field, estimating, project controls, finance and resources</li>
          <li>Unlimited team members with role-based access</li>
          <li>AI Assistant for Canadian code and construction questions (fair-use daily limit)</li>
          <li>Desktop, Android and iPhone install</li>
        </ul>
        <div className="mt-6">
          <BillingActions status={c.subscription_status} hasCustomer={!!c.stripe_customer_id} />
        </div>
      </Panel>
    </>
  );
}
