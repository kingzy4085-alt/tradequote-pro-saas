'use client';

import { useEffect, useState } from 'react';
import { TIERS, TIER_MONTHLY, TIER_NAMES, type Tier } from '@/lib/stripe';

interface Company {
  subscription_plan: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
}

const STATUS: Record<string, string> = { active: 'Active', trialing: 'Free trial', past_due: 'Payment overdue', canceled: 'Cancelled', unpaid: 'Unpaid', incomplete: 'Waiting for payment', none: 'No plan yet' };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export default function BillingPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => fetch('/api/company').then((r) => r.json()).then((j) => j.data && setCompany(j.data)).catch(() => setError('Could not load your plan.'));
  useEffect(() => {
    load();
    const q = new URLSearchParams(location.search).get('checkout');
    if (q === 'success') {
      setNotice('Thanks! Your subscription is being confirmed. This page updates in a few seconds.');
      // The webhook usually lands within seconds
      const t = window.setInterval(load, 3000);
      window.setTimeout(() => window.clearInterval(t), 30000);
      return () => window.clearInterval(t);
    }
    if (q === 'cancelled') setNotice('Checkout was cancelled. Nothing was charged.');
    const locked = new URLSearchParams(location.search).get('locked');
    if (locked) setNotice(`"${locked.replace(/-/g, ' ')}" isn't included in your current plan, or your free trial has ended. Choose a plan below, or use Manage billing to upgrade.`);
  }, []);

  async function go(url: string, body?: unknown) {
    setBusy(url);
    setError('');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (res.success) location.href = res.data.url;
    else { setError(res.error); setBusy(''); }
  }

  const status = company?.subscription_status || 'none';
  const subscribed = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(status) && !!company?.stripe_customer_id;
  const trialDays = company?.trial_ends_at ? Math.ceil((new Date(company.trial_ends_at).getTime() - Date.now()) / 86400000) : 0;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Billing</h1>
          <p className="text-slate-400 mt-1">Your TradeQuote PRO plan. Prices in CAD; cancel any time.</p>
        </div>
        {notice && <p className="bg-slate-900 border border-emerald-500/40 text-emerald-400 rounded-xl p-4 text-sm">{notice}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">Current plan</p>
            <p className="text-2xl font-bold text-white">{TIER_NAMES[company?.subscription_plan as Tier] || 'Free trial'}</p>
            <p className={`text-sm ${status === 'active' ? 'text-emerald-400' : status === 'past_due' || status === 'unpaid' ? 'text-red-400' : 'text-amber-400'}`}>
              {subscribed ? STATUS[status] || status : trialDays > 0 ? `Free trial: ${trialDays} day${trialDays === 1 ? '' : 's'} left` : 'Trial ended. Choose a plan to keep going.'}
              {subscribed && company?.current_period_end && ` · renews ${fmt(company.current_period_end)}`}
            </p>
          </div>
          {company?.stripe_customer_id && (
            <button onClick={() => go('/api/stripe/portal')} disabled={!!busy} className="self-start bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50">
              {busy === '/api/stripe/portal' ? 'Opening…' : 'Manage billing'}
            </button>
          )}
        </section>

        {!subscribed && (
          <>
            <div className="flex gap-2">
              {(['monthly', 'annual'] as const).map((i) => (
                <button key={i} onClick={() => setInterval(i)} className={`px-4 py-2 rounded-lg text-sm font-semibold ${interval === i ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
                  {i === 'monthly' ? 'Monthly' : 'Annual (2 months free)'}
                </button>
              ))}
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {TIERS.map((t) => (
                <div key={t} className={`bg-slate-900 border rounded-2xl p-6 flex flex-col ${t === 'crew' ? 'border-amber-500' : 'border-slate-800'}`}>
                  <p className="text-lg font-bold text-white">{TIER_NAMES[t]}</p>
                  <p className="text-3xl font-extrabold text-white mt-2">${interval === 'monthly' ? TIER_MONTHLY[t] : TIER_MONTHLY[t] * 10}<span className="text-sm font-normal text-slate-400"> / {interval === 'monthly' ? 'month' : 'year'}</span></p>
                  <button onClick={() => go('/api/stripe/checkout', { tier: t, interval })} disabled={!!busy} className="mt-6 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold py-3 rounded-xl">
                    {busy === '/api/stripe/checkout' ? 'Opening checkout…' : `Choose ${TIER_NAMES[t]}`}
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">See what each plan includes on the <a href="/pricing" className="text-amber-400">pricing page</a>. Payment is handled securely by Stripe.</p>
          </>
        )}
      </div>
    </main>
  );
}
