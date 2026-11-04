'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RecordPicker from '@/components/record-picker';
import { Alert, Badge, Button, FieldError, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { formatValue, inSentence } from '@/lib/format';
import { detailHref, printHref } from '@/lib/detail-pages';
import { editableFields, getModule, manualStatuses, tableColumns, type FieldDef } from '@/lib/modules';
import { PAGE_SIZE, mergePages } from '@/lib/pagination';

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

/** A session that ended mid-visit goes to sign-in and comes back here afterwards. Returns true if it redirected. */
function redirectIfSignedOut(res: Response): boolean {
  if (res.status !== 401) return false;
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  return true;
}

export default function ModulePage({ slug, canWrite, canDelete, initialProject = '' }: { slug: string; canWrite: boolean; canDelete: boolean; initialProject?: string }) {
  const mod = getModule(slug)!;
  const listColumns = useMemo(() => tableColumns(mod), [mod]);
  const formFields = useMemo(() => editableFields(mod), [mod]);
  const computedFields = useMemo(() => mod.fields.filter((f) => f.computed && !f.hidden), [mod]);
  const manual = useMemo(() => manualStatuses(mod), [mod]);
  const firstStatus = manual[0] ?? mod.statuses[0];
  const hasProject = mod.fields.some((f) => f.type === 'project');
  const recordLabel = mod.recordLabel ?? mod.titleLabel;

  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState(initialProject);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(formFields, firstStatus));
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  // Set when the first page of the current search has loaded; an error before that means we know nothing
  const [loaded, setLoaded] = useState(false);

  /** Loads a page from `offset`. A newer request cancels the older one, so stale results can't overwrite it. */
  const fetchPage = useCallback(
    async (offset: number) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoadError('');
      if (offset === 0) {
        setLoading(true);
        setLoaded(false);
      } else {
        setLoadingMore(true);
      }

      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (query.trim()) params.set('q', query.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (hasProject && projectFilter) params.set('project', projectFilter);
      try {
        const res = await fetch(`/api/modules/${slug}?${params}`, { cache: 'no-store', signal: controller.signal });
        if (redirectIfSignedOut(res)) return;
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'Could not load records');
        const page: Row[] = json.data ?? [];
        setRows((current) => (offset === 0 ? page : mergePages(current, page)));
        setCount(json.count ?? page.length);
        if (offset === 0) setLoaded(true);
      } catch (err) {
        if (controller.signal.aborted) return;
        setLoadError(err instanceof TypeError ? 'Network error. Check your connection and try again.' : err instanceof Error ? err.message : 'Could not load records');
      }
      if (inFlight.current === controller) {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [slug, query, statusFilter, hasProject, projectFilter]
  );

  const load = useCallback(() => fetchPage(0), [fetchPage]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => {
      clearTimeout(t);
      inFlight.current?.abort();
    };
  }, [load, query]);

  useEffect(() => setProjectFilter(initialProject), [initialProject]);

  // Keeps ?project= in the address bar, so the filtered list can be linked to and survives a reload
  function filterByProject(id: string) {
    setProjectFilter(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('project', id);
    else url.searchParams.delete('project');
    window.history.replaceState(null, '', url);
  }

  function openCreate() {
    setEditingId(null);
    setEditingRow(null);
    // A new record added from a filtered list belongs to that project
    setForm({ ...emptyForm(formFields, firstStatus), ...(hasProject && projectFilter ? { project_id: projectFilter } : {}) });
    setFieldErrors({});
    setSaveError('');
    setNotice('');
    setFormOpen(true);
    setTimeout(() => titleRef.current?.focus(), 0);
  }

  function openEdit(row: Row) {
    setEditingId(row.id);
    setEditingRow(row);
    setForm(rowToForm(row, formFields));
    setFieldErrors({});
    setSaveError('');
    setNotice('');
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => titleRef.current?.focus(), 0);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    setFieldErrors({});
    // Only the system sets a system status, so an unchanged one isn't sent back
    const { status, ...rest } = form;
    const body = manual.includes(status as string) ? form : rest;
    try {
      const res = await fetch(editingId ? `/api/modules/${slug}/${editingId}` : `/api/modules/${slug}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (redirectIfSignedOut(res)) return;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.details && typeof json.details === 'object') setFieldErrors(json.details);
        setSaveError(json.error ?? 'Could not save');
        return;
      }
      setNotice(editingId ? 'Changes saved.' : `${recordLabel} added.`);
      setFormOpen(false);
      setEditingId(null);
      setEditingRow(null);
      load();
    } catch {
      setSaveError('Network error — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(`Delete "${row.title}"? This can't be undone.`)) return;
    setNotice('');
    setLoadError('');
    try {
      const res = await fetch(`/api/modules/${slug}/${row.id}`, { method: 'DELETE' });
      if (redirectIfSignedOut(res)) return;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error ?? 'Could not delete');
        return;
      }
      setNotice('Deleted.');
      setRows((r) => r.filter((x) => x.id !== row.id));
      setCount((c) => Math.max(0, c - 1));
    } catch {
      setLoadError('Network error. Nothing was deleted; check your connection and try again.');
    }
  }

  const set = (key: string, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  // Picking a linked record also fills the typed name the print pages and older lists read
  function setLink(def: FieldDef, id: string, title: string) {
    const nameKey = def.type === 'project' ? 'project_name' : 'client_name';
    const hasName = id && formFields.some((f) => f.key === nameKey);
    setForm((f) => ({ ...f, [def.key]: id, ...(hasName ? { [nameKey]: title } : {}) }));
  }

  const filtered = !!(query || statusFilter || (hasProject && projectFilter));
  const currentStatus = form.status as string;
  const statusOptions = manual.includes(currentStatus) || !currentStatus ? manual : [{ value: currentStatus, label: `${currentStatus} (set automatically)` }, ...manual];

  const firstLoadFailed = !loading && !loaded && !!loadError;
  const hasMore = loaded && rows.length < count;

  return (
    <>
      <PageHeader
        title={mod.label}
        subtitle={mod.description}
        back={{ href: '/', label: 'Back to Command Center' }}
        actions={canWrite && !formOpen ? <Button onClick={openCreate}>+ New {recordLabel}</Button> : undefined}
      />

      {notice && (
        <div className="mb-6">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      {formOpen && canWrite && (
        <Panel title={editingId ? `Edit ${recordLabel}` : `New ${recordLabel}`} className="mb-8">
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
              {formFields.map((def) =>
                def.type === 'project' || def.type === 'client' ? (
                  <div key={def.key}>
                    <Label htmlFor={`f-${def.key}`}>{def.label}{def.required ? ' *' : ''}</Label>
                    <RecordPicker
                      kind={def.type}
                      id={`f-${def.key}`}
                      value={(form[def.key] as string) ?? ''}
                      invalid={!!fieldErrors[def.key]}
                      placeholder={`No ${def.type}`}
                      onChange={(id, title) => setLink(def, id, title)}
                    />
                    <FieldError message={fieldErrors[def.key]} />
                  </div>
                ) : (
                  <FieldInput key={def.key} def={def} value={form[def.key]} error={fieldErrors[def.key]} onChange={(v) => set(def.key, v)} />
                )
              )}
              {editingRow &&
                computedFields.map((def) => (
                  <div key={def.key}>
                    <Label htmlFor={`f-${def.key}`}>{def.label}</Label>
                    <Input id={`f-${def.key}`} value={formatValue(def.type, editingRow[def.key])} readOnly disabled />
                  </div>
                ))}
              <div>
                <Label htmlFor="f-status">Status</Label>
                {statusOptions.length ? (
                  <Select id="f-status" value={currentStatus} onChange={(e) => set('status', e.target.value)} options={statusOptions} />
                ) : (
                  <Input id="f-status" value={currentStatus} readOnly disabled />
                )}
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
                {saving ? 'Saving...' : editingId ? 'Save Changes' : `Save ${recordLabel}`}
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
        {hasProject && <RecordPicker kind="project" ariaLabel="Filter by project" value={projectFilter} placeholder="All projects" onChange={(id) => filterByProject(id)} className="sm:w-56" />}
      </div>

      {loadError && (
        <div className="mb-6">
          <Alert>{loadError}</Alert>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white">
            Records{loaded ? ` (${rows.length < count ? `${rows.length} of ${count}` : count})` : ''}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" aria-busy={loading}>
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
              ) : firstLoadFailed ? (
                <tr>
                  <td colSpan={listColumns.length + 4} className="p-6 text-center text-slate-400">
                    <p className="mb-3">Your records couldn't be loaded. They haven't gone anywhere.</p>
                    <Button variant="secondary" size="sm" onClick={load}>
                      Try again
                    </Button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={listColumns.length + 4} className="p-6 text-center text-slate-400">
                    {filtered ? 'No records match your search.' : canWrite ? `No records yet. Add your first ${inSentence(recordLabel)} above.` : 'No records yet.'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const detail = detailHref(slug, row.id);
                  const print = printHref(slug, row.id);
                  return (
                  <tr key={row.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="p-4 font-medium text-white">
                      {detail ? (
                        <Link href={detail} className="hover:text-amber-400 hover:underline">
                          {row.title}
                        </Link>
                      ) : (
                        row.title
                      )}
                    </td>
                    {listColumns.map((c) => (
                      <td key={c.key} className="p-4 text-slate-300">
                        {formatValue(c.type, c.value(row))}
                      </td>
                    ))}
                    <td className="p-4">
                      <Badge>{row.status}</Badge>
                    </td>
                    <td className="p-4 text-slate-400">{new Date(row.created_at).toLocaleDateString('en-CA')}</td>
                    {(canWrite || canDelete) && (
                      <td className="p-4 text-right whitespace-nowrap space-x-2">
                        {print && (
                          <Link href={print} className="text-xs font-semibold text-amber-400 hover:underline mr-2">
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div className="p-4 border-t border-slate-800 text-center">
            <Button variant="secondary" disabled={loadingMore} onClick={() => fetchPage(rows.length)}>
              {loadingMore ? 'Loading...' : `Load ${Math.min(PAGE_SIZE, count - rows.length)} more`}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function FieldInput({ def, value, error, onChange }: { def: FieldDef; value: string | boolean | undefined; error?: string; onChange: (v: string | boolean) => void }) {
  const id = `f-${def.key}`;
  const label = `${def.label}${def.required ? ' *' : ''}`;
  if (def.type === 'boolean') {
    return (
      <div className="md:mt-6">
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input id={id} type="checkbox" className="h-5 w-5 accent-amber-500" checked={Boolean(value)} aria-invalid={!!error} onChange={(e) => onChange(e.target.checked)} />
          {def.label}
        </label>
        <FieldError message={error} />
      </div>
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
