'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SignaturePad from '@/components/signature-pad';
import { Alert, Badge, Button, ButtonLink, FieldError, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { JOB_PHOTOS_BUCKET } from '@/lib/daily-log';
import { getModule, type FieldDef } from '@/lib/modules';
import { MAX_RECORD_PHOTOS, attestedKeys, checklistChoices, cleanText, deleteBlock, formatSignedAt, isLocked, missingFor, nextSlots, recordConfig, recordPhotoFolder, type RecordRow, type RecordSignature, type RecordSlot } from '@/lib/records';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

type Fields = Record<string, string>;
type Checklists = Record<string, string[]>;
type ProjectList = { status: 'loading' | 'ready' | 'error'; options: { id: string; title: string }[] };

class ApiError extends Error {
  constructor(message: string, readonly details?: Record<string, string>) {
    super(message);
  }
}

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new ApiError('Your session ended. Sign in to keep going.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? 'Request failed', json.details);
  return json.data;
}

// Shrinks phone photos to at most 1600px JPEG before upload
async function compress(file: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.82));
  } catch {
    return file; // formats the browser can't read (e.g. HEIC on desktop) upload as-is
  }
}

export default function RecordEditor({ slug, initial, canWrite, canReopen, canDelete, userRank = 0 }: { slug: string; initial: RecordRow; canWrite: boolean; canReopen: boolean; canDelete: boolean; userRank?: number }) {
  const config = recordConfig(slug)!;
  const mod = getModule(slug)!;
  const url = `/api/records/${slug}/${initial.id}`;

  const editableDefs = useMemo(() => mod.fields.filter((f) => !f.computed && f.type !== 'list' && !f.legacy), [mod]);
  const shortDefs = editableDefs.filter((f) => f.type !== 'textarea');
  const longDefs = editableDefs.filter((f) => f.type === 'textarea');
  const neededToSign = useMemo(() => new Set(config.slots.flatMap((s) => s.required.map((r) => r.key))), [config]);

  const toFields = useCallback((row: RecordRow): Fields => Object.fromEntries(['title', 'notes', ...editableDefs.map((f) => f.key)].map((k) => [k, row[k] === null || row[k] === undefined ? '' : String(row[k])])), [editableDefs]);
  const toChecklists = useCallback((row: RecordRow): Checklists => Object.fromEntries(config.checklists.map((c) => [c.key, (row[c.key] as string[] | null) ?? []])), [config]);

  const [record, setRecord] = useState<RecordRow>(initial);
  const [fields, setFields] = useState<Fields>(() => toFields(initial));
  const [checklists, setChecklists] = useState<Checklists>(() => toChecklists(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [projects, setProjects] = useState<ProjectList>({ status: 'loading', options: [] });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const requestedUrls = useRef(new Set<string>());

  const [slotKey, setSlotKey] = useState('');
  const [signer, setSigner] = useState('');
  const [signature, setSignature] = useState('');
  const [padKey, setPadKey] = useState(0);
  const [reason, setReason] = useState('');

  const signatures = record.signatures ?? [];
  const photos = record.photos ?? [];
  const locked = isLocked(config, signatures);
  const editable = canWrite && !locked;
  // Signed-for fields wait for a reopen. They aren't sent on save either.
  const attested = attestedKeys(config, signatures);
  const open = (key: string) => editable && !attested.has(key);
  const unsigned = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).filter(([key]) => !attested.has(key)));
  const nextUp = nextSlots(config, signatures);
  const options = nextUp.filter((s) => (s.minRank ?? 0) <= userRank);
  const outranked = nextUp.filter((s) => (s.minRank ?? 0) > userRank);
  const slot: RecordSlot | undefined = options.find((s) => s.key === slotKey) ?? options[0];
  const missing = slot ? missingFor(config, slot, { ...fields, ...checklists }) : [];
  const lastSlot = config.slots.find((s) => s.key === signatures[signatures.length - 1]?.slot);

  const loadProjects = useCallback(async () => {
    setProjects((p) => ({ status: 'loading', options: p.options }));
    try {
      const res = await fetch('/api/link-options?type=project', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load');
      const json = await res.json();
      setProjects({ status: 'ready', options: json.data ?? [] });
    } catch {
      setProjects((p) => ({ status: 'error', options: p.options }));
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Private photos are shown through short-lived links. Each is asked for once, so one bad file can't loop.
  useEffect(() => {
    const missingUrls = photos.filter((p) => !requestedUrls.current.has(p));
    if (!missingUrls.length) return;
    missingUrls.forEach((p) => requestedUrls.current.add(p));
    getSupabaseBrowserClient()
      .storage.from(JOB_PHOTOS_BUCKET)
      .createSignedUrls(missingUrls, 3600)
      .then(({ data }) => {
        if (data) setUrls((u) => ({ ...u, ...Object.fromEntries(data.flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl]] : []))) }));
      });
  }, [photos]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function run(label: string, done: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    setFieldErrors({});
    setNotice('');
    try {
      await fn();
      setNotice(done);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.details ?? {});
      } else {
        setError(err instanceof Error && !(err instanceof TypeError) ? err.message : 'Network error. Check your connection and try again.');
      }
    } finally {
      setBusy('');
    }
  }

  // After a save the server's copy is what's on screen. Photo and sign calls keep unsaved typing.
  const accept = (row: RecordRow) => setRecord(row);
  const acceptSaved = (row: RecordRow) => {
    setRecord(row);
    setFields(toFields(row));
    setChecklists(toChecklists(row));
    setDirty(false);
  };

  const saveFields = async () => acceptSaved(await call(url, 'PUT', { action: 'save', fields: unsigned(fields), checklists: unsigned(checklists) }));
  const save = () => run('Saving…', 'Saved.', saveFields);

  const edit = (key: string, value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };
  const toggle = (list: string, option: string) => {
    setChecklists((c) => ({ ...c, [list]: c[list].includes(option) ? c[list].filter((o) => o !== option) : [...c[list], option] }));
    setDirty(true);
  };

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, MAX_RECORD_PHOTOS - photos.length);
    await run(`Uploading ${list.length}…`, `${list.length} photo${list.length === 1 ? '' : 's'} added.`, async () => {
      const storage = getSupabaseBrowserClient().storage.from(JOB_PHOTOS_BUCKET);
      const added: string[] = [];
      try {
        for (const file of list) {
          const blob = await compress(file);
          const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
          const path = `${recordPhotoFolder(record.company_id, slug, record.id)}${crypto.randomUUID()}.${ext}`;
          const { error: uploadError } = await storage.upload(path, blob, { contentType: blob.type || file.type });
          if (uploadError) {
            console.error('Photo upload failed', uploadError);
            throw new Error('That photo could not be uploaded. Use a JPEG, PNG, WEBP or HEIC file under 10 MB.');
          }
          added.push(path);
        }
        accept(await call(url, 'PUT', { action: 'photos', photos: [...photos, ...added] }));
      } catch (err) {
        // Don't leave files behind that no record points at
        if (added.length) await storage.remove(added).catch(() => undefined);
        throw err;
      }
    });
  }

  async function removePhoto(path: string) {
    if (!window.confirm('Remove this photo?')) return;
    await run('Removing…', 'Photo removed.', async () => {
      // The database refuses this if the file isn't theirs to remove, so nothing changes yet
      accept(await call(url, 'PUT', { action: 'photos', photos: photos.filter((p) => p !== path) }));
      const { data, error: removeError } = await getSupabaseBrowserClient().storage.from(JOB_PHOTOS_BUCKET).remove([path]);
      if (removeError || !data?.length) throw new Error('The photo is off this record, but its file could not be deleted from storage.');
    });
  }

  const sign = (target: RecordSlot) =>
    run('Signing…', target.multiple ? `${cleanText(signer)} signed in. The next person can sign below.` : `${target.label} signed.`, async () => {
      if (dirty) await saveFields();
      accept(await call(url, 'PUT', { action: 'sign', slot: target.key, name: signer, signature }));
      setSigner('');
      setSignature('');
      setPadKey((k) => k + 1);
    });

  const reopen = () =>
    run('Reopening…', 'Reopened.', async () => {
      if (dirty) await saveFields();
      accept(await call(url, 'PUT', { action: 'reopen', reason, slot: lastSlot?.key }));
      setReason('');
    });

  async function remove() {
    if (!window.confirm(`Delete this ${config.noun} and its photos? This cannot be undone.`)) return;
    await run('Deleting…', 'Deleted.', async () => {
      await call(`/api/modules/${slug}/${record.id}`, 'DELETE');
      setDirty(false);
      window.location.assign(`/${slug}`);
    });
  }

  const inputFor = (def: FieldDef) => {
    const id = `f-${def.key}`;
    const label = `${def.label}${def.required || neededToSign.has(def.key) ? ' *' : ''}`;
    const value = fields[def.key] ?? '';
    const invalid = !!fieldErrors[def.key];
    if (def.type === 'project') {
      const choices = [...projects.options.map((o) => ({ value: o.id, label: o.title })), ...(value && !projects.options.some((o) => o.id === value) ? [{ value, label: 'Linked project' }] : [])];
      return (
        <div key={def.key}>
          <Label htmlFor={id}>{label}</Label>
          <Select id={id} value={value} disabled={!open(def.key)} aria-invalid={invalid} onChange={(e) => edit(def.key, e.target.value)} options={choices} placeholder={projects.status === 'loading' ? 'Loading...' : 'No project'} />
          {projects.status === 'error' && (
            <p className="text-sm text-slate-400 mt-1">
              The list of projects could not be loaded.{' '}
              <button type="button" onClick={loadProjects} className="text-amber-400 hover:underline">
                Try again
              </button>
            </p>
          )}
          {editable && projects.status === 'ready' && projects.options.length === 0 && (
            <p className="text-sm text-slate-400 mt-1">
              No projects yet.{' '}
              <Link href="/projects" className="text-amber-400 hover:underline">
                Add one
              </Link>
            </p>
          )}
          <FieldError message={fieldErrors[def.key]} />
        </div>
      );
    }
    return (
      <div key={def.key} className={def.type === 'textarea' ? 'sm:col-span-2' : undefined}>
        <Label htmlFor={id}>{label}</Label>
        {def.type === 'textarea' ? (
          <Textarea id={id} rows={3} value={value} disabled={!open(def.key)} aria-invalid={invalid} placeholder={def.placeholder} onChange={(e) => edit(def.key, e.target.value)} />
        ) : def.type === 'select' ? (
          <Select id={id} value={value} disabled={!open(def.key)} aria-invalid={invalid} options={def.options ?? []} placeholder="Select..." onChange={(e) => edit(def.key, e.target.value)} />
        ) : (
          <Input id={id} type={def.type === 'date' ? 'date' : 'text'} value={value} disabled={!open(def.key)} aria-invalid={invalid} placeholder={def.placeholder} onChange={(e) => edit(def.key, e.target.value)} />
        )}
        <FieldError message={fieldErrors[def.key]} />
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title={record.title}
        subtitle={mod.label}
        back={{ href: `/${slug}`, label: `Back to ${mod.label}` }}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Badge>{record.status}</Badge>
            {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
            <ButtonLink variant="secondary" href={`/print/record/${slug}/${record.id}`}>
              Print / PDF
            </ButtonLink>
            {editable && (
              <Button onClick={save} disabled={!!busy}>
                {busy === 'Saving…' ? busy : 'Save'}
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {/* Stays on screen: on a phone the sign button is a long way down the page */}
        {(error || busy || notice) && (
          <div className="sticky top-[65px] lg:top-4 z-20 space-y-3 bg-slate-950 rounded-xl">
            {error && <Alert>{error}</Alert>}
            {busy && <Alert tone="info">{busy}</Alert>}
            {notice && !busy && <Alert tone="success">{notice}</Alert>}
          </div>
        )}
        <div className="space-y-3 empty:hidden">
          {locked &&<Alert tone="info">This {config.noun} is signed off and locked.{canReopen ? ' You can reopen it below.' : ' A project manager or above can reopen it.'}</Alert>}
          {!canWrite && !locked && <Alert tone="info">You can view this {config.noun}, but you can&apos;t change it.</Alert>}
        </div>

        <Panel title="Details">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label htmlFor="f-title">{mod.titleLabel} *</Label>
              <Input id="f-title" value={fields.title} maxLength={300} disabled={!editable} aria-invalid={!!fieldErrors.title} placeholder={mod.titlePlaceholder} onChange={(e) => edit('title', e.target.value)} />
              <FieldError message={fieldErrors.title} />
            </div>
            {shortDefs.map(inputFor)}
            {longDefs.map(inputFor)}
            <div className="sm:col-span-2">
              <Label htmlFor="f-notes">Notes</Label>
              <Textarea id="f-notes" rows={3} value={fields.notes} disabled={!editable} aria-invalid={!!fieldErrors.notes} onChange={(e) => edit('notes', e.target.value)} />
              <FieldError message={fieldErrors.notes} />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">* Needed before the sign-off it belongs to.</p>
          {editable && attested.size > 0 && <p className="text-xs text-slate-500 mt-1">Greyed-out fields have been signed for. A project manager or above can reopen the sign-off to change them.</p>}
        </Panel>

        {config.checklists.map((list) => (
          <Panel key={list.key} title={list.label}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {checklistChoices(list, (record[list.key] as string[] | null) ?? []).map((option) => {
                const checked = checklists[list.key]?.includes(option) ?? false;
                return (
                  <label key={option} className={`flex items-center gap-3 min-h-12 rounded-xl border px-4 py-2 text-sm ${checked ? 'border-amber-500/50 bg-amber-500/10 text-white' : 'border-slate-800 bg-slate-950 text-slate-300'} ${open(list.key) ? 'cursor-pointer' : 'opacity-80'}`}>
                    <input type="checkbox" className="h-5 w-5 accent-amber-500 shrink-0" checked={checked} disabled={!open(list.key)} onChange={() => toggle(list.key, option)} />
                    {option}
                  </label>
                );
              })}
            </div>
          </Panel>
        ))}

        <Panel>
          <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
            <h2 className="text-lg font-bold text-white">
              Photos ({photos.length})
            </h2>
            {editable && photos.length < MAX_RECORD_PHOTOS && (
              <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-3 rounded-lg text-sm">
                + Add photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={!!busy}
                  onChange={(e) => {
                    addPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          {photos.length === 0 ? (
            <p className="text-slate-500 text-sm">No photos yet.{editable ? ' Add photos of the locks, tags, hazards or findings.' : ''}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {photos.map((p) => (
                <figure key={p} className="relative">
                  {urls[p] ? (
                    <a href={urls[p]} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                      <img src={urls[p]} alt="Record photo" className="w-full aspect-[4/3] object-cover rounded-lg" />
                    </a>
                  ) : (
                    <div className="w-full aspect-[4/3] bg-slate-800 rounded-lg" />
                  )}
                  {editable && (
                    <button type="button" onClick={() => removePhoto(p)} disabled={!!busy} className="absolute top-1 right-1 bg-black/70 text-white rounded px-3 py-1.5 text-xs" aria-label="Remove photo">
                      Remove
                    </button>
                  )}
                </figure>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Sign-offs">
          <ol className="space-y-5">
            {config.slots.map((s, i) => {
              const signed = signatures.filter((x) => x.slot === s.key);
              return (
                <li key={s.key}>
                  <p className={`font-semibold ${signed.length ? 'text-white' : 'text-slate-400'}`}>
                    {i + 1}. {s.label}
                    {signed.length === 0 && <span className="font-normal text-slate-500"> · not signed</span>}
                  </p>
                  {signed.length > 0 && (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
                      {signed.map((x) => (
                        <SignedBox key={`${x.slot}-${x.name}-${x.signed_at}`} signature={x} />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {canWrite && slot && (
            <div className="border-t border-slate-800 mt-6 pt-6">
              {options.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Which sign-off">
                  {options.map((o) => (
                    <Button key={o.key} variant={o.key === slot.key ? 'primary' : 'secondary'} onClick={() => setSlotKey(o.key)}>
                      {o.label}
                    </Button>
                  ))}
                </div>
              )}
              <h3 className="font-bold text-white">{slot.label}</h3>
              <p className="text-sm text-slate-300 mt-1 mb-4">{slot.attest}</p>
              {missing.length > 0 && (
                <div className="mb-4">
                  <Alert tone="info">Fill these in before signing: {missing.join(', ')}.</Alert>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="signer">Name of person signing</Label>
                  <Input id="signer" value={signer} maxLength={200} autoComplete="off" onChange={(e) => setSigner(e.target.value)} />
                </div>
                <SignaturePad key={padKey} onChange={setSignature} />
              </div>
              <Button size="lg" className="mt-4 w-full sm:w-auto" onClick={() => sign(slot)} disabled={!cleanText(signer) || !signature || missing.length > 0 || !!busy}>
                {busy === 'Signing…' ? busy : `Sign: ${slot.label}`}
              </Button>
              {slot.key === config.slots[config.slots.length - 1].key && <p className="text-xs text-slate-500 mt-2">This is the last sign-off. Signing locks the {config.noun}.</p>}
            </div>
          )}
          {canWrite && outranked.length > 0 && <p className="text-sm text-slate-400 mt-4">{outranked.map((o) => o.label).join(', ')} has to be signed by a foreman or above.</p>}
          {!canWrite && !slot && signatures.length === 0 && <p className="text-slate-500 text-sm mt-4">Nothing signed yet.</p>}
        </Panel>

        {canReopen && signatures.length > 0 && lastSlot && (
          <Panel title="Reopen">
            <p className="text-sm text-slate-300 mb-4">
              This takes back the {lastSlot.label.toLowerCase()} sign-off{lastSlot.multiple ? 's' : ''} and unlocks the {config.noun} for changes. The history below keeps who signed.
            </p>
            <Label htmlFor="reopen-reason">Why is it being reopened?</Label>
            <Input id="reopen-reason" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            <Button variant="secondary" className="mt-4" onClick={reopen} disabled={!cleanText(reason) || !!busy}>
              Reopen
            </Button>
          </Panel>
        )}

        {(record.reopen_log ?? []).length > 0 && (
          <Panel title="Reopen history">
            <ul className="space-y-3 text-sm text-slate-300">
              {record.reopen_log.map((r) => (
                <li key={r.at}>
                  <p>
                    {formatSignedAt(r.at)}
                    {r.by_name ? ` · ${r.by_name}` : ''}: {r.reason}
                  </p>
                  <p className="text-slate-500">Removed: {r.removed.map((x) => `${x.name} (${x.slot.replace(/_/g, ' ')})`).join(', ')}</p>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {canDelete && !deleteBlock(record) && (
          <button type="button" onClick={remove} disabled={!!busy} className="text-sm text-slate-400 hover:text-red-400 py-2">
            Delete this {config.noun}
          </button>
        )}
      </div>
    </div>
  );
}

function SignedBox({ signature }: { signature: RecordSignature }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- stored data URL */}
      <img src={signature.signature} alt={`Signature of ${signature.name}`} className="h-16 w-full object-contain bg-white rounded-lg" />
      <p className="text-sm text-white mt-2">{signature.name}</p>
      <p className="text-xs text-slate-500">{formatSignedAt(signature.signed_at)}</p>
    </div>
  );
}
