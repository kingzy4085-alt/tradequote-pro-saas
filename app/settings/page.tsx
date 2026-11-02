'use client';

import { useEffect, useState } from 'react';

const KEY = 'tq-settings';
const DEFAULTS = { company: '', contact: '', phone: '', email: '', province: 'SK', markup: '15', taxRate: '5' };

function loadSettings(): typeof DEFAULTS {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return DEFAULTS;
  }
}

export default function SettingsPage() {
  const [s, setS] = useState(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [db, setDb] = useState('checking…');

  useEffect(() => {
    setS(loadSettings());
    fetch('/api/health').then((r) => r.json()).then((j) => setDb(j.database)).catch(() => setDb('offline'));
  }, []);

  function save(e: React.FormEvent) {
    e.preventDefault();
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500';
  const label = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';
  const field = (k: keyof typeof DEFAULTS, l: string, type = 'text') => (
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
            {field('company', 'Company name')}
            {field('contact', 'Main contact')}
            {field('phone', 'Phone', 'tel')}
            {field('email', 'Email', 'email')}
            <div>
              <label className={label} htmlFor="province">Province</label>
              <select id="province" className={input} value={s.province} onChange={(e) => setS({ ...s, province: e.target.value })}>
                {['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <h2 className="text-lg font-bold text-white mt-8 mb-4">Estimating defaults</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {field('markup', 'Default markup %', 'number')}
            {field('taxRate', 'Sales tax %', 'number')}
          </div>
          <div className="flex items-center gap-4 mt-6">
            <button className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-6 py-3 rounded-xl transition-colors">Save Settings</button>
            {saved && <span className="text-sm text-emerald-400 font-semibold">Saved</span>}
          </div>
          <p className="text-xs text-slate-500 mt-4">Settings are saved on this device. New estimates start with your default markup.</p>
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
          <div><p className={label}>Sign-in</p><p className="text-white">Shared company password</p></div>
        </div>
      </div>
    </main>
  );
}
