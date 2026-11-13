import { supabase } from '@/lib/supabase';
import { amount, fail, isDate, isUuid, ok, text } from '@/lib/api-helpers';
import { invoiceTotals, type InvoiceLine } from '@/lib/billing-math';
import { estimateTotals } from '@/lib/estimate-math';

const STATUSES = ['Draft', 'Sent', 'Paid'];
const notFound = () => fail('Invoice not found.', 404);
const round = (v: number) => Math.round(v * 100) / 100;

// Pre-tax contract value of an estimate (material + labour + markup)
async function estimateValue(id: number) {
  const [est, items] = await Promise.all([
    supabase!.from('estimates').select('id, "projectName", "labourRate", "markupPercentage"').eq('id', id).maybeSingle(),
    supabase!.from('estimate_items').select('*').eq('estimate_id', id),
  ]);
  if (!est.data) return null;
  return { estimate: est.data, value: estimateTotals(items.data || [], est.data.labourRate, est.data.markupPercentage, 0).beforeTax };
}

// Percent of each estimate already billed on invoices other than this one
async function billedPercents(exceptId: string) {
  const { data } = await supabase!.from('invoices').select('id, lines').neq('id', exceptId);
  const out: Record<string, number> = {};
  for (const inv of data || []) for (const l of (inv.lines as InvoiceLine[]) || []) {
    if (l.estimate_id != null) out[String(l.estimate_id)] = (out[String(l.estimate_id)] || 0) + Number(l.percent || 0);
  }
  return out;
}

// Invoice plus what can still be billed: approved, un-invoiced change orders and estimates with their billed-to-date %
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return fail('Database unavailable.', 503);
  if (!isUuid(id)) return notFound();
  const { data, error } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return notFound();
  const [cos, ests, billed] = await Promise.all([
    supabase.from('change-orders').select('id, co_number, project, scope, price, invoice_id').eq('status', 'Approved').or(`invoice_id.is.null,invoice_id.eq.${id}`).order('co_number'),
    supabase.from('estimates').select('id, "projectName", "clientName", status, total_bid').order('id', { ascending: false }).limit(200),
    billedPercents(id),
  ]);
  return ok({ ...data, available_change_orders: cos.data || [], estimates: ests.data || [], billed_percent: billed });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return fail('Database unavailable.', 503);
  if (!isUuid(id)) return notFound();
  const body = await request.json().catch(() => ({}));
  const cur = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();
  if (cur.error) return fail(cur.error.message);
  if (!cur.data) return notFound();
  const inv = cur.data;
  const row: Record<string, unknown> = {};

  if ('status' in body) {
    if (!STATUSES.includes(body.status)) return fail('Status must be Draft, Sent or Paid.', 400);
    row.status = body.status;
    row.paid_at = body.status === 'Paid' ? inv.paid_at || new Date().toISOString() : null;
  }

  const editing = ['project', 'client_name', 'client_address', 'issue_date', 'due_date', 'tax_pct', 'holdback_pct', 'notes', 'lines'].some((f) => f in body);
  if (editing && inv.status !== 'Draft') return fail('Only draft invoices can be edited. Set it back to Draft first.', 409);

  for (const f of ['project', 'client_name', 'client_address', 'notes']) if (f in body) row[f] = text(body[f]);
  if ('project' in row) row.name = row.project;
  for (const f of ['issue_date', 'due_date']) {
    if (!(f in body)) continue;
    if (body[f] && !isDate(body[f])) return fail('Dates must be YYYY-MM-DD.', 400);
    row[f] = body[f] || null;
  }
  for (const f of ['tax_pct', 'holdback_pct']) {
    if (!(f in body)) continue;
    const v = amount(body[f]);
    if (v === null || v > 100) return fail('Percentages must be between 0 and 100.', 400);
    row[f] = v;
  }

  let coIds: string[] | null = null;
  if ('lines' in body) {
    if (!Array.isArray(body.lines) || body.lines.length > 200) return fail('Invalid invoice lines.', 400);
    const billed = await billedPercents(id);
    const lines: InvoiceLine[] = [];
    coIds = [];
    for (const [i, l] of (body.lines as InvoiceLine[]).entries()) {
      if (l.change_order_id) {
        // Change order lines are billed at the approved price
        if (!isUuid(String(l.change_order_id))) return fail(`Line ${i + 1}: unknown change order.`, 400);
        const co = await supabase.from('change-orders').select('id, co_number, scope, project, price, status, invoice_id').eq('id', l.change_order_id).maybeSingle();
        if (!co.data || co.data.status !== 'Approved') return fail(`Line ${i + 1}: change order is not approved.`, 400);
        if (co.data.invoice_id && co.data.invoice_id !== id) return fail(`Line ${i + 1}: CO #${co.data.co_number} is already on another invoice.`, 409);
        coIds.push(co.data.id);
        lines.push({ description: text(l.description, 500) || `Change order #${co.data.co_number}`, amount: Number(co.data.price), change_order_id: co.data.id });
      } else if (l.estimate_id != null && l.estimate_id !== '') {
        // Progress lines bill a percent of the estimate's pre-tax value, never past 100% overall
        const pct = amount(l.percent);
        if (pct === null || pct <= 0) return fail(`Line ${i + 1}: enter the percent complete to bill.`, 400);
        if (!/^\d+$/.test(String(l.estimate_id))) return fail(`Line ${i + 1}: unknown estimate.`, 400);
        const e = await estimateValue(Number(l.estimate_id));
        if (!e) return fail(`Line ${i + 1}: unknown estimate.`, 400);
        const already = billed[String(l.estimate_id)] || 0;
        if (already + pct > 100.0001) return fail(`Line ${i + 1}: ${already}% of that estimate is already billed; at most ${round(100 - already)}% is left.`, 400);
        billed[String(l.estimate_id)] = already + pct;
        lines.push({
          description: text(l.description, 500) || `Progress billing ${pct}% of Estimate #${e.estimate.id} (${e.estimate.projectName})`,
          amount: round((e.value * pct) / 100),
          estimate_id: e.estimate.id,
          percent: pct,
        });
      } else {
        const a = Number(l.amount);
        if (!Number.isFinite(a)) return fail(`Line ${i + 1}: amount must be a number.`, 400);
        if (!String(l.description || '').trim()) return fail(`Line ${i + 1}: add a description.`, 400);
        lines.push({ description: text(l.description, 500)!, amount: round(a) });
      }
    }
    row.lines = lines;
  }

  const merged = { ...inv, ...row };
  Object.assign(row, invoiceTotals(merged.lines || [], merged.tax_pct, merged.holdback_pct));

  const { data, error } = await supabase.from('invoices').update(row).eq('id', id).select().maybeSingle();
  if (error) return fail(error.message);

  if (coIds) {
    // Link billed change orders to this invoice and release any that were removed from it
    const rel = supabase.from('change-orders').update({ invoice_id: null }).eq('invoice_id', id);
    const released = coIds.length ? await rel.not('id', 'in', `(${coIds.join(',')})`) : await rel;
    if (released.error) return fail(released.error.message);
    if (coIds.length) {
      const linked = await supabase.from('change-orders').update({ invoice_id: id }).in('id', coIds);
      if (linked.error) return fail(linked.error.message);
    }
  }
  return ok(data);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return fail('Database unavailable.', 503);
  if (!isUuid(id)) return notFound();
  const cur = await supabase.from('invoices').select('status').eq('id', id).maybeSingle();
  if (!cur.data) return notFound();
  if (cur.data.status !== 'Draft') return fail('Only draft invoices can be deleted.', 409);
  await supabase.from('change-orders').update({ invoice_id: null }).eq('invoice_id', id);
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) return fail(error.message);
  return ok(null);
}
