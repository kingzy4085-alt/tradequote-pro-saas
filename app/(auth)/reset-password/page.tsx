'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, AuthCard, Button, Input, Label } from '@/components/ui';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    });
    setLoading(false);
    // Same message whether or not the account exists, so emails can't be probed
    if (error && error.status !== 400) return setError('Could not send the email. Try again in a minute.');
    setSent(true);
  }

  return (
    <AuthCard title="Reset your password" footer={<Link href="/login" className="text-amber-400 hover:underline">← Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success">If an account exists for {email}, a reset link is on its way.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Sending...' : 'Send Reset Link'}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
