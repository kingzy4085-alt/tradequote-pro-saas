'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SEARCH_MIN_LENGTH, type QuickAction, type SearchGroup } from '@/lib/search';

interface Entry {
  key: string;
  section: string;
  label: string;
  detail?: string | null;
  tag?: string | null;
  href: string;
}

/**
 * Search everything from one box: records by name, client, number or address, plus the
 * pages in the menu and the "new" shortcuts. Opened with Ctrl+K, Cmd+K or the search button.
 */
export default function CommandPalette({ open, onClose, pages, actions }: { open: boolean; onClose: () => void; pages: { href: string; label: string }[]; actions: QuickAction[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const term = query.trim();
  const searching = term.length >= SEARCH_MIN_LENGTH;

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setGroups([]);
    setState('idle');
    setActive(0);
    inputRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !searching) {
      setGroups([]);
      setState('idle');
      return;
    }
    const controller = new AbortController();
    setState('loading');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?${new URLSearchParams({ q: term })}`, { cache: 'no-store', signal: controller.signal });
        if (res.status === 401) {
          window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        if (!res.ok) throw new Error('search failed');
        const json = await res.json();
        setGroups(json.groups ?? []);
        setState('idle');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, searching, term]);

  const entries = useMemo<Entry[]>(() => {
    const needle = term.toLowerCase();
    const matches = (label: string) => !needle || label.toLowerCase().includes(needle);
    const records = groups.flatMap((g) => g.hits.map((h) => ({ key: `r:${g.slug}:${h.id}`, section: g.label, label: h.title || 'Untitled', detail: h.detail, tag: h.status, href: h.href })));
    const create = actions.filter((a) => matches(a.label)).map((a) => ({ key: `a:${a.href}`, section: 'Create', label: a.label, href: a.href }));
    const go = pages.filter((p) => matches(p.label)).map((p) => ({ key: `p:${p.href}`, section: 'Go to', label: p.label, href: p.href }));
    // With nothing typed, the shortcuts and a short list of pages; the full menu is one keystroke away
    return [...records, ...create, ...(needle ? go : go.slice(0, 8))];
  }, [groups, actions, pages, term]);

  useEffect(() => setActive(0), [entries.length, term]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (entries.length ? (i + 1) % entries.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (entries.length ? (i - 1 + entries.length) % entries.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(entries[active]);
    }
  };

  let lastSection = '';
  return (
    <div className="print:hidden fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-6 sm:pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKeyDown} className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-800 p-3">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={entries[active] ? `palette-${active}` : undefined}
            aria-label="Search clients, quotes, jobs and invoices"
            placeholder="Search clients, quotes, jobs, invoices…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-base text-white placeholder-slate-500"
          />
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">
            Close
          </button>
        </div>

        <ul ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto p-2">
          {entries.map((entry, i) => {
            const heading = entry.section !== lastSection ? entry.section : null;
            lastSection = entry.section;
            return (
              <li key={entry.key} role="presentation">
                {heading && <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{heading}</p>}
                <div
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(entry)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-3 text-sm ${i === active ? 'bg-amber-500/10 text-amber-300' : 'text-slate-200'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{entry.label}</span>
                    {entry.detail && <span className="block truncate text-xs text-slate-400">{entry.detail}</span>}
                  </span>
                  {entry.tag && <span className="shrink-0 rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">{entry.tag}</span>}
                </div>
              </li>
            );
          })}
        </ul>

        <p role="status" className="border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
          {state === 'error'
            ? 'Search could not be reached. Check your connection and try again.'
            : state === 'loading'
              ? 'Searching…'
              : searching && groups.length === 0
                ? entries.length
                  ? 'No records match. Pages and shortcuts are listed above.'
                  : 'Nothing matches that.'
                : searching
                  ? `${groups.reduce((n, g) => n + g.hits.length, 0)} records found. Enter opens the highlighted one.`
                  : 'Type a name, address, phone number or quote number. Arrow keys move, Enter opens.'}
        </p>
      </div>
    </div>
  );
}
