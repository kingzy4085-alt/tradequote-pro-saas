'use client';

import Link from 'next/link';
import { useState } from 'react';

const TIERS = [
  { name: 'Field', monthly: 99, users: 'Up to 5 users', features: ['Unlimited estimates & proposals', 'Daily logs & timecards', 'Safety & tailgate logs', 'Punch list'] },
  { name: 'Crew', monthly: 299, users: 'Up to 20 users', popular: true, features: ['Everything in Field', 'Job costing', 'Change orders, RFIs, submittals', 'LOTO permits', 'Progress billing', 'Crew schedule & tool crib'] },
  { name: 'Contractor', monthly: 699, users: 'Up to 60 users', features: ['Everything in Crew', 'Sub compliance (WCB & insurance)', 'Warranty, commissioning & cable testing', 'Priority support & guided onboarding'] },
];

const PAINS = [
  {
    role: 'The estimator',
    pain: '“I build the bid in a spreadsheet, re-type it into a proposal, and pray I didn’t fat-finger the markup.”',
    fix: 'Estimate once with your markup built in, then turn it into a clean, printable proposal from the same record.',
  },
  {
    role: 'The office',
    pain: '“Timecards on paper, change orders in someone’s inbox, and a sub’s WCB clearance expired last month.”',
    fix: 'Timecards, change orders, progress billing and sub compliance live together, by job — so billing day has everything.',
  },
  {
    role: 'The field crew',
    pain: '“The app was built for a desk. Tiny buttons, can’t read it in the sun, and I’ve got gloves on.”',
    fix: 'Big 48px touch targets, high-contrast screens, and daily, safety, tailgate and LOTO logs that take seconds.',
  },
];

const COMPARE = [
  ['Built for electrical & industrial shutdown work', 'yes', 'no', 'no'],
  ['LOTO permits, tailgate & cable-testing logs included', 'yes', 'add-on / custom', 'no'],
  ['WCB & insurance tracking for subs', 'yes', 'varies', 'manual'],
  ['Flat monthly price in CAD', 'yes', 'priced on construction volume', 'free, but costs you hours'],
  ['Running the same day, no implementation project', 'yes', 'weeks of setup', 'yes'],
  ['Works with gloves, in sunlight, on any phone', 'yes', 'partly', 'no'],
];

const FAQ = [
  ['Why not just use Procore or another big platform?', 'They are excellent for large general contractors — and priced and built for them. TradeQuote PRO is focused on electrical and industrial trade contractors, with a flat monthly price and the field logs your crews actually fill out.'],
  ['Is it built for Canada?', 'Yes. Prices are in CAD, and WCB tracking, LOTO permits and tailgate meetings are built in.'],
  ['Does it work on phones and tablets?', 'Yes. Install it from Chrome or Safari and it opens full-screen like any other app.'],
  ['What does the founding offer include?', 'The first 25 companies lock in 40% off their plan for as long as they stay subscribed, in exchange for honest feedback.'],
  ['When do I pay?', 'Every account starts with a 14-day free trial — no credit card. Subscribe from Billing when you are ready; if you don’t, your records stay readable.'],
  ['Is there an AI assistant?', 'Yes. Ask it Canadian code and construction questions; it searches current sources and cites them. It can also look things up in your own company’s records.'],
];

function Cell({ v }: { v: string }) {
  if (v === 'yes') return <span className="text-amber-400 font-bold">✓ Yes</span>;
  if (v === 'no') return <span className="text-slate-500">✕ No</span>;
  return <span className="text-slate-400">{v}</span>;
}

export default function PricingView() {
  const [annual, setAnnual] = useState(true);
  // `website` is a honeypot: hidden from people, filled in by bots
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', tier: 'Crew', website: '' });
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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Something went wrong');
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setState('error');
    }
  }

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500';
  const section = 'max-w-7xl mx-auto px-4 sm:px-8';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className={`${section} py-5 flex items-center justify-between`}>
        <Link href="/pricing" className="text-lg font-extrabold tracking-tight text-white">
          TradeQuote <span className="text-amber-500">PRO</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm font-semibold">
          <Link href="/about" className="text-slate-300 hover:text-white hidden sm:inline">About</Link>
          <Link href="/login" className="text-slate-300 hover:text-white">Sign in</Link>
          <Link href="/signup" className="bg-amber-500 hover:bg-amber-600 text-slate-950 px-4 py-2 rounded-lg">Start free trial</Link>
        </nav>
      </header>
      {/* Hero */}
      <section className={`${section} pt-16 pb-20 grid lg:grid-cols-2 gap-12 items-center`}>
        <div>
          <span className="inline-block bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-full text-xs font-semibold">
            Founding offer · 40% off for life · 25 spots
          </span>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-[1.05] mt-6">
            The job-site app built for <span className="text-amber-400">electrical & shutdown</span> contractors.
          </h1>
          <p className="text-lg text-slate-400 mt-6 max-w-xl">
            Bid faster, run cleaner jobs and get paid sooner — estimates, proposals, job costing, LOTO, safety logs and crew schedules in one app that works as hard in the field as it does in the office.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/signup" className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-6 py-3.5 rounded-xl transition-colors">Start my 14-day free trial</Link>
            <a href="#join" className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-6 py-3.5 rounded-xl border border-slate-700 transition-colors">Reserve a founding spot</a>
            <a href="#compare" className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-6 py-3.5 rounded-xl border border-slate-700 transition-colors">Compare to the big names</a>
          </div>
          <p className="text-sm text-slate-500 mt-4">No credit card. CAD pricing. Works on Windows, Android and iPhone.</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Command Center</p>
            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-full text-xs font-semibold">Live</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[['Estimates', 'Bids'], ['Job Costing', 'Margin'], ['LOTO', 'Permits'], ['Safety', 'Logs'], ['Crew', 'Schedule'], ['Billing', 'Progress']].map(([a, b]) => (
              <div key={a} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <p className="text-sm font-bold text-white">{a}</p>
                <p className="text-xs text-amber-400 mt-1">{b}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <span className="text-sm text-slate-300">44 modules · AI assistant · every device</span>
            <span className="text-amber-400 font-bold">→</span>
          </div>
        </div>
      </section>

      {/* Niche strip */}
      <section className="border-y border-slate-800 bg-slate-900/60">
        <div className={`${section} py-6 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm font-semibold text-slate-400 uppercase tracking-wider`}>
          {['Industrial shutdowns', 'Electrical contractors', 'Plant maintenance', 'Commercial electrical', 'Instrumentation'].map((n) => <span key={n}>{n}</span>)}
        </div>
      </section>

      {/* Pain points */}
      <section className={`${section} py-20`}>
        <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">The problem</p>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mt-2 max-w-3xl">Every role on the job loses hours to the same three headaches.</h2>
        <div className="grid md:grid-cols-3 gap-6 mt-10">
          {PAINS.map((p) => (
            <div key={p.role} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{p.role}</p>
              <p className="text-slate-300 italic mt-4">{p.pain}</p>
              <div className="border-t border-slate-800 mt-6 pt-4">
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">With TradeQuote PRO</p>
                <p className="text-white mt-2">{p.fix}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section id="compare" className="border-y border-slate-800 bg-slate-900/60">
        <div className={`${section} py-20`}>
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Why switch</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mt-2">Built for your trade — not adapted to it.</h2>
          <p className="text-slate-400 mt-3 max-w-2xl">The big construction platforms are built for general contractors and priced on construction volume. Spreadsheets are free until they cost you a bid. TradeQuote PRO sits in between.</p>
          <div className="mt-10 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="p-4"></th>
                  <th className="p-4 text-amber-400">TradeQuote PRO</th>
                  <th className="p-4">Enterprise suites</th>
                  <th className="p-4">Spreadsheets & paper</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {COMPARE.map(([f, a, b, c]) => (
                  <tr key={f}>
                    <td className="p-4 text-white font-medium">{f}</td>
                    <td className="p-4 bg-amber-500/5"><Cell v={a} /></td>
                    <td className="p-4"><Cell v={b} /></td>
                    <td className="p-4"><Cell v={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className={`${section} py-20`}>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Pricing</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mt-2">Flat pricing in Canadian dollars</h2>
            <p className="text-slate-400 mt-2">Founding customers lock in 40% off, for life.</p>
          </div>
          <div className="inline-flex bg-slate-900 border border-slate-800 rounded-xl p-1">
            {([['Monthly', false], ['Annual · 2 months free', true]] as const).map(([l, v]) => (
              <button key={l} onClick={() => setAnnual(v)} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${annual === v ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-6 mt-10">
          {TIERS.map((t) => (
            <div key={t.name} className={`bg-slate-900 rounded-2xl p-6 shadow-xl flex flex-col border ${t.popular ? 'border-amber-500' : 'border-slate-800'}`}>
              {t.popular && <span className="self-start bg-amber-500 text-slate-950 px-3 py-1 rounded-full text-xs font-semibold mb-3">Most popular</span>}
              <h3 className="text-xl font-bold text-white">{t.name}</h3>
              <p className="text-4xl font-extrabold text-white mt-4">${annual ? (t.monthly * 10).toLocaleString() : t.monthly}</p>
              <p className="text-xs text-slate-400">{annual ? 'CAD / year' : 'CAD / month'}</p>
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mt-4">{t.users}</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-300 flex-1">
                {t.features.map((f) => <li key={f}><span className="text-amber-400">✓</span> {f}</li>)}
              </ul>
              <a href="#join" onClick={() => setForm((f) => ({ ...f, tier: t.name }))} className={`mt-6 text-center font-semibold py-3 rounded-xl transition-colors ${t.popular ? 'bg-amber-500 hover:bg-amber-600 text-slate-950' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'}`}>
                {`Choose ${t.name}`}
              </a>
            </div>
          ))}
        </div>
        <p className="text-sm text-slate-400 mt-6">Enterprise from $1,500 / month · Extra users $19 / month · Guided onboarding $499 · Data import $750 · AI assistant included · Live supplier pricing coming soon.</p>
      </section>

      {/* Join */}
      <section id="join" className="border-y border-slate-800 bg-slate-900/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-20">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Founding 25</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mt-2">Lock in 40% off for life.</h2>
          <p className="text-slate-400 mt-2">No payment now. Join the list and we&apos;ll email you the founding discount for your plan.</p>
          {state === 'done' ? (
            <p className="mt-8 bg-slate-900 border border-emerald-500/50 rounded-2xl p-6 text-emerald-400 font-semibold">You&apos;re on the list! We&apos;ll be in touch about your {form.tier} account.</p>
          ) : (
            <form onSubmit={submit} className="mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl grid sm:grid-cols-2 gap-4">
              <input required className={input} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input required className={input} placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <input required type="email" className={input} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className={input} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" name="website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              <select aria-label="Plan" className={`${input} sm:col-span-2`} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                {['Field', 'Crew', 'Contractor', 'Enterprise'].map((t) => <option key={t}>{t}</option>)}
              </select>
              <p className="sm:col-span-2 text-xs text-slate-500">
                We only use these details to contact you about TradeQuote PRO. See our <Link href="/legal/privacy" className="underline">Privacy Policy</Link>.
              </p>
              {state === 'error' && <p className="sm:col-span-2 text-sm text-red-400">Couldn&apos;t save: {error}</p>}
              <button disabled={state === 'sending'} className="sm:col-span-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold py-3.5 rounded-xl">
                {state === 'sending' ? 'Saving…' : 'Reserve my founding spot'}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-8 py-20">
        <h2 className="text-3xl font-bold tracking-tight text-white">Questions</h2>
        <div className="mt-8 space-y-4">
          {FAQ.map(([q, a]) => (
            <details key={q} className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <summary className="cursor-pointer font-semibold text-white">{q}</summary>
              <p className="text-slate-400 mt-3 text-sm">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
