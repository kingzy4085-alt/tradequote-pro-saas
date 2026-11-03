'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function OnboardingPage() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabaseBrowser().rpc('create_company', { p_name: name });
    setBusy(false);
    if (error) return setError(error.message);
    location.href = '/settings';
  }

  return (
    <main className="min-h-[70vh] bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h1 className="text-2xl font-bold text-white">Set up your company</h1>
        <p className="text-sm text-slate-400">Your estimates and records are private to your company.</p>
        <div>
          <label htmlFor="company" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Company name</label>
          <input id="company" required className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button disabled={busy} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-semibold px-6 py-3 rounded-xl transition-colors">
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </main>
  );
}
