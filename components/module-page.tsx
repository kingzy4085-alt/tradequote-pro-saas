'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, FieldError, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { deviceToday, overdueWord } from '@/lib/alerts';
import { formatValue } from '@/lib/format';
import { detailHref } from '@/lib/detail-pages';
import { listViewLabel } from '@/lib/list-views';
import { getModule, pickableStatuses, type FieldDef, type ModuleDef } from '@/lib/modules';
import { PAGE_SIZE, mergePages } from '@/lib/pagination';

type LinkType = 'project' | 'client' | 'purchase_order';
type LinkList = { status: 'loading' | 'ready' | 'error'; options: { id: string; title: string }[] };
type LinkLists = Partial<Record<LinkType, LinkList>>;
const LINK_WORDS: Record<LinkType, { one: string; many: string; href: string; nameKey: string }> = {
  project: { one: 'project', many: 'projects', href: '/projects', nameKey: 'project_name' },
  client: { one: 'client', many: 'clients', href: '/crm', nameKey: 'client_name' },
  purchase_order: { one: 'purchase order', many: 'purchase orders', href: '/purchase-orders', nameKey: 'purchase_order_name' },
};
/** The picker a field uses, if any. A bill's link to its PO is what takes the PO off the job's committed cost. */
const linkTypeOf = (def: FieldDef): LinkType | null => (def.key === 'purchase_order_id' ? 'purchase_order' : def.type === 'project' || def.type === 'client' ? def.type : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Columns in the list. A client link isn't one: crew can see projects but not the client list, and the client's name is its own column. */
function pickListColumns(mod: ModuleDef): FieldDef[] {
  return mod.fields.filter((f) => f.type !== 'textarea' && f.type !== 'client' && !f.hidden && !f.legacy).slice(0, 3);
}

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

// The status picker's value when a link from the Command Center asked for several at once
const SEVERAL_STATUSES = '__several';

export default function ModulePage({ slug, canWrite, canDelete, initialProject, initialStatuses, initialView, initialQuery, startNew }: { slug: string; canWrite: boolean; canDelete: boolean; initialProject?: string; initialStatuses?: string[]; initialView?: string; /** Text already in the search box, when a search result opened this list. */ initialQuery?: string; startNew?: boolean }) {
  const mod = getModule(slug)!;
  const listColumns = useMemo(() => pickListColumns(mod), [mod]);
  const recordLabel = mod.recordLabel ?? mod.titleLabel;
  const startStatus = pickableStatuses(mod)[0];
  const projectField = useMemo(() => mod.fields.find((f) => f.type === 'project'), [mod]);

  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState(initialQuery ?? '');
  const [statusFilter, setStatusFilter] = useState<string[]>(() => (initialStatuses ?? []).filter((s) => mod.statuses.includes(s)));
  const [viewFilter, setViewFilter] = useState(() => (listViewLabel(slug, initialView) ? initialView! : ''));
  const [projectFilter, setProjectFilter] = useState(() => (projectField && initialProject && UUID.test(initialProject) ? initialProject : ''));
  const [linkLists, setLinkLists] = useState<LinkLists>({});

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(mod.fields, startStatus));
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
      for (const status of statusFilter) params.append('status', status);
      if (viewFilter) params.set('view', viewFilter);
      if (projectFilter) params.set('project', projectFilter);
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
    [slug, query, statusFilter, viewFilter, projectFilter]
  );

  const load = useCallback(() => fetchPage(0), [fetchPage]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => {
      clearTimeout(t);
      inFlight.current?.abort();
    };
  }, [load, query]);

  /** Loads the choices for the project and client pickers this module has. */
  const loadLinks = useCallback(async () => {
    const types = [...new Set(mod.fields.map(linkTypeOf).filter((t): t is LinkType => t !== null))];
    await Promise.all(
      types.map(async (type) => {
        setLinkLists((l) => ({ ...l, [type]: { status: 'loading', options: l[type]?.options ?? [] } }));
        try {
          const res = await fetch(`/api/link-options?type=${type}`, { cache: 'no-store' });
          if (!res.ok) throw new Error('Could not load');
          const json = await res.json();
          setLinkLists((l) => ({ ...l, [type]: { status: 'ready', options: json.data ?? [] } }));
        } catch {
          setLinkLists((l) => ({ ...l, [type]: { status: 'error', options: l[type]?.options ?? [] } }));
        }
      })
    );
  }, [mod]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  /** Shows one project's records and keeps that in the address, so the view can be linked and reloaded. */
  function filterByProject(id: string) {
    setProjectFilter(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('project', id);
    else url.searchParams.delete('project');
    window.history.replaceState(null, '', url);
  }

  function filterByStatus(value: string) {
    if (value === SEVERAL_STATUSES) return;
    const next = value ? [value] : [];
    setStatusFilter(next);
    const url = new URL(window.location.href);
    url.searchParams.delete('status');
    for (const status of next) url.searchParams.append('status', status);
    window.history.replaceState(null, '', url);
  }

  function clearView() {
    setViewFilter('');
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }

  /** Picking a project or client also fills the module's own name column, which print pages and old records use. */
  function pickLink(def: FieldDef, id: string) {
    const type = linkTypeOf(def);
    if (!type) return;
    const { nameKey } = LINK_WORDS[type];
    const title = linkLists[type]?.options.find((o) => o.id === id)?.title;
    setForm((f) => ({ ...f, [def.key]: id, ...(title && mod.fields.some((x) => x.key === nameKey) ? { [nameKey]: title } : {}) }));
  }

  function openCreate() {
    setEditingId(null);
    const fresh = emptyForm(mod.fields, startStatus);
    if (projectField && projectFilter) fresh[projectField.key] = projectFilter;
    setForm(fresh);
    setFieldErrors({});
    setSaveError('');
    setNotice('');
    setFormOpen(true);
    setTimeout(() => titleRef.current?.focus(), 0);
  }

  // "New record" from a project's page: the form opens with that project already picked
  const startedNew = useRef(false);
  useEffect(() => {
    if (!startNew || !canWrite || startedNew.current) return;
    startedNew.current = true;
    openCreate();
    const url = new URL(window.location.href);
    url.searchParams.delete('new');
    window.history.replaceState(null, '', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNew, canWrite]);

  function openEdit(row: Row) {
    setEditingId(row.id);
    setForm(rowToForm(row, mod.fields));
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
    // System-owned values aren't the form's to send
    const leaveOut = new Set(mod.fields.filter((f) => f.computed || f.hidden).map((f) => f.key));
    if (statusIsSystem) leaveOut.add('status');
    const payload = Object.fromEntries(Object.entries(form).filter(([key]) => !leaveOut.has(key)));
    try {
      const res = await fetch(editingId ? `/api/modules/${slug}/${editingId}` : `/api/modules/${slug}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (redirectIfSignedOut(res)) return;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.details && typeof json.details === 'object') setFieldErrors(json.details);
        setSaveError(json.error ?? 'Could not save');
        return;
      }
      const opensOnDetail = mod.editOnDetail && !editingId && json.data?.id ? detailHref(slug, json.data.id) : null;
      if (opensOnDetail) {
        window.location.assign(opensOnDetail);
        return;
      }
      setNotice(editingId ? 'Changes saved.' : `${recordLabel} added.`);
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

  const statusIsSystem = !!mod.systemStatuses?.includes(form.status as string);
  const editingRow = editingId ? rows.find((r) => r.id === editingId) : undefined;
  const visibleInForm = (def: FieldDef) => {
    if (def.hidden) return false;
    if (def.computed) return !!editingId;
    if (!def.legacy) return true;
    // Old text only matters on an existing record that hasn't been linked yet
    const stored = editingRow?.[def.key];
    return !!stored && !(projectField && form[projectField.key]);
  };
  const projectChoices = linkLists.project?.options ?? [];

  const firstLoadFailed = !loading && !loaded && !!loadError;
  const hasMore = loaded && rows.length < count;
  const today = deviceToday();

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
              {mod.fields.filter(visibleInForm).map((def) => {
                const type = linkTypeOf(def);
                return type ? (
                  <LinkInput key={def.key} def={def} type={type} list={linkLists[type]} value={(form[def.key] as string) ?? ''} error={fieldErrors[def.key]} onChange={(v) => pickLink(def, v)} onRetry={loadLinks} />
                ) : (
                  <FieldInput key={def.key} def={def} value={form[def.key]} error={fieldErrors[def.key]} onChange={(v) => set(def.key, v)} />
                );
              })}
              {!mod.editOnDetail && (
                <div>
                  <Label htmlFor="f-status">Status</Label>
                  {/* A record the system put on a status (say Overdue) still shows it, and can be moved off it (say to Paid) */}
                  <Select id="f-status" value={form.status as string} onChange={(e) => set('status', e.target.value)} options={statusIsSystem ? [form.status as string, ...pickableStatuses(mod)] : pickableStatuses(mod)} />
                </div>
              )}
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
        <Select
          aria-label="Filter by status"
          value={statusFilter.length > 1 ? SEVERAL_STATUSES : statusFilter[0] ?? ''}
          onChange={(e) => filterByStatus(e.target.value)}
          options={[...mod.statuses.map((s) => ({ value: s, label: s })), ...(statusFilter.length > 1 ? [{ value: SEVERAL_STATUSES, label: statusFilter.join(' or ') }] : [])]}
          placeholder="All statuses"
          className="sm:max-w-[14rem]"
        />
        {projectField && (
          <Select
            aria-label="Filter by project"
            value={projectFilter}
            onChange={(e) => filterByProject(e.target.value)}
            options={[...projectChoices.map((o) => ({ value: o.id, label: o.title })), ...(projectFilter && !projectChoices.some((o) => o.id === projectFilter) ? [{ value: projectFilter, label: 'This project' }] : [])]}
            placeholder="All projects"
            className="sm:max-w-[16rem]"
          />
        )}
        {viewFilter && (
          <Button variant="secondary" onClick={clearView} aria-label={`Stop showing ${listViewLabel(slug, viewFilter)}`} className="whitespace-nowrap">
            {listViewLabel(slug, viewFilter)} ✕
          </Button>
        )}
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
                    {query || statusFilter.length || viewFilter || projectFilter ? 'No records match your search.' : canWrite ? `No records yet. Add your first ${recordLabel.toLowerCase()} above.` : 'No records yet.'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const href = detailHref(slug, row.id);
                  // From the row's own date, so it's right even if last night's automation run was missed
                  const late = overdueWord(slug, row, today);
                  // A receivable from an invoice follows it, and the database refuses any edit or delete here
                  const followsInvoice = slug === 'receivables' && !!row.invoice_id;
                  return (
                  <tr key={row.id} className={`transition-colors ${late ? 'bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-slate-800/50'}`}>
                    <td className="p-4 font-medium text-white">
                      {href ? (
                        <Link href={href} className="hover:text-amber-400 hover:underline">
                          {row.title}
                        </Link>
                      ) : (
                        row.title
                      )}
                    </td>
                    {listColumns.map((c) => (
                      <td key={c.key} className="p-4 text-slate-300">
                        {c.type === 'project' ? <ProjectCell id={row[c.key] as string | null} oldText={row.project_name as string | null} list={linkLists.project} /> : formatValue(c.type, row[c.key])}
                      </td>
                    ))}
                    <td className="p-4">
                      <Badge>{row.status}</Badge>
                      {late && late !== row.status && <span className="block sm:inline-block mt-1 sm:mt-0 sm:ml-2 text-xs font-semibold text-red-400 whitespace-nowrap">{late}</span>}
                    </td>
                    <td className="p-4 text-slate-400">{new Date(row.created_at).toLocaleDateString('en-CA')}</td>
                    {(canWrite || canDelete) && (
                      <td className="p-4 text-right whitespace-nowrap space-x-2">
                        {slug === 'proposals' && (
                          <Link href={`/print/proposal/${row.id}`} className="text-xs font-semibold text-amber-400 hover:underline mr-2">
                            Print
                          </Link>
                        )}
                        {followsInvoice && (
                          <Link href={detailHref('invoices', String(row.invoice_id))!} className="text-xs font-semibold text-amber-400 hover:underline">
                            Open invoice
                          </Link>
                        )}
                        {canWrite && !mod.editOnDetail && !followsInvoice && (
                          <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>
                            Edit
                          </Button>
                        )}
                        {canDelete && !followsInvoice && (
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

/** A project's name in a list row, linked when projects have a detail page. Unlinked old rows show their old text. */
function ProjectCell({ id, oldText, list }: { id: string | null; oldText?: string | null; list?: LinkList }) {
  if (!id) return <>{oldText || '—'}</>;
  const title = list?.options.find((o) => o.id === id)?.title ?? (list?.status === 'loading' ? '…' : 'Linked project');
  const href = detailHref('projects', id);
  return href ? (
    <Link href={href} className="hover:text-amber-400 hover:underline">
      {title}
    </Link>
  ) : (
    <>{title}</>
  );
}

function LinkInput({ def, type, list, value, error, onChange, onRetry }: { def: FieldDef; type: LinkType; list?: LinkList; value: string; error?: string; onChange: (v: string) => void; onRetry: () => void }) {
  const id = `f-${def.key}`;
  const words = LINK_WORDS[type];
  const options = list?.options ?? [];
  // A linked record past the list's limit, or one still loading, keeps its link
  const choices = [...options.map((o) => ({ value: o.id, label: o.title })), ...(value && !options.some((o) => o.id === value) ? [{ value, label: `Linked ${words.one}` }] : [])];
  return (
    <div>
      <Label htmlFor={id}>
        {def.label}
        {def.required ? ' *' : ''}
      </Label>
      <Select id={id} value={value} aria-invalid={!!error} required={def.required} onChange={(e) => onChange(e.target.value)} options={choices} placeholder={list?.status === 'ready' || list?.status === 'error' ? `No ${words.one}` : 'Loading...'} />
      {list?.status === 'error' && (
        <p className="text-sm text-slate-400 mt-1">
          The list of {words.many} could not be loaded.{' '}
          <button type="button" onClick={onRetry} className="text-amber-400 hover:underline">
            Try again
          </button>
        </p>
      )}
      {list?.status === 'ready' && options.length === 0 && (
        <p className="text-sm text-slate-400 mt-1">
          No {words.many} yet.{' '}
          <Link href={words.href} className="text-amber-400 hover:underline">
            Add one
          </Link>
        </p>
      )}
      <FieldError message={error} />
    </div>
  );
}

function FieldInput({ def, value, error, onChange }: { def: FieldDef; value: string | boolean | undefined; error?: string; onChange: (v: string | boolean) => void }) {
  const id = `f-${def.key}`;
  const label = `${def.label}${def.required ? ' *' : ''}`;
  if (def.type === 'boolean' && !def.computed) {
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
  if (def.computed) {
    return (
      <div>
        <Label htmlFor={id}>{def.label}</Label>
        <Input id={id} value={formatValue(def.type, value)} disabled />
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
