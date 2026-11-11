import { NextResponse } from 'next/server';
import { requireApi } from '@/lib/api';
import { SEARCH_PER_MODULE, cleanQuery, searchFilter, searchTargets, toHit, type SearchGroup } from '@/lib/search';

export const dynamic = 'force-dynamic';

/**
 * One search across every module the caller's role can read. Each query runs as the
 * signed-in user, so row security decides what comes back (their company, their own rows).
 */
export async function GET(request: Request) {
  const ctx = await requireApi({ minRank: 1 });
  if (ctx instanceof Response) return ctx;

  const q = cleanQuery(new URL(request.url).searchParams.get('q'));
  if (!q) return NextResponse.json({ groups: [] });

  const targets = searchTargets(ctx.role);
  const results = await Promise.all(
    targets.map(async (target): Promise<SearchGroup | null> => {
      const { data, error } = await ctx.supabase
        .from(target.mod.table)
        .select(['id', 'status', ...target.columns].join(', '))
        .or(searchFilter(target.columns, q))
        .order('updated_at', { ascending: false })
        .limit(SEARCH_PER_MODULE);
      if (error) {
        // One module failing shouldn't blank the rest of the results
        console.error(`Search failed in ${target.mod.slug}`, error);
        return null;
      }
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      if (!rows.length) return null;
      return { slug: target.mod.slug, label: target.mod.label, hits: rows.map((row) => toHit(target, row, q)) };
    })
  );

  return NextResponse.json({ groups: results.filter((g): g is SearchGroup => g !== null) });
}
