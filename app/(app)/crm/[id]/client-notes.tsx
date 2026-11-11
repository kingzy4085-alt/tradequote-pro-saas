'use client';

import { useState } from 'react';
import { Button, Label, Textarea } from '@/components/ui';
import { apiCall } from '@/lib/job-cost';

/** The client's notes, saved through the same route the Clients list uses. */
export default function ClientNotes({ clientId, initial, canEdit }: { clientId: string; initial: string; canEdit: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [notes, setNotes] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  if (!canEdit) return <p className="text-sm text-slate-300 whitespace-pre-wrap break-words">{initial || 'No notes yet.'}</p>;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const row = await apiCall<{ notes: string | null }>(`/api/modules/crm/${clientId}`, 'PUT', { notes });
      const next = row.notes ?? '';
      setSaved(next);
      setNotes(next);
      setMessage({ tone: 'ok', text: 'Notes saved.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not save the notes.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Label htmlFor="client-notes">Notes about this client</Label>
      <Textarea
        id="client-notes"
        rows={5}
        value={notes}
        maxLength={10000}
        placeholder="Gate codes, who signs off, how they like to be billed…"
        onChange={(e) => {
          setNotes(e.target.value);
          setMessage(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <Button disabled={busy || notes === saved} onClick={save}>
          {busy ? 'Saving…' : 'Save notes'}
        </Button>
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
