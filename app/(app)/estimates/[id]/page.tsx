import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import EstimateEditor from './estimate-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Estimate · TradeQuote PRO' };

export default async function EstimatePage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const mod = getModule('estimates')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const [{ data: estimate }, { data: items }] = await Promise.all([
    ctx.supabase.from('estimates').select('*').eq('id', params.id).maybeSingle(),
    ctx.supabase
      .from('estimate_items')
      .select('description, quantity, unit, material_unit_cost, labour_hours_per_unit')
      .eq('estimate_id', params.id)
      .order('sort'),
  ]);
  if (!estimate) notFound();

  return (
    <EstimateEditor
      estimate={estimate}
      initialItems={items ?? []}
      statuses={mod.statuses}
      canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)}
    />
  );
}
