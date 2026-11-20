import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyPrice } from '@/lib/costbook';

/**
 * The company's own saved prices (material_price_book), read as the signed-in user so row level
 * security decides what is visible. Any failure means "no company prices": pricing falls back to
 * the reference catalog rather than failing the request.
 */
export async function loadCompanyPrices(supabase: SupabaseClient, companyId: string): Promise<CompanyPrice[]> {
  try {
    const { data, error } = await supabase
      .from('material_price_book')
      .select('item_code, description, unit, unit_cost')
      .eq('company_id', companyId)
      .limit(2000);
    if (error || !Array.isArray(data)) {
      if (error) console.error('Company price book could not be read', error);
      return [];
    }
    const prices: CompanyPrice[] = [];
    for (const row of data as Record<string, unknown>[]) {
      const unitCost = Number(row.unit_cost);
      if (typeof row.item_code !== 'string' || !row.item_code || !Number.isFinite(unitCost) || unitCost < 0) continue;
      prices.push({
        itemCode: row.item_code,
        unitCost,
        description: typeof row.description === 'string' ? row.description : null,
        unit: typeof row.unit === 'string' ? row.unit : null,
      });
    }
    return prices;
  } catch (err) {
    console.error('Company price book could not be read', err);
    return [];
  }
}
