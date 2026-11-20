import { notFound } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { PRICE_BOOK_COLUMNS, PRICE_BOOK_LIST_LIMIT, toCompanyPrice } from '@/lib/price-book';
import { hasRank } from '@/lib/roles';
import PriceBookManager from './price-book-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Price Book · TradeQuote PRO' };

export default async function PriceBookPage() {
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  // Your own prices feed estimates, so they follow the estimate roles
  const mod = getModule('estimates')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const { data, error } = await ctx.supabase.from('material_price_book').select(PRICE_BOOK_COLUMNS).eq('company_id', ctx.company.id).order('item_code').limit(PRICE_BOOK_LIST_LIMIT);
  if (error) throw new Error('Could not load your price book. Try again in a moment.');

  return (
    <PriceBookManager
      initial={(data ?? []).map((row) => toCompanyPrice(row as unknown as Parameters<typeof toCompanyPrice>[0]))}
      canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)}
      province={ctx.company.province}
    />
  );
}
