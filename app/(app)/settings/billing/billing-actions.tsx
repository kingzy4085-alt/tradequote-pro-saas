'use client';

import { useState } from 'react';
import { Alert, Button } from '@/components/ui';

export default function BillingActions({ status, hasCustomer }: { status: string; hasCustomer: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go(path: string) {
    setBusy(true);
    setError('');
    const res = await fetch(path, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.url) {
      window.location.href = json.url;
      return;
    }
    setBusy(false);
    setError(json.error ?? 'Something went wrong');
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        {status !== 'active' && (
          <Button size="lg" disabled={busy} onClick={() => go('/api/billing/checkout')}>
            {busy ? 'Opening...' : 'Subscribe'}
          </Button>
        )}
        {hasCustomer && (
          <Button size="lg" variant="secondary" disabled={busy} onClick={() => go('/api/billing/portal')}>
            Manage Billing & Invoices
          </Button>
        )}
      </div>
    </div>
  );
}
