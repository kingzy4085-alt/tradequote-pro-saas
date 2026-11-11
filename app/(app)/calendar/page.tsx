import { redirect } from 'next/navigation';
import { Alert, PageHeader } from '@/components/ui';
import { companyToday } from '@/lib/alerts';
import { parseCalendarParams, toItems, viewRange, visibleSources, type CalendarItem, type CalendarSource } from '@/lib/calendar';
import { getPageContext, type AppContext } from '@/lib/context';
import { getModule, type ModuleDef } from '@/lib/modules';
import CalendarView from './calendar-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calendar · TradeQuote PRO' };

// Most records one module puts on a single view. Past this the page says so.
const PER_MODULE = 500;

/**
 * One module's records that touch the range, as the signed-in user: row security decides
 * which rows come back. A crew booking counts if any of its days fall in the range.
 */
async function loadModule(ctx: AppContext, mod: ModuleDef, sources: CalendarSource[], from: string, to: string): Promise<{ rows: Record<string, unknown>[]; more: boolean } | null> {
  const columns = [...new Set(['id', 'title', 'status', ...sources.flatMap((source) => (source.end ? [source.start, source.end] : [source.start]))])];
  let query = ctx.supabase.from(mod.table).select(columns.join(', '));
  const span = sources.find((source) => source.end);
  if (span?.end) {
    query = query.lte(span.start, to).or(`${span.end}.gte.${from},and(${span.end}.is.null,${span.start}.gte.${from})`);
  } else if (sources.length === 1) {
    query = query.gte(sources[0].start, from).lte(sources[0].start, to);
  } else {
    query = query.or(sources.map((source) => `and(${source.start}.gte.${from},${source.start}.lte.${to})`).join(','));
  }
  const { data, error } = await query.order(sources[0].start, { ascending: true }).limit(PER_MODULE + 1);
  if (error) {
    console.error(`Could not load ${mod.slug} for the calendar`, error);
    return null;
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return { rows: rows.slice(0, PER_MODULE), more: rows.length > PER_MODULE };
}

export default async function CalendarPage({ searchParams }: { searchParams: { view?: string | string[]; date?: string | string[] } }) {
  const result = await getPageContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;

  const today = companyToday(ctx.company.province);
  const { view, date } = parseCalendarParams(searchParams, today);
  // The month grid always contains the selected day's week, which is what phones list.
  const { from, to } = viewRange(view, date);

  const sources = visibleSources(ctx.role);
  const slugs = [...new Set(sources.map((source) => source.module))];
  const loaded = await Promise.all(
    slugs.map(async (slug) => {
      const mod = getModule(slug)!;
      const mine = sources.filter((source) => source.module === slug);
      return { mod, mine, result: await loadModule(ctx, mod, mine, from, to) };
    }),
  );

  const items: CalendarItem[] = loaded.flatMap(({ mine, result: r }) => (r ? mine.flatMap((source) => toItems(source, r.rows)) : []));
  const failed = loaded.filter((l) => !l.result).map((l) => l.mod.label);
  const cut = loaded.filter((l) => l.result?.more).map((l) => l.mod.label);

  return (
    <>
      <PageHeader title="Calendar" subtitle="Crew bookings, project dates and everything coming due, in one place. Pick an item to open it." />
      {failed.length > 0 && (
        <div className="mb-6">
          <Alert>{failed.join(', ')} could not be loaded, so the calendar is missing them. Reload the page to try again.</Alert>
        </div>
      )}
      {cut.length > 0 && (
        <div className="mb-6">
          <Alert tone="info">
            Showing the first {PER_MODULE} records for {cut.join(', ')} in this range. The rest are on their own lists.
          </Alert>
        </div>
      )}
      <CalendarView view={view} date={date} today={today} sources={sources} items={items} />
    </>
  );
}
