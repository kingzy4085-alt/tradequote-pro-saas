'use client';

import { useEffect, useState } from 'react';

// Company profile and estimating defaults, saved to your company's record
const DEFAULTS = { company_name: '', contact: '', phone: '', email: '', address: '', province: 'SK', default_markup: '15', default_tax: '5', default_labour_rate: '0', default_terms: '' };
type Fields = typeof DEFAULTS;

export default function SettingsPage() {
  const [s, setS] = useState<Fields>(DEFAULTS);
  const [status, setStatus] = useState('');
  const [db, setDb] = useState('checking…');

  useEffect(() => {
    fetch('/api/company').then((r) => r.json()).then((j) => {
      if (!j.data) return;
      const next = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS) as (keyof Fields)[]) if (j.data[k] != null) next[k] = String(j.data[k]);
      setS(next);
    }).catch(() => {});
    fetch('/api/health').then((r) => r.json()).then((j) => setDb(j.database)).catch(() => setDb('offline'));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus('Saving…');
    const res = await fetch('/api/company', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, default_markup: Number(s.default_markup) || 0, default_tax: Number(s.default_tax) || 0, default_labour_rate: Number(s.default_labour_rate) || 0 }),
    }).then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    setStatus(res.success ? 'Saved' : `Not saved: ${res.error}`);
    if (res.success) setTimeout(() => setStatus(''), 2500);
  }

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500';
  const label = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';
  const field = (k: keyof Fields, l: string, type = 'text') => (
    <div>
      <label className={label} htmlFor={k}>{l}</label>
      <input id={k} type={type} className={input} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
          <p className="text-slate-400 mt-1">Your company details and defaults.</p>
        </div>

        <form onSubmit={save} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-lg font-bold text-white mb-4">Company profile</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {field('company_name', 'Company name')}
            {field('contact', 'Main contact')}
            {field('phone', 'Phone', 'tel')}
            {field('email', 'Email', 'email')}
            {field('address', 'Address')}
            <div>
              <label className={label} htmlFor="province">Province</label>
              <select id="province" className={input} value={s.province} onChange={(e) => setS({ ...s, province: e.target.value })}>
                {['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <h2 className="text-lg font-bold text-white mt-8 mb-4">Estimating defaults</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {field('default_markup', 'Default markup %', 'number')}
            {field('default_tax', 'Sales tax %', 'number')}
            {field('default_labour_rate', 'Labour rate ($/hr)', 'number')}
          </div>
          <div className="mt-4">
            <label className={label} htmlFor="default_terms">Proposal terms</label>
            <textarea id="default_terms" rows={4} className={input} value={s.default_terms} onChange={(e) => setS({ ...s, default_terms: e.target.value })} />
          </div>
          <div className="flex items-center gap-4 mt-6">
            <button className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-6 py-3 rounded-xl transition-colors">Save Settings</button>
            {status && <span className={`text-sm font-semibold ${status.startsWith('Not') ? 'text-red-400' : 'text-emerald-400'}`}>{status}</span>}
          </div>
          <p className="text-xs text-slate-500 mt-4">Saved to your company account. New estimates start with these defaults, and proposals show these details.</p>
        </form>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-lg font-bold text-white mb-4">Install the app</h2>
          <ul className="space-y-3 text-slate-300 text-sm">
            <li><span className="font-semibold text-white">Windows:</span> use the TradeQuote PRO shortcut on your Desktop, or in Edge/Chrome open the menu and choose &quot;Install TradeQuote PRO&quot;.</li>
            <li><span className="font-semibold text-white">Android:</span> open this site in Chrome → menu (⋮) → Install app.</li>
            <li><span className="font-semibold text-white">iPhone / iPad:</span> open this site in Safari → Share → Add to Home Screen.</li>
          </ul>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl grid sm:grid-cols-3 gap-4 text-sm">
          <div><p className={label}>Database</p><p className={db === 'connected' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{db}</p></div>
          <div><p className={label}>Version</p><p className="text-white">1.0</p></div>
          <div><p className={label}>Sign-in</p><p className="text-white">Your own email login</p></div>
        </div>
      </div>
    </main>
  );
}
