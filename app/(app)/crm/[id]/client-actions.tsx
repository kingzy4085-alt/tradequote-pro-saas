'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { PROFILE_SECTIONS, newRecordBody, type ProfileSlug } from '@/lib/client-profile';
import { detailHref } from '@/lib/detail-pages';
import { apiCall } from '@/lib/job-cost';

/** "New estimate for this client" and the rest. Each saves a draft already linked to the client and opens it to fill in. Nothing is sent. */
export default function ClientActions({ client, canCreate }: { client: { id: string; title: string }; canCreate: ProfileSlug[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function create(slug: ProfileSlug) {
    setBusy(slug);
    setError('');
    try {
      const { id } = await apiCall<{ id: string }>(`/api/modules/${slug}`, 'POST', newRecordBody(slug, client));
      router.push(detailHref(slug, id) ?? `/${slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that. Try again.');
      setBusy('');
    }
  }

  const buttons = PROFILE_SECTIONS.filter((s) => canCreate.includes(s.slug));
  if (buttons.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        {buttons.map((s, i) => (
          <Button key={s.slug} variant={i === 0 ? 'primary' : 'secondary'} disabled={!!busy} onClick={() => create(s.slug)}>
            {busy === s.slug ? 'Creating…' : s.newLabel}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
