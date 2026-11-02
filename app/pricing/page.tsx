'use client';

import { useState } from 'react';

const TIERS = [
  { name: 'Solo', monthly: 0, users: '1 user', features: ['10 estimates / month', 'Proposals & CRM'] },
  { name: 'Field', monthly: 99, users: 'Up to 5 users', features: ['Unlimited estimates & proposals', 'Daily logs & timecards', 'Safety & tailgate logs', 'Punch list'] },
  { name: 'Crew', monthly: 299, users: 'Up to 20 users', popular: true, features: ['Everything in Field', 'Job costing', 'Change orders, RFIs, submittals', 'LOTO permits', 'Progress billing', 'Crew schedule & tool crib'] },
  { name: 'Contractor', monthly: 699, users: 'Up to 60 users', features: ['Everything in Crew', 'Sub compliance (WCB)', 'Warranty & commissioning', 'Priority support & onboarding'] },
];

const PAINS = [
  ['Estimators', 'Estimate once, apply markup, send a clean proposal from the same record.'],
  ['Office & admin', 'Timecards, change orders, billing and WCB compliance in one place.'],
  ['Field crews', 'Big touch targets and high-contrast screens built for gloves and sunlight.'],
];

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', tier: 'Crew' });
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, billing: annual ? 'annual' : 'monthly' }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Something went wrong');
      setState('done');
    } catch (err: any) {
      setError(err.message);
      setState('error');
    }
  }

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-6 sm:px-8">
      <div className="max-w-7xl mx-auto">
        <header className="py-6 flex items-center justify-between">
          <span className="text-lg font-extrabold tracking-tight text-white">TradeQuote PRO</span>
          <a href="#join" className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-4 py-2.5 rounded-lg transition-colors">Join founding list</a>
        </header>

        <section className="py-16 max-w-3xl">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-4">For Canadian electrical & industrial contractors</p>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white">Bid it, run it, bill it — without the Procore price tag.</h1>
          <p className="text-lg text-slate-400 mt-6">Estimates, proposals, job costing, safety logs, LOTO permits and crew schedules in one app your office and field crews will actually use.</p>
        </section>

        <section className="grid md:grid-cols-3 gap-6 pb-16">
          {PAINS.map(([role, fix]) => (
            <div key={role} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">{role}</p>
              <p className="text-white mt-3">{fix}</p>
            </div>
          ))}
        </section>

        <section id="pricing" className="pb-16">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-white">Pricing in Canadian dollars</h2>
              <p className="text-slate-400 mt-2">Founding customers lock in 40% off, for life.</p>
            </div>
            <button onClick={() => setAnnual(!annual)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-4 py-2.5 rounded-lg border border-slate-700">
              {annual ? 'Showing annual (2 months free)' : 'Showing monthly'} · switch
            </button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
            {TIERS.map((t) => (
              <div key={t.name} className={`bg-slate-900 rounded-2xl p-6 shadow-xl flex flex-col border ${t.popular ? 'border-amber-500' : 'border-slate-800'}`}>
                {t.popular && <span className="self-start bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-full text-xs font-semibold mb-3">Most popular</span>}
                <h3 className="text-xl font-bold text-white">{t.name}</h3>
                <p className="text-4xl font-extrabold text-white mt-4">${annual && t.monthly ? (t.monthly * 10).toLocaleString() : t.monthly}</p>
                <p className="text-xs text-slate-400">{t.monthly === 0 ? 'free forever' : annual ? 'CAD / year' : 'CAD / month'}</p>
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mt-4">{t.users}</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-300 flex-1">
                  {t.features.map((f) => <li key={f}>✓ {f}</li>)}
                </ul>
                <a href="#join" onClick={() => setForm((f) => ({ ...f, tier: t.name }))} className={`mt-6 text-center font-semibold py-3 rounded-xl transition-colors ${t.popular ? 'bg-amber-500 hover:bg-amber-600 text-slate-950' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'}`}>
                  Choose {t.name}
                </a>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-400 mt-6">Enterprise from $1,500 / month · Extra users $19 / month · Onboarding $499 · Data import $750 · AI estimator and live material pricing coming soon.</p>
        </section>

        <section id="join" className="pb-20 max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-white">Join the founding 25</h2>
          <p className="text-slate-400 mt-2">No payment now. We&apos;ll contact you to set up your account.</p>
          {state === 'done' ? (
            <p className="mt-6 bg-slate-900 border border-emerald-500/50 rounded-2xl p-6 text-emerald-400 font-semibold">You&apos;re on the list! We&apos;ll be in touch.</p>
          ) : (
            <form onSubmit={submit} className="mt-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl grid sm:grid-cols-2 gap-4">
              <input required className={input} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input required className={input} placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <input required type="email" className={input} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className={input} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <select className={`${input} sm:col-span-2`} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                {['Solo', 'Field', 'Crew', 'Contractor', 'Enterprise'].map((t) => <option key={t}>{t}</option>)}
              </select>
              {state === 'error' && <p className="sm:col-span-2 text-sm text-red-400">Couldn&apos;t save: {error}</p>}
              <button disabled={state === 'sending'} className="sm:col-span-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold py-3 rounded-xl">
                {state === 'sending' ? 'Saving…' : 'Reserve my founding spot'}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
