'use client';

import { useEffect, useState } from 'react';
import { RECORD_MODULES, isLocked, type Signature } from '@/lib/records';
import { PHOTO_BUCKET, signedPhotoUrls, uploadPhotos } from '@/lib/photos';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { SignaturePad } from './daily-logs/signature-pad';

interface Rec {
  id: string;
  company_id?: string;
  project: string;
  record_date: string;
  status: string | null;
  data: Record<string, any> | null;
  signatures: Signature[] | null;
  photos: string[] | null;
}

const today = () => new Date().toLocaleDateString('en-CA');
const input = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 disabled:opacity-70';
const label = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';

export function RecordList({ module }: { module: string }) {
  const m = RECORD_MODULES[module];
  const [recs, setRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [project, setProject] = useState('');
  const [date, setDate] = useState(today());
  const [search, setSearch] = useState('');
  const headline = m.fields[0];

  useEffect(() => {
    fetch(`/api/records/${module}`).then((r) => r.json()).then((j) => (j.success ? setRecs(j.data) : setError(j.error))).catch(() => setError('Could not load records.')).finally(() => setLoading(false));
  }, [module]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/records/${module}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, record_date: date }) })
      .then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (res.success) window.location.href = `/${module}/${res.data.id}`;
    else setError(res.error);
  }

  const projects = Array.from(new Set(recs.map((r) => r.project).filter(Boolean)));
  const shown = recs.filter((r) => `${r.project} ${r.record_date} ${r.data?.[headline.key] ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{m.title}</h1>
          <p className="text-slate-400 mt-1">{m.intro}</p>
        </div>
        <form onSubmit={create} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row gap-3">
          <input required list="projects" placeholder="Project / job" value={project} onChange={(e) => setProject(e.target.value)} className={`${input} flex-1`} aria-label="Project" />
          <datalist id="projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${input} sm:w-44`} aria-label="Date" />
          <button className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg whitespace-nowrap">+ New {m.singular}</button>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${input} md:w-96`} />
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                <th className="p-4">Date</th><th className="p-4">Project</th><th className="p-4">{headline.label}</th><th className="p-4">Signatures</th><th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? <tr><td colSpan={5} className="p-8 text-center text-slate-500">Loading…</td></tr>
                : shown.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-slate-500">Nothing yet. Start one above.</td></tr>
                : shown.map((r) => (
                  <tr key={r.id} onClick={() => (window.location.href = `/${module}/${r.id}`)} className="hover:bg-slate-800/50 cursor-pointer">
                    <td className="p-4 text-slate-300 whitespace-nowrap">{r.record_date}</td>
                    <td className="p-4 text-white font-medium"><a href={`/${module}/${r.id}`}>{r.project}</a></td>
                    <td className="p-4 text-slate-300">{r.data?.[headline.key] || '—'}</td>
                    <td className="p-4 text-slate-300">{r.signatures?.length || 0}</td>
                    <td className={`p-4 ${isLocked(m, r.signatures || []) ? 'text-emerald-400' : 'text-amber-400'}`}>{r.status || 'Open'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

export function RecordDetail({ module, id }: { module: string; id: string }) {
  const m = RECORD_MODULES[module];
  const [rec, setRec] = useState<Rec | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [signRole, setSignRole] = useState('');
  const [signer, setSigner] = useState('');
  const [signature, setSignature] = useState('');
  const [padKey, setPadKey] = useState(0);

  useEffect(() => {
    fetch(`/api/records/${module}/${id}`).then((r) => r.json()).then((j) => (j.success ? setRec(j.data) : setError(j.error))).catch(() => setError('Could not load this record.'));
  }, [module, id]);

  useEffect(() => {
    const missing = (rec?.photos || []).filter((p): p is string => !!p && !urls[p]);
    if (missing.length) signedPhotoUrls(missing).then((u) => setUrls((x) => ({ ...x, ...(Object.fromEntries(Object.entries(u).filter(([, v]) => typeof v === "string")) as Record<string, string>) })));
  }, [rec?.photos, urls]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <main className="min-h-screen bg-slate-950 text-red-400 p-8">{error}</main>;
  if (!rec) return <main className="min-h-screen bg-slate-950 text-slate-400 p-8">Loading…</main>;

  const sigs = rec.signatures || [];
  const photos = rec.photos || [];
  const data = rec.data || {};
  const locked = isLocked(m, sigs);
  const roles = sigs.map((s) => s.role);
  const openSlots = locked ? [] : m.slots.filter((s) => (s.multi || !roles.includes(s.role)) && (!s.after || roles.includes(s.after)));
  const slot = m.slots.find((s) => s.role === (signRole || openSlots[0]?.role));
  const edit = (patch: Partial<Rec>) => { setRec({ ...rec, ...patch }); setDirty(true); };
  const setData = (k: string, v: unknown) => edit({ data: { ...data, [k]: v } });

  async function send(body: Record<string, unknown>, okMessage: string) {
    setStatus('Saving…');
    const res = await fetch(`/api/records/${module}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (!res.success) { setStatus(`Not saved: ${res.error}`); return false; }
    setRec(res.data);
    setDirty(false);
    setStatus(okMessage);
    setTimeout(() => setStatus(''), 2500);
    return true;
  }
  const fields = () => ({ project: rec!.project, record_date: rec!.record_date, data: rec!.data || {} });

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(files.length);
    const { paths, error } = await uploadPhotos(files, `${rec!.company_id}/${module}/${id}`, () => setUploading((n) => n - 1));
    if (error) setStatus(`Photo not uploaded: ${error}`);
    if (paths.length) await send({ ...fields(), photos: [...photos, ...paths] }, `${paths.length} photo${paths.length > 1 ? 's' : ''} added`);
  }

  async function sign() {
    if (!slot) return;
    if (await send({ ...fields(), action: 'sign', role: slot.role, name: signer, signature }, `${slot.label}: signed`)) {
      setSigner('');
      setSignature('');
      setSignRole('');
      setPadKey((k) => k + 1);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8 print:bg-white print:text-gray-700 print:p-0">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between gap-4 print:hidden">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">{m.singular}: {rec.project}</h1>
            <p className="text-slate-400 mt-1">{rec.record_date} · <span className={locked ? 'text-emerald-400' : 'text-amber-400'}>{rec.status || 'Open'}</span></p>
          </div>
          <div className="flex items-center gap-3">
            {dirty && !status && <span className="text-sm text-amber-400">Unsaved changes</span>}
            {status && <span className={`text-sm font-semibold ${status.startsWith('Not') || status.startsWith('Photo not') ? 'text-red-400' : 'text-emerald-400'}`}>{status}</span>}
            {!locked && <button onClick={() => send(fields(), 'Saved')} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">Save</button>}
            <button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-2.5 rounded-lg">Print / PDF</button>
          </div>
        </div>
        <header className="hidden print:block border-b-2 border-black pb-3">
          <h1 className="text-2xl font-bold text-black">{m.singular}: {rec.project}</h1>
          <p>{rec.record_date} · {rec.status}</p>
        </header>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 grid sm:grid-cols-2 gap-4 print:bg-white print:border-0 print:p-0">
          <div>
            <label className={label} htmlFor="project">Project</label>
            <input id="project" disabled={locked} className={input} value={rec.project} onChange={(e) => edit({ project: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="record_date">Date</label>
            <input id="record_date" type="date" disabled={locked} className={input} value={rec.record_date} onChange={(e) => edit({ record_date: e.target.value })} />
          </div>
          {m.fields.map((f) => (
            <div key={f.key} className={f.type === 'textarea' || f.type === 'checklist' ? 'sm:col-span-2' : ''}>
              <label className={label} htmlFor={f.key}>{f.label}{m.required.includes(f.key) && ' *'}</label>
              {f.type === 'textarea' ? (
                <textarea id={f.key} rows={3} disabled={locked} placeholder={f.placeholder} className={input} value={data[f.key] ?? ''} onChange={(e) => setData(f.key, e.target.value)} />
              ) : f.type === 'select' ? (
                <select id={f.key} disabled={locked} className={input} value={data[f.key] ?? ''} onChange={(e) => setData(f.key, e.target.value)}>
                  <option value="">Choose…</option>
                  {f.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : f.type === 'checklist' ? (
                <div className="flex flex-wrap gap-2">
                  {f.options.map((o) => {
                    const on = (data[f.key] || []).includes(o);
                    return (
                      <label key={o} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${on ? 'border-amber-500 bg-amber-500/10 text-amber-300 print:text-black' : 'border-slate-700 text-slate-300 print:hidden'}`}>
                        <input type="checkbox" disabled={locked} checked={on} onChange={() => setData(f.key, on ? data[f.key].filter((x: string) => x !== o) : [...(data[f.key] || []), o])} className="accent-amber-500" />
                        {o}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <input id={f.key} type={f.type} disabled={locked} placeholder={f.placeholder} className={input} value={data[f.key] ?? ''} onChange={(e) => setData(f.key, e.target.value)} />
              )}
            </div>
          ))}
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 print:bg-white print:border-0 print:p-0 break-inside-avoid">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-white print:text-black">Photos ({photos.length})</h2>
            {!locked && (
              <label className="print:hidden cursor-pointer bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
                {uploading ? `Uploading ${uploading}…` : '+ Add photos'}
                <input type="file" accept="image/*" multiple capture="environment" className="hidden" disabled={!!uploading} onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
              </label>
            )}
          </div>
          {photos.length === 0 ? <p className="text-slate-500 text-sm">No photos.</p> : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {photos.map((p) => (
                <figure key={p} className="relative group">
                  {urls[p] ? <a href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="Site photo" className="w-full aspect-[4/3] object-cover rounded-lg" /></a> : <div className="w-full aspect-[4/3] bg-slate-800 rounded-lg" />}
                  {!locked && (
                    <button onClick={async () => {
                      if (!confirm('Remove this photo?')) return;
                      if (await send({ photos: photos.filter((x) => x !== p) }, 'Photo removed')) await supabaseBrowser().storage.from(PHOTO_BUCKET).remove([p]);
                    }} className="print:hidden absolute top-1 right-1 bg-black/70 text-white rounded px-2 py-0.5 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Remove photo">✕</button>
                  )}
                </figure>
              ))}
            </div>
          )}
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 print:bg-white print:border-0 print:p-0 break-inside-avoid">
          <h2 className="text-lg font-bold text-white print:text-black mb-4">Sign-offs</h2>
          {sigs.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {sigs.map((s, i) => (
                <div key={i} className="bg-slate-950 border border-slate-800 rounded-lg p-3 print:bg-white print:border-gray-300">
                  <p className="text-xs uppercase tracking-wider text-slate-400">{m.slots.find((x) => x.role === s.role)?.label}</p>
                  <img src={s.signature} alt={`Signature of ${s.name}`} className="h-16 bg-white rounded my-2" />
                  <p className="text-sm text-slate-200 print:text-black">{s.name} · {new Date(s.signed_at).toLocaleString('en-CA')}</p>
                </div>
              ))}
            </div>
          )}
          {locked ? (
            <button onClick={() => confirm('Reopen for changes? All signatures on it will be removed.') && send({ action: 'reopen' }, 'Reopened')} className="print:hidden text-sm text-slate-400 hover:text-amber-400">Reopen for changes</button>
          ) : slot ? (
            <div className="grid sm:grid-cols-2 gap-4 print:hidden">
              <div>
                {openSlots.length > 1 && (
                  <div className="mb-3">
                    <label className={label} htmlFor="slot">Signing as</label>
                    <select id="slot" className={input} value={slot.role} onChange={(e) => setSignRole(e.target.value)}>
                      {openSlots.map((s) => <option key={s.role} value={s.role}>{s.label}</option>)}
                    </select>
                  </div>
                )}
                <label className={label} htmlFor="signer">{slot.label}: name</label>
                <input id="signer" className={input} value={signer} onChange={(e) => setSigner(e.target.value)} />
                <button onClick={sign} disabled={!signer.trim() || !signature} className="mt-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">Sign: {slot.label}</button>
                {slot.locks && <p className="text-xs text-slate-500 mt-2">This sign-off saves and locks the record.</p>}
              </div>
              <SignaturePad key={padKey} onChange={setSignature} />
            </div>
          ) : null}
        </section>

        {!sigs.length && (
          <button onClick={async () => {
            if (!confirm('Delete this record?')) return;
            const r = await fetch(`/api/records/${module}/${id}`, { method: 'DELETE' }).then((x) => x.json()).catch(() => ({ success: false }));
            if (r.success) { setDirty(false); window.location.href = `/${module}`; } else setStatus(`Not deleted: ${r.error || 'Network error'}`);
          }} className="print:hidden text-sm text-slate-400 hover:text-red-400">Delete</button>
        )}
      </div>
    </main>
  );
}
