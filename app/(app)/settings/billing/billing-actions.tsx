'use client';

import { useState } from 'react';
import { Alert, Button } from '@/components/ui';

export default function BillingActions({ canSubscribe, hasCustomer }: { canSubscribe: boolean; hasCustomer: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go(path: string): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(path, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.url) {
        window.location.href = json.url;
        return;
      }
      // Stripe already has a subscription for this company, so fix it there instead
      if (json.portal) return go('/api/billing/portal');
      setBusy(false);
      setError(json.error ?? 'Something went wrong');
    } catch {
      setBusy(false);
      setError('Network error. Check your connection and try again.');
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        {canSubscribe && (
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
