'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, AuthCard, Button, Input, Label } from '@/components/ui';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { safeNext } from '@/lib/safe-redirect';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(params.get('error') ?? '');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      setError(error.message === 'Email not confirmed' ? 'Confirm your email first — check your inbox for the link.' : 'Email or password is incorrect.');
      return;
    }
    router.replace(safeNext(params.get('next')));
    router.refresh();
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back to the Command Center."
      footer={
        <>
          New to TradeQuote PRO?{' '}
          <Link href="/signup" className="text-amber-400 hover:underline">
            Start a free 14-day trial
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <div className="flex justify-between items-baseline">
            <Label htmlFor="password">Password</Label>
            <Link href="/reset-password" className="text-xs text-amber-400 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
