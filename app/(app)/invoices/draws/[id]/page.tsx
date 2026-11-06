import { notFound } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import DrawEditor, { type Draw } from './draw-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Progress Draw · TradeQuote PRO' };

export default async function DrawPage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const mod = getModule('progress-billing')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const [{ data: draw, error }, { data: projects }] = await Promise.all([
    ctx.supabase.from(mod.table).select('*').eq('id', params.id).maybeSingle(),
    ctx.supabase.from('projects').select('id, title').order('title'),
  ]);
  if (error) throw new Error('Could not load this draw.');
  if (!draw) notFound();

  const invoices = getModule('invoices')!;
  const { data: invoice } =
    draw.invoice_id && hasRank(ctx.role, invoices.read)
      ? await ctx.supabase.from(invoices.table).select('id, invoice_number, status').eq('id', draw.invoice_id).maybeSingle()
      : { data: null };

  return (
    <DrawEditor
      initial={draw as Draw}
      projects={projects ?? []}
      invoice={invoice}
      canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)}
      canInvoice={ctx.canWrite && hasRank(ctx.role, invoices.write)}
      canDelete={ctx.canWrite && hasRank(ctx.role, mod.remove)}
    />
  );
}
