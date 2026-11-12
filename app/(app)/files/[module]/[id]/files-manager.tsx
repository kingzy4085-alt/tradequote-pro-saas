'use client';

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { Alert, Button, Panel } from '@/components/ui';
import {
  ALLOWED_FILES_TEXT,
  ATTACHMENT_ACCEPT,
  ATTACHMENTS_BUCKET,
  MAX_ATTACHMENTS_PER_RECORD,
  attachmentHref,
  attachmentKind,
  attachmentLinkRequest,
  attachmentPath,
  attachmentUploadUrl,
  checkAttachmentFile,
  cleanFileName,
  formatBytes,
  newFileId,
  quotedName,
  storageUploadError,
  typeLabel,
  type Attachment,
  type AttachmentModule,
} from '@/lib/attachments';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

// Phones and tablets get 48px to tap, for gloves. A desk keeps the tighter size.
const TAP = 'min-h-[48px] lg:min-h-0';

type Job = { key: string; file: File; name: string; ext: string; contentType: string };
type Progress = { key: string; name: string; percent: number; stage: 'waiting' | 'uploading' | 'saving' };

/** Puts one file in storage with the signed-in user's own session, reporting how far along it is. */
function sendToStorage(url: string, token: string, apiKey: string, body: Blob, onProgress: (fraction: number) => void): Promise<{ status: number; text: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', apiKey);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => resolve({ status: 0, text: '' });
    xhr.onabort = () => resolve({ status: 0, text: '' });
    // The same form supabase-js sends. Storage takes the file's type from its part, which is the checked type.
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', body);
    xhr.send(form);
  });
}

/** A session that ended mid-visit goes to sign-in and comes back here afterwards. */
function signIn() {
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
}

const hasFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export default function FilesManager({
  module,
  recordId,
  folder,
  initialFiles,
  canUpload,
  canDelete,
  viewOnlyReason,
}: {
  module: AttachmentModule;
  recordId: string;
  /** The record's storage folder, built on the server from the session's company. */
  folder: string;
  initialFiles: Attachment[];
  canUpload: boolean;
  canDelete: boolean;
  /** Why there is no way to add files, when the role or the subscription is the reason. */
  viewOnlyReason?: string;
}) {
  const [files, setFiles] = useState<Attachment[]>(initialFiles);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noPreview, setNoPreview] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const queue = useRef<Job[]>([]);
  const working = useRef(false);
  // Files waiting or going up, so a second drop counts them toward the limit
  const pending = useRef(0);
  const addedThisRun = useRef(0);
  const fileCount = useRef(initialFiles.length);
  fileCount.current = files.length;

  const uploading = progress.length > 0;

  // A file dropped beside the box would open in the browser and leave the page
  useEffect(() => {
    if (!canUpload) return;
    const stop = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, [canUpload]);

  // Leaving mid-upload would drop the files still going up
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  const update = (key: string, change: Partial<Progress>) => setProgress((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));

  /** Uploads one file, then records it. Returns what went wrong, or null. */
  async function uploadOne(job: Job): Promise<string | null> {
    update(job.key, { stage: 'uploading', percent: 0 });
    const supabase = getSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getSession();
    const token = auth.session?.access_token;
    if (!token) return 'Your session has ended. Sign in again, then add the file.';

    const path = attachmentPath(folder, newFileId(), job.ext);
    const sent = await sendToStorage(
      attachmentUploadUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', path),
      token,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      job.file.slice(0, job.file.size, job.contentType),
      (fraction) => update(job.key, { percent: Math.min(99, Math.round(fraction * 100)) })
    );
    if (sent.status < 200 || sent.status >= 300) return storageUploadError(sent.status, sent.text, job.name);

    update(job.key, { stage: 'saving', percent: 100 });
    let res: Response;
    try {
      res = await fetch(`/api/attachments/${module}/${recordId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, file_name: job.name, content_type: job.contentType, size_bytes: job.file.size }),
      });
    } catch {
      // The answer was lost, not refused: the file may well be saved, so it stays where it is
      return `${quotedName(job.name)} was uploaded, but the connection dropped before it was saved. Refresh the page to check.`;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Refused, so nothing records the file: take it back out of storage
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]).catch(() => undefined);
      if (res.status === 401) return 'Your session has ended. Sign in again, then add the file.';
      return typeof json.error === 'string' ? `${quotedName(job.name)} was not added. ${json.error}` : `${quotedName(job.name)} could not be saved. Try again.`;
    }
    setFiles((list) => [json.data as Attachment, ...list.filter((f) => f.id !== json.data.id)]);
    return null;
  }

  /** Works through the queue one file at a time, so each shows its own progress. */
  async function work() {
    if (working.current) return;
    working.current = true;
    try {
      while (queue.current.length) {
        const job = queue.current.shift()!;
        let failure: string | null;
        try {
          failure = await uploadOne(job);
        } catch {
          failure = `${quotedName(job.name)} could not be uploaded. Try again.`;
        }
        pending.current -= 1;
        setProgress((list) => list.filter((p) => p.key !== job.key));
        if (failure) setProblems((list) => [...list, failure as string]);
        else addedThisRun.current += 1;
      }
      if (addedThisRun.current) setNotice(addedThisRun.current === 1 ? '1 file added.' : `${addedThisRun.current} files added.`);
      addedThisRun.current = 0;
    } finally {
      working.current = false;
    }
  }

  function addFiles(list: File[]) {
    if (!canUpload || list.length === 0) return;
    setNotice('');
    setError('');
    const refused: string[] = [];
    const jobs: Job[] = [];
    for (const file of list) {
      const name = cleanFileName(file.name);
      const check = checkAttachmentFile({ name, type: file.type, size: file.size });
      if (!check.ok) {
        refused.push(check.error);
        continue;
      }
      if (fileCount.current + pending.current + jobs.length >= MAX_ATTACHMENTS_PER_RECORD) {
        refused.push(`${quotedName(name)} was not added. A record can have up to ${MAX_ATTACHMENTS_PER_RECORD} files.`);
        continue;
      }
      jobs.push({ key: newFileId(), file, name, ext: check.ext, contentType: check.contentType });
    }
    setProblems(refused);
    if (!jobs.length) return;
    pending.current += jobs.length;
    queue.current.push(...jobs);
    setProgress((p) => [...p, ...jobs.map((j) => ({ key: j.key, name: j.name, percent: 0, stage: 'waiting' as const }))]);
    void work();
  }

  /** Asks for a fresh link and saves the file under its own name. A failure shows here, not on a blank page. */
  async function download(file: Attachment) {
    setError('');
    try {
      const res = await fetch(attachmentLinkRequest(file, true), { cache: 'no-store' });
      if (res.status === 401) return signIn();
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.data?.url !== 'string') throw new Error(typeof json.error === 'string' ? json.error : 'That file could not be opened. Try again.');
      window.location.assign(json.data.url);
    } catch (err) {
      setError(err instanceof TypeError ? 'Network error. Check your connection and try again.' : err instanceof Error ? err.message : 'That file could not be opened. Try again.');
    }
  }

  async function remove(file: Attachment) {
    if (!window.confirm(`Delete ${quotedName(file.file_name)}? This cannot be undone.`)) return;
    setBusyId(file.id);
    setError('');
    setNotice('');
    try {
      const res = await fetch(attachmentHref(file), { method: 'DELETE' });
      if (res.status === 401) return signIn();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'The file could not be deleted. Try again.');
      setFiles((list) => list.filter((f) => f.id !== file.id));
      setNotice(`Deleted ${quotedName(file.file_name)}.`);
    } catch (err) {
      setError(err instanceof TypeError ? 'Network error. Nothing was deleted; check your connection and try again.' : err instanceof Error ? err.message : 'The file could not be deleted. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {(error || problems.length > 0 || notice) && (
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          {problems.length > 0 && (
            <Alert>
              <ul className="space-y-1">
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}
          {notice && <Alert tone="success">{notice}</Alert>}
        </div>
      )}

      {canUpload ? (
        <div
          onDragEnter={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            addFiles(Array.from(e.dataTransfer.files));
          }}
          className={`rounded-2xl border-2 border-dashed p-6 sm:p-10 text-center transition-colors ${dragging ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 bg-slate-900'}`}
        >
          <p className="text-lg font-semibold text-white">{dragging ? 'Drop to add these files' : 'Drag files here to add them'}</p>
          <p className="text-sm text-slate-400 mt-1">{`${ALLOWED_FILES_TEXT}. Up to 25 MB each.`}</p>
          <Button className="mt-4" onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            aria-label="Choose files to add"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
      ) : viewOnlyReason ? (
        <Alert tone="info">{viewOnlyReason}</Alert>
      ) : null}

      {progress.length > 0 && (
        <Panel title="Uploading">
          <ul className="space-y-4">
            {progress.map((p) => (
              <li key={p.key}>
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-slate-200 truncate">{p.name}</span>
                  <span className="text-slate-400 whitespace-nowrap">{p.stage === 'waiting' ? 'Waiting' : p.stage === 'saving' ? 'Saving' : `${p.percent}%`}</span>
                </div>
                <div role="progressbar" aria-label={`Uploading ${p.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-amber-500 transition-all" style={{ width: `${p.percent}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`Files (${files.length})`}>
        {files.length === 0 ? (
          <p className="text-sm text-slate-400">{canUpload ? 'No files yet. Drag them into the box above, or choose them from this device.' : 'No files yet.'}</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {files.map((f) => {
              const kind = attachmentKind(f.content_type);
              // Pictures and PDFs open in the browser; drawings, Word, Excel and text files download
              const opens = kind !== 'file';
              return (
                <li key={f.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    {kind === 'image' && !noPreview[f.id] ? (
                      <a href={attachmentHref(f)} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label={`Open ${f.file_name}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- each load asks the server for a short-lived signed link */}
                        <img src={attachmentHref(f)} alt={`Preview of ${f.file_name}`} loading="lazy" onError={() => setNoPreview((m) => ({ ...m, [f.id]: true }))} className="h-16 w-16 rounded-lg object-cover bg-slate-800" />
                      </a>
                    ) : (
                      <span aria-hidden="true" className="shrink-0 h-16 w-16 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-amber-400">
                        {typeLabel(f.file_name)}
                      </span>
                    )}
                    <div className="min-w-0">
                      {opens ? (
                        <a href={attachmentHref(f)} target="_blank" rel="noopener noreferrer" className={`${TAP} inline-flex items-center font-semibold text-white hover:text-amber-400 hover:underline break-all`}>
                          {f.file_name}
                        </a>
                      ) : (
                        <a
                          href={attachmentHref(f, true)}
                          onClick={(e) => {
                            e.preventDefault();
                            void download(f);
                          }}
                          className={`${TAP} inline-flex items-center font-semibold text-white hover:text-amber-400 hover:underline break-all`}
                        >
                          {f.file_name}
                        </a>
                      )}
                      <p className="text-xs text-slate-400" suppressHydrationWarning>
                        {`${typeLabel(f.file_name)} · ${formatBytes(f.size_bytes)} · Added ${new Date(f.created_at).toLocaleDateString('en-CA')}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:shrink-0">
                    <Button variant="secondary" size="sm" aria-label={`Download ${f.file_name}`} onClick={() => void download(f)}>
                      Download
                    </Button>
                    {canDelete && (
                      <Button variant="danger" size="sm" aria-label={`Delete ${f.file_name}`} disabled={busyId === f.id} onClick={() => void remove(f)}>
                        {busyId === f.id ? 'Deleting...' : 'Delete'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
