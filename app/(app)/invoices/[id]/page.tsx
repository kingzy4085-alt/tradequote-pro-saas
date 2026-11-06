import { notFound } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import InvoiceEditor, { type Invoice } from './invoice-editor';
import { loadInvoiceOptions } from './options';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoice · TradeQuote PRO' };

export default async function InvoicePage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const mod = getModule('invoices')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const [{ data: invoice, error }, { data: projects }, { data: clients }] = await Promise.all([
    ctx.supabase.from(mod.table).select('*').eq('id', params.id).maybeSingle(),
    ctx.supabase.from('projects').select('id, title, client_id, client_name').order('title'),
    ctx.supabase.from('crm').select('id, title').order('title'),
  ]);
  if (error) throw new Error('Could not load this invoice.');
  if (!invoice) notFound();

  return (
    <InvoiceEditor
      initial={invoice as Invoice}
      initialOptions={await loadInvoiceOptions(ctx, params.id, invoice.project_id)}
      projects={projects ?? []}
      clients={clients ?? []}
      canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)}
      canDelete={ctx.canWrite && hasRank(ctx.role, mod.remove)}
    />
  );
}
