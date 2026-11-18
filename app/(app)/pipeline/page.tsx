import { notFound, redirect } from 'next/navigation';
import { Alert, ButtonLink, PageHeader } from '@/components/ui';
import { companyToday } from '@/lib/alerts';
import { getPageContext, type AppContext } from '@/lib/context';
import { FOLLOW_UP_DAYS, daysAgo, followUpsDue } from '@/lib/followups';
import { getModule } from '@/lib/modules';
import { PIPELINE_STAGES, toCard, type PipelineCard, type PipelineKind } from '@/lib/pipeline';
import { hasRank } from '@/lib/roles';
import PipelineBoard from './pipeline-board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quote Pipeline · TradeQuote PRO' };

// The newest of each. Past this the board says so and points at the full lists.
const PER_KIND = 150;
// Sent quotes old enough to chase are loaded on top of that, so the follow-up list doesn't miss the ones that matter most.
const WAITING_PER_KIND = 100;

const COLUMNS: Record<PipelineKind, string> = {
  estimates: 'id, title, status, client_name, client_id, notes, total_amount, bid_due, updated_at',
  proposals: 'id, title, status, client_name, client_id, notes, total_amount, valid_until, updated_at',
};

const SENT = PIPELINE_STAGES.find((s) => s.key === 'sent')!;

/** As the signed-in user: row security decides which quotes come back. */
async function loadKind(ctx: AppContext, kind: PipelineKind, today: string): Promise<{ cards: PipelineCard[]; more: boolean } | null> {
  const table = getModule(kind)!.table;
  const [recent, waiting] = await Promise.all([
    ctx.supabase.from(table).select(COLUMNS[kind]).order('updated_at', { ascending: false }).limit(PER_KIND + 1),
    ctx.supabase
      .from(table)
      .select(COLUMNS[kind])
      .eq('status', SENT.accepts[kind]!)
      .lt('updated_at', daysAgo(today, FOLLOW_UP_DAYS - 1))
      .order('updated_at', { ascending: true })
      .limit(WAITING_PER_KIND),
  ]);
  if (recent.error || waiting.error) {
    console.error(`Could not load ${kind} for the pipeline`, recent.error ?? waiting.error);
    return null;
  }
  const rows = (recent.data ?? []) as unknown as Record<string, unknown>[];
  const cards = rows.slice(0, PER_KIND).map((row) => toCard(kind, row));
  const seen = new Set(cards.map((c) => c.id));
  for (const row of (waiting.data ?? []) as unknown as Record<string, unknown>[]) {
    if (!seen.has(String(row.id))) cards.push(toCard(kind, row));
  }
  return { cards, more: rows.length > PER_KIND };
}

/** Client emails for the quotes due a follow-up, by client id. Without them the list still works, minus the email link. */
async function loadEmails(ctx: AppContext, cards: PipelineCard[], today: string): Promise<Record<string, string>> {
  const crm = getModule('crm')!;
  const ids = [...new Set(followUpsDue(cards, today).map((f) => f.card.client_id).filter((id): id is string => !!id))];
  if (!ids.length || !hasRank(ctx.role, crm.read)) return {};
  const { data, error } = await ctx.supabase.from(crm.table).select('id, email').in('id', ids);
  if (error) {
    console.error('Could not load client emails for follow-ups', error);
    return {};
  }
  const emails: Record<string, string> = {};
  for (const row of (data ?? []) as { id: string; email: string | null }[]) if (row.email) emails[row.id] = row.email;
  return emails;
}

export default async function PipelinePage() {
  const result = await getPageContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;

  const estimates = getModule('estimates')!;
  const proposals = getModule('proposals')!;
  if (!hasRank(ctx.role, estimates.read) || !hasRank(ctx.role, proposals.read)) notFound();

  // The company's date, not the server's
  const today = companyToday(ctx.company.province);
  const [est, prop] = await Promise.all([loadKind(ctx, 'estimates', today), loadKind(ctx, 'proposals', today)]);
  const cards = [...(est?.cards ?? []), ...(prop?.cards ?? [])];
  const emails = await loadEmails(ctx, cards, today);
  const canMove = { estimates: ctx.canWrite && hasRank(ctx.role, estimates.write), proposals: ctx.canWrite && hasRank(ctx.role, proposals.write) };

  return (
    <>
      <PageHeader
        title="Quote Pipeline"
        subtitle="Every estimate and proposal by stage. Drag a card to move it, or use Move on the card."
        actions={canMove.estimates ? <ButtonLink href="/estimates?new=1">+ New Estimate</ButtonLink> : undefined}
      />
      {(!est || !prop) && (
        <div className="mb-6">
          <Alert>{!est && !prop ? 'The pipeline could not be loaded.' : `${!est ? 'Estimates' : 'Proposals'} could not be loaded, so the board is missing them.`} Reload the page to try again.</Alert>
        </div>
      )}
      {(est?.more || prop?.more) && (
        <div className="mb-6">
          <Alert tone="info">
            Showing the {PER_KIND} most recently changed {est?.more && prop?.more ? 'estimates and proposals' : est?.more ? 'estimates' : 'proposals'}, plus sent quotes still waiting on a client. Older ones are on their own lists.
          </Alert>
        </div>
      )}
      <PipelineBoard initial={cards} canMove={canMove} today={today} emails={emails} companyName={ctx.company.name} />
    </>
  );
}
