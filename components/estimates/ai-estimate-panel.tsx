'use client';

import { useRef, useState } from 'react';
import { Alert, Badge, Button, Label, Panel, Textarea } from '@/components/ui';
import type { EstimateLine } from '@/lib/estimate-math';

// Mirrors lib/ai-estimate.ts and lib/costbook/types.ts. Kept local so this client file pulls in no server code.
interface PricedLine {
  code: string | null;
  description: string;
  quantity: number;
  unit: string;
  materialUnitCost: number;
  labourHoursPerUnit: number;
  labourClass: string | null;
  priceSource: 'company' | 'reference' | 'line' | 'none';
  confidence: 'high' | 'medium' | 'low' | null;
  note?: string;
}
interface Draft {
  summary: string;
  trade: string;
  assumptions: string[];
  exclusions: string[];
  questions_for_client: string[];
}
interface DraftResponse {
  draft: Draft;
  lines: PricedLine[];
  estimateLines: EstimateLine[];
}

const MAX_FILES = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_SCOPE = 20_000;

const SOURCE_LABEL: Record<PricedLine['priceSource'], string> = {
  company: 'Your price',
  reference: 'Reference price',
  line: 'Estimated by AI',
  none: 'No price yet',
};
const SOURCE_STYLE: Record<PricedLine['priceSource'], string> = {
  company: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  reference: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  line: 'bg-slate-700/40 text-slate-300 border-slate-600',
  none: 'bg-red-500/10 text-red-400 border-red-500/20',
};
const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function AiEstimatePanel({
  canWrite,
  onAddLines,
}: {
  canWrite: boolean;
  onAddLines: (lines: EstimateLine[], extras: { scopeText?: string; exclusions?: string[] }) => void;
}) {
  const [scope, setScope] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DraftResponse | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [added, setAdded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Lines the estimate can hold are the ones with a quantity, in the same order as estimateLines
  const rows = result ? result.lines.filter((l) => l.quantity > 0) : [];

  function addFiles(incoming: FileList | File[]) {
    setError('');
    const next = [...files];
    for (const f of Array.from(incoming)) {
      if (!TYPES.includes(f.type)) return setError('Only PDF, PNG, JPEG and WebP files can be used.');
      if (f.size > MAX_FILE_BYTES) return setError(`"${f.name}" is over 10 MB. Use a smaller file or a lower-resolution photo.`);
      if (next.length >= MAX_FILES) return setError(`Attach up to ${MAX_FILES} files.`);
      next.push(f);
    }
    setFiles(next);
  }

  async function draft() {
    if (busy || !canWrite) return;
    if (!scope.trim() && files.length === 0) return setError('Describe the work or attach a drawing, scope document or photo.');
    setError('');
    setResult(null);
    setAdded(false);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const form = new FormData();
      if (scope.trim()) form.append('scope', scope.trim());
      for (const f of files) form.append('files', f);
      const res = await fetch('/api/ai/estimate', { method: 'POST', body: form, signal: controller.signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'The draft could not be made.');
      const data = json as DraftResponse;
      setResult(data);
      // Lines with no price at all start unticked so a zero never lands in an estimate by accident
      setPicked(new Set(data.lines.filter((l) => l.quantity > 0).flatMap((l, i) => (l.priceSource === 'none' ? [] : [i]))));
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'The draft could not be made.');
    } finally {
      setBusy(false);
    }
  }

  function toggle(i: number) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  function addSelected() {
    if (!result || !canWrite) return;
    const lines = result.estimateLines.filter((_, i) => picked.has(i));
    if (!lines.length) return;
    onAddLines(lines, {
      scopeText: scope.trim() || result.draft.summary || undefined,
      exclusions: result.draft.exclusions.length ? result.draft.exclusions : undefined,
    });
    setAdded(true);
  }

  return (
    <Panel title="Draft with AI" description="Describe the job or attach drawings and photos. You get a draft to review. Nothing is added until you say so.">
      {!canWrite && <Alert tone="info">Your trial or subscription has ended. Update billing to draft estimates with AI.</Alert>}

      <div className="space-y-4">
        <div>
          <Label htmlFor="ai-scope">Scope of work</Label>
          <Textarea
            id="ai-scope"
            rows={5}
            maxLength={MAX_SCOPE}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            disabled={busy || !canWrite}
            placeholder="e.g. Finish the basement: 12 pot lights, 8 receptacles and a 15 A circuit from the main panel"
          />
          <p className="text-xs text-slate-500 mt-1">{scope.length.toLocaleString('en-CA')} of {MAX_SCOPE.toLocaleString('en-CA')} characters</p>
        </div>

        <div>
          <Label htmlFor="ai-files">Drawings, scope documents or photos</Label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (canWrite && !busy) addFiles(e.dataTransfer.files);
            }}
            className={`rounded-xl border-2 border-dashed p-4 text-center text-sm ${dragging ? 'border-amber-500 bg-amber-500/5' : 'border-slate-700 bg-slate-900/40'} text-slate-400`}
          >
            <p>Drop up to {MAX_FILES} files here. PDF, PNG, JPEG or WebP, 10 MB each.</p>
            <input
              ref={inputRef}
              id="ai-files"
              type="file"
              multiple
              accept={TYPES.join(',')}
              className="sr-only"
              disabled={busy || !canWrite}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" className="mt-3" disabled={busy || !canWrite || files.length >= MAX_FILES} onClick={() => inputRef.current?.click()}>
              Choose files
            </Button>
          </div>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 rounded-lg bg-slate-800/60 px-3 text-sm text-slate-300">
                  <span className="truncate py-2">{f.name} <span className="text-slate-500">({fileSize(f.size)})</span></span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <Alert>{error}</Alert>}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={draft} disabled={busy || !canWrite}>
            {busy ? 'Drafting…' : 'Draft with AI'}
          </Button>
          {busy && (
            <>
              <span role="status" className="text-sm text-slate-400">Reading your scope and pricing the lines. This can take a minute or two.</span>
              <Button variant="ghost" onClick={() => abortRef.current?.abort()}>Cancel</Button>
            </>
          )}
        </div>
        {busy && (
          <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800" aria-hidden="true">
            <div className="h-full w-1/3 animate-pulse rounded bg-amber-500" />
          </div>
        )}
      </div>

      {result && (
        <div className="mt-6 space-y-5 border-t border-slate-800 pt-5">
          <p role="note" className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
            Sizes and quantities here are AI assumptions. Check them before you send. The summary and scope text will appear on the client proposal once you add them, so review the wording first.
          </p>
          <div>
            <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Summary</h3>
            <p className="mt-1 text-slate-200">{result.draft.summary}</p>
          </div>

          <DraftList title="Assumptions" items={result.draft.assumptions} />
          <DraftList title="Exclusions" items={result.draft.exclusions} />
          <DraftList title="Questions for the client" items={result.draft.questions_for_client} />

          <div>
            <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Lines</h3>
            {rows.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">No lines came back. Add detail to the scope and try again.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {rows.map((l, i) => (
                  <li key={i} className="rounded-xl border border-slate-800 bg-slate-900/60">
                    <label className="flex min-h-[48px] cursor-pointer items-start gap-3 p-3 lg:min-h-0">
                      <input type="checkbox" className="mt-1 h-5 w-5 accent-amber-500" checked={picked.has(i)} onChange={() => toggle(i)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-slate-100">{l.description}</span>
                        <span className="block text-sm text-slate-400">
                          {l.quantity} {l.unit}
                          {l.priceSource !== 'none' ? ` · ${money(l.materialUnitCost)} each` : ''}
                          {l.labourHoursPerUnit > 0 ? ` · ${l.labourHoursPerUnit} h each` : ''}
                        </span>
                        {l.note && <span className="block text-xs text-slate-500">{l.note}</span>}
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <span className={`rounded-full border px-2 py-0.5 text-xs ${SOURCE_STYLE[l.priceSource]}`}>{SOURCE_LABEL[l.priceSource]}</span>
                          {l.confidence && <Badge>{CONFIDENCE_LABEL[l.confidence]}</Badge>}
                          {l.priceSource === 'none' && <span className="text-xs text-red-300">Enter the price in the estimate after adding.</span>}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={addSelected} disabled={!canWrite || picked.size === 0}>
                Add selected lines ({picked.size})
              </Button>
              {added && <span role="status" className="text-sm text-emerald-400">Added. Check the prices before you send.</span>}
            </div>
          )}
          <p className="text-xs text-slate-500">This is an AI draft. Check quantities, prices and scope before you send an estimate to a client.</p>
        </div>
      )}
    </Panel>
  );
}

function DraftList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-300">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
