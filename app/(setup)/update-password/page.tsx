'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, AuthCard, Button, Input, Label } from '@/components/ui';
import { safeNext } from '@/lib/safe-redirect';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError('Use at least 10 characters.');
    if (password !== confirm) return setError('The passwords do not match.');
    setLoading(true);
    const { error } = await getSupabaseBrowserClient().auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(error.message);
    // Invited people carry on to accepting their invitation
    router.replace(safeNext(new URLSearchParams(window.location.search).get('next')));
    router.refresh();
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="password">New Password</Label>
          <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm Password</Label>
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? 'Saving...' : 'Save Password'}
        </Button>
      </form>
    </AuthCard>
  );
}
