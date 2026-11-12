'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { assemblySummary, expandAssembly, filterAssemblies, insertLines, isFilledLine, parseMultiplier, type Assembly } from '@/lib/assemblies';
import { estimateTotals, type EstimateLine } from '@/lib/estimate-math';
import { DEFAULT_NPT_PERCENT, isPermitLine, nptLine, parseNptPercent, permitDescription, productiveHours, withNptAllowance, withPermitLine } from '@/lib/industrial';
import { formatMoney } from '@/lib/format';

const BLANK: EstimateLine = { description: '', quantity: 1, unit: 'ea', material_unit_cost: 0, labour_hours_per_unit: 0 };
const HEADER_KEYS = ['title', 'status', 'client_name', 'client_address', 'labour_rate', 'markup_percentage', 'tax_percentage', 'scope', 'terms'] as const;
type Header = Record<(typeof HEADER_KEYS)[number], string>;

const toHeader = (e: Record<string, unknown>): Header =>
  Object.fromEntries(HEADER_KEYS.map((k) => [k, e[k] === null || e[k] === undefined ? '' : String(e[k])])) as Header;

const cell = 'px-3 py-2 rounded-lg';
const lineAction = 'inline-flex items-center min-h-[48px] lg:min-h-0 lg:py-1 text-amber-400 hover:text-amber-300 font-semibold text-sm';

export default function EstimateEditor({
  estimate,
  initialItems,
  statuses,
  proposal,
  province,
  canWrite,
}: {
  estimate: Record<string, unknown> & { id: string };
  initialItems: EstimateLine[];
  statuses: string[];
  /** The proposal made from this estimate, if there is one. */
  proposal: { id: string; status: string } | null;
  /** The company's province, which decides how the permit line is worded. */
  province?: string;
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
  // Industrial extras: the non-productive time allowance and the permit line
  const [nptPct, setNptPct] = useState(String(DEFAULT_NPT_PERCENT));
  const [extraNote, setExtraNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  // Saved assemblies: 'add' picks one from the library, 'save' turns ticked lines into a new one
  const [panel, setPanel] = useState<'add' | 'save' | null>(null);
  const [library, setLibrary] = useState<Assembly[] | null>(null);
  const [asmQuery, setAsmQuery] = useState('');
  const [asmTimes, setAsmTimes] = useState('1');
  const [asmName, setAsmName] = useState('');
  const [asmCategory, setAsmCategory] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [asmBusy, setAsmBusy] = useState(false);
  const [asmError, setAsmError] = useState('');
  const [asmNote, setAsmNote] = useState('');

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

  const removeLine = (i: number) => {
    editItems(items.filter((_, j) => j !== i));
    // Ticks follow their lines
    setPicked((p) => new Set([...p].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
  };

  function addNpt() {
    const hours = productiveHours(items);
    if (hours <= 0) return setExtraNote({ tone: 'error', text: 'Add your lines with labour hours first. The allowance is a share of those hours.' });
    const pct = parseNptPercent(nptPct);
    const line = nptLine(items, pct);
    editItems(withNptAllowance(items, pct));
    setExtraNote({ tone: 'success', text: `Non-productive time is ${line.labour_hours_per_unit} hours: ${pct}% of the ${hours} labour hours on the other lines. Press the button again after changing lines. Save the estimate to keep it.` });
  }

  function addPermit() {
    if (items.some(isPermitLine)) return setExtraNote({ tone: 'error', text: 'This estimate already has a permit line. Type the fee in its material cost.' });
    editItems(withPermitLine(items, province));
    setExtraNote({ tone: 'success', text: `Added "${permitDescription(province)}". Type the fee from the authority's schedule in its material cost. Markup applies to it like any other line.` });
  }

  async function openAdd() {
    setPanel('add');
    setAsmError('');
    setAsmNote('');
    if (library) return;
    setAsmBusy(true);
    try {
      const res = await fetch('/api/assemblies', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not load your assemblies');
      setLibrary(json.data ?? []);
    } catch (err) {
      setAsmError(err instanceof TypeError ? 'Network error. Check your connection and try again.' : err instanceof Error ? err.message : 'Could not load your assemblies');
    } finally {
      setAsmBusy(false);
    }
  }

  function addAssembly(a: Assembly) {
    const times = parseMultiplier(asmTimes);
    const added = expandAssembly(a.lines, times);
    editItems(insertLines(items, added));
    setPicked(new Set());
    setAsmNote(`Added ${added.length} ${added.length === 1 ? 'line' : 'lines'} from ${a.name}${times === 1 ? '' : ` (x${times})`}. Save the estimate to keep them.`);
  }

  function openSave() {
    setPanel('save');
    setAsmError('');
    setAsmNote('');
    setPicked(new Set(items.flatMap((it, i) => (isFilledLine(it) ? [i] : []))));
  }

  async function saveAssembly() {
    const lines = items.filter((it, i) => picked.has(i) && isFilledLine(it));
    if (!asmName.trim()) return setAsmError('Give the assembly a name.');
    if (!lines.length) return setAsmError('Tick at least one line that has a description, a cost or hours.');
    setAsmBusy(true);
    setAsmError('');
    try {
      const res = await fetch('/api/assemblies', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: asmName, category: asmCategory, lines }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not save the assembly');
      setAsmNote(`Saved ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} as the assembly ${asmName.trim()}.`);
      setLibrary(null);
      setAsmName('');
      setAsmCategory('');
      setPanel(null);
    } catch (err) {
      setAsmError(err instanceof TypeError ? 'Network error. Check your connection and try again.' : err instanceof Error ? err.message : 'Could not save the assembly');
    } finally {
      setAsmBusy(false);
    }
  }

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
  // Leaving for the Assemblies page drops anything unsaved here
  const leaveCheck = (e: { preventDefault: () => void }) => {
    if (dirty && !window.confirm('You have unsaved changes on this estimate. Leave without saving?')) e.preventDefault();
  };
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
                  {panel === 'save' && <th className="p-3">Use</th>}
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
                    {panel === 'save' && (
                      <td className="p-2">
                        <label className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] lg:min-h-0 lg:min-w-0 lg:p-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-amber-500"
                            aria-label={`Include line ${i + 1} in the assembly`}
                            checked={picked.has(i)}
                            onChange={(e) => setPicked((p) => { const next = new Set(p); if (e.target.checked) next.add(i); else next.delete(i); return next; })}
                          />
                        </label>
                      </td>
                    )}
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
                        <button type="button" onClick={() => removeLine(i)} className="text-slate-500 hover:text-red-400 px-2 min-h-[48px] min-w-[48px] lg:min-h-0 lg:min-w-0" aria-label={`Remove line ${i + 1}`}>
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
            <div className="p-3 border-t border-slate-800 flex flex-wrap gap-x-6 gap-y-1">
              <button type="button" onClick={() => editItems([...items, { ...BLANK }])} className={lineAction}>
                + Add line
              </button>
              <button type="button" onClick={() => (panel === 'add' ? setPanel(null) : openAdd())} aria-expanded={panel === 'add'} className={lineAction}>
                Add assembly
              </button>
              <button type="button" onClick={() => (panel === 'save' ? setPanel(null) : openSave())} aria-expanded={panel === 'save'} className={lineAction}>
                Save lines as assembly
              </button>
            </div>
          )}
          {canEditLines && (
            <div className="p-3 border-t border-slate-800 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <Label htmlFor="npt-percent">Non-productive time %</Label>
                  <Input id="npt-percent" type="number" min={0} max={100} step="any" value={nptPct} onChange={(e) => setNptPct(e.target.value)} />
                </div>
                <Button variant="secondary" onClick={addNpt}>
                  Add or update NPT allowance
                </Button>
                <Button variant="secondary" onClick={addPermit}>
                  Add permit and inspection fee
                </Button>
              </div>
              <p className="text-sm text-slate-400">The allowance covers time that installs nothing: lockout/tagout, site orientation, permits and waiting on isolations.</p>
              {extraNote && <Alert tone={extraNote.tone}>{extraNote.text}</Alert>}
            </div>
          )}
          {canEditLines && (asmNote || panel) && (
            <div className="p-4 border-t border-slate-800 space-y-4">
              {asmError && <Alert>{asmError}</Alert>}
              {asmNote && <Alert tone="success">{asmNote}</Alert>}

              {panel === 'add' && (
                <>
                  <div className="grid sm:grid-cols-[minmax(0,1fr)_10rem] gap-4">
                    <div>
                      <Label htmlFor="assembly-search">Search your assemblies</Label>
                      <Input id="assembly-search" type="search" value={asmQuery} placeholder="e.g. EV charger" onChange={(e) => setAsmQuery(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="assembly-times">How many</Label>
                      <Input id="assembly-times" type="number" min={0} step="any" value={asmTimes} onChange={(e) => setAsmTimes(e.target.value)} />
                    </div>
                  </div>
                  {asmBusy && <p className="text-sm text-slate-400">Loading your assemblies…</p>}
                  {library && library.length === 0 && (
                    <p className="text-sm text-slate-400">
                      You have no saved assemblies yet. Use Save lines as assembly here, or set some up on the{' '}
                      <Link href="/assemblies" className="underline text-amber-400" onClick={leaveCheck}>
                        Assemblies page
                      </Link>
                      .
                    </p>
                  )}
                  {library && library.length > 0 && (
                    <>
                      <ul className="divide-y divide-slate-800 border border-slate-800 rounded-xl max-h-96 overflow-y-auto">
                        {filterAssemblies(library, asmQuery).map((a) => {
                          const s = assemblySummary(a.lines);
                          return (
                            <li key={a.id} className="flex items-center justify-between gap-3 p-3">
                              <div className="min-w-0">
                                <p className="text-white font-semibold truncate">{a.name}</p>
                                <p className="text-sm text-slate-400 truncate">
                                  {[a.category, `${a.lines.length} ${a.lines.length === 1 ? 'line' : 'lines'}`, `${formatMoney(s.material)} material`, `${s.hours.toFixed(2)} hrs`].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                              <Button variant="secondary" className="min-h-[48px] lg:min-h-0 shrink-0" aria-label={`Add ${a.name}`} onClick={() => addAssembly(a)}>
                                Add
                              </Button>
                            </li>
                          );
                        })}
                        {filterAssemblies(library, asmQuery).length === 0 && <li className="p-3 text-sm text-slate-400">No assemblies match that search.</li>}
                      </ul>
                      <Link href="/assemblies" className="inline-flex items-center min-h-[48px] lg:min-h-0 text-sm text-slate-400 hover:text-slate-200 underline" onClick={leaveCheck}>
                        Manage assemblies
                      </Link>
                    </>
                  )}
                </>
              )}

              {panel === 'save' && (
                <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 items-end">
                  <div>
                    <Label htmlFor="assembly-name">Assembly name</Label>
                    <Input id="assembly-name" value={asmName} maxLength={120} placeholder="e.g. Hot Tub Feed" onChange={(e) => setAsmName(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="assembly-category">Trade or category</Label>
                    <Input id="assembly-category" value={asmCategory} maxLength={60} placeholder="e.g. Residential" onChange={(e) => setAsmCategory(e.target.value)} />
                  </div>
                  <Button className="min-h-[48px] lg:min-h-0" disabled={asmBusy} onClick={saveAssembly}>
                    {asmBusy ? 'Saving…' : `Save ${picked.size} ${picked.size === 1 ? 'line' : 'lines'}`}
                  </Button>
                  <p className="text-sm text-slate-400 sm:col-span-3">Tick the lines to keep in the Use column. The quantities here become the quantities for one of the assembly.</p>
                </div>
              )}
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
