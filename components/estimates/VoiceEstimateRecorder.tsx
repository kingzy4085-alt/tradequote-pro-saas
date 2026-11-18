'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mic, Square, Upload, X } from 'lucide-react';
import type { EstimateLine } from '@/lib/estimate-math';
import { formatMoney } from '@/lib/format';
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, toEstimateLines, VOICE_ACCEPT, type VoiceEstimate, type VoiceLine } from '@/lib/voice-estimate';

type Phase = 'idle' | 'recording' | 'processing' | 'review';

// Chrome/Edge/Android record webm, Safari/iOS mp4, Firefox ogg. All three go to the model as-is.
const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

const SOURCE_LABEL: Record<VoiceLine['price_source'], string> = {
  spoken: 'Price said',
  assembly: 'From your assemblies',
  none: 'No price yet',
};

const big = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg font-semibold text-sm transition-colors disabled:opacity-50';

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function canRecord() {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Record a walk-through of the job on a phone, get estimate lines back, tick the ones to keep and
 * add them to the estimate. Nothing is saved until the contractor saves the estimate.
 */
export function VoiceEstimateRecorder({ onLines, disabled = false }: { onLines: (lines: EstimateLine[]) => void; disabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<VoiceEstimate | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [supported, setSupported] = useState(true);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Decided after mount so the server render and the first client render agree
  useEffect(() => setSupported(canRecord()), []);

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  // Let go of the microphone if the page goes away mid-recording
  useEffect(() => () => {
    if (recorder.current && recorder.current.state !== 'inactive') {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    release();
  }, []);

  async function send(audio: Blob) {
    if (audio.size > MAX_VOICE_BYTES) {
      setPhase('idle');
      return setError('That recording is too long. Keep it under 5 minutes.');
    }
    setPhase('processing');
    try {
      const form = new FormData();
      const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', audio, audio instanceof File ? audio.name : `voice-note.${ext}`);
      const res = await fetch('/api/ai/parse-voice', { method: 'POST', body: form, cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'We could not process that recording.');
      const data = json.data as VoiceEstimate;
      setResult(data);
      setKeep(new Set(data.items.map((_, i) => i)));
      setPhase('review');
    } catch (err) {
      setError(err instanceof TypeError ? 'Network error. Check your connection and try again.' : err instanceof Error ? err.message : 'We could not process that recording.');
      setPhase('idle');
    }
  }

  async function start() {
    setError('');
    setNote('');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = media;
      const mimeType = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        release();
        const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || 'audio/webm' });
        if (!blob.size) {
          setPhase('idle');
          return setError('Nothing was recorded. Check the microphone and try again.');
        }
        void send(blob);
      };
      recorder.current = rec;
      rec.start(1000);
      setSeconds(0);
      setPhase('recording');
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_VOICE_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      release();
      const name = err instanceof DOMException ? err.name : '';
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is blocked. Allow it for this site in your browser settings, or upload a voice memo instead.'
          : name === 'NotFoundError'
            ? 'No microphone was found on this device.'
            : 'Could not start recording. Try uploading a voice memo instead.'
      );
    }
  }

  function stop() {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setNote('');
    void send(file);
  }

  function toggle(i: number) {
    setKeep((k) => {
      const next = new Set(k);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function addLines() {
    if (!result) return;
    const lines = toEstimateLines(result.items.filter((_, i) => keep.has(i)));
    if (!lines.length) return;
    onLines(lines);
    const missing = result.items.filter((l, i) => keep.has(i) && l.price_source === 'none').length;
    setNote(
      `Added ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}.` +
        (missing ? ` ${missing} still ${missing === 1 ? 'needs' : 'need'} a material price.` : '') +
        ' Check them, then save the estimate.'
    );
    setResult(null);
    setPhase('idle');
  }

  function discard() {
    setResult(null);
    setPhase('idle');
  }

  const busy = disabled || phase === 'processing';

  return (
    <div className="p-4 border border-slate-700 rounded-lg bg-slate-900/50 space-y-3">
      <div className="flex items-center gap-2 text-amber-400 font-medium">
        <Mic className="w-5 h-5" aria-hidden />
        <span>Voice to Estimate</span>
      </div>

      {phase !== 'review' && (
        <p className="text-xs text-slate-400">
          Walk through the job out loud: materials, quantities, prices if you know them, and labour hours. We turn it into estimate lines you can check before adding.
        </p>
      )}

      {phase === 'idle' && (
        <div className="flex flex-col sm:flex-row gap-2">
          {supported && (
            <button type="button" onClick={start} disabled={busy} className={`${big} flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950`}>
              <Mic className="w-5 h-5" aria-hidden />
              Start recording
            </button>
          )}
          <label className={`${big} flex-1 cursor-pointer border border-slate-600 text-slate-200 hover:bg-slate-800 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload className="w-4 h-4" aria-hidden />
            Upload voice memo
            <input type="file" accept={VOICE_ACCEPT} className="sr-only" onChange={onFile} disabled={busy} />
          </label>
        </div>
      )}

      {phase === 'recording' && (
        <div className="flex flex-col items-center gap-3 py-2" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-red-400 font-mono text-2xl tabular-nums">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" aria-hidden />
            {clock(seconds)}
            <span className="sr-only">recording</span>
          </div>
          <p className="text-xs text-slate-400">Stops by itself at {clock(MAX_VOICE_SECONDS)}.</p>
          <button type="button" onClick={stop} className={`${big} w-full bg-red-600 hover:bg-red-500 text-white`}>
            <Square className="w-4 h-4 fill-current" aria-hidden />
            Stop and build lines
          </button>
        </div>
      )}

      {phase === 'processing' && (
        <div className="flex items-center justify-center gap-2 min-h-[48px] text-slate-300 text-sm" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
          Listening and building lines...
        </div>
      )}

      {phase === 'review' && result && (
        <div className="space-y-3">
          {result.items.length === 0 ? (
            <p className="text-sm text-slate-300">We did not hear any items to add. Try again and name the materials and quantities.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400">Untick anything you don&apos;t want. You can change prices and hours after adding.</p>
              <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg">
                {result.items.map((l, i) => (
                  <li key={i}>
                    <label className="flex items-start gap-3 p-3 min-h-[56px] cursor-pointer">
                      <input type="checkbox" checked={keep.has(i)} onChange={() => toggle(i)} className="mt-1 h-5 w-5 accent-amber-500 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-slate-100 break-words">{l.description}</span>
                        <span className="block text-xs text-slate-400 mt-0.5">
                          {l.quantity} {l.unit}
                          {' · '}
                          {formatMoney(l.material_unit_cost)}/{l.unit}
                          {Number(l.labour_hours_per_unit) > 0 && ` · ${l.labour_hours_per_unit} h/${l.unit}`}
                        </span>
                        <span className={`inline-block mt-1 text-[11px] px-1.5 py-0.5 rounded ${l.price_source === 'none' ? 'bg-red-500/15 text-red-300' : 'bg-slate-700/60 text-slate-300'}`}>
                          {SOURCE_LABEL[l.price_source]}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.dropped > 0 && <p className="text-xs text-amber-300">{result.dropped} unclear {result.dropped === 1 ? 'item was' : 'items were'} left out.</p>}
          {result.notes && <p className="text-xs text-amber-300 whitespace-pre-line">{result.notes}</p>}
          {result.transcript && (
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer min-h-[32px] flex items-center">What we heard</summary>
              <p className="mt-1 whitespace-pre-line">{result.transcript}</p>
            </details>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            {result.items.length > 0 && (
              <button type="button" onClick={addLines} disabled={!keep.size} className={`${big} flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950`}>
                <Check className="w-4 h-4" aria-hidden />
                Add {keep.size} {keep.size === 1 ? 'line' : 'lines'} to estimate
              </button>
            )}
            <button type="button" onClick={discard} className={`${big} flex-1 border border-slate-600 text-slate-200 hover:bg-slate-800`}>
              <X className="w-4 h-4" aria-hidden />
              {result.items.length ? 'Discard' : 'Try again'}
            </button>
          </div>
        </div>
      )}

      {note && <p className="text-xs text-emerald-400" role="status">{note}</p>}
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
    </div>
  );
}
