'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Input, Label, PageHeader, Panel, Select } from '@/components/ui';
import { REGIONS, getItem } from '@/lib/costbook';
import { TRADES, type CompanyPrice } from '@/lib/costbook/types';
import { formatMoney } from '@/lib/format';
import { PRICE_BOOK_MAX_ITEMS, parsePriceCsv, priceBookCsv } from '@/lib/price-book';

interface ReferenceItem {
  code: string;
  trade: string;
  category: string;
  description: string;
  unit: string;
  pack: string | null;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  asOf: string;
  referenceUnitCost: number;
  referenceLabourHours: number;
  referenceNote: string | null;
  company: { unitCost: number; labourHours: number | null } | null;
}

const NETWORK = 'Network error. Check your connection and try again.';
const CONFIDENCE_WORDS = { high: 'Seen on a shop page', medium: 'From a dated guide', low: 'Worked out from similar items' } as const;
const TRADE_OPTIONS = [{ value: '', label: 'All trades' }, ...TRADES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))];

const hours = (h: number) => `${Math.round(h * 1000) / 1000} h`;

/** One row of the price book: the reference price, and boxes for your own price and labour hours. */
function PriceRow({
  code,
  title,
  detail,
  unit,
  reference,
  mine,
  canWrite,
  busy,
  onSave,
  onRemove,
}: {
  code: string;
  title: string;
  detail: string;
  unit: string;
  reference?: { cost: number; hours: number; note: string | null; trust: string };
  mine: { unitCost: number; labourHours?: number | null } | null;
  canWrite: boolean;
  busy: boolean;
  onSave: (code: string, unitCost: number, labourHours: number | null) => Promise<boolean>;
  onRemove: (code: string) => Promise<void>;
}) {
  const [cost, setCost] = useState(mine ? String(mine.unitCost) : '');
  const [labour, setLabour] = useState(mine?.labourHours != null ? String(mine.labourHours) : '');
  const [problem, setProblem] = useState('');
  const savedCost = mine ? String(mine.unitCost) : '';
  const savedLabour = mine?.labourHours != null ? String(mine.labourHours) : '';
  const dirty = cost !== savedCost || labour !== savedLabour;

  // The saved figures change after a save or an import: show them
  useEffect(() => {
    setCost(savedCost);
    setLabour(savedLabour);
  }, [savedCost, savedLabour]);

  async function save() {
    const price = Number(cost);
    const h = labour.trim() === '' ? null : Number(labour);
    if (cost.trim() === '' || !Number.isFinite(price) || price < 0) return setProblem('Type your price, 0 or more.');
    if (h !== null && (!Number.isFinite(h) || h < 0)) return setProblem('Labour hours must be 0 or more.');
    setProblem('');
    await onSave(code, price, h);
  }

  return (
    <li className="border border-slate-800 rounded-xl p-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
      <div className="min-w-0">
        <p className="font-medium text-slate-100">{title}</p>
        <p className="text-sm text-slate-400 mt-1 break-words">{detail}</p>
        {reference && (
          <p className="mt-2 flex flex-wrap gap-2 items-center">
            <Badge>{reference.trust}</Badge>
          </p>
        )}
      </div>

      <div>
        {reference ? (
          <>
            <p className="text-xs uppercase tracking-wide text-slate-500">Reference price</p>
            <p className="text-lg font-semibold text-slate-100">
              {formatMoney(reference.cost)} <span className="text-sm font-normal text-slate-400">per {unit}</span>
            </p>
            <p className="text-sm text-slate-400">{hours(reference.hours)} labour per {unit}</p>
            {reference.note && <p className="text-xs text-amber-400 mt-1">{reference.note}</p>}
          </>
        ) : (
          <p className="text-sm text-slate-400">Your own item. No reference price.</p>
        )}
      </div>

      <div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`cost-${code}`}>Your price per {unit}</Label>
            <Input id={`cost-${code}`} type="number" inputMode="decimal" min={0} step="any" value={cost} placeholder={reference ? String(reference.cost) : '0.00'} disabled={!canWrite} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`labour-${code}`}>Your labour hours</Label>
            <Input id={`labour-${code}`} type="number" inputMode="decimal" min={0} step="any" value={labour} placeholder={reference ? String(reference.hours) : '0'} disabled={!canWrite} onChange={(e) => setLabour(e.target.value)} />
          </div>
        </div>
        {problem && <p className="text-sm text-red-400 mt-2" role="alert">{problem}</p>}
        {canWrite && (
          <div className="flex flex-wrap gap-3 mt-3">
            <Button className="min-h-[48px] lg:min-h-0" disabled={busy || !dirty} onClick={save}>
              Save my price
            </Button>
            {mine && (
              <Button variant="ghost" className="min-h-[48px] lg:min-h-0" disabled={busy} onClick={() => onRemove(code)}>
                {reference ? 'Use the reference price' : 'Delete'}
              </Button>
            )}
          </div>
        )}
        {mine && !dirty && <p className="text-sm text-emerald-400 mt-2">Estimates use your price for this.</p>}
      </div>
    </li>
  );
}

export default function PriceBookManager({ initial, canWrite, province }: { initial: CompanyPrice[]; canWrite: boolean; province: string }) {
  const [own, setOwn] = useState(initial);
  const [query, setQuery] = useState('');
  const [trade, setTrade] = useState('');
  const [region, setRegion] = useState(REGIONS.some((r) => r.code === province) ? province : 'ON');
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [regionName, setRegionName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [csv, setCsv] = useState('');
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [custom, setCustom] = useState({ code: '', description: '', unit: 'ea', cost: '', hours: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const mineFor = (code: string) => own.find((p) => p.itemCode === code) ?? null;

  const search = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, region, limit: '60' });
      if (trade) params.set('trade', trade);
      const res = await fetch(`/api/price-book/reference?${params}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error(json.error ?? 'Could not load prices');
      setItems(json.data ?? []);
      setRegionName(json.region?.name ?? '');
      setError('');
    } catch (err) {
      if (id === requestId.current) setError(err instanceof TypeError ? NETWORK : err instanceof Error ? err.message : 'Could not load prices');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [query, trade, region]);

  useEffect(() => {
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [search]);

  async function refreshOwn() {
    const res = await fetch('/api/price-book', { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setOwn(json.data ?? []);
  }

  /** Sends one change, then reloads the prices so the page shows what was kept. */
  async function send(url: string, init: RequestInit, done: string): Promise<boolean> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url, { ...init, cache: 'no-store', headers: init.body ? { 'Content-Type': 'application/json' } : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not save');
      await refreshOwn();
      await search();
      setNotice(done);
      return true;
    } catch (err) {
      setError(err instanceof TypeError ? NETWORK : err instanceof Error ? err.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const savePrice = (code: string, unitCost: number, labourHours: number | null) =>
    send('/api/price-book', { method: 'PUT', body: JSON.stringify([{ itemCode: code, unitCost, labourHours }]) }, 'Saved. Estimates now use your price.');
  const removePrice = async (code: string) => {
    if (!window.confirm(`Remove your price for ${code}? Estimates go back to the reference price.`)) return;
    await send(`/api/price-book?code=${encodeURIComponent(code)}`, { method: 'DELETE' }, 'Removed.');
  };

  async function importCsv(text: string) {
    const parsed = parsePriceCsv(text);
    setCsvErrors(parsed.errors.slice(0, 8));
    if (parsed.errors.length) {
      setError(`Nothing was imported. Fix ${parsed.errors.length === 1 ? 'this line' : `these ${parsed.errors.length} lines`} and try again.`);
      return;
    }
    if (parsed.items.length === 0) {
      setError('There are no prices to import. Each line is: code,unit_cost,labour_hours');
      return;
    }
    let saved = 0;
    for (let n = 0; n < parsed.items.length; n += PRICE_BOOK_MAX_ITEMS) {
      const chunk = parsed.items.slice(n, n + PRICE_BOOK_MAX_ITEMS);
      const ok = await send('/api/price-book', { method: 'PUT', body: JSON.stringify(chunk) }, `Imported ${parsed.items.length} prices.`);
      if (!ok) return;
      saved += chunk.length;
    }
    if (saved === parsed.items.length) {
      setCsv('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) return setError('That file is too large. Import it in smaller files.');
    setCsv(await file.text());
    setNotice('File loaded. Check it, then press Import prices.');
    setError('');
  }

  async function exportCsv() {
    setError('');
    try {
      const res = await fetch('/api/price-book', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not export');
      const blob = new Blob([priceBookCsv(json.data ?? [])], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'my-price-book.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err instanceof TypeError ? NETWORK : err instanceof Error ? err.message : 'Could not export');
    }
  }

  async function addCustom() {
    const price = Number(custom.cost);
    const h = custom.hours.trim() === '' ? null : Number(custom.hours);
    if (!custom.code.trim()) return setError('Give your item a code, like MY-DOOR-30.');
    if (custom.cost.trim() === '' || !Number.isFinite(price) || price < 0) return setError('Type your price, 0 or more.');
    if (h !== null && (!Number.isFinite(h) || h < 0)) return setError('Labour hours must be 0 or more.');
    const ok = await send(
      '/api/price-book',
      { method: 'PUT', body: JSON.stringify([{ itemCode: custom.code.trim(), unitCost: price, labourHours: h, description: custom.description.trim() || undefined, unit: custom.unit.trim() || 'ea' }]) },
      'Item added.'
    );
    if (ok) setCustom({ code: '', description: '', unit: 'ea', cost: '', hours: '' });
  }

  const customItems = own.filter((p) => !getItem(p.itemCode));

  return (
    <>
      <PageHeader
        title="Price Book"
        subtitle="Reference prices for your region, and your own prices beside them. Estimates and calculators use your price whenever you have one."
        back={{ href: '/estimates', label: 'Back to Estimates' }}
        actions={
          <Button variant="secondary" className="min-h-[48px] lg:min-h-0" onClick={exportCsv}>
            Export my prices
          </Button>
        }
      />

      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {!canWrite && <Alert tone="info">You can look at the price book but not change it.</Alert>}

        <Panel title="Find an item" description={`${own.length} of your own prices saved. Reference prices are retail, before tax, in Canadian dollars.`}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <Label htmlFor="pb-search">Search</Label>
              <Input id="pb-search" type="search" value={query} placeholder="e.g. 12/2 cable, EMT, drywall" onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pb-trade">Trade</Label>
              <Select id="pb-trade" value={trade} options={TRADE_OPTIONS} onChange={(e) => setTrade(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pb-region">Prices for</Label>
              <Select id="pb-region" value={region} options={REGIONS.map((r) => ({ value: r.code, label: r.name }))} onChange={(e) => setRegion(e.target.value)} />
            </div>
          </div>
          <p className="text-sm text-slate-400 mt-3" aria-live="polite">
            {loading ? 'Looking…' : `${items.length} item${items.length === 1 ? '' : 's'}${regionName ? ` priced for ${regionName}` : ''}${items.length >= 60 ? '. Narrow the search to see more.' : '.'}`}
          </p>
        </Panel>

        {items.length > 0 && (
          <ul className="space-y-3">
            {items.map((i) => (
              <PriceRow
                key={i.code}
                code={i.code}
                title={i.description}
                detail={`${i.code} · ${i.unit}${i.pack ? ` · sold as ${i.pack}` : ''} · ${i.category} · ${i.source}`}
                unit={i.unit}
                reference={{ cost: i.referenceUnitCost, hours: i.referenceLabourHours, note: i.referenceNote, trust: CONFIDENCE_WORDS[i.confidence] }}
                mine={mineFor(i.code)}
                canWrite={canWrite}
                busy={busy}
                onSave={savePrice}
                onRemove={removePrice}
              />
            ))}
          </ul>
        )}
        {!loading && items.length === 0 && !error && (
          <Panel>
            <p className="text-slate-300">Nothing matches that. Try fewer words, or pick All trades.</p>
          </Panel>
        )}

        <Panel title="Your own items" description="Things the reference book does not have: a door you always use, a subcontractor's rate.">
          {customItems.length > 0 && (
            <ul className="space-y-3 mb-6">
              {customItems.map((p) => (
                <PriceRow key={p.itemCode} code={p.itemCode} title={p.description || p.itemCode} detail={`${p.itemCode} · ${p.unit || 'ea'}`} unit={p.unit || 'ea'} mine={{ unitCost: p.unitCost, labourHours: p.labourHours ?? null }} canWrite={canWrite} busy={busy} onSave={savePrice} onRemove={removePrice} />
              ))}
            </ul>
          )}
          {canWrite ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 items-end">
              <div>
                <Label htmlFor="custom-code">Code</Label>
                <Input id="custom-code" value={custom.code} maxLength={60} placeholder="MY-DOOR-30" onChange={(e) => setCustom({ ...custom, code: e.target.value })} />
              </div>
              <div className="lg:col-span-2">
                <Label htmlFor="custom-description">Description</Label>
                <Input id="custom-description" value={custom.description} maxLength={500} placeholder="30 in interior door, primed" onChange={(e) => setCustom({ ...custom, description: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="custom-unit">Unit</Label>
                <Input id="custom-unit" value={custom.unit} maxLength={20} onChange={(e) => setCustom({ ...custom, unit: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="custom-cost">Your price</Label>
                <Input id="custom-cost" type="number" inputMode="decimal" min={0} step="any" value={custom.cost} onChange={(e) => setCustom({ ...custom, cost: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="custom-hours">Labour hours</Label>
                <Input id="custom-hours" type="number" inputMode="decimal" min={0} step="any" value={custom.hours} onChange={(e) => setCustom({ ...custom, hours: e.target.value })} />
              </div>
              <Button className="min-h-[48px] lg:min-h-0" disabled={busy} onClick={addCustom}>
                Add my item
              </Button>
            </div>
          ) : (
            customItems.length === 0 && <p className="text-slate-400">You have no items of your own yet.</p>
          )}
        </Panel>

        {canWrite && (
          <Panel title="Import prices from a spreadsheet" description="One item per line: code,unit_cost or code,unit_cost,labour_hours. Use the codes shown above. Up to 500 per upload, and a bad line stops the whole import so nothing is half done.">
            <div className="space-y-4">
              <div>
                <Label htmlFor="csv-file">Choose a CSV file</Label>
                <input
                  ref={fileRef}
                  id="csv-file"
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="block w-full min-h-[48px] lg:min-h-0 text-sm text-slate-300 file:mr-3 file:min-h-[48px] lg:file:min-h-0 file:rounded-lg file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-slate-100"
                  onChange={(e) => readFile(e.target.files?.[0])}
                />
              </div>
              <div>
                <Label htmlFor="csv-text">Or paste it here</Label>
                <textarea
                  id="csv-text"
                  value={csv}
                  rows={6}
                  placeholder={'code,unit_cost,labour_hours\nNMD90-14-2,2.35,0.025'}
                  onChange={(e) => setCsv(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:outline focus:outline-2 focus:outline-amber-500"
                />
              </div>
              {csvErrors.length > 0 && (
                <ul className="text-sm text-red-400 list-disc pl-5" role="alert">
                  {csvErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              <Button className="min-h-[48px] lg:min-h-0" disabled={busy || !csv.trim()} onClick={() => importCsv(csv)}>
                {busy ? 'Importing…' : 'Import prices'}
              </Button>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
