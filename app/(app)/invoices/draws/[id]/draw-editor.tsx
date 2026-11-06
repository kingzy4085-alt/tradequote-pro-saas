'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { drawNet } from '@/lib/billing-math';
import { formatMoney } from '@/lib/format';

export interface Draw {
  id: string;
  title: string;
  status: string;
  notes: string | null;
  project_id: string | null;
  billing_period: string | null;
  amount_billed: number | string | null;
  holdback_percent: number | string | null;
  holdback_release_date: string | null;
  invoice_id: string | null;
}

const KEYS = ['title', 'project_id', 'billing_period', 'amount_billed', 'holdback_percent', 'holdback_release_date', 'notes'] as const;
type Fields = Record<(typeof KEYS)[number], string>;
const toFields = (d: Draw): Fields => Object.fromEntries(KEYS.map((k) => [k, d[k] === null || d[k] === undefined ? '' : String(d[k])])) as Fields;

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = json.details ? Object.values(json.details as Record<string, string>).join(' ') : '';
    throw new Error([json.error ?? 'Request failed', details].filter(Boolean).join(': '));
  }
  return json.data;
}

export default function DrawEditor({
  initial,
  projects,
  invoice,
  canWrite,
  canInvoice,
  canDelete,
}: {
  initial: Draw;
  projects: { id: string; title: string }[];
  invoice: { id: string; invoice_number: string | null; status: string } | null;
  canWrite: boolean;
  canInvoice: boolean;
  canDelete: boolean;
}) {
  const [draw, setDraw] = useState(initial);
  const [fields, setFields] = useState<Fields>(() => toFields(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const linked = !!draw.invoice_id;
  const { holdback, net } = drawNet(fields.amount_billed, fields.holdback_percent);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveFields() {
    const data: Draw = await call(`/api/modules/progress-billing/${draw.id}`, 'PUT', fields);
    setDraw(data);
    setFields(toFields(data));
    setDirty(false);
  }

  const save = () =>
    run(async () => {
      await saveFields();
      setNotice('Saved.');
    });

  const createInvoice = () =>
    run(async () => {
      if (dirty) await saveFields();
      const data: { invoice_id: string } = await call(`/api/progress-billing/${draw.id}/invoice`, 'POST');
      window.location.href = `/invoices/${data.invoice_id}`;
    });

  // Only the old app could leave a draw marked Invoiced or Paid with no invoice behind it
  const billedElsewhere = !linked && draw.status !== 'Draft';
  const backToDraft = () => {
    if (!window.confirm('Set this draw back to Draft? Do this only if it was never really invoiced, or the client could be billed twice.')) return;
    run(async () => {
      const data: Draw = await call(`/api/modules/progress-billing/${draw.id}`, 'PUT', { status: 'Draft' });
      setDraw(data);
      setNotice('Back to Draft.');
    });
  };

  const remove = () => {
    if (!window.confirm('Delete this draw? This cannot be undone.')) return;
    run(async () => {
      await call(`/api/modules/progress-billing/${draw.id}`, 'DELETE');
      setDirty(false);
      window.location.href = '/progress-billing';
    });
  };

  const edit = (k: keyof Fields, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  return (
    <>
      <PageHeader
        title={fields.title || 'Untitled draw'}
        subtitle={fields.billing_period || undefined}
        back={{ href: '/progress-billing', label: 'Back to Progress Billing' }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{draw.status}</Badge>
            {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
            {canWrite && (
              <Button variant="secondary" disabled={busy} onClick={save}>
                Save
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <div className="grid lg:grid-cols-3 gap-6">
          <Panel title="Draw" className="lg:col-span-2">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label htmlFor="title">Draw</Label>
                <Input id="title" disabled={!canWrite} value={fields.title} onChange={(e) => edit('title', e.target.value)} placeholder="e.g. Draw #4, October" />
              </div>
              <div>
                <Label htmlFor="project_id">Project</Label>
                <Select id="project_id" disabled={!canWrite || linked} value={fields.project_id} onChange={(e) => edit('project_id', e.target.value)} placeholder="No project" options={projects.map((p) => ({ value: p.id, label: p.title }))} />
              </div>
              <div>
                <Label htmlFor="billing_period">Period</Label>
                <Input id="billing_period" disabled={!canWrite} value={fields.billing_period} onChange={(e) => edit('billing_period', e.target.value)} placeholder="e.g. October 2026" />
              </div>
              <div>
                <Label htmlFor="amount_billed">Amount billed, before tax</Label>
                <Input id="amount_billed" type="number" inputMode="decimal" min={0} step="any" disabled={!canWrite || linked} value={fields.amount_billed} onChange={(e) => edit('amount_billed', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="holdback_percent">Holdback %</Label>
                <Input id="holdback_percent" type="number" inputMode="decimal" min={0} max={100} step="any" disabled={!canWrite || linked} value={fields.holdback_percent} onChange={(e) => edit('holdback_percent', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="holdback_release_date">Holdback release date</Label>
                <Input id="holdback_release_date" type="date" disabled={!canWrite || linked} value={fields.holdback_release_date} onChange={(e) => edit('holdback_release_date', e.target.value)} />
                {linked && <p className="text-xs text-slate-400 mt-1">Holdback terms follow the invoice. Change them there.</p>}
                <p className="text-xs text-slate-400 mt-1">Enter the date your province and contract give you. It is not worked out for you.</p>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" disabled={!canWrite} value={fields.notes} onChange={(e) => edit('notes', e.target.value)} />
              </div>
            </div>
          </Panel>

          <div className="space-y-6">
            <Panel title="This draw">
              <dl className="space-y-2 text-sm text-slate-300">
                <div className="flex justify-between"><dt>Amount billed</dt><dd>{formatMoney(Number(fields.amount_billed) || 0)}</dd></div>
                <div className="flex justify-between"><dt>Less holdback</dt><dd>−{formatMoney(holdback)}</dd></div>
                <div className="flex justify-between text-white font-semibold border-t border-slate-800 pt-2"><dt>After holdback, before tax</dt><dd>{formatMoney(net)}</dd></div>
              </dl>
              <p className="text-xs text-slate-400 mt-3">Tax is added on the invoice, at your company rate.</p>
            </Panel>

            <Panel title="Invoice">
              {linked ? (
                invoice ? (
                  <p className="text-sm text-slate-300">
                    <Link href={`/invoices/${invoice.id}`} className="text-amber-400 hover:underline">
                      Invoice {invoice.invoice_number}
                    </Link>{' '}
                    ({invoice.status}). If that invoice is voided or deleted, this draw goes back to Draft.
                  </p>
                ) : (
                  <p className="text-sm text-slate-300">This draw is on an invoice. Your role does not open invoices.</p>
                )
              ) : billedElsewhere ? (
                <>
                  <p className="text-sm text-slate-300">This draw was marked {draw.status.toLowerCase()} before this app tracked invoices, so it cannot be invoiced again here.</p>
                  {canWrite && (
                    <Button className="w-full mt-3" variant="secondary" disabled={busy} onClick={backToDraft}>
                      It was never invoiced: back to Draft
                    </Button>
                  )}
                </>
              ) : canInvoice ? (
                <>
                  <Button className="w-full" disabled={busy} onClick={createInvoice}>
                    {busy ? 'Working...' : 'Create invoice'}
                  </Button>
                  <p className="text-xs text-slate-400 mt-2">Makes a draft invoice for you to check. Nothing is sent to the client.</p>
                </>
              ) : (
                <p className="text-sm text-slate-300">Ask an admin or the owner to create the invoice for this draw.</p>
              )}
            </Panel>

            {canDelete && !linked && (
              <Button variant="danger" disabled={busy} onClick={remove}>
                Delete draw
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
