import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { getItem } from '@/lib/costbook';
import { getModule } from '@/lib/modules';
import { PRICE_BOOK_COLUMNS, PRICE_BOOK_LIST_LIMIT, parsePriceBookBody, toCompanyPrice } from '@/lib/price-book';

export const dynamic = 'force-dynamic';

// A company's own prices feed estimates, so whoever may read or write estimates may read or write these
const estimates = getModule('estimates')!;

type SavedRow = { item_code: string; unit_cost: number; labour_hours: number | null; description: string | null; unit: string | null; category: string | null };

export async function GET() {
  const ctx = await requireApi({ minRank: estimates.read });
  if (ctx instanceof Response) return ctx;
  const { data, error } = await ctx.supabase.from('material_price_book').select(PRICE_BOOK_COLUMNS).eq('company_id', ctx.company.id).order('item_code').limit(PRICE_BOOK_LIST_LIMIT);
  if (error) return dbError(error, 'loading your price book');
  return NextResponse.json({ data: (data ?? []).map((row) => toCompanyPrice(row as unknown as SavedRow)) });
}

export async function PUT(request: Request) {
  const ctx = await requireApi({ minRank: estimates.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    return jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON');
  }
  const parsed = parsePriceBookBody(body);
  if (!parsed.ok) return jsonError(400, parsed.error);

  // A price sent without a description or unit keeps what the company already had, then the catalog's wording
  const { data: existing, error: readError } = await ctx.supabase.from('material_price_book').select(PRICE_BOOK_COLUMNS).eq('company_id', ctx.company.id).limit(PRICE_BOOK_LIST_LIMIT);
  if (readError) return dbError(readError, 'saving your prices');
  const saved = new Map((existing ?? []).map((r) => [(r as unknown as SavedRow).item_code, r as unknown as SavedRow]));

  const rows = parsed.items.map((p) => {
    const was = saved.get(p.itemCode);
    const item = getItem(p.itemCode);
    return {
      item_code: p.itemCode,
      category: was?.category || item?.category || '',
      description: p.description || was?.description || item?.description || p.itemCode,
      unit: p.unit || was?.unit || item?.unit || 'ea',
      unit_cost: p.unitCost,
      // company_id comes from a database default tied to the session, never from the client
      labour_hours: p.labourHours === undefined ? (was?.labour_hours ?? null) : p.labourHours,
    };
  });
  const { error } = await ctx.supabase.from('material_price_book').upsert(rows, { onConflict: 'company_id,item_code' });
  if (error) return dbError(error, 'saving your prices');
  return NextResponse.json({ data: { saved: rows.length } });
}

export async function DELETE(request: Request) {
  const ctx = await requireApi({ minRank: estimates.write, write: true });
  if (ctx instanceof Response) return ctx;
  const code = new URL(request.url).searchParams.get('code')?.trim();
  if (!code || code.length > 60) return jsonError(400, 'Say which item code to remove');
  const { error } = await ctx.supabase.from('material_price_book').delete().eq('company_id', ctx.company.id).eq('item_code', code);
  if (error) return dbError(error, 'removing the price');
  return NextResponse.json({ data: { deleted: code } });
}
