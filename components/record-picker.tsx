'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input, Select } from '@/components/ui';

type Kind = 'project' | 'client';
type Option = { id: string; title: string };

const SOURCE: Record<Kind, { slug: string; plural: string }> = {
  project: { slug: 'projects', plural: 'projects' },
  client: { slug: 'crm', plural: 'clients' },
};
const LOAD_LIMIT = 200;

/**
 * A select of the company's projects or clients, loaded from the module API. Past the
 * load limit it also shows a search box. A value the list didn't return (older than the
 * limit, or a record this person can't read) stays selected, so saving never clears it.
 */
export default function RecordPicker({
  kind,
  id,
  value,
  onChange,
  placeholder,
  invalid,
  ariaLabel,
  className,
}: {
  kind: Kind;
  id?: string;
  value: string;
  onChange: (id: string, title: string) => void;
  placeholder: string;
  invalid?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const { slug, plural } = SOURCE[kind];
  const [options, setOptions] = useState<Option[]>([]);
  const [current, setCurrent] = useState<Option | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const q = search.trim();
    const timer = setTimeout(
      async () => {
        const params = new URLSearchParams({ picker: '1', limit: String(LOAD_LIMIT) });
        if (q) params.set('q', q);
        try {
          const res = await fetch(`/api/modules/${slug}?${params}`, { cache: 'no-store', signal: controller.signal });
          if (!res.ok) throw new Error(String(res.status));
          const json = await res.json();
          setOptions(json.data ?? []);
          if (!q) setTotal(json.count ?? 0);
          setLoadFailed(false);
        } catch {
          if (!controller.signal.aborted) setLoadFailed(true);
        }
      },
      q ? 250 : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug, search, attempt]);

  // Name the current value when it isn't in the loaded list
  useEffect(() => {
    if (!value || current?.id === value || options.some((o) => o.id === value)) return;
    const controller = new AbortController();
    fetch(`/api/modules/${slug}/${value}`, { cache: 'no-store', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setCurrent({ id: value, title: json?.data?.title ?? `Current ${kind}` }))
      .catch(() => {
        if (!controller.signal.aborted) setCurrent({ id: value, title: `Current ${kind}` });
      });
    return () => controller.abort();
  }, [slug, kind, value, options, current]);

  const choices = useMemo(() => {
    const list = options.map((o) => ({ value: o.id, label: o.title }));
    if (value && !options.some((o) => o.id === value)) list.unshift({ value, label: current?.id === value ? current.title : 'Loading...' });
    return list;
  }, [options, value, current]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <div className={className}>
      {total > LOAD_LIMIT && (
        <Input type="search" aria-label={`Search ${plural}`} placeholder={`Search ${plural}...`} value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
      )}
      <Select
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        value={value}
        options={choices}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value, choices.find((c) => c.value === e.target.value)?.label ?? '')}
      />
      {loadFailed && (
        <p className="mt-1 text-sm text-slate-400">
          Your {plural} couldn't be loaded.{' '}
          <button type="button" onClick={retry} className="text-amber-400 hover:underline">
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
