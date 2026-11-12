'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { SignaturePad } from '../signature-pad';

interface Log {
  id: string;
  company_id: string;
  log_date: string;
  project: string;
  crew: string | null;
  crew_count: number | string | null;
  hours: number | string | null;
  weather: string | null;
  work_done: string | null;
  delays: string | null;
  safety_notes: string | null;
  photos: string[];
  signed_by: string | null;
  signature: string | null;
  signed_at: string | null;
}

const BUCKET = 'job-photos';

// Shrinks phone photos to at most 1600px JPEG before upload
async function compress(file: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej()), 'image/jpeg', 0.82));
  } catch {
    return file; // formats the browser can't read (e.g. HEIC on desktop) upload as-is
  }
}

export default function DailyLogPage({ params }: { params: { id: string } }) {
  const { id } = React.use(params);
  const [log, setLog] = useState<Log | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [signer, setSigner] = useState('');
  const [signature, setSignature] = useState('');

  useEffect(() => {
    fetch(`/api/daily-logs/${params.id}`)
      .then((r) => r.json())
      .then((j) => (j.success ? setLog({ ...j.data, photos: j.data.photos || [] }) : setError(j.error)))
      .catch(() => setError('Could not load this log.'));
  }, [id]);

  // Private photos are shown through short-lived links
  useEffect(() => {
    const missing = (log?.photos || []).filter((p) => !urls[p]);
    if (!missing.length) return;
    supabaseBrowser().storage.from(BUCKET).createSignedUrls(missing, 3600).then(({ data }) => {
      if (data) setUrls((u) => ({ ...u, ...Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path!, d.signedUrl])) }));
    });
  }, [log?.photos, urls]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <main className="min-h-screen bg-slate-950 text-red-400 p-8">{error}</main>;
  if (!log) return <main className="min-h-screen bg-slate-950 text-slate-400 p-8">Loading log…</main>;

  const signed = !!log.signed_at;
  const edit = (patch: Partial<Log>) => { setLog({ ...log, ...patch }); setDirty(true); };

  async function send(body: Record<string, unknown>, okMessage: string) {
    setStatus('Saving…');
    const res = await fetch(`/api/daily-logs/${params.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (!res.success) { setStatus(`Not saved: ${res.error}`); return false; }
    setLog({ ...res.data, photos: res.data.photos || [] });
    setDirty(false);
    setStatus(okMessage);
    setTimeout(() => setStatus(''), 2500);
    return true;
  }

  const fields = () => {
    const { project, log_date, crew, crew_count, hours, weather, work_done, delays, safety_notes } = log!;
    return { project, log_date, crew, crew_count, hours, weather, work_done, delays, safety_notes };
  };
  const save = () => send(fields(), 'Saved');

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const sb = supabaseBrowser();
    const added: string[] = [];
    setUploading(files.length);
    for (const file of Array.from(files)) {
      const blob = await compress(file);
      const ext = blob.type === 'image/jpeg' ? 'jpg' : file.name.split('.').pop() || 'jpg';
      const path = `${log!.company_id}/daily-logs/${log!.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || file.type });
      if (error) setStatus(`Photo not uploaded: ${error.message}`);
      else added.push(path);
      setUploading((n) => n - 1);
    }
    if (added.length) await send({ ...fields(), photos: [...log!.photos, ...added] }, `${added.length} photo${added.length > 1 ? 's' : ''} added`);
  }

  async function removePhoto(path: string) {
    if (!confirm('Remove this photo?')) return;
    if (await send({ photos: log!.photos.filter((p) => p !== path) }, 'Photo removed')) {
      await supabaseBrowser().storage.from(BUCKET).remove([path]);
    }
  }

  async function sign() {
    if (dirty && !(await save())) return;
    await send({ action: 'sign', signed_by: signer, signature }, 'Signed');
  }

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 disabled:opacity-70';
  const label = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';
  const text = (k: keyof Log, l: string, type = 'text') => (
    <div>
      <label className={label} htmlFor={k}>{l}</label>
      <input id={k} type={type} min={0} step="any" disabled={signed} className={input} value={(log[k] as string) ?? ''} onChange={(e) => edit({ [k]: e.target.value })} />
    </div>
  );
  const area = (k: keyof Log, l: string, placeholder: string) => (
    <div>
      <label className={label} htmlFor={k}>{l}</label>
      <textarea id={k} rows={4} disabled={signed} placeholder={placeholder} className={input} value={(log[k] as string) ?? ''} onChange={(e) => edit({ [k]: e.target.value })} />
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8 print:bg-white print:text-gray-700 print:p-0">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between gap-4 print:hidden">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">{log.project}</h1>
            <p className="text-slate-400 mt-1">Daily log · {log.log_date} · {signed ? <span className="text-emerald-400">Signed by {log.signed_by}</span> : <span className="text-amber-400">Open</span>}</p>
          </div>
          <div className="flex items-center gap-3">
            {dirty && !status && <span className="text-sm text-amber-400">Unsaved changes</span>}
            {status && <span className={`text-sm font-semibold ${status.startsWith('Not') || status.startsWith('Photo not') ? 'text-red-400' : 'text-emerald-400'}`}>{status}</span>}
            {!signed && <button onClick={save} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">Save</button>}
            <button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-5 py-2.5 rounded-lg">Print / PDF</button>
          </div>
        </div>

        {/* Printed report header */}
        <header className="hidden print:block border-b-2 border-black pb-3">
          <h1 className="text-2xl font-bold text-black">Daily Log: {log.project}</h1>
          <p>{log.log_date}</p>
        </header>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 print:bg-white print:border-0 print:p-0">
          {text('project', 'Project')}
          {text('log_date', 'Date', 'date')}
          {text('weather', 'Weather')}
          {text('crew', 'Crew / foreman')}
          {text('crew_count', 'Crew size', 'number')}
          {text('hours', 'Total crew hours', 'number')}
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 print:bg-white print:border-0 print:p-0">
          {area('work_done', 'Work completed', 'What got done today, areas, quantities installed…')}
          {area('delays', 'Delays / issues', 'Waiting on materials, access, other trades, client changes…')}
          {area('safety_notes', 'Safety', 'Tailgate topics, hazards, incidents, near misses…')}
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 print:bg-white print:border-0 print:p-0 break-inside-avoid">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-white print:text-black">Photos ({log.photos.length})</h2>
            {!signed && (
              <label className="print:hidden cursor-pointer bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
                {uploading ? `Uploading ${uploading}…` : '+ Add photos'}
                <input type="file" accept="image/*" multiple capture="environment" className="hidden" disabled={!!uploading} onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
              </label>
            )}
          </div>
          {log.photos.length === 0 ? (
            <p className="text-slate-500 text-sm">No photos yet. On a phone, Add photos opens the camera.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {log.photos.map((p) => (
                <figure key={p} className="relative group break-inside-avoid">
                  {urls[p] ? (
                    <a href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="Job photo" className="w-full aspect-[4/3] object-cover rounded-lg" /></a>
                  ) : (
                    <div className="w-full aspect-[4/3] bg-slate-800 rounded-lg" />
                  )}
                  {!signed && (
                    <button onClick={() => removePhoto(p)} className="print:hidden absolute top-1 right-1 bg-black/70 text-white rounded px-2 py-0.5 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Remove photo">✕</button>
                  )}
                </figure>
              ))}
            </div>
          )}
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 print:bg-white print:border-0 print:p-0 break-inside-avoid">
          <h2 className="text-lg font-bold text-white print:text-black mb-4">Sign-off</h2>
          {signed ? (
            <div className="space-y-2">
              <img src={log.signature!} alt={`Signature of ${log.signed_by}`} className="h-24 bg-white rounded-lg p-2" />
              <p className="text-slate-300 print:text-black">{log.signed_by} · {new Date(log.signed_at!).toLocaleString('en-CA')}</p>
              <button
                onClick={() => confirm('Reopen this log for changes? The signature will be removed.') && send({ action: 'reopen' }, 'Reopened')}
                className="print:hidden text-sm text-slate-400 hover:text-amber-400"
              >
                Reopen for changes
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4 print:hidden">
              <div>
                <label className={label} htmlFor="signer">Name of person signing</label>
                <input id="signer" className={input} value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Foreman or client rep" />
                <button onClick={sign} disabled={!signer.trim() || !signature} className="mt-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">
                  Sign &amp; lock log
                </button>
                <p className="text-xs text-slate-500 mt-2">Signing saves the log and locks it from changes.</p>
              </div>
              <SignaturePad onChange={setSignature} />
            </div>
          )}
        </section>

        {!signed && (
          <button
            onClick={async () => {
              if (!confirm('Delete this log and its photos? This cannot be undone.')) return;
              const r = await fetch(`/api/daily-logs/${params.id}`, { method: 'DELETE' }).then((x) => x.json()).catch(() => ({ success: false }));
              if (r.success) { setDirty(false); window.location.href = '/daily-logs'; } else setStatus(`Not deleted: ${r.error || 'Network error'}`);
            }}
            className="print:hidden text-sm text-slate-400 hover:text-red-400"
          >
            Delete log
          </button>
        )}
      </div>
    </main>
  );
}

