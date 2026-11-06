'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, AuthCard, Button, Input, Label } from '@/components/ui';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError('Use at least 10 characters for your password.');
    if (!agreed) return setError('Please accept the Terms and Privacy Policy.');
    setLoading(true);
    setError('');
    const { data, error } = await getSupabaseBrowserClient().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    setLoading(false);
    if (error) return setError(error.message);
    if (data.session) {
      router.replace('/onboarding');
      router.refresh();
    } else {
      setSent(true);
    }
  }

  async function resend() {
    setLoading(true);
    setError('');
    setResent(false);
    const { error } = await getSupabaseBrowserClient().auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    setLoading(false);
    if (error) return setError(error.message);
    setResent(true);
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`We sent a confirmation link to ${email}.`}
        footer={
          <Link href="/login" className="text-amber-400 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-slate-300">Open the link on this device to finish setting up your company. It can take a minute to arrive — check spam if you don't see it.</p>
        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}
        {resent && (
          <div className="mt-4">
            <Alert tone="success">Sent again.</Alert>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <Button variant="secondary" disabled={loading} onClick={resend}>
            {loading ? 'Sending...' : 'Send it again'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSent(false);
              setError('');
              setResent(false);
            }}
          >
            Use a different email
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Start your free trial"
      subtitle="14 days, full access. No card needed to start."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-amber-400 hover:underline">
            Sign in
          </Link>
          {' · '}
          <Link href="/pricing" className="text-amber-400 hover:underline">
            See pricing
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="email">Work Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-slate-500 mt-1">At least 10 characters.</p>
        </div>
        <label className="flex gap-3 items-start text-sm text-slate-300">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-amber-500" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I agree to the{' '}
            <Link href="/legal/terms" className="text-amber-400 hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/legal/privacy" className="text-amber-400 hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? 'Creating account...' : 'Create Account'}
        </Button>
      </form>
    </AuthCard>
  );
}
