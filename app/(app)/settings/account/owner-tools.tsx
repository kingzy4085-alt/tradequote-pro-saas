'use client';

import { useState } from 'react';
import { Alert, Button, Input, Label, Panel } from '@/components/ui';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

type Status = { tone: 'error' | 'success' | 'info'; text: string } | null;

/** The file name the server chose, from Content-Disposition. */
function fileNameFrom(disposition: string | null): string | null {
  const match = /filename="([^"]+)"/.exec(disposition ?? '');
  return match ? match[1] : null;
}

/** "Download all company data": one JSON file, made on the server as the owner. */
export function ExportPanel() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function download() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/account/export', { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setStatus({ tone: 'error', text: json.error ?? 'The file could not be made. Try again in a moment.' });
        return;
      }
      const blob = await res.blob();
      const name = fileNameFrom(res.headers.get('Content-Disposition')) ?? 'tradequote-company-data.json';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus({ tone: 'success', text: `Downloaded ${name}. Keep it somewhere safe: it holds your clients, prices and crew details.` });
    } catch {
      setStatus({ tone: 'error', text: 'Network error. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Download your company data" description="One file with every record your company keeps here: clients, estimates, proposals, projects, timecards, invoices, safety records, the team list and the rest.">
      <div className="space-y-4">
        {status && <Alert tone={status.tone}>{status.text}</Alert>}
        <p className="text-sm text-slate-400">
          It is a JSON file, which a spreadsheet tool, a bookkeeper or another app can read. Photos and the logo are not in it. A few cost and contract columns that nobody signed in can read directly are left out, and the file lists them.
        </p>
        <Button onClick={download} disabled={busy}>
          {busy ? 'Preparing your file…' : 'Download all company data'}
        </Button>
      </div>
    </Panel>
  );
}

/** "Close this company account": typed confirmation, then everything goes. */
export function ClosePanel({ companyName }: { companyName: string }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ filesLeft: number; checked: boolean; cancelled: number } | null>(null);
  const matches = typed === companyName;

  async function close() {
    if (!matches) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/account/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_name: typed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'The company account could not be closed. Try again in a moment.');
        return;
      }
      // The server has signed this browser out; this clears anything it kept as well
      await getSupabaseBrowserClient()
        .auth.signOut({ scope: 'local' })
        .catch(() => undefined);
      setDone({ filesLeft: Number(json.data?.files_left ?? 0), checked: json.data?.files_checked !== false, cancelled: Number(json.data?.subscriptions_cancelled ?? 0) });
    } catch {
      setError('Network error. Check your connection and try again. Nothing is closed until this page says so.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Panel title="Company account closed">
        <div className="space-y-4">
          <Alert tone="success">
            {`${companyName} is closed. Its records, photos and logo are deleted, everyone on the team has lost access, and you are signed out.`}
          </Alert>
          {done.cancelled > 0 && <p className="text-sm text-slate-300">Your subscription is cancelled. There will be no more charges.</p>}
          {(done.filesLeft > 0 || !done.checked) && (
            <p className="text-sm text-slate-300">
              {done.filesLeft > 0
                ? `${done.filesLeft} photos on signed or locked records could not be removed from storage from here. Nobody can open them any more. Ask support to delete them for good.`
                : 'Some stored photos could not be checked. Nobody can open them any more. Ask support to delete them for good.'}
            </p>
          )}
          <a href="/pricing" className="min-h-[48px] lg:min-h-0 inline-flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-2.5 font-semibold text-slate-200">
            Go to the home page
          </a>
        </div>
      </Panel>
    );
  }

  return (
    <section className="bg-slate-900 border border-red-500/30 rounded-2xl shadow-xl p-6">
      <h2 className="text-xl font-bold text-white mb-2">Close this company account</h2>
      <div className="space-y-4 text-sm text-slate-300">
        <p>This cannot be undone. Closing the account:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>cancels your subscription right away, so there are no more charges;</li>
          <li>deletes every record: clients, estimates, proposals, projects, timecards, invoices, safety records and the rest;</li>
          <li>deletes your photos and logo, and any links you shared with clients stop working;</li>
          <li>removes everyone from the company, including you, and signs you out.</li>
        </ul>
        <p>Download your company data first if you want to keep a copy.</p>
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="close-confirm">{`Type ${companyName} to confirm`}</Label>
          <Input id="close-confirm" autoComplete="off" spellCheck={false} value={typed} disabled={busy} onChange={(e) => setTyped(e.target.value)} aria-describedby="close-confirm-help" />
          <p id="close-confirm-help" className="text-xs text-slate-500 mt-1">
            The name exactly as shown, with the same capitals and spaces.
          </p>
        </div>
        <Button variant="danger" onClick={close} disabled={!matches || busy}>
          {busy ? 'Closing the account…' : 'Close this company account'}
        </Button>
      </div>
    </section>
  );
}
