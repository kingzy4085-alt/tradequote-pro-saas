import type { AppContext } from '@/lib/context';
import { withChangeOrderMoney, withProjectMoney } from '@/lib/project-money';

export interface InvoiceOptions {
  project: { id: string; title: string; contract_value: number | string | null; revised_contract: number | string | null } | null;
  /** Percent of the contract on this project's other live invoices. */
  billed_percent: number;
  /** Before tax, on this project's other invoices that have gone out: the same count as job costing and the contract check. */
  billed_amount: number;
  /** The dollars and number of percent lines behind billed_percent. The last slice of a contract can't round past them. */
  billed_percent_amount: number;
  billed_percent_lines: number;
  change_orders: { id: string; co_number: string | null; title: string; price?: number | string | null; tax_pct: number | string | null }[];
  draws: { id: string; title: string; billing_period: string | null; amount_billed: number | string | null }[];
}

export const NO_OPTIONS: InvoiceOptions = { project: null, billed_percent: 0, billed_amount: 0, billed_percent_amount: 0, billed_percent_lines: 0, change_orders: [], draws: [] };

const BILLED_STATUSES = ['Sent', 'Overdue', 'Paid'];

/** What can go on this invoice for this project: approved change orders and draws nobody has billed, and how much of the contract is left. */
export async function loadInvoiceOptions(ctx: Pick<AppContext, 'supabase' | 'role'>, invoiceId: string, projectId: string | null): Promise<InvoiceOptions> {
  if (!projectId) return NO_OPTIONS;

  const [project, others, changeOrders, draws] = await Promise.all([
    ctx.supabase.from('projects').select('id, title').eq('id', projectId).maybeSingle(),
    ctx.supabase.from('invoices').select('id, status, amount, lines').eq('project_id', projectId).neq('status', 'Void').neq('id', invoiceId),
    ctx.supabase.from('change_orders').select('id, co_number, title, tax_pct').eq('project_id', projectId).eq('status', 'Approved').is('invoice_id', null).eq('billed_in_old_app', false).order('created_at'),
    ctx.supabase.from('progress_billing').select('id, title, billing_period, amount_billed').eq('project_id', projectId).eq('status', 'Draft').is('invoice_id', null).order('created_at'),
  ]);
  const failure = project.error ?? others.error ?? changeOrders.error ?? draws.error;
  if (failure) throw new Error(`Could not load invoice options: ${failure.message}`);

  const withMoney = await withProjectMoney(ctx.supabase, ctx.role, project.data ? [project.data] : []);
  if ('error' in withMoney) throw new Error(`Could not load invoice options: ${withMoney.error.message}`);
  const coMoney = await withChangeOrderMoney(ctx.supabase, ctx.role, (changeOrders.data ?? []) as InvoiceOptions['change_orders']);
  if ('error' in coMoney) throw new Error(`Could not load invoice options: ${coMoney.error.message}`);

  let billedPercent = 0;
  let billedAmount = 0;
  let billedPercentAmount = 0;
  let billedPercentLines = 0;
  let billedContract = 0;
  for (const row of (others.data ?? []) as { status: string; amount: number | string | null; lines: { type?: string; description?: string; percent?: number | string; amount?: number | string }[] | null }[]) {
    const out = BILLED_STATUSES.includes(row.status);
    if (out) billedAmount += Number(row.amount) || 0;
    for (const line of row.lines ?? []) {
      // The same lines guard_invoice_send holds a change order to
      if (out && (line.type !== 'free' || line.description?.trim().toLowerCase() === 'balance of contract')) billedContract += Number(line.amount) || 0;
      if (line.type !== 'percent') continue;
      billedPercent += Number(line.percent) || 0;
      billedPercentAmount += Number(line.amount) || 0;
      billedPercentLines += 1;
    }
  }
  // A change order a Balance of contract invoice already covered has no invoice of its own, and sending it again would be refused
  const room = Number((withMoney.rows[0] as InvoiceOptions['project'])?.revised_contract ?? 0) - billedContract;
  const billable = coMoney.rows.filter((c) => Number(c.price) !== 0 && Number(c.price) <= room + 0.005);
  return {
    project: (withMoney.rows[0] as InvoiceOptions['project']) ?? null,
    billed_percent: Number(billedPercent.toFixed(4)),
    billed_amount: Number(billedAmount.toFixed(2)),
    billed_percent_amount: Number(billedPercentAmount.toFixed(2)),
    billed_percent_lines: billedPercentLines,
    change_orders: billable,
    draws: draws.data ?? [],
  };
}
