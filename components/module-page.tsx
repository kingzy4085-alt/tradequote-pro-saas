'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, FieldError, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { formatValue } from '@/lib/format';
import { getModule, type FieldDef } from '@/lib/modules';

// Modules with their own detail page (line items, photos, sign-off); the row title opens it
const DETAIL_PAGES = new Set(['estimates', 'daily-logs']);

type Row = Record<string, unknown> & { id: string; title: string; status: string; created_at: string };
type FormState = Record<string, string | boolean>;

function emptyForm(fields: FieldDef[], status: string): FormState {
  const f: FormState = { title: '', status, notes: '' };
  for (const d of fields) f[d.key] = d.type === 'boolean' ? false : '';
  return f;
}

function rowToForm(row: Row, fields: FieldDef[]): FormState {
  const f: FormState = { title: row.title ?? '', status: row.status ?? '', notes: (row.notes as string) ?? '' };
  for (const d of fields) {
    const v = row[d.key];
    f[d.key] = d.type === 'boolean' ? Boolean(v) : v === null || v === undefined ? '' : String(v);
  }
  return f;
}

export default function ModulePage({ slug, canWrite, canDelete }: { slug: string; canWrite: boolean; canDelete: boolean }) {
  const mod = getModule(slug)!;
  const listColumns = useMemo(() => mod.fields.filter((f) => f.type !== 'textarea').slice(0, 3), [mod]);

  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(mod.fields, mod.statuses[0]));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (statusFilter) params.set('status', statusFilter);
    try {
      const res = await fetch(`/api/modules/${slug}?${params}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not load records');
      setRows(json.data ?? []);
      setCount(json.count ?? json.data?.length ?? 0);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load records');
    } finally {
      setLoading(false);
    }
  }, [slug, query, statusFilter]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm(mod.fields, mod.statuses[0]));
    setFieldErrors({});
    setSaveError('');
    setFormOpen(true);
    setTimeout(() => titleRef.current?.focus(), 0);
  }

  function openEdit(row: Row) {
    setEditingId(row.id);
    setForm(rowToForm(row, mod.fields));
    setFieldErrors({});
    setSaveError('');
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => titleRef.current?.focus(), 0);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    setFieldErrors({});
    try {
      const res = await fetch(editingId ? `/api/modules/${slug}/${editingId}` : `/api/modules/${slug}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.details && typeof json.details === 'object') setFieldErrors(json.details);
        setSaveError(json.error ?? 'Could not save');
        return;
      }
      setNotice(editingId ? 'Changes saved.' : `${mod.titleLabel} added.`);
      setFormOpen(false);
      setEditingId(null);
      load();
    } catch {
      setSaveError('Network error — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(`Delete "${row.title}"? This can't be undone.`)) return;
    const res = await fetch(`/api/modules/${slug}/${row.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice('');
      setLoadError(json.error ?? 'Could not delete');
      return;
    }
    setNotice('Deleted.');
    setRows((r) => r.filter((x) => x.id !== row.id));
    setCount((c) => Math.max(0, c - 1));
  }

  const set = (key: string, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <>
      <PageHeader
        title={mod.label}
        subtitle={mod.description}
        back={{ href: '/', label: 'Back to Command Center' }}
        actions={canWrite && !formOpen ? <Button onClick={openCreate}>+ New {mod.titleLabel}</Button> : undefined}
      />

      {notice && (
        <div className="mb-6">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      {formOpen && canWrite && (
        <Panel title={editingId ? `Edit ${mod.titleLabel}` : `New ${mod.titleLabel}`} className="mb-8">
          <form onSubmit={save} noValidate>
            {saveError && (
              <div className="mb-4">
                <Alert>{saveError}</Alert>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label htmlFor="f-title">{mod.titleLabel} *</Label>
                <Input
                  id="f-title"
                  ref={titleRef}
                  value={form.title as string}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder={mod.titlePlaceholder}
                  aria-invalid={!!fieldErrors.title}
                  maxLength={300}
                  required
                />
                <FieldError message={fieldErrors.title} />
              </div>
              {mod.fields.map((def) => (
                <FieldInput key={def.key} def={def} value={form[def.key]} error={fieldErrors[def.key]} onChange={(v) => set(def.key, v)} />
              ))}
              <div>
                <Label htmlFor="f-status">Status</Label>
                <Select id="f-status" value={form.status as string} onChange={(e) => set('status', e.target.value)} options={mod.statuses} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="f-notes">Notes</Label>
                <Textarea id="f-notes" value={form.notes as string} onChange={(e) => set('notes', e.target.value)} rows={3} />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Save Changes' : `Save ${mod.titleLabel}`}
              </Button>
            </div>
          </form>
        </Panel>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <Input
          type="search"
          aria-label={`Search ${mod.label}`}
          placeholder={`Search ${mod.label.toLowerCase()}...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="sm:max-w-sm"
        />
        <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={mod.statuses} placeholder="All statuses" className="sm:max-w-[14rem]" />
      </div>

      {loadError && (
        <div className="mb-6">
          <Alert>{loadError}</Alert>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white">Records ({count})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                <th className="p-4">{mod.titleLabel}</th>
                {listColumns.map((c) => (
                  <th key={c.key} className="p-4">
                    {c.label}
                  </th>
                ))}
                <th className="p-4">Status</th>
                <th className="p-4">Created</th>
                {(canWrite || canDelete) && <th className="p-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={listColumns.length + 4} className="p-6 text-center text-slate-400">
                    Loading records...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={listColumns.length + 4} className="p-6 text-center text-slate-400">
                    {query || statusFilter ? 'No records match your search.' : canWrite ? `No records yet. Add your first ${mod.titleLabel.toLowerCase()} above.` : 'No records yet.'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="p-4 font-medium text-white">
                      {DETAIL_PAGES.has(slug) ? (
                        <Link href={`/${slug}/${row.id}`} className="hover:text-amber-400 hover:underline">
                          {row.title}
                        </Link>
                      ) : (
                        row.title
                      )}
                    </td>
                    {listColumns.map((c) => (
                      <td key={c.key} className="p-4 text-slate-300">
                        {formatValue(c.type, row[c.key])}
                      </td>
                    ))}
                    <td className="p-4">
                      <Badge>{row.status}</Badge>
                    </td>
                    <td className="p-4 text-slate-400">{new Date(row.created_at).toLocaleDateString('en-CA')}</td>
                    {(canWrite || canDelete) && (
                      <td className="p-4 text-right whitespace-nowrap space-x-2">
                        {slug === 'proposals' && (
                          <Link href={`/print/proposal/${row.id}`} className="text-xs font-semibold text-amber-400 hover:underline mr-2">
                            Print
                          </Link>
                        )}
                        {canWrite && (
                          <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>
                            Edit
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="danger" size="sm" onClick={() => remove(row)}>
                            Delete
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function FieldInput({ def, value, error, onChange }: { def: FieldDef; value: string | boolean | undefined; error?: string; onChange: (v: string | boolean) => void }) {
  const id = `f-${def.key}`;
  const label = `${def.label}${def.required ? ' *' : ''}`;
  if (def.type === 'boolean') {
    return (
      <label className="flex items-center gap-3 text-sm text-slate-300 md:mt-6">
        <input id={id} type="checkbox" className="h-5 w-5 accent-amber-500" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {def.label}
      </label>
    );
  }
  const common = { id, value: (value as string) ?? '', 'aria-invalid': !!error, required: def.required };
  return (
    <div className={def.type === 'textarea' ? 'md:col-span-2' : undefined}>
      <Label htmlFor={id}>{label}</Label>
      {def.type === 'textarea' ? (
        <Textarea {...common} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder} />
      ) : def.type === 'select' ? (
        <Select {...common} onChange={(e) => onChange(e.target.value)} options={def.options ?? []} placeholder="Select..." />
      ) : (
        <Input
          {...common}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          type={def.type === 'money' || def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : def.type === 'email' ? 'email' : def.type === 'tel' ? 'tel' : 'text'}
          step={def.type === 'money' ? '0.01' : def.type === 'number' ? 'any' : undefined}
          inputMode={def.type === 'money' || def.type === 'number' ? 'decimal' : undefined}
        />
      )}
      <FieldError message={error} />
    </div>
  );
}
