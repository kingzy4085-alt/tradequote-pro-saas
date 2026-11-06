import { notFound } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { recordColumns } from '@/lib/crud';
import { getModule } from '@/lib/modules';
import { PROJECT_MONEY_RANK, withChangeOrderMoney } from '@/lib/project-money';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import ChangeOrderEditor, { type ChangeOrder } from './change-order-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Change Order · TradeQuote PRO' };

export default async function ChangeOrderPage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const mod = getModule('change-orders')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const [{ data: found, error }, { data: projects }] = await Promise.all([
    ctx.supabase.from(mod.table).select(recordColumns(mod)).eq('id', params.id).maybeSingle(),
    ctx.supabase.from('projects').select('id, title').order('title'),
  ]);
  if (error) throw new Error('Could not load this change order.');
  if (!found) notFound();
  const withMoney = await withChangeOrderMoney(ctx.supabase, ctx.role, [found as unknown as ChangeOrder]);
  if ('error' in withMoney) throw new Error('Could not load this change order.');
  const co = withMoney.rows[0];

  // Only those who can open invoices get a link to one
  const invoices = getModule('invoices')!;
  const { data: invoice } =
    co.invoice_id && hasRank(ctx.role, invoices.read)
      ? await ctx.supabase.from(invoices.table).select('id, invoice_number').eq('id', co.invoice_id).maybeSingle()
      : { data: null };

  return (
    <ChangeOrderEditor
      initial={co}
      projects={projects ?? []}
      invoice={invoice}
      canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)}
      canDelete={ctx.canWrite && hasRank(ctx.role, mod.remove)}
      canSeeMoney={hasRank(ctx.role, PROJECT_MONEY_RANK)}
    />
  );
}
