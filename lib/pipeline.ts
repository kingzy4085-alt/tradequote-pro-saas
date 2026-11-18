// The quote pipeline board: estimates and proposals as cards in columns by stage.
// The rules for what can be dragged where live here so they can be tested.
import { getModule } from './modules';

export type PipelineKind = 'estimates' | 'proposals';

export interface PipelineCard {
  id: string;
  kind: PipelineKind;
  title: string;
  client: string | null;
  amount: number | null;
  status: string;
  /** Bid due (estimate) or prices valid until (proposal). */
  date: string | null;
  updated_at: string;
  /** Only loaded where follow-ups are worked out: see lib/followups.ts. */
  notes?: string | null;
  client_id?: string | null;
}

export interface PipelineStage {
  key: string;
  label: string;
  hint: string;
  /** The status a card dropped here takes, per kind. A kind that isn't listed can't be dropped here. */
  accepts: Partial<Record<PipelineKind, string>>;
  tone: 'slate' | 'amber' | 'green' | 'red';
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { key: 'draft', label: 'Draft', hint: 'Being priced', accepts: { estimates: 'Draft', proposals: 'Draft' }, tone: 'slate' },
  { key: 'sent', label: 'Sent', hint: 'Waiting on the client', accepts: { estimates: 'Submitted', proposals: 'Sent' }, tone: 'amber' },
  { key: 'won', label: 'Won', hint: 'Accepted', accepts: { estimates: 'Won', proposals: 'Accepted' }, tone: 'green' },
  { key: 'lost', label: 'Lost', hint: 'Declined', accepts: { estimates: 'Lost', proposals: 'Declined' }, tone: 'red' },
];

/** The column a card sits in, or null if its status isn't one the board knows. */
export function stageOf(card: Pick<PipelineCard, 'kind' | 'status'>): string | null {
  return PIPELINE_STAGES.find((s) => s.accepts[card.kind] === card.status)?.key ?? null;
}

/** The status a card would take in that column, or null if it can't go there (or is already there). */
export function statusForDrop(card: Pick<PipelineCard, 'kind' | 'status'>, stageKey: string): string | null {
  const target = PIPELINE_STAGES.find((s) => s.key === stageKey)?.accepts[card.kind];
  if (!target || target === card.status) return null;
  const mod = getModule(card.kind);
  // A status only the system sets can't be picked by dragging either
  if (!mod?.statuses.includes(target) || mod.systemStatuses?.includes(target)) return null;
  return target;
}

export interface StageTotals {
  count: number;
  amount: number;
}

export function stageTotals(cards: readonly PipelineCard[]): Record<string, StageTotals> {
  const totals: Record<string, StageTotals> = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, { count: 0, amount: 0 }]));
  for (const card of cards) {
    const key = stageOf(card);
    if (!key) continue;
    totals[key].count += 1;
    totals[key].amount = Math.round((totals[key].amount + (Number(card.amount) || 0)) * 100) / 100;
  }
  return totals;
}

/**
 * Share of decided quotes that were won, as a whole percent. Null until something has been
 * decided: no wins and no losses is "not known yet", not 0%.
 */
export function winRate(cards: readonly PipelineCard[]): number | null {
  const totals = stageTotals(cards);
  const decided = totals.won.count + totals.lost.count;
  return decided ? Math.round((totals.won.count / decided) * 100) : null;
}

export function toCard(kind: PipelineKind, row: Record<string, unknown>): PipelineCard {
  const amount = row.total_amount === null || row.total_amount === undefined ? null : Number(row.total_amount);
  const date = kind === 'estimates' ? row.bid_due : row.valid_until;
  return {
    id: String(row.id),
    kind,
    title: String(row.title ?? ''),
    client: typeof row.client_name === 'string' && row.client_name ? row.client_name : null,
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    status: String(row.status ?? ''),
    date: typeof date === 'string' && date ? date : null,
    updated_at: String(row.updated_at ?? ''),
    ...('notes' in row ? { notes: typeof row.notes === 'string' ? row.notes : null } : {}),
    ...('client_id' in row ? { client_id: typeof row.client_id === 'string' ? row.client_id : null } : {}),
  };
}
