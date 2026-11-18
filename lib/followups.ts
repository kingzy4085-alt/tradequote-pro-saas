// Follow-ups and win tracking for sent quotes. No table of its own: "followed up" is a dated
// line at the top of the quote's notes, and everything else is worked out from the card.
import { stageOf, type PipelineCard, type PipelineKind } from './pipeline';

/** A sent quote is due a follow-up after this many days, and again this long after each follow-up. */
export const FOLLOW_UP_DAYS = 5;
/** Sent this long with no decision reads as cold. */
export const COLD_DAYS = 14;
/** A quote whose date is this close is worth chasing now. */
export const EXPIRING_DAYS = 3;
export const WIN_RATE_DAYS = 90;

const NOTES_MAX = 10_000; // the notes limit in lib/validation.ts
const NOTE_PREFIX = 'Followed up ';
const NOTE_LINE = /^Followed up (\d{4}-\d{2}-\d{2})\b/;

const toDay = (value: string | null | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : null;
};

/** Whole days from one date (or timestamp) to another; negative when `to` is earlier. Null if either isn't a date. */
export function dayDiff(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = toDay(from);
  const b = toDay(to);
  return a === null || b === null ? null : b - a;
}

/** The date `days` before `today`, as YYYY-MM-DD. */
export function daysAgo(today: string, days: number): string {
  const day = toDay(today);
  return day === null ? today : new Date((day - days) * 86_400_000).toISOString().slice(0, 10);
}

/** The most recent "Followed up" date written in the notes, or null. */
export function lastFollowedUp(notes: string | null | undefined): string | null {
  let latest: string | null = null;
  for (const line of (notes ?? '').split(/\r?\n/)) {
    const date = NOTE_LINE.exec(line.trim())?.[1];
    if (date && toDay(date) !== null && (!latest || date > latest)) latest = date;
  }
  return latest;
}

/** The notes with today's follow-up as the first line. What was there is kept below it. */
export function withFollowUpNote(notes: string | null | undefined, today: string): string {
  const rest = (notes ?? '').trim();
  return (rest ? `${NOTE_PREFIX}${today}\n${rest}` : `${NOTE_PREFIX}${today}`).slice(0, NOTES_MAX);
}

export interface FollowUp {
  card: PipelineCard;
  /** Days since the quote last changed, which for a sent quote is how long the client has had it. */
  daysWaiting: number;
  lastFollowedUp: string | null;
}

/** Sent quotes nobody has touched or chased in FOLLOW_UP_DAYS, longest wait first. */
export function followUpsDue(cards: readonly PipelineCard[], today: string): FollowUp[] {
  const due: FollowUp[] = [];
  for (const card of cards) {
    if (stageOf(card) !== 'sent') continue;
    const daysWaiting = dayDiff(card.updated_at, today);
    if (daysWaiting === null || daysWaiting < FOLLOW_UP_DAYS) continue;
    const last = lastFollowedUp(card.notes);
    const sinceLast = dayDiff(last, today);
    if (sinceLast !== null && sinceLast < FOLLOW_UP_DAYS) continue;
    due.push({ card, daysWaiting, lastFollowedUp: last });
  }
  return due.sort((a, b) => b.daysWaiting - a.daysWaiting || a.card.title.localeCompare(b.card.title));
}

export type HealthLabel = 'Hot' | 'Warm' | 'Cold';
export interface QuoteHealth {
  label: HealthLabel;
  /** Why, in a sentence. Shown as the tooltip and as text on the card. */
  reason: string;
}

const ago = (days: number) => (days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`);

export const HEALTH_LEGEND = `Hot: sent in the last ${FOLLOW_UP_DAYS - 1} days, or its date is within ${EXPIRING_DAYS} days. Warm: waiting ${FOLLOW_UP_DAYS} to ${COLD_DAYS - 1} days. Cold: waiting ${COLD_DAYS} days or more, or past its date.`;

/** How likely a sent quote still is to close, from how long it has waited and how close its date is. Null for a quote that isn't out with a client. */
export function quoteHealth(card: PipelineCard, today: string): QuoteHealth | null {
  if (stageOf(card) !== 'sent') return null;
  const waiting = Math.max(0, dayDiff(card.updated_at, today) ?? 0);
  const left = dayDiff(today, card.date);
  const sent = `Sent ${ago(waiting)}`;
  const dateName = card.kind === 'estimates' ? 'bid date' : 'price expiry';
  if (left !== null && left < 0) return { label: 'Cold', reason: `${sent}, and the ${dateName} has passed.` };
  if (waiting >= COLD_DAYS) return { label: 'Cold', reason: `${sent} with no decision.` };
  if (left !== null && left <= EXPIRING_DAYS) return { label: 'Hot', reason: `${sent}. The ${dateName} is ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`}.` };
  if (waiting < FOLLOW_UP_DAYS) return { label: 'Hot', reason: `${sent}.` };
  return { label: 'Warm', reason: `${sent}. Worth a follow-up.` };
}

const EMAIL = /^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/;
const KIND_NOUN: Record<PipelineKind, string> = { estimates: 'estimate', proposals: 'proposal' };

/** A mailto: link with a short, polite follow-up already written. Null when the address isn't one. */
export function followUpMailto(card: Pick<PipelineCard, 'kind' | 'title'>, email: string | null | undefined, companyName: string): string | null {
  const to = (email ?? '').trim();
  if (!EMAIL.test(to)) return null;
  const name = card.title.trim() || `our ${KIND_NOUN[card.kind]}`;
  const subject = `Following up: ${name}`;
  const body = [
    'Hello,',
    '',
    `I am following up on the ${KIND_NOUN[card.kind]} "${name}" we sent you. Do you have any questions, or is there anything you would like us to change?`,
    '',
    'Thank you,',
    companyName.trim(),
  ].join('\r\n');
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface WinRate {
  /** Whole percent, or null when nothing was decided. */
  rate: number | null;
  won: number;
  decided: number;
}

/** Won over decided, for quotes decided on or after `since` (YYYY-MM-DD). */
export function winRateSince(rows: readonly Pick<PipelineCard, 'kind' | 'status' | 'updated_at'>[], since: string): WinRate {
  let won = 0;
  let decided = 0;
  for (const row of rows) {
    const stage = stageOf(row);
    if (stage !== 'won' && stage !== 'lost') continue;
    const age = dayDiff(since, row.updated_at);
    if (age === null || age < 0) continue;
    decided += 1;
    if (stage === 'won') won += 1;
  }
  return { rate: decided ? Math.round((won / decided) * 100) : null, won, decided };
}
