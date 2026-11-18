'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Label, Panel } from '@/components/ui';
import { formatValue } from '@/lib/format';
import type { ShareRow, ShareStatus } from '@/lib/portal';

const day = (stamp: string | null | undefined) => (stamp ? formatValue('date', stamp.slice(0, 10)) : '');

function describe(status: ShareStatus, share: ShareRow | null): string {
  switch (status) {
    case 'live':
      return `A client link is live until ${day(share?.expires_at)}. The client has not opened it yet.`;
    case 'viewed':
      return `The client first opened the link on ${day(share?.first_viewed_at)}. It is live until ${day(share?.expires_at)}.`;
    case 'accepted':
      return `Accepted and signed by ${share?.signer_name ?? 'the client'} on ${day(share?.decided_at)}.`;
    case 'declined':
      return `Declined by the client on ${day(share?.decided_at)}${share?.decline_reason ? `: “${share.decline_reason}”` : '.'}`;
    case 'expired':
      return `The client link expired on ${day(share?.expires_at)}.`;
    case 'revoked':
      return 'The client link was turned off.';
    default:
      return 'Send the client a link to read this proposal and accept or decline it online, with no account.';
  }
}

/** Makes, shows and turns off the client's link to this proposal, and reports what the client did with it. */
export default function ShareWithClient({ proposalId, status, canWrite }: { proposalId: string; status: string; canWrite: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: ShareStatus; share: ShareRow | null } | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/share`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not load the client link');
      setState(json.data);
    } catch (err) {
      setError(err instanceof TypeError ? 'Network error. The client link could not be loaded.' : err instanceof Error ? err.message : 'Could not load the client link');
    }
  }, [proposalId]);

  // Reloads when the proposal's status changes: saving it as Draft closes the link, and the client's answer changes the status
  useEffect(() => {
    void load();
  }, [load, status]);

  async function call(method: 'POST' | 'DELETE') {
    setBusy(method);
    setError('');
    setCopied(false);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/share`, { method, cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not update the client link');
      setUrl(method === 'POST' ? json.data.url : '');
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof TypeError ? 'Network error. Nothing was changed.' : err instanceof Error ? err.message : 'Could not update the client link');
    } finally {
      setBusy('');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the link and copy it yourself.');
    }
  }

  const live = state?.status === 'live' || state?.status === 'viewed';
  const decided = state?.status === 'accepted' || state?.status === 'declined';
  const shareable = status === 'Sent';

  return (
    <Panel title="Client link">
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-slate-300">{state ? describe(state.status, state.share) : 'Loading…'}</p>

        {url && (
          <div>
            <Label htmlFor="client-link">Link for the client</Label>
            <div className="flex flex-col sm:flex-row gap-3">
              <Input id="client-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <Button onClick={copy} className="shrink-0">
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <p className="mt-2 text-sm text-amber-300">Copy it now and send it to the client. For safety it is not stored, so it is not shown again; you can always make a new one.</p>
          </div>
        )}

        {canWrite && !decided && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant={live ? 'secondary' : 'primary'} onClick={() => call('POST')} disabled={!!busy || !shareable} title={shareable ? undefined : 'Set the status to Sent and save first'}>
              {busy === 'POST' ? 'Working…' : live ? 'Make a new link' : 'Share with client'}
            </Button>
            {live && (
              <Button variant="danger" onClick={() => call('DELETE')} disabled={!!busy}>
                {busy === 'DELETE' ? 'Working…' : 'Turn off link'}
              </Button>
            )}
            {!shareable && <span className="text-sm text-slate-400">Set the status to Sent and save to share it.</span>}
            {live && <span className="text-sm text-slate-400">Making a new link turns the old one off.</span>}
          </div>
        )}
      </div>
    </Panel>
  );
}
