import { notFound } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { PAYMENT_COLUMNS, type InvoicePayment } from '@/lib/payments';
import { hasRank } from '@/lib/roles';
import { companyDate } from '@/lib/timecards';
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

  const [{ data: invoice, error }, { data: projects }, { data: clients }, payments] = await Promise.all([
    ctx.supabase.from(mod.table).select('*').eq('id', params.id).maybeSingle(),
    ctx.supabase.from('projects').select('id, title, client_id, client_name').order('title'),
    ctx.supabase.from('crm').select('id, title').order('title'),
    ctx.supabase.from('invoice_payments').select(PAYMENT_COLUMNS).eq('invoice_id', params.id).order('paid_on').order('created_at').order('id'),
  ]);
  if (error) throw new Error('Could not load this invoice.');
  if (!invoice) notFound();
  // The invoice still opens without them: the payments panel says they could not be loaded
  if (payments.error) console.error('Could not load the payments on an invoice', payments.error);

  return (
    <InvoiceEditor
      initial={invoice as Invoice}
      initialOptions={await loadInvoiceOptions(ctx, params.id, invoice.project_id)}
      initialPayments={payments.error ? null : ((payments.data ?? []) as InvoicePayment[])}
      today={companyDate(ctx.company.province)}
      projects={projects ?? []}
      clients={clients ?? []}
      canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)}
      canDelete={ctx.canWrite && hasRank(ctx.role, mod.remove)}
    />
  );
}
