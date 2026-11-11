'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Input, Label, PageHeader, Panel } from '@/components/ui';
import { assemblySummary, filterAssemblies, isFilledLine, MAX_ASSEMBLY_LINES, STARTER_ASSEMBLIES, type Assembly } from '@/lib/assemblies';
import type { EstimateLine } from '@/lib/estimate-math';
import { formatMoney } from '@/lib/format';

const BLANK: EstimateLine = { description: '', quantity: 1, unit: 'ea', material_unit_cost: 0, labour_hours_per_unit: 0 };
type Draft = { id: string | null; name: string; category: string; lines: EstimateLine[] };

const NETWORK = 'Network error. Check your connection and try again.';

export default function AssembliesManager({ initial, canWrite }: { initial: Assembly[]; canWrite: boolean }) {
  const [list, setList] = useState(initial);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /** Sends one change, then reloads the list so the page shows what the database kept. */
  async function send(url: string, init: RequestInit, done: string): Promise<boolean> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url, { ...init, cache: 'no-store', headers: init.body ? { 'Content-Type': 'application/json' } : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not save');
      const fresh = await fetch('/api/assemblies', { cache: 'no-store' });
      const freshJson = await fresh.json().catch(() => ({}));
      if (fresh.ok) setList(freshJson.data ?? []);
      setNotice(done);
      return true;
    } catch (err) {
      setError(err instanceof TypeError ? NETWORK : err instanceof Error ? err.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    const body = JSON.stringify({ name: draft.name, category: draft.category, lines: draft.lines.filter(isFilledLine) });
    const ok = draft.id
      ? await send(`/api/assemblies/${draft.id}`, { method: 'PUT', body }, 'Assembly saved.')
      : await send('/api/assemblies', { method: 'POST', body }, 'Assembly added.');
    if (ok) setDraft(null);
  }

  async function remove(a: Assembly) {
    if (!window.confirm(`Delete "${a.name}"? Estimates that already used it keep their lines.`)) return;
    await send(`/api/assemblies/${a.id}`, { method: 'DELETE' }, 'Assembly deleted.');
  }

  const setLine = (i: number, k: keyof EstimateLine, v: string) => setDraft((d) => d && { ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const shown = filterAssemblies(list, query);

  return (
    <>
      <PageHeader
        title="Assemblies"
        subtitle="Groups of lines you price over and over. Add one to an estimate in a single click."
        back={{ href: '/estimates', label: 'Back to Estimates' }}
        actions={
          canWrite && !draft ? (
            <Button onClick={() => { setDraft({ id: null, name: '', category: '', lines: [{ ...BLANK }] }); setNotice(''); setError(''); }}>New assembly</Button>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {!canWrite && <Alert tone="info">You can view assemblies but not change them.</Alert>}

        {draft && (
          <Panel title={draft.id ? 'Edit assembly' : 'New assembly'} description="Quantities are for one of this assembly. Costs are your cost; markup and tax come from the estimate.">
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="assembly-name">Name</Label>
                  <Input id="assembly-name" value={draft.name} maxLength={120} placeholder="e.g. EV Charger" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="assembly-category">Trade or category</Label>
                  <Input id="assembly-category" value={draft.category} maxLength={60} placeholder="e.g. Residential" onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
                </div>
              </div>

              <ul className="space-y-3">
                {draft.lines.map((l, i) => (
                  <li key={i} className="border border-slate-800 rounded-xl p-3 grid grid-cols-2 lg:grid-cols-[minmax(0,3fr)_repeat(4,minmax(0,1fr))_auto] gap-3 items-end">
                    <div className="col-span-2 lg:col-span-1">
                      <Label htmlFor={`line-${i}-description`}>Description</Label>
                      <Input id={`line-${i}-description`} value={l.description} maxLength={500} placeholder="e.g. 40A 2-pole breaker" onChange={(e) => setLine(i, 'description', e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor={`line-${i}-quantity`}>Qty</Label>
                      <Input id={`line-${i}-quantity`} type="number" min={0} step="any" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor={`line-${i}-unit`}>Unit</Label>
                      <Input id={`line-${i}-unit`} value={l.unit} maxLength={20} onChange={(e) => setLine(i, 'unit', e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor={`line-${i}-material`}>Material $/unit</Label>
                      <Input id={`line-${i}-material`} type="number" min={0} step="any" value={l.material_unit_cost} onChange={(e) => setLine(i, 'material_unit_cost', e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor={`line-${i}-hours`}>Labour hrs/unit</Label>
                      <Input id={`line-${i}-hours`} type="number" min={0} step="any" value={l.labour_hours_per_unit} onChange={(e) => setLine(i, 'labour_hours_per_unit', e.target.value)} />
                    </div>
                    <Button variant="ghost" className="col-span-2 lg:col-span-1 min-h-[48px] lg:min-h-0" aria-label={`Remove line ${i + 1}`} onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-3 justify-between">
                <Button variant="secondary" className="min-h-[48px] lg:min-h-0" disabled={draft.lines.length >= MAX_ASSEMBLY_LINES} onClick={() => setDraft({ ...draft, lines: [...draft.lines, { ...BLANK }] })}>
                  Add line
                </Button>
                <div className="flex gap-3">
                  <Button variant="ghost" className="min-h-[48px] lg:min-h-0" disabled={busy} onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                  <Button className="min-h-[48px] lg:min-h-0" disabled={busy} onClick={save}>
                    {busy ? 'Saving…' : 'Save assembly'}
                  </Button>
                </div>
              </div>
            </div>
          </Panel>
        )}

        {list.length === 0 && !draft && (
          <Panel title="No assemblies yet" description="Start from a set of common electrical assemblies and change the prices to yours, or build your own.">
            {canWrite && (
              <Button className="min-h-[48px] lg:min-h-0" disabled={busy} onClick={() => send('/api/assemblies/starters', { method: 'POST' }, 'Starter assemblies loaded. Check the prices against your own costs.')}>
                {busy ? 'Loading…' : `Load ${STARTER_ASSEMBLIES.length} starter assemblies`}
              </Button>
            )}
          </Panel>
        )}

        {list.length > 0 && (
          <>
            <div>
              <Label htmlFor="assembly-search">Search assemblies</Label>
              <Input id="assembly-search" type="search" value={query} placeholder="Name, trade or a line" onChange={(e) => setQuery(e.target.value)} />
            </div>
            {shown.length === 0 && <p className="text-slate-400 text-sm">No assemblies match that search.</p>}
            <ul className="grid lg:grid-cols-2 gap-4">
              {shown.map((a) => {
                const s = assemblySummary(a.lines);
                return (
                  <li key={a.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-white font-semibold">{a.name}</h2>
                        <p className="text-sm text-slate-400">
                          {a.lines.length} {a.lines.length === 1 ? 'line' : 'lines'} · {formatMoney(s.material)} material · {s.hours.toFixed(2)} hrs
                        </p>
                      </div>
                      {a.category && <Badge>{a.category}</Badge>}
                    </div>
                    <ul className="text-sm text-slate-300 space-y-1">
                      {a.lines.slice(0, 4).map((l, i) => (
                        <li key={i} className="truncate">
                          {Number(l.quantity)} {l.unit} · {l.description || 'No description'}
                        </li>
                      ))}
                      {a.lines.length > 4 && <li className="text-slate-500">and {a.lines.length - 4} more</li>}
                    </ul>
                    {canWrite && (
                      <div className="flex gap-3">
                        <Button variant="secondary" className="min-h-[48px] lg:min-h-0" disabled={busy} onClick={() => { setDraft({ id: a.id, name: a.name, category: a.category, lines: a.lines.map((l) => ({ ...l })) }); setNotice(''); setError(''); window.scrollTo({ top: 0 }); }}>
                          Edit
                        </Button>
                        <Button variant="danger" className="min-h-[48px] lg:min-h-0" disabled={busy} onClick={() => remove(a)}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
