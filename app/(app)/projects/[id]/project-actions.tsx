'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { apiCall } from '@/lib/job-cost';

/** New invoice and new draw. Both make a draft with this project's client and balance, for a person to check. Nothing is sent. */
export default function ProjectActions({ projectId, canInvoice, canDraw, canStart = false }: { projectId: string; canInvoice: boolean; canDraw: boolean; /** Still in Planning, and this person can move it. The Command Center only counts active jobs. */ canStart?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function create(kind: 'invoice' | 'draw') {
    setBusy(kind);
    setError('');
    try {
      const { id } = await apiCall<{ id: string }>(`/api/projects/${projectId}/${kind}`, 'POST');
      router.push(kind === 'invoice' ? `/invoices/${id}` : `/invoices/draws/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not create the ${kind}.`);
      setBusy('');
    }
  }

  async function start() {
    setBusy('start');
    setError('');
    try {
      await apiCall(`/api/modules/projects/${projectId}`, 'PUT', { status: 'Active' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the job.');
    } finally {
      setBusy('');
    }
  }

  if (!canInvoice && !canDraw && !canStart) return null;
  return (
    <div className="flex flex-col items-start md:items-end gap-2">
      <div className="flex flex-wrap gap-3">
        {canStart && (
          <Button disabled={!!busy} onClick={start}>
            {busy === 'start' ? 'Starting…' : 'Mark active'}
          </Button>
        )}
        {canDraw && (
          <Button variant="secondary" disabled={!!busy} onClick={() => create('draw')}>
            {busy === 'draw' ? 'Creating…' : 'New draw'}
          </Button>
        )}
        {canInvoice && (
          <Button disabled={!!busy} onClick={() => create('invoice')}>
            {busy === 'invoice' ? 'Creating…' : 'New invoice'}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
