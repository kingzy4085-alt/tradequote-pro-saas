'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import SignaturePad from '@/components/signature-pad';
import { Alert, Badge, Button, ButtonLink, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { changeOrderTotals } from '@/lib/billing-math';
import { formatMoney, formatValue } from '@/lib/format';

export interface ChangeOrder {
  id: string;
  title: string;
  status: string;
  notes: string | null;
  co_number: string | null;
  project_id: string | null;
  project_name: string | null;
  reason: string | null;
  scope: string | null;
  material_cost: number | string | null;
  labour_hours: number | string | null;
  labour_rate: number | string | null;
  markup_pct: number | string | null;
  tax_pct: number | string | null;
  days_impact: number | string | null;
  price: number | string | null;
  tax: number | string | null;
  total: number | string | null;
  approved_by: string | null;
  approved_at: string | null;
  signature: string | null;
  invoice_id: string | null;
  billed_in_old_app: boolean;
}

const FIELD_KEYS = ['title', 'project_id', 'reason', 'scope', 'material_cost', 'labour_hours', 'labour_rate', 'markup_pct', 'tax_pct', 'days_impact', 'notes'] as const;
type Fields = Record<(typeof FIELD_KEYS)[number], string>;
const toFields = (co: ChangeOrder): Fields => Object.fromEntries(FIELD_KEYS.map((k) => [k, co[k] === null || co[k] === undefined ? '' : String(co[k])])) as Fields;

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = json.details ? Object.values(json.details as Record<string, string>).join(' ') : '';
    throw new Error([json.error ?? 'Request failed', details].filter(Boolean).join(': '));
  }
  return json.data;
}

export default function ChangeOrderEditor({
  initial,
  projects,
  invoice,
  canWrite,
  canDelete,
  canSeeMoney = true,
}: {
  initial: ChangeOrder;
  projects: { id: string; title: string }[];
  invoice: { id: string; invoice_number: string | null } | null;
  canWrite: boolean;
  canDelete: boolean;
  /** Prices and rates are for project managers and up. The database doesn't send them to anyone else. */
  canSeeMoney?: boolean;
}) {
  const [co, setCo] = useState<ChangeOrder>(initial);
  const [fields, setFields] = useState<Fields>(() => toFields(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signer, setSigner] = useState('');
  const [signature, setSignature] = useState('');

  const approved = co.status === 'Approved';
  const editable = canWrite && !approved;
  // An approved or old record shows what was stored; a draft previews what it will come to
  const live = changeOrderTotals(fields);
  const shown = approved ? { price: Number(co.price) || 0, tax: Number(co.tax) || 0, total: Number(co.total) || 0 } : live;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function run(label: string, done: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  }

  const accept = (data: ChangeOrder) => {
    setCo(data);
    setFields(toFields(data));
    setDirty(false);
  };

  async function saveFields() {
    const project = projects.find((p) => p.id === fields.project_id);
    accept(await call(`/api/modules/change-orders/${co.id}`, 'PUT', { ...fields, ...(project ? { project_name: project.title } : {}) }));
  }

  const save = () => run('Saving...', 'Saved.', saveFields);

  const move = (status: string, done: string) =>
    run('Saving...', done, async () => {
      if (dirty) await saveFields();
      accept(await call(`/api/modules/change-orders/${co.id}`, 'PUT', { status }));
    });

  const approve = () =>
    run('Approving...', 'Approved and locked. The project contract has been updated.', async () => {
      if (dirty) await saveFields();
      accept(await call(`/api/change-orders/${co.id}`, 'PUT', { action: 'approve', approved_by: signer, signature }));
      setSigner('');
      setSignature('');
    });

  const reopen = () => {
    if (!window.confirm('Reopen this change order? The signature is removed and its price comes off the contract until it is approved again.')) return;
    run('Reopening...', 'Reopened. It is back to Draft.', async () => accept(await call(`/api/change-orders/${co.id}`, 'PUT', { action: 'reopen' })));
  };

  function remove() {
    if (!window.confirm('Delete this change order? This cannot be undone.')) return;
    run('Deleting...', 'Deleted.', async () => {
      await call(`/api/modules/change-orders/${co.id}`, 'DELETE');
      setDirty(false);
      window.location.href = '/change-orders';
    });
  }

  const edit = (k: keyof Fields, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const number = (k: keyof Fields, label: string) => (
    <div>
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type="number" inputMode="decimal" step="any" disabled={!editable} value={fields[k]} onChange={(e) => edit(k, e.target.value)} />
    </div>
  );

  // What still stands between this and a signature, so the button doesn't fail with a surprise
  const blockers = [!fields.project_id && 'pick the project', live.price === 0 && 'enter a price, or a negative material cost for a credit'].filter(Boolean) as string[];

  return (
    <>
      <PageHeader
        title={`CO #${co.co_number ?? '—'}: ${fields.title || 'Untitled'}`}
        subtitle={co.reason || undefined}
        back={{ href: '/change-orders', label: 'Back to Change Orders' }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{co.status}</Badge>
            {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
            <ButtonLink variant="secondary" href={`/print/change-order/${co.id}`}>
              Print / PDF
            </ButtonLink>
            {editable && (
              <Button onClick={save} disabled={!!busy}>
                {busy === 'Saving...' ? 'Saving...' : 'Save'}
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {approved && (
          <Alert tone="info">
            Approved and locked{co.invoice_id ? ', and on an invoice' : co.billed_in_old_app ? ', and invoiced before this app tracked billing' : ''}.{' '}
            {invoice && (
              <Link href={`/invoices/${invoice.id}`} className="underline">
                Open invoice {invoice.invoice_number}
              </Link>
            )}
          </Alert>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Panel title="The change">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Label htmlFor="title">Change</Label>
                  <Input id="title" disabled={!editable} value={fields.title} onChange={(e) => edit('title', e.target.value)} placeholder="e.g. Add 2 VFDs to conveyor line" />
                </div>
                <div>
                  <Label htmlFor="project_id">Project</Label>
                  <Select
                    id="project_id"
                    disabled={!editable}
                    value={fields.project_id}
                    onChange={(e) => edit('project_id', e.target.value)}
                    placeholder="Pick a project"
                    options={projects.map((p) => ({ value: p.id, label: p.title }))}
                  />
                  {!fields.project_id && co.project_name && <p className="text-xs text-slate-400 mt-1">Old project text: {co.project_name}</p>}
                  {projects.length === 0 && (
                    <p className="text-xs text-slate-400 mt-1">
                      No projects yet.{' '}
                      <Link href="/projects" className="text-amber-400 hover:underline">
                        Add one first
                      </Link>
                      .
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="reason">Reason</Label>
                  <Input id="reason" disabled={!editable} value={fields.reason} onChange={(e) => edit('reason', e.target.value)} placeholder="Client request, site condition, design change" />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="scope">Scope of added or changed work</Label>
                  <Textarea id="scope" disabled={!editable} value={fields.scope} onChange={(e) => edit('scope', e.target.value)} />
                </div>
              </div>
            </Panel>

            <Panel title={canSeeMoney ? 'Pricing' : 'Labour and schedule'} description={canSeeMoney ? 'Rates start from your company defaults. The price is worked out when you save. For a credit, enter the material cost as a negative.' : undefined}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {canSeeMoney && number('material_cost', 'Material cost')}
                {number('labour_hours', 'Labour hours')}
                {canSeeMoney && number('labour_rate', 'Labour rate ($/hr)')}
                {canSeeMoney && number('markup_pct', 'Markup %')}
                {canSeeMoney && number('tax_pct', 'Tax %')}
                {number('days_impact', 'Schedule impact (days)')}
              </div>
            </Panel>

            <Panel title="Notes">
              <Label htmlFor="notes">Internal notes</Label>
              <Textarea id="notes" disabled={!editable} value={fields.notes} onChange={(e) => edit('notes', e.target.value)} />
            </Panel>
          </div>

          <div className="space-y-6">
            {canSeeMoney && (
            <Panel title="Price">
              <dl className="space-y-2 text-sm text-slate-300">
                {!approved && (
                  <>
                    <div className="flex justify-between"><dt>Labour</dt><dd>{formatMoney(live.labour)}</dd></div>
                    <div className="flex justify-between"><dt>Material and labour</dt><dd>{formatMoney(live.cost)}</dd></div>
                    <div className="flex justify-between"><dt>Markup</dt><dd>{formatMoney(live.markup)}</dd></div>
                  </>
                )}
                <div className="flex justify-between text-white font-semibold border-t border-slate-800 pt-2"><dt>Price</dt><dd>{formatMoney(shown.price)}</dd></div>
                <div className="flex justify-between"><dt>Tax</dt><dd>{formatMoney(shown.tax)}</dd></div>
                <div className="flex justify-between text-white text-lg font-bold border-t border-slate-800 pt-2"><dt>Total</dt><dd>{formatMoney(shown.total)}</dd></div>
              </dl>
            </Panel>
            )}

            {canWrite && !approved && (
              <Panel title="Status">
                <div className="flex flex-wrap gap-2">
                  {co.status === 'Draft' && (
                    <Button variant="secondary" disabled={!!busy} onClick={() => move('Sent', 'Marked as sent.')}>
                      Mark sent to client
                    </Button>
                  )}
                  {co.status === 'Sent' && (
                    <Button variant="secondary" disabled={!!busy} onClick={() => move('Rejected', 'Marked as rejected.')}>
                      Client rejected
                    </Button>
                  )}
                  {co.status !== 'Draft' && (
                    <Button variant="secondary" disabled={!!busy} onClick={() => move('Draft', 'Back to Draft.')}>
                      Back to Draft
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-3">Marking it sent does not email anyone. Print it and send it yourself.</p>
              </Panel>
            )}

            {approved ? (
              <Panel title="Client approval">
                {co.signature && (
                  // A data URL from the signature pad
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={co.signature} alt={`Signature of ${co.approved_by ?? 'the approver'}`} className="bg-white rounded-lg w-full max-h-40 object-contain" />
                )}
                <p className="text-sm text-slate-300 mt-3">{co.approved_by}</p>
                {co.approved_at && <p className="text-xs text-slate-400">{formatValue('datetime', co.approved_at)}</p>}
                {canWrite && (
                  <div className="mt-4">
                    <Button variant="secondary" disabled={!!busy || !!co.invoice_id || co.billed_in_old_app} onClick={reopen}>
                      Reopen
                    </Button>
                    {co.invoice_id && <p className="text-xs text-slate-400 mt-2">It cannot be reopened while it is on an invoice.</p>}
                    {co.billed_in_old_app && <p className="text-xs text-slate-400 mt-2">It was already invoiced, so it stays approved.</p>}
                  </div>
                )}
              </Panel>
            ) : (
              canWrite &&
              co.status === 'Draft' && (
                <Panel title="Client approval">
                  <p className="text-sm text-slate-300">Mark it sent to the client first. Then they can sign here, on this phone or tablet, or you can copy from a signed printout.</p>
                </Panel>
              )
            )}

            {!approved &&
              canWrite &&
              co.status === 'Sent' && (
                <Panel title="Client approval" description="Hand over the phone or tablet, or copy from a signed printout.">
                  {blockers.length > 0 && <p className="text-sm text-amber-400 mb-3">Before approving, {blockers.join(' and ')}.</p>}
                  <Label htmlFor="signer">Name of the person approving</Label>
                  <Input id="signer" value={signer} onChange={(e) => setSigner(e.target.value)} />
                  <div className="mt-4">
                    <SignaturePad onChange={setSignature} />
                  </div>
                  <Button className="mt-3 w-full" disabled={!!busy || blockers.length > 0 || !signer.trim() || !signature} onClick={approve}>
                    {busy === 'Approving...' ? 'Approving...' : `Approve ${formatMoney(live.total)}`}
                  </Button>
                  <p className="text-xs text-slate-400 mt-2">Approving locks this change order and adds its price to the project contract.</p>
                </Panel>
              )}

            {canDelete && !approved && (
              <Button variant="danger" disabled={!!busy} onClick={remove}>
                Delete change order
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
