import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { getRegion, priceItem, searchCatalog } from '@/lib/costbook';
import { TRADES, type Trade } from '@/lib/costbook/types';
import { getModule } from '@/lib/modules';
import { PRICE_BOOK_COLUMNS, PRICE_BOOK_LIST_LIMIT, toCompanyPrice } from '@/lib/price-book';

export const dynamic = 'force-dynamic';

const estimates = getModule('estimates')!;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Reference catalog items priced for a region, with the company's own price beside each. */
export async function GET(request: Request) {
  const ctx = await requireApi({ minRank: estimates.read });
  if (ctx instanceof Response) return ctx;

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').slice(0, 100);
  const trade = params.get('trade') || undefined;
  if (trade && !TRADES.includes(trade as Trade)) return jsonError(400, `Trade must be one of: ${TRADES.join(', ')}`);
  const asked = Number(params.get('limit'));
  const limit = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), MAX_LIMIT) : DEFAULT_LIMIT;
  // The company's province is the default pricing area; an unknown region falls back to its province
  const region = getRegion(params.get('region') || ctx.company.province);

  const { data, error } = await ctx.supabase.from('material_price_book').select(PRICE_BOOK_COLUMNS).eq('company_id', ctx.company.id).limit(PRICE_BOOK_LIST_LIMIT);
  if (error) return dbError(error, 'loading your price book');
  const own = new Map((data ?? []).map((row) => toCompanyPrice(row as never)).map((p) => [p.itemCode, p]));

  const items = searchCatalog(q, { trade: trade as Trade | undefined, limit }).map((item) => {
    // Reference only: the company's price is returned beside it, not mixed in
    const ref = priceItem(item.code, { region: region.code })!;
    const mine = own.get(item.code) ?? null;
    return {
      code: item.code,
      trade: item.trade,
      category: item.category,
      description: item.description,
      unit: item.unit,
      pack: item.pack ?? null,
      labourClass: item.labourClass,
      confidence: item.confidence,
      source: item.source,
      asOf: item.asOf,
      referenceUnitCost: ref.materialUnitCost,
      referenceLabourHours: ref.labourHoursPerUnit,
      referenceNote: ref.note ?? null,
      company: mine ? { unitCost: mine.unitCost, labourHours: mine.labourHours ?? null } : null,
    };
  });
  return NextResponse.json({ data: items, region: { code: region.code, name: region.name, materialFactor: region.materialFactor } });
}
