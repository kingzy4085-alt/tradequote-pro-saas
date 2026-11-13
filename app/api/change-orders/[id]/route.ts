import { supabase } from '@/lib/supabase';
import { amount, fail, isSignature, isUuid, ok, text } from '@/lib/api-helpers';
import { changeOrderTotals } from '@/lib/billing-math';

const TEXT = ['project', 'client_name', 'reason', 'scope'];
const NUMBERS = ['material_cost', 'labour_hours', 'labour_rate', 'markup_pct', 'tax_pct'];
const notFound = () => fail('Change order not found.', 404);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return fail('Database unavailable.', 503);
  if (!isUuid(id)) return notFound();
  const { data, error } = await supabase.from('change-orders').select('*').eq('id', id).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return notFound();
  return ok(data);
}

// Edits a Draft/Sent change order, or moves it through Sent → Approved (client signature) / Rejected.
// Approved change orders are locked; reopening is only possible before they are invoiced.
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return fail('Database unavailable.', 503);
  if (!isUuid(id)) return notFound();
  const body = await request.json().catch(() => ({}));
  const cur = await supabase.from('change-orders').select('*').eq('id', id).maybeSingle();
  if (cur.error) return fail(cur.error.message);
  if (!cur.data) return notFound();
  const co = cur.data;
  const locked = co.status === 'Approved' || co.status === 'Rejected';
  const row: Record<string, unknown> = {};

  if (body.action === 'reopen') {
    if (co.invoice_id) return fail('This change order is already on an invoice. Remove it from the invoice first.', 409);
    Object.assign(row, { status: 'Draft', approved_by: null, approval_signature: null, approved_at: null });
  } else {
    if (locked) return fail(`This change order is ${co.status.toLowerCase()}. Reopen it to make changes.`, 409);
    for (const f of TEXT) if (f in body) row[f] = text(body[f]);
    if ('project' in row) row.name = row.project;
    for (const f of NUMBERS) {
      if (!(f in body)) continue;
      const v = amount(body[f]);
      if (v === null) return fail('Amounts and percentages must be numbers of 0 or more.', 400);
      row[f] = v;
    }
    Object.assign(row, changeOrderTotals({ ...co, ...row }));
    delete row.labour;
    delete row.cost;
    delete row.markup;

    if (body.action === 'send') row.status = 'Sent';
    if (body.action === 'reject') row.status = 'Rejected';
    if (body.action === 'approve') {
      const name = text(body.approved_by, 200)?.trim();
      if (!name) return fail('Enter the name of the client signing.', 400);
      if (!isSignature(body.signature)) return fail('The client needs to sign first.', 400);
      if (!(Number(row.price) > 0)) return fail('Price the change order before approval.', 400);
      Object.assign(row, { status: 'Approved', approved_by: name, approval_signature: body.signature, approved_at: new Date().toISOString() });
    }
  }

  const { data, error } = await supabase.from('change-orders').update(row).eq('id', id).select().maybeSingle();
  if (error) return fail(error.message);
  return ok(data);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return fail('Database unavailable.', 503);
  if (!isUuid(id)) return notFound();
  const cur = await supabase.from('change-orders').select('status, invoice_id').eq('id', id).maybeSingle();
  if (!cur.data) return notFound();
  if (cur.data.status === 'Approved') return fail('Approved change orders can\'t be deleted. Reopen it first.', 409);
  const { error } = await supabase.from('change-orders').delete().eq('id', id);
  if (error) return fail(error.message);
  return ok(null);
}
