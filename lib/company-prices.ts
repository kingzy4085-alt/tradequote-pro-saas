import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyPrice } from '@/lib/costbook';
import { PRICE_BOOK_COLUMNS, PRICE_BOOK_LIST_LIMIT, toCompanyPrice } from '@/lib/price-book';

/**
 * The company's own saved prices and labour hours (material_price_book), read as the signed-in user
 * so row level security decides what is visible. Uses the same columns and row shape as the price
 * book page, so an AI draft or assistant answer prices a line the way the company set it up.
 * Any failure means "no company prices": pricing falls back to the reference catalog rather than
 * failing the request.
 */
export async function loadCompanyPrices(supabase: SupabaseClient, companyId: string): Promise<CompanyPrice[]> {
  try {
    const { data, error } = await supabase
      .from('material_price_book')
      .select(PRICE_BOOK_COLUMNS)
      .eq('company_id', companyId)
      .limit(PRICE_BOOK_LIST_LIMIT);
    if (error || !Array.isArray(data)) {
      if (error) console.error('Company price book could not be read', error);
      return [];
    }
    const prices: CompanyPrice[] = [];
    for (const row of data as Record<string, unknown>[]) {
      if (typeof row.item_code !== 'string' || !row.item_code) continue;
      const price = toCompanyPrice({
        item_code: row.item_code,
        unit_cost: typeof row.unit_cost === 'number' || typeof row.unit_cost === 'string' ? row.unit_cost : Number.NaN,
        labour_hours: typeof row.labour_hours === 'number' || typeof row.labour_hours === 'string' ? row.labour_hours : null,
        description: typeof row.description === 'string' ? row.description : null,
        unit: typeof row.unit === 'string' ? row.unit : null,
      });
      // A row with no usable price is skipped, never priced at zero
      if (!Number.isFinite(price.unitCost) || price.unitCost < 0) continue;
      if (price.labourHours !== null && price.labourHours !== undefined && price.labourHours < 0) price.labourHours = null;
      prices.push(price);
    }
    return prices;
  } catch (err) {
    console.error('Company price book could not be read', err);
    return [];
  }
}
