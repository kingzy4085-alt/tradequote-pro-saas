'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { estimateTotals, type EstimateLine } from '@/lib/estimate-math';
import { formatMoney } from '@/lib/format';

const BLANK: EstimateLine = { description: '', quantity: 1, unit: 'ea', material_unit_cost: 0, labour_hours_per_unit: 0 };
const HEADER_KEYS = ['title', 'status', 'client_name', 'client_address', 'labour_rate', 'markup_percentage', 'tax_percentage', 'scope', 'terms'] as const;
type Header = Record<(typeof HEADER_KEYS)[number], string>;

const toHeader = (e: Record<string, unknown>): Header =>
  Object.fromEntries(HEADER_KEYS.map((k) => [k, e[k] === null || e[k] === undefined ? '' : String(e[k])])) as Header;

const cell = 'px-3 py-2 rounded-lg';

export default function EstimateEditor({
  estimate,
  initialItems,
  statuses,
  proposal,
  canWrite,
}: {
  estimate: Record<string, unknown> & { id: string };
  initialItems: EstimateLine[];
  statuses: string[];
  /** The proposal made from this estimate, if there is one. */
  proposal: { id: string; status: string } | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [converting, setConverting] = useState(false);
  // What the client was shown can't move under them. The database refuses it too.
  const withClient = proposal?.status === 'Sent' || proposal?.status === 'Accepted';
  const [header, setHeader] = useState<Header>(() => toHeader(estimate));
  const [items, setItems] = useState<EstimateLine[]>(() => (initialItems.length ? initialItems : [{ ...BLANK }]));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const t = estimateTotals(items, header.labour_rate, header.markup_percentage, header.tax_percentage);
  const editHeader = (k: keyof Header, v: string) => {
    setHeader((h) => ({ ...h, [k]: v }));
    setDirty(true);
  };
  const editItems = (next: EstimateLine[]) => {
    setItems(next);
    setDirty(true);
  };
  const setItem = (i: number, k: keyof EstimateLine, v: string) => editItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  async function save() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      // Rates first: the server computes the stored total from the saved rates
      const res = await fetch(`/api/modules/estimates/${estimate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(header),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = json.details ? Object.values(json.details as Record<string, string>).join(' ') : '';
        throw new Error([json.error ?? 'Could not save', details].filter(Boolean).join(': '));
      }
      // Locked with the proposal, so they can't have changed. The header above is all this save has.
      if (!withClient) {
        const lines = items.filter((it) => String(it.description).trim() || Number(it.material_unit_cost) || Number(it.labour_hours_per_unit));
        const res2 = await fetch(`/api/estimates/${estimate.id}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: lines }),
        });
        const json2 = await res2.json().catch(() => ({}));
        if (!res2.ok) throw new Error(json2.error ?? 'Could not save the lines');
      }
      setDirty(false);
      setNotice('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function createProposal() {
    setConverting(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/estimates/${estimate.id}/convert`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not create the proposal');
      router.push(`/proposals/${json.data.id}`);
    } catch (err) {
      setError(err instanceof TypeError ? 'Network error. Check your connection and try again.' : err instanceof Error ? err.message : 'Could not create the proposal');
      setConverting(false);
    }
  }

  const canEditLines = canWrite && !withClient;
  const field = (k: keyof Header, label: string, type = 'text', locked = false) => (
    <div>
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type={type} min={type === 'number' ? 0 : undefined} step="any" value={header[k]} disabled={!canWrite || locked} onChange={(e) => editHeader(k, e.target.value)} />
    </div>
  );

  return (
    <>
      <PageHeader
        title={header.title || 'Untitled estimate'}
        subtitle={header.client_name || undefined}
        back={{ href: '/estimates', label: 'Back to Estimates' }}
        actions={
          <>
            {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
            <Link
              href={`/print/estimate/${estimate.id}`}
              onClick={(e) => {
                if (dirty && !window.confirm('You have unsaved changes. The preview shows the last saved version. Open it anyway?')) e.preventDefault();
              }}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700 px-4 py-2.5 rounded-lg"
            >
              Preview
            </Link>
            {proposal ? (
              <Link href={`/proposals/${proposal.id}`} className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700 px-4 py-2.5 rounded-lg">
                Open proposal
              </Link>
            ) : (
              canWrite && (
                <Button variant="secondary" onClick={createProposal} disabled={converting || dirty} title={dirty ? 'Save your changes first' : undefined}>
                  {converting ? 'Creating…' : 'Create proposal'}
                </Button>
              )
            )}
            {canWrite && (
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {notice && !dirty && <Alert tone="success">{notice}</Alert>}
        {!canWrite && <Alert tone="info">You can view this estimate but not change it.</Alert>}
        {withClient && proposal && (
          <Alert tone="info">
            The proposal for this estimate is {proposal.status.toLowerCase()}, so its price and lines are locked.
            {proposal.status === 'Sent' && (
              <>
                {' '}
                To change them, set{' '}
                <Link href={`/proposals/${proposal.id}`} className="underline">
                  the proposal
                </Link>{' '}
                back to Draft first.
              </>
            )}
            {proposal.status === 'Accepted' && ' To add work to the job, use a change order.'}
          </Alert>
        )}

        {t.labourHours > 0 && !(Number(header.labour_rate) > 0) && (
          <Alert tone="info">This estimate has {t.labourHours.toFixed(2)} labour hours and no labour rate, so the labour is quoted at $0. Enter a labour rate below, or set a default in Company Profile for new estimates.</Alert>
        )}

        <Panel>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {field('title', 'Project')}
            {field('client_name', 'Client name')}
            {field('client_address', 'Client / site address')}
            {field('labour_rate', 'Labour rate ($/hr)', 'number', withClient)}
            {field('markup_percentage', 'Markup %', 'number', withClient)}
            {field('tax_percentage', 'Tax %', 'number', withClient)}
            <div>
              <Label htmlFor="status">Status</Label>
              <Select id="status" options={statuses} value={header.status} disabled={!canWrite} onChange={(e) => editHeader('status', e.target.value)} />
            </div>
          </div>
        </Panel>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="p-3 w-[34%]">Description</th>
                  <th className="p-3">Qty</th>
                  <th className="p-3">Unit</th>
                  <th className="p-3">Material $/unit</th>
                  <th className="p-3">Labour hrs/unit</th>
                  <th className="p-3 text-right">Material</th>
                  <th className="p-3 text-right">Hours</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="p-2">
                      <Input aria-label={`Line ${i + 1} description`} className={cell} value={it.description} disabled={!canEditLines} maxLength={500} placeholder="e.g. 3/4in EMT conduit" onChange={(e) => setItem(i, 'description', e.target.value)} />
                    </td>
                    <td className="p-2">
                      <Input aria-label={`Line ${i + 1} quantity`} className={cell} type="number" min={0} step="any" value={it.quantity} disabled={!canEditLines} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
                    </td>
                    <td className="p-2">
                      <Input aria-label={`Line ${i + 1} unit`} className={cell} value={it.unit} disabled={!canEditLines} maxLength={20} onChange={(e) => setItem(i, 'unit', e.target.value)} />
                    </td>
                    <td className="p-2">
                      <Input aria-label={`Line ${i + 1} material cost per unit`} className={cell} type="number" min={0} step="any" value={it.material_unit_cost} disabled={!canEditLines} onChange={(e) => setItem(i, 'material_unit_cost', e.target.value)} />
                    </td>
                    <td className="p-2">
                      <Input aria-label={`Line ${i + 1} labour hours per unit`} className={cell} type="number" min={0} step="any" value={it.labour_hours_per_unit} disabled={!canEditLines} onChange={(e) => setItem(i, 'labour_hours_per_unit', e.target.value)} />
                    </td>
                    <td className="p-3 text-right text-slate-300">{formatMoney(t.lines[i].material)}</td>
                    <td className="p-3 text-right text-slate-300">{t.lines[i].hours.toFixed(2)}</td>
                    <td className="p-2 text-right">
                      {canEditLines && (
                        <button type="button" onClick={() => editItems(items.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 px-2" aria-label={`Remove line ${i + 1}`}>
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEditLines && (
            <div className="p-3 border-t border-slate-800">
              <button type="button" onClick={() => editItems([...items, { ...BLANK }])} className="text-amber-400 hover:text-amber-300 font-semibold text-sm">
                + Add line
              </button>
            </div>
          )}
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          <Panel>
            <div className="space-y-4">
              <div>
                <Label htmlFor="scope">Scope of work</Label>
                <Textarea id="scope" rows={5} value={header.scope} disabled={!canWrite} onChange={(e) => editHeader('scope', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="terms">Terms (blank uses your company terms)</Label>
                <Textarea id="terms" rows={4} value={header.terms} disabled={!canWrite} onChange={(e) => editHeader('terms', e.target.value)} />
              </div>
            </div>
          </Panel>
          <Panel>
            <dl className="space-y-2 text-sm">
              {[
                ['Material', formatMoney(t.material)],
                ['Labour hours', t.labourHours.toFixed(2)],
                ['Labour cost', formatMoney(t.labour)],
                ['Subtotal', formatMoney(t.subtotal)],
                [`Markup (${Number(header.markup_percentage) || 0}%)`, formatMoney(t.markup)],
                [`Tax (${Number(header.tax_percentage) || 0}%)`, formatMoney(t.tax)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-slate-300">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <div className="flex justify-between text-white text-xl font-bold border-t border-slate-800 pt-3">
                <dt>Total</dt>
                <dd>{formatMoney(t.total)}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500 mt-4">Markup is added to material and labour; tax is charged on the marked-up price.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
