'use client';

import { useEffect, useState } from 'react';
import SignaturePad from '@/components/signature-pad';
import { Alert, Button, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { JOB_PHOTOS_BUCKET, MAX_PHOTOS, photoFolder } from '@/lib/daily-log';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

export interface DailyLog {
  id: string;
  company_id: string;
  title: string;
  status: string;
  notes: string | null;
  log_date: string | null;
  crew_lead: string | null;
  weather: string | null;
  crew_count: number | string | null;
  hours: number | string | null;
  work_done: string | null;
  delays: string | null;
  safety_notes: string | null;
  photos: string[];
  signed_by: string | null;
  signature: string | null;
  signed_at: string | null;
}

const FIELD_KEYS = ['title', 'status', 'log_date', 'crew_lead', 'weather', 'crew_count', 'hours', 'work_done', 'delays', 'safety_notes', 'notes'] as const;
type Fields = Record<(typeof FIELD_KEYS)[number], string>;
const toFields = (log: DailyLog): Fields =>
  Object.fromEntries(FIELD_KEYS.map((k) => [k, log[k] === null || log[k] === undefined ? '' : String(log[k])])) as Fields;

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

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = json.details ? Object.values(json.details as Record<string, string>).join(' ') : '';
    throw new Error([json.error ?? 'Request failed', details].filter(Boolean).join(': '));
  }
  return json.data;
}

export default function DailyLogEditor({
  initial,
  statuses,
  canWrite,
  canReopen,
  canDelete,
}: {
  initial: DailyLog;
  statuses: string[];
  canWrite: boolean;
  canReopen: boolean;
  canDelete: boolean;
}) {
  const [log, setLog] = useState<DailyLog>({ ...initial, photos: initial.photos ?? [] });
  const [fields, setFields] = useState<Fields>(() => toFields(initial));
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signer, setSigner] = useState('');
  const [signature, setSignature] = useState('');

  const signed = !!log.signed_at;
  const editable = canWrite && !signed;

  // Private photos are shown through short-lived links
  useEffect(() => {
    const missing = log.photos.filter((p) => !urls[p]);
    if (!missing.length) return;
    getSupabaseBrowserClient()
      .storage.from(JOB_PHOTOS_BUCKET)
      .createSignedUrls(missing, 3600)
      .then(({ data }) => {
        if (data) setUrls((u) => ({ ...u, ...Object.fromEntries(data.flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl]] : []))) }));
      });
  }, [log.photos, urls]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function run(label: string, done: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — check your connection and try again.');
    } finally {
      setBusy('');
    }
  }

  const accept = (data: DailyLog) => {
    setLog({ ...data, photos: data.photos ?? [] });
    setFields(toFields(data));
  };

  async function saveFields() {
    accept(await call(`/api/modules/daily-logs/${log.id}`, 'PUT', fields));
    setDirty(false);
  }

  const save = () => run('Saving…', 'Saved.', saveFields);

  const action = (body: Record<string, unknown>) => call(`/api/daily-logs/${log.id}`, 'PUT', body).then(accept);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, MAX_PHOTOS - log.photos.length);
    await run(`Uploading ${list.length}…`, `${list.length} photo${list.length === 1 ? '' : 's'} added.`, async () => {
      const storage = getSupabaseBrowserClient().storage.from(JOB_PHOTOS_BUCKET);
      const added: string[] = [];
      for (const file of list) {
        const blob = await compress(file);
        const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${photoFolder(log.company_id, log.id)}${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await storage.upload(path, blob, { contentType: blob.type || file.type });
        if (uploadError) {
          console.error('Photo upload failed', uploadError);
          throw new Error('That photo could not be uploaded. Use a JPEG, PNG, WEBP or HEIC file under 10 MB.');
        }
        added.push(path);
      }
      await action({ action: 'photos', photos: [...log.photos, ...added] });
    });
  }

  async function removePhoto(path: string) {
    if (!window.confirm('Remove this photo?')) return;
    await run('Removing…', 'Photo removed.', async () => {
      await action({ action: 'photos', photos: log.photos.filter((p) => p !== path) });
      await getSupabaseBrowserClient().storage.from(JOB_PHOTOS_BUCKET).remove([path]);
    });
  }

  const sign = () =>
    run('Signing…', 'Signed and locked.', async () => {
      if (dirty) await saveFields();
      await action({ action: 'sign', signed_by: signer, signature });
    });

  const reopen = () => {
    if (!window.confirm('Reopen this log for changes? The signature will be removed.')) return;
    run('Reopening…', 'Reopened.', () => action({ action: 'reopen' }));
  };

  async function remove() {
    if (!window.confirm('Delete this log and its photos? This cannot be undone.')) return;
    await run('Deleting…', 'Deleted.', async () => {
      await call(`/api/modules/daily-logs/${log.id}`, 'DELETE');
      setDirty(false);
      window.location.href = '/daily-logs';
    });
  }

  const edit = (k: keyof Fields, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const text = (k: keyof Fields, label: string, type = 'text') => (
    <div>
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type={type} min={type === 'number' ? 0 : undefined} step="any" disabled={!editable} value={fields[k]} onChange={(e) => edit(k, e.target.value)} />
    </div>
  );
  const area = (k: keyof Fields, label: string, placeholder: string) => (
    <div>
      <Label htmlFor={k}>{label}</Label>
      <Textarea id={k} rows={4} disabled={!editable} placeholder={placeholder} value={fields[k]} onChange={(e) => edit(k, e.target.value)} />
    </div>
  );
  const panel = 'print:bg-white print:border-0 print:shadow-none print:p-0';

  return (
    <div className="print:text-black">
      <div className="print:hidden">
        <PageHeader
          title={log.title}
          subtitle={`Daily log${log.log_date ? ` · ${log.log_date}` : ''} · ${signed ? `Signed by ${log.signed_by}` : 'Open'}`}
          back={{ href: '/daily-logs', label: 'Back to Daily Logs' }}
          actions={
            <>
              {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
              <Button variant="secondary" onClick={() => window.print()}>
                Print / PDF
              </Button>
              {editable && (
                <Button onClick={save} disabled={!!busy}>
                  {busy === 'Saving…' ? busy : 'Save'}
                </Button>
              )}
            </>
          }
        />
      </div>

      <header className="hidden print:block border-b-2 border-black pb-3 mb-4">
        <h1 className="text-2xl font-bold">Daily Log: {log.title}</h1>
        <p>{log.log_date}</p>
      </header>

      <div className="space-y-6">
        <div className="print:hidden space-y-3">
          {error && <Alert>{error}</Alert>}
          {busy && <Alert tone="info">{busy}</Alert>}
          {notice && !busy && <Alert tone="success">{notice}</Alert>}
          {signed && <Alert tone="info">This log is signed and locked.{canReopen ? ' Reopen it to make changes.' : ''}</Alert>}
        </div>

        <Panel className={panel}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {text('title', 'Log title')}
            {text('log_date', 'Date', 'date')}
            {text('weather', 'Weather')}
            {text('crew_lead', 'Crew lead / foreman')}
            {text('crew_count', 'Crew size', 'number')}
            {text('hours', 'Total crew hours', 'number')}
            <div className="print:hidden">
              <Label htmlFor="status">Status</Label>
              <Select id="status" options={statuses} disabled={!editable} value={fields.status} onChange={(e) => edit('status', e.target.value)} />
            </div>
          </div>
        </Panel>

        <Panel className={panel}>
          <div className="space-y-4">
            {area('work_done', 'Work completed', 'What got done today, areas, quantities installed…')}
            {area('delays', 'Delays / issues', 'Waiting on materials, access, other trades, client changes…')}
            {area('safety_notes', 'Safety', 'Tailgate topics, hazards, incidents, near misses…')}
            {area('notes', 'Other notes', '')}
          </div>
        </Panel>

        <Panel className={`${panel} break-inside-avoid`}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-white print:text-black">Photos ({log.photos.length})</h2>
            {editable && log.photos.length < MAX_PHOTOS && (
              <label className="print:hidden cursor-pointer bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
                + Add photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
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
          {log.photos.length === 0 ? (
            <p className="text-slate-500 text-sm">No photos yet.{editable ? ' On a phone, Add photos opens the camera.' : ''}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {log.photos.map((p) => (
                <figure key={p} className="relative group break-inside-avoid">
                  {urls[p] ? (
                    <a href={urls[p]} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                      <img src={urls[p]} alt="Job photo" className="w-full aspect-[4/3] object-cover rounded-lg" />
                    </a>
                  ) : (
                    <div className="w-full aspect-[4/3] bg-slate-800 rounded-lg" />
                  )}
                  {editable && (
                    <button
                      type="button"
                      onClick={() => removePhoto(p)}
                      className="print:hidden absolute top-1 right-1 bg-black/70 text-white rounded px-2 py-0.5 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100"
                      aria-label="Remove photo"
                    >
                      ✕
                    </button>
                  )}
                </figure>
              ))}
            </div>
          )}
        </Panel>

        <Panel className={`${panel} break-inside-avoid`}>
          <h2 className="text-lg font-bold text-white print:text-black mb-4">Sign-off</h2>
          {signed ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- stored data URL */}
              <img src={log.signature!} alt={`Signature of ${log.signed_by}`} className="h-24 bg-white rounded-lg p-2" />
              <p className="text-slate-300 print:text-black">
                {log.signed_by} · {new Date(log.signed_at!).toLocaleString('en-CA')}
              </p>
              {canReopen && (
                <button type="button" onClick={reopen} disabled={!!busy} className="print:hidden text-sm text-slate-400 hover:text-amber-400">
                  Reopen for changes
                </button>
              )}
            </div>
          ) : canWrite ? (
            <div className="grid sm:grid-cols-2 gap-4 print:hidden">
              <div>
                <Label htmlFor="signer">Name of person signing</Label>
                <Input id="signer" value={signer} maxLength={200} onChange={(e) => setSigner(e.target.value)} placeholder="Foreman or client rep" />
                <Button className="mt-4" onClick={sign} disabled={!signer.trim() || !signature || !!busy}>
                  Sign &amp; lock log
                </Button>
                <p className="text-xs text-slate-500 mt-2">Signing saves the log and locks it from changes.</p>
              </div>
              <SignaturePad onChange={setSignature} />
            </div>
          ) : (
            <p className="text-slate-500 text-sm">Not signed yet.</p>
          )}
        </Panel>

        {canDelete && !signed && (
          <button type="button" onClick={remove} disabled={!!busy} className="print:hidden text-sm text-slate-400 hover:text-red-400">
            Delete log
          </button>
        )}
      </div>
    </div>
  );
}
