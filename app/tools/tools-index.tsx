'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { TRADE_LABEL, type ToolCard } from '@/components/marketing/tool-labels';
import type { Trade } from '@/lib/costbook';

export default function ToolsIndex({ tools }: { tools: ToolCard[] }) {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () => tools.filter((t) => words.every((w) => [t.name, t.summary, t.category, TRADE_LABEL[t.trade], ...t.keywords].join(' ').toLowerCase().includes(w))),
    // words is derived from q
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tools, q]
  );
  const groups = (Object.keys(TRADE_LABEL) as Trade[]).map((trade) => ({ trade, items: shown.filter((t) => t.trade === trade) })).filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden />
        <input
          type="search"
          aria-label="Search calculators"
          placeholder={`Search ${tools.length} calculators`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-11 pr-4 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 min-h-[48px]"
        />
      </div>
      <p className="mt-3 text-sm text-slate-400" aria-live="polite">{shown.length === tools.length ? `${tools.length} calculators` : `${shown.length} of ${tools.length} calculators`}</p>

      {groups.length === 0 && <p className="mt-10 text-slate-300">Nothing matches &ldquo;{q}&rdquo;. Try a trade (electrical, roofing) or a material (wire, drywall).</p>}

      <div className="mt-8 space-y-12">
        {groups.map((g) => (
          <section key={g.trade} aria-labelledby={`trade-${g.trade}`}>
            <h2 id={`trade-${g.trade}`} className="text-2xl font-bold text-white">{TRADE_LABEL[g.trade]}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((t) => (
                <li key={t.id}>
                  <Link href={`/tools/${t.id}`} className="group flex h-full min-h-[48px] flex-col rounded-xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-amber-500/60 lg:min-h-0">
                    <span className="font-bold text-white group-hover:text-amber-200">{t.name}</span>
                    <span className="mt-1 text-sm text-slate-400">{t.summary}</span>
                    <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-amber-300">Open <ArrowRight className="h-4 w-4" aria-hidden /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
