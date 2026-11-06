'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { invoiceTaxLabel, invoiceTotals, lineKind, percentLeft, pricePercentLines, type InvoiceLine } from '@/lib/billing-math';
import { formatMoney, formatValue } from '@/lib/format';
import { NO_OPTIONS, type InvoiceOptions } from './options';

export interface Invoice {
  id: string;
  title: string;
  status: string;
  notes: string | null;
  invoice_number: string | null;
  project_id: string | null;
  client_id: string | null;
  client_name: string | null;
  client_address: string | null;
  issue_date: string | null;
  due_date: string | null;
  tax_pct: number | string | null;
  holdback_pct: number | string | null;
  holdback_release_date: string | null;
  amount: number | string | null;
  gst: number | string | null;
  holdback_amount: number | string | null;
  total: number | string | null;
  paid_at: string | null;
  lines: InvoiceLine[] | null;
}

const KEYS = ['title', 'project_id', 'client_id', 'client_name', 'client_address', 'issue_date', 'due_date', 'tax_pct', 'holdback_pct', 'holdback_release_date', 'notes'] as const;
type Fields = Record<(typeof KEYS)[number], string>;
const toFields = (i: Invoice): Fields => Object.fromEntries(KEYS.map((k) => [k, i[k] === null || i[k] === undefined ? '' : String(i[k])])) as Fields;

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = json.details ? Object.values(json.details as Record<string, string>).join(' ') : '';
    throw new Error([json.error ?? 'Request failed', details].filter(Boolean).join(': '));
  }
  return json;
}

const pickButton = 'w-full flex justify-between gap-3 text-left text-sm bg-slate-950 border border-slate-800 hover:border-amber-500 rounded-lg px-3 py-2';

export default function InvoiceEditor({
  initial,
  initialOptions,
  projects,
  clients,
  canWrite,
  canDelete,
}: {
  initial: Invoice;
  initialOptions: InvoiceOptions;
  projects: { id: string; title: string; client_id: string | null; client_name: string | null }[];
  clients: { id: string; title: string }[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const [invoice, setInvoice] = useState(initial);
  const [fields, setFields] = useState<Fields>(() => toFields(initial));
  const [lines, setLines] = useState<InvoiceLine[]>(initial.lines ?? []);
  const [options, setOptions] = useState(initialOptions);
  const [percent, setPercent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const draft = invoice.status === 'Draft';
  const editable = canWrite && draft;
  const contract = options.project?.contract_value;
  // A percent line is priced here only for the preview. The database prices it on save.
  const priced = editable ? pricePercentLines(lines, contract, options.billed_percent_amount, options.billed_percent_lines, options.billed_percent) : lines;
  const preview = invoiceTotals(priced, fields.tax_pct, fields.holdback_pct);
  // The database leaves the totals alone unless the lines or rates move (an old draft can hold a
  // hand-typed tax that no rate reproduces), so while they haven't, show exactly what was stored
  const stored = toFields(invoice);
  const moved =
    fields.tax_pct !== stored.tax_pct ||
    fields.holdback_pct !== stored.holdback_pct ||
    JSON.stringify(priced.map((l) => Number(l.amount) || 0)) !== JSON.stringify((invoice.lines ?? []).map((l) => Number(l.amount) || 0));
  const totals = draft && moved
    ? preview
    : { subtotal: Number(invoice.amount) || 0, tax: Number(invoice.gst) || 0, holdback: Number(invoice.holdback_amount) || 0, total: Number(invoice.total) || 0 };

  const percentHere = lines.reduce((sum, l) => sum + (l.type === 'percent' ? Number(l.percent) || 0 : 0), 0);
  const left = percentLeft(options.billed_percent + percentHere);
  const onThis = new Set(lines.flatMap((l) => [l.change_order_id, l.progress_billing_id]).filter(Boolean));
  const openCos = options.change_orders.filter((c) => !onThis.has(c.id));
  const openDraws = options.draws.filter((d) => !onThis.has(d.id));

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

  const accept = (data: Invoice) => {
    setInvoice(data);
    setFields(toFields(data));
    setLines(data.lines ?? []);
    setDirty(false);
  };

  async function saveAll() {
    // Only what the database needs to price each line
    const payload = lines.map((l) => {
      if (l.type === 'free') return { type: l.type, description: l.description, amount: l.amount };
      if (l.type === 'percent') return { type: l.type, description: l.description, percent: l.percent };
      if (l.type === 'change_order') return { type: l.type, description: l.description, change_order_id: l.change_order_id };
      return { type: l.type, description: l.description, progress_billing_id: l.progress_billing_id };
    });
    const json = await call(`/api/invoices/${invoice.id}`, 'PUT', { ...fields, lines: payload });
    accept(json.data);
    if (json.options) setOptions(json.options);
  }

  const save = () => run('Saving...', 'Saved.', saveAll);

  const move = (status: string, done: string, ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    run('Saving...', done, async () => {
      if (dirty && draft) await saveAll();
      const json = await call(`/api/modules/invoices/${invoice.id}`, 'PUT', { status });
      accept(json.data);
    });
  };

  const saveReleaseDate = () =>
    run('Saving...', 'Saved.', async () => {
      const json = await call(`/api/modules/invoices/${invoice.id}`, 'PUT', { holdback_release_date: fields.holdback_release_date });
      accept(json.data);
    });

  function remove() {
    if (!window.confirm('Delete this draft invoice? Any change orders and draws on it can be billed again.')) return;
    run('Deleting...', 'Deleted.', async () => {
      await call(`/api/modules/invoices/${invoice.id}`, 'DELETE');
      setDirty(false);
      window.location.href = '/invoices';
    });
  }

  const edit = (k: keyof Fields, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  function pickProject(id: string) {
    const project = projects.find((p) => p.id === id);
    setFields((f) => ({
      ...f,
      project_id: id,
      client_id: f.client_id || project?.client_id || '',
      client_name: f.client_name || project?.client_name || '',
    }));
    setDirty(true);
    if (!id) {
      setOptions(NO_OPTIONS);
      return;
    }
    call(`/api/invoices/${invoice.id}?project=${id}`, 'GET')
      .then((json) => setOptions(json.options))
      .catch(() => setError('Could not load that project. Check your connection and try again.'));
  }

  function pickClient(id: string) {
    const client = clients.find((c) => c.id === id);
    setFields((f) => ({ ...f, client_id: id, client_name: client?.title ?? f.client_name }));
    setDirty(true);
  }

  const setLineList = (next: InvoiceLine[]) => {
    setLines(next);
    setDirty(true);
  };
  const setLine = (i: number, patch: Partial<InvoiceLine>) => setLineList(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function addPercent() {
    const p = Number(percent);
    if (!(p > 0)) return;
    setLineList([...lines, { type: 'percent', description: '', amount: 0, percent: p }]);
    setPercent('');
  }

  const text = (k: keyof Fields, label: string, type = 'text') => (
    <div>
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type={type} inputMode={type === 'number' ? 'decimal' : undefined} min={type === 'number' ? 0 : undefined} step="any" disabled={!editable} value={fields[k]} onChange={(e) => edit(k, e.target.value)} />
    </div>
  );

  return (
    <>
      <PageHeader
        title={`Invoice ${invoice.invoice_number ?? ''}`}
        subtitle={[fields.title, fields.client_name].filter(Boolean).join(' · ')}
        back={{ href: '/invoices', label: 'Back to Invoices' }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{invoice.status}</Badge>
            {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
            <ButtonLink variant="secondary" href={`/print/invoice/${invoice.id}`}>
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
        {!draft && invoice.status !== 'Void' && <Alert tone="info">Only a draft can be edited.{canWrite && invoice.status !== 'Paid' ? ' Set it back to Draft to change it.' : ''}</Alert>}
        {invoice.status === 'Void' && <Alert tone="info">This invoice is void. Its change orders and draws can be billed again.</Alert>}

        <Panel title="Details">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2 lg:col-span-3">
              <Label htmlFor="title">Invoice title</Label>
              <Input id="title" disabled={!editable} value={fields.title} onChange={(e) => edit('title', e.target.value)} placeholder="e.g. Draw #4, October" />
            </div>
            <div>
              <Label htmlFor="project_id">Project</Label>
              <Select id="project_id" disabled={!editable} value={fields.project_id} onChange={(e) => pickProject(e.target.value)} placeholder="No project" options={projects.map((p) => ({ value: p.id, label: p.title }))} />
            </div>
            <div>
              <Label htmlFor="client_id">Client</Label>
              <Select id="client_id" disabled={!editable} value={fields.client_id} onChange={(e) => pickClient(e.target.value)} placeholder="Not in your client list" options={clients.map((c) => ({ value: c.id, label: c.title }))} />
            </div>
            {text('client_name', 'Name on the invoice')}
            <div className="sm:col-span-2 lg:col-span-3">{text('client_address', 'Client address')}</div>
            {text('issue_date', 'Issue date', 'date')}
            {text('due_date', 'Due date', 'date')}
            {text('tax_pct', 'Tax %', 'number')}
            {text('holdback_pct', 'Holdback %', 'number')}
            <div>
              <Label htmlFor="holdback_release_date">Holdback release date</Label>
              <Input id="holdback_release_date" type="date" disabled={!canWrite || invoice.status === 'Void'} value={fields.holdback_release_date} onChange={(e) => edit('holdback_release_date', e.target.value)} />
              {canWrite && !draft && invoice.status !== 'Void' && dirty && (
                <Button size="sm" variant="secondary" className="mt-2" disabled={!!busy} onClick={saveReleaseDate}>
                  Save date
                </Button>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Lines">
          {lines.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">{editable ? 'No lines yet. Add a percent of the contract, a change order, a draw or another charge below.' : 'No lines on this invoice.'}</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {priced.map((l, i) => (
                <li key={i} className="py-3 grid grid-cols-[1fr_auto] sm:grid-cols-[9rem_1fr_9rem_auto] gap-2 sm:gap-3 items-center">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{lineKind(l)}</span>
                  <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                    <Input
                      aria-label={`Line ${i + 1} description`}
                      disabled={!editable}
                      value={l.description}
                      placeholder={l.type === 'free' ? 'What this charge or credit is for' : 'Filled in when saved'}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 row-start-3 sm:col-span-1 sm:row-start-auto text-right">
                    {l.type === 'free' && editable ? (
                      <Input aria-label={`Line ${i + 1} amount`} type="number" inputMode="decimal" step="any" className="text-right" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
                    ) : (
                      <span className="text-slate-200 whitespace-nowrap">{formatMoney(l.amount)}</span>
                    )}
                  </div>
                  <div className="row-start-1 col-start-2 sm:row-start-auto sm:col-start-auto text-right">
                    {editable && (
                      <Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLineList(lines.filter((_, j) => j !== i))}>
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {editable && (
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
            <Panel title="Percent of contract">
              {!fields.project_id ? (
                <p className="text-sm text-slate-400">Pick a project first.</p>
              ) : !(Number(contract) > 0) ? (
                <p className="text-sm text-slate-400">
                  This project has no contract value.{' '}
                  <Link href="/projects" className="text-amber-400 hover:underline">
                    Add it on the project
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <p className="text-sm text-slate-300 mb-3">
                    {formatMoney(contract)} contract. {left}% left to bill.
                  </p>
                  <div className="flex gap-2">
                    <Input aria-label="Percent to bill" type="number" inputMode="decimal" min={0} max={left} step="any" placeholder="%" value={percent} onChange={(e) => setPercent(e.target.value)} />
                    <Button variant="secondary" disabled={!(Number(percent) > 0) || Number(percent) > left} onClick={addPercent}>
                      Add
                    </Button>
                  </div>
                </>
              )}
            </Panel>

            <Panel title="Approved change orders">
              {!fields.project_id ? (
                <p className="text-sm text-slate-400">Pick a project first.</p>
              ) : openCos.length === 0 ? (
                <p className="text-sm text-slate-400">None waiting to be billed on this project.</p>
              ) : (
                <div className="space-y-2">
                  {openCos.map((c) => (
                    <button key={c.id} type="button" className={pickButton} onClick={() => setLineList([...lines, { type: 'change_order', description: '', amount: Number(c.price) || 0, tax_pct: c.tax_pct ?? undefined, change_order_id: c.id }])}>
                      <span className="text-slate-200">+ CO #{c.co_number}: {c.title}</span>
                      <span className="text-slate-300 whitespace-nowrap">{formatMoney(c.price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Progress draws">
              {!fields.project_id ? (
                <p className="text-sm text-slate-400">Pick a project first.</p>
              ) : openDraws.length === 0 ? (
                <p className="text-sm text-slate-400">None waiting to be billed on this project.</p>
              ) : (
                <div className="space-y-2">
                  {openDraws.map((d) => (
                    <button key={d.id} type="button" className={pickButton} onClick={() => setLineList([...lines, { type: 'draw', description: '', amount: Number(d.amount_billed) || 0, progress_billing_id: d.id }])}>
                      <span className="text-slate-200">+ {d.title}</span>
                      <span className="text-slate-300 whitespace-nowrap">{formatMoney(d.amount_billed)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Other charge or credit">
              <Button variant="secondary" onClick={() => setLineList([...lines, { type: 'free', description: '', amount: 0 }])}>
                + Add a line
              </Button>
              <p className="text-xs text-slate-400 mt-2">For time and material or call-outs. Use a negative amount for a credit.</p>
            </Panel>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-6">
          <Panel title="Notes on the invoice">
            <Label htmlFor="notes">The client sees this</Label>
            <Textarea id="notes" disabled={!editable} value={fields.notes} onChange={(e) => edit('notes', e.target.value)} placeholder="Payment instructions, PO number" />
          </Panel>
          <Panel title="Totals">
            <dl className="space-y-2 text-sm text-slate-300">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(totals.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>{invoiceTaxLabel(priced, fields.tax_pct)}</dt><dd>{formatMoney(totals.tax)}</dd></div>
              <div className="flex justify-between"><dt>Less holdback ({Number(fields.holdback_pct) || 0}%)</dt><dd>{formatMoney(-totals.holdback)}</dd></div>
              <div className="flex justify-between text-white text-xl font-bold border-t border-slate-800 pt-3"><dt>Amount due</dt><dd>{formatMoney(totals.total)}</dd></div>
            </dl>
            {options.project && (
              <p className="text-xs text-slate-400 mt-4">
                Billed on other sent invoices for {options.project.title}: {formatMoney(options.billed_amount)} before tax, against a revised contract of {formatMoney(options.project.revised_contract)}.
              </p>
            )}
            {invoice.paid_at && <p className="text-sm text-emerald-300 mt-3">Paid {formatValue('date', invoice.paid_at)}</p>}
          </Panel>
        </div>

        {canWrite && invoice.status !== 'Void' && (
          <Panel title="What happens next">
            <div className="flex flex-wrap gap-2">
              {draft && (
                <Button disabled={!!busy || lines.length === 0} onClick={() => move('Sent', 'Marked as sent. It now shows in Receivables.')}>
                  Mark sent
                </Button>
              )}
              {(invoice.status === 'Sent' || invoice.status === 'Overdue') && (
                <>
                  <Button disabled={!!busy} onClick={() => move('Paid', 'Marked as paid. The receivable is collected.')}>
                    Mark paid
                  </Button>
                  <Button variant="secondary" disabled={!!busy} onClick={() => move('Draft', 'Back to Draft. The receivable was removed.', 'Set this invoice back to Draft? Its receivable is removed until it is sent again.')}>
                    Back to Draft
                  </Button>
                </>
              )}
              {invoice.status === 'Paid' && (
                <Button variant="secondary" disabled={!!busy} onClick={() => move('Sent', 'Payment undone. The receivable is open again.', 'Undo this payment? The invoice goes back to Sent and the receivable reopens.')}>
                  Undo payment
                </Button>
              )}
              {invoice.status !== 'Paid' && (
                <Button variant="danger" disabled={!!busy} onClick={() => move('Void', 'Voided.', 'Void this invoice? This cannot be undone. Its change orders and draws can be billed again and its receivable is removed.')}>
                  Void
                </Button>
              )}
              {canDelete && draft && (
                <Button variant="danger" disabled={!!busy} onClick={remove}>
                  Delete draft
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-3">Marking it sent does not email anyone. Print it and send it yourself.</p>
          </Panel>
        )}
      </div>
    </>
  );
}
