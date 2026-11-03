'use client';

import Link from 'next/link';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const sb = supabaseBrowser();
    const { data, error } = signup
      ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/onboarding` } })
      : await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    if (signup && !data.session) return setNotice('Check your email and click the link to confirm your account, then log in.');
    const next = new URLSearchParams(location.search).get('next');
    location.href = signup ? '/onboarding' : next && next.startsWith('/') ? next : '/';
  }

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500';
  return (
    <main className="min-h-[70vh] bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h1 className="text-2xl font-bold text-white">{signup ? 'Create your account' : 'Log in'}</h1>
        <div>
          <label htmlFor="email" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Email</label>
          <input id="email" type="email" required autoComplete="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Password</label>
          <input id="password" type="password" required minLength={8} autoComplete={signup ? 'new-password' : 'current-password'} className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-emerald-400">{notice}</p>}
        <button disabled={busy} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-semibold px-6 py-3 rounded-xl transition-colors">
          {busy ? 'Please wait…' : signup ? 'Sign up' : 'Log in'}
        </button>
        <p className="text-sm text-slate-400 text-center">
          {signup ? <>Already have an account? <Link href="/login" className="text-amber-400">Log in</Link></> : <>New here? <Link href="/signup" className="text-amber-400">Create an account</Link></>}
        </p>
      </form>
    </main>
  );
}
