import { createClient } from '@/lib/supabase/client';

export async function getMaterialPriceBook(companyId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('material_price_book')
    .select('*')
    .or(`company_id.eq.${companyId},company_id.is.null`);

  if (error) throw error;
  return data || [];
}

export function calculateRetailPrice(unitCost: number, markupPercentage: number): number {
  return Number((unitCost * (1 + markupPercentage / 100)).toFixed(2));
}