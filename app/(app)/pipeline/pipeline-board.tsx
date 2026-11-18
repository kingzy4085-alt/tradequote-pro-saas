'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Button, ButtonLink } from '@/components/ui';
import { FOLLOW_UP_DAYS, HEALTH_LEGEND, followUpMailto, followUpsDue, quoteHealth, withFollowUpNote, type HealthLabel } from '@/lib/followups';
import { formatMoney, formatValue } from '@/lib/format';
import { PIPELINE_STAGES, stageOf, stageTotals, statusForDrop, winRate, type PipelineCard, type PipelineKind, type PipelineStage } from '@/lib/pipeline';

const KIND_LABEL: Record<PipelineKind, string> = { estimates: 'Estimate', proposals: 'Proposal' };

const TONE: Record<PipelineStage['tone'], { head: string; over: string }> = {
  slate: { head: 'text-slate-300', over: 'border-slate-400 bg-slate-800/60' },
  amber: { head: 'text-amber-400', over: 'border-amber-400 bg-amber-500/10' },
  green: { head: 'text-emerald-400', over: 'border-emerald-400 bg-emerald-500/10' },
  red: { head: 'text-red-400', over: 'border-red-400 bg-red-500/10' },
};

// The word carries the meaning; the colour only backs it up
const HEALTH_TONE: Record<HealthLabel, string> = {
  Hot: 'border-emerald-500/40 text-emerald-300',
  Warm: 'border-amber-500/40 text-amber-300',
  Cold: 'border-sky-500/40 text-sky-300',
};

const cardKey = (c: Pick<PipelineCard, 'kind' | 'id'>) => `${c.kind}:${c.id}`;

export default function PipelineBoard({
  initial,
  canMove,
  today,
  emails = {},
  companyName = '',
}: {
  initial: PipelineCard[];
  canMove: Record<PipelineKind, boolean>;
  /** The company's date, YYYY-MM-DD. */
  today: string;
  /** Client email by client id, for the quotes due a follow-up. */
  emails?: Record<string, string>;
  companyName?: string;
}) {
  const [cards, setCards] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const totals = useMemo(() => stageTotals(cards), [cards]);
  const rate = useMemo(() => winRate(cards), [cards]);
  const draggedCard = dragging ? cards.find((c) => cardKey(c) === dragging) : undefined;
  const due = useMemo(() => followUpsDue(cards, today), [cards, today]);

  /** Writes "Followed up <today>" as the first line of the quote's notes, which takes it off the list for FOLLOW_UP_DAYS. */
  async function markFollowedUp(card: PipelineCard) {
    if (!canMove[card.kind] || busy) return;
    const key = cardKey(card);
    const url = `/api/modules/${card.kind}/${card.id}`;
    setError('');
    setNotice('');
    setBusy(key);
    try {
      // The notes as they are now, not as they were when the page loaded: someone may have added to them since
      const current = await fetch(url, { cache: 'no-store' });
      if (current.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent('/pipeline')}`);
        return;
      }
      const currentJson = await current.json().catch(() => ({}));
      if (!current.ok) throw new Error(currentJson.error ?? 'Could not save the follow-up');
      const notes = withFollowUpNote((currentJson.data as { notes?: string | null } | undefined)?.notes, today);
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }), cache: 'no-store' });
      if (res.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent('/pipeline')}`);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not save the follow-up');
      const saved = json.data as { notes?: string | null; status?: string; updated_at?: string } | undefined;
      setCards((list) => list.map((c) => (cardKey(c) === key ? { ...c, notes: saved?.notes ?? notes, status: saved?.status ?? c.status, updated_at: saved?.updated_at ?? c.updated_at } : c)));
      setNotice(`Follow-up noted on “${card.title || 'Untitled'}”. It comes back to this list in ${FOLLOW_UP_DAYS} days if it is still waiting.`);
    } catch (err) {
      setError(err instanceof TypeError ? 'Network error. The follow-up was not saved.' : err instanceof Error ? err.message : 'Could not save the follow-up');
    } finally {
      setBusy(null);
    }
  }

  async function move(card: PipelineCard, stageKey: string) {
    const status = statusForDrop(card, stageKey);
    if (!status || !canMove[card.kind] || busy) return;
    const key = cardKey(card);
    setError('');
    setNotice('');
    setBusy(key);
    // Shown in its new column straight away, and put back if the server refuses
    setCards((list) => list.map((c) => (cardKey(c) === key ? { ...c, status } : c)));
    try {
      const res = await fetch(`/api/modules/${card.kind}/${card.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        cache: 'no-store',
      });
      if (res.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent('/pipeline')}`);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not move that quote');
      const saved = json.data as { status?: string; total_amount?: number | null; updated_at?: string } | undefined;
      setCards((list) =>
        list.map((c) =>
          cardKey(c) === key
            ? { ...c, status: saved?.status ?? status, amount: saved?.total_amount === undefined || saved.total_amount === null ? c.amount : Number(saved.total_amount), updated_at: saved?.updated_at ?? c.updated_at }
            : c
        )
      );
      setNotice(`${KIND_LABEL[card.kind]} “${card.title}” is now ${status}.`);
    } catch (err) {
      setCards((list) => list.map((c) => (cardKey(c) === key ? { ...c, status: card.status } : c)));
      setError(err instanceof TypeError ? 'Network error. The quote was not moved.' : err instanceof Error ? err.message : 'Could not move that quote');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section id="follow-up" aria-labelledby="follow-up-heading" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6 mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
          <h2 id="follow-up-heading" className="text-lg font-bold text-white">
            Follow up{due.length > 0 ? ` (${due.length})` : ''}
          </h2>
          <p className="text-xs text-slate-500">Sent {FOLLOW_UP_DAYS} or more days ago with no decision, longest wait first.</p>
        </div>
        {due.length === 0 ? (
          <p className="text-sm text-slate-300 mt-2">Nothing to chase. A sent quote shows up here once it has waited {FOLLOW_UP_DAYS} days.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {due.map(({ card, daysWaiting, lastFollowedUp }) => {
              const key = cardKey(card);
              const mailto = followUpMailto(card, card.client_id ? emails[card.client_id] : null, companyName);
              return (
                <li key={key} className={`flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 py-3 ${busy === key ? 'opacity-60' : ''}`}>
                  <div className="min-w-0">
                    <p className="font-semibold text-white break-words">
                      {card.title || 'Untitled'} <span className="font-normal text-slate-500">· {KIND_LABEL[card.kind]}</span>
                    </p>
                    <p className="text-sm text-slate-400 break-words">
                      {card.client ?? 'No client named'} · {card.amount === null ? 'No price yet' : formatMoney(card.amount)} · <span className="text-amber-300">Waiting {daysWaiting} days</span>
                      {lastFollowedUp ? ` · Last followed up ${formatValue('date', lastFollowedUp)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <ButtonLink href={`/${card.kind}/${card.id}`} variant="secondary" size="sm">
                      Open
                    </ButtonLink>
                    {mailto && (
                      <a
                        href={mailto}
                        className="min-h-[48px] lg:min-h-0 inline-flex items-center justify-center gap-2 transition-colors bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700 shadow px-3 py-1.5 text-xs rounded-lg"
                      >
                        Email client
                      </a>
                    )}
                    {canMove[card.kind] && (
                      <Button size="sm" disabled={!!busy} onClick={() => void markFollowedUp(card)} aria-label={`Mark ${card.title || 'this quote'} followed up`}>
                        Mark followed up
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Pipeline totals" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Figure label="Open pipeline" value={formatMoney(totals.draft.amount + totals.sent.amount)} caption={`${totals.draft.count + totals.sent.count} draft or sent`} />
        <Figure label="Waiting on clients" value={formatMoney(totals.sent.amount)} caption={`${totals.sent.count} sent`} />
        <Figure label="Won" value={formatMoney(totals.won.amount)} caption={`${totals.won.count} accepted`} />
        <Figure label="Win rate" value={rate === null ? '—' : `${rate}%`} caption={rate === null ? 'Nothing won or lost yet' : `Of ${totals.won.count + totals.lost.count} decided`} />
      </section>

      <div aria-live="polite" className="mb-4 space-y-2 empty:hidden">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
      </div>

      <p className="mb-4 text-xs text-slate-500">Sent quotes are marked by how likely they still are to close. {HEALTH_LEGEND}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
        {PIPELINE_STAGES.map((stage) => {
          const inStage = cards.filter((c) => stageOf(c) === stage.key);
          const droppable = !!draggedCard && statusForDrop(draggedCard, stage.key) !== null;
          const tone = TONE[stage.tone];
          return (
            <section
              key={stage.key}
              aria-label={`${stage.label}: ${inStage.length}`}
              onDragOver={(e) => {
                if (!droppable) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(stage.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === stage.key ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                setDragging(null);
                if (draggedCard) void move(draggedCard, stage.key);
              }}
              className={`rounded-2xl border p-3 transition-colors ${over === stage.key && droppable ? tone.over : 'border-slate-800 bg-slate-900/50'}`}
            >
              <header className="flex items-baseline justify-between gap-2 px-1 mb-3">
                <div>
                  <h2 className={`text-sm font-bold uppercase tracking-wider ${tone.head}`}>{stage.label}</h2>
                  <p className="text-xs text-slate-500">{stage.hint}</p>
                </div>
                <p className="text-right text-sm text-slate-300 whitespace-nowrap">
                  <span className="font-semibold text-white">{formatMoney(totals[stage.key].amount)}</span>
                  <span className="block text-xs text-slate-500">{inStage.length} {inStage.length === 1 ? 'quote' : 'quotes'}</span>
                </p>
              </header>

              {inStage.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-center text-sm text-slate-500">Nothing here</p>
              ) : (
                <ul className="space-y-2">
                  {inStage.map((card) => {
                    const key = cardKey(card);
                    const movable = canMove[card.kind];
                    const targets = PIPELINE_STAGES.filter((s) => statusForDrop(card, s.key) !== null);
                    const health = quoteHealth(card, today);
                    return (
                      <li
                        key={key}
                        draggable={movable && !busy}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', key);
                          setDragging(key);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        className={`rounded-xl border border-slate-800 bg-slate-950 p-3 ${movable ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging === key ? 'opacity-40' : ''} ${busy === key ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/${card.kind}/${card.id}`} draggable={false} className="min-w-0 font-semibold text-white hover:text-amber-400 break-words">
                            {card.title || 'Untitled'}
                          </Link>
                          <span className="shrink-0 rounded-full border border-slate-700 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{KIND_LABEL[card.kind]}</span>
                        </div>
                        {card.client && <p className="mt-1 text-sm text-slate-400 break-words">{card.client}</p>}
                        <div className="mt-2 flex items-end justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-200">{card.amount === null ? 'No price yet' : formatMoney(card.amount)}</p>
                          {card.date && (
                            <p className="text-xs text-slate-500">
                              {card.kind === 'estimates' ? 'Bid due' : 'Valid to'} {formatValue('date', card.date)}
                            </p>
                          )}
                        </div>
                        {health && (
                          <p className="mt-2 flex items-start gap-2 text-xs text-slate-400">
                            <span title={health.reason} className={`shrink-0 rounded-full border px-2 py-0.5 font-semibold ${HEALTH_TONE[health.label]}`}>
                              {health.label}
                            </span>
                            <span className="pt-0.5">{health.reason}</span>
                          </p>
                        )}
                        {movable && targets.length > 0 && (
                          <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                            <span className="shrink-0">Move to</span>
                            <select
                              value=""
                              disabled={!!busy}
                              aria-label={`Move ${card.title || 'this quote'} to another stage`}
                              onChange={(e) => {
                                if (e.target.value) void move(card, e.target.value);
                              }}
                              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-200"
                            >
                              <option value="">Choose…</option>
                              {targets.map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function Figure({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white break-words">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{caption}</p>
    </div>
  );
}
