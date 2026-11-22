'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Label, Select } from '@/components/ui';
import { COSTBOOK_AS_OF, getRegion, searchCatalog, type CompanyPrice, type Trade } from '@/lib/costbook';
import { TRADES } from '@/lib/costbook/types';
import type { EstimateLine } from '@/lib/estimate-math';
import { TRADE_LABEL, addedNote, buildEstimateLines, confidenceHint, parseQuantity, priceCatalogRows, priceSourceLabel } from '@/lib/estimate-helpers';
import { formatMoney } from '@/lib/format';

const SOURCE_STYLE = {
  company: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  reference: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  line: 'bg-slate-700/40 text-slate-300 border-slate-600',
  none: 'bg-red-500/10 text-red-400 border-red-500/20',
} as const;

export default function PriceBookPanel({
  region,
  prices,
  pricesState,
  onNeedPrices,
  onAdd,
}: {
  region: string;
  prices: CompanyPrice[];
  pricesState: 'idle' | 'loading' | 'ready' | 'unavailable';
  onNeedPrices: () => void;
  onAdd: (lines: EstimateLine[], note: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [trade, setTrade] = useState<'' | Trade>('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  useEffect(() => {
    onNeedPrices();
  }, [onNeedPrices]);

  const regionName = getRegion(region).name;
  const rows = useMemo(() => {
    const items = searchCatalog(query, { trade: trade || undefined, limit: 30 });
    return priceCatalogRows(items, region, prices);
  }, [query, trade, region, prices]);
  const quantityOf = (code: string) => parseQuantity(qty[code] ?? '1');

  function add(codes: string[]) {
    const chosen = rows.filter((r) => codes.includes(r.item.code));
    const take = chosen.map((r) => ({ code: r.item.code, description: r.item.description, quantity: quantityOf(r.item.code), unit: r.item.unit }));
    if (!take.some((t) => t.quantity > 0)) return setError('Type a quantity above zero.');
    setError('');
    const built = buildEstimateLines(take, region, prices);
    onAdd(built.lines, addedNote(built, regionName, 'the price book'));
    setTicked(new Set());
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Reference prices are for {regionName}, last checked {COSTBOOK_AS_OF}.{' '}
        {pricesState === 'loading' && 'Loading your own prices…'}
        {pricesState === 'unavailable' && 'Your own prices could not be loaded, so only reference prices are shown.'}
        {pricesState === 'ready' && (prices.length ? `${prices.length} of your own prices are used first.` : 'You have no saved prices yet, so reference prices are shown.')}
      </p>
      <div className="grid sm:grid-cols-[minmax(0,1fr)_14rem] gap-4">
        <div>
          <Label htmlFor="book-search">Search the price book</Label>
          <Input id="book-search" type="search" value={query} placeholder="e.g. 14/2 cable, 2x4, drywall" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="book-trade">Trade</Label>
          <Select id="book-trade" value={trade} onChange={(e) => setTrade(e.target.value as '' | Trade)} options={[{ value: '', label: 'All trades' }, ...TRADES.map((t) => ({ value: t, label: TRADE_LABEL[t] }))]} />
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing matches that search.</p>
      ) : (
        <ul className="divide-y divide-slate-800 border border-slate-800 rounded-xl max-h-[28rem] overflow-y-auto">
          {rows.map(({ item, priced }) => (
            <li key={item.code} className="p-3 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] lg:min-h-0 lg:min-w-0 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-amber-500"
                  aria-label={`Select ${item.description}`}
                  checked={ticked.has(item.code)}
                  onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(item.code); else n.delete(item.code); return n; })}
                />
              </label>
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-white font-semibold">{item.description}</p>
                <p className="text-sm text-slate-400">
                  {formatMoney(priced.materialUnitCost)} per {priced.unit} · {priced.labourHoursPerUnit} labour h per {priced.unit}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  <span className={`inline-block border px-2 py-0.5 rounded-full font-semibold mr-2 ${SOURCE_STYLE[priced.priceSource]}`}>{priceSourceLabel(priced.priceSource)}</span>
                  {confidenceHint(priced.priceSource, priced.confidence)}
                </p>
              </div>
              <div className="w-24">
                <Input aria-label={`Quantity of ${item.description}`} type="number" min={0} step="any" inputMode="decimal" value={qty[item.code] ?? '1'} onChange={(e) => setQty((q) => ({ ...q, [item.code]: e.target.value }))} />
              </div>
              <Button variant="secondary" aria-label={`Add ${item.description}`} onClick={() => add([item.code])}>
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
      {ticked.size > 0 && (
        <Button onClick={() => add([...ticked])}>
          Add {ticked.size} selected {ticked.size === 1 ? 'item' : 'items'}
        </Button>
      )}
    </div>
  );
}
