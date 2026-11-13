import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { estimateTotals, type EstimateItem } from '@/lib/estimate-math';

const TEXT_FIELDS = ['projectName', 'clientName', 'clientAddress', 'scope', 'terms', 'status'];
const NUMBER_FIELDS = ['markupPercentage', 'taxPercentage', 'labourRate'];
const STATUSES = ['Draft', 'Sent', 'Won', 'Lost'];
const unavailable = () => NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });
const fail = (message: string, status = 500) => NextResponse.json({ success: false, error: message }, { status });
const notFound = () => fail('Estimate not found.', 404);
const validId = (id: string) => /^\d+$/.test(id);

// Finite, non-negative number or null when the input isn't one
function amount(v: unknown) {
  const n = typeof v === 'string' && v.trim() === '' ? 0 : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// One estimate with its line items
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return unavailable();
  if (!validId(id)) return notFound();
  const { data, error } = await supabase.from('estimates').select('*').eq('id', id).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return notFound();
  const items = await supabase.from('estimate_items').select('*').eq('estimate_id', id).order('sort');
  if (items.error) return fail(items.error.message);
  return NextResponse.json({ success: true, data: { ...data, items: items.data } });
}

// Saves the estimate fields and line items, and stores the computed totals for the estimate list
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return unavailable();
  if (!validId(id)) return notFound();
  const body = await request.json().catch(() => ({}));

  const row: Record<string, unknown> = {};
  for (const f of TEXT_FIELDS) if (f in body) row[f] = typeof body[f] === 'string' ? body[f].slice(0, 20000) : null;
  if ('status' in row && !STATUSES.includes(row.status as string)) return fail('Status must be Draft, Sent, Won or Lost.', 400);
  for (const f of NUMBER_FIELDS) {
    if (!(f in body)) continue;
    const n = amount(body[f]);
    if (n === null) return fail(`${f} must be a number of 0 or more.`, 400);
    row[f] = n;
  }

  const current = await supabase.from('estimates').select('*').eq('id', id).maybeSingle();
  if (current.error) return fail(current.error.message);
  if (!current.data) return notFound();

  let items: (EstimateItem & { estimate_id: string; sort: number })[] | null = null;
  if (Array.isArray(body.items)) {
    if (body.items.length > 1000) return fail('An estimate can have up to 1000 lines.', 400);
    items = [];
    for (const [i, it] of (body.items as Record<string, unknown>[]).entries()) {
      const quantity = amount(it.quantity), material = amount(it.material_unit_cost), hours = amount(it.labour_hours_per_unit);
      if (quantity === null || material === null || hours === null) return fail(`Line ${i + 1}: quantity, material cost and labour hours must be numbers of 0 or more.`, 400);
      items.push({
        estimate_id: id,
        sort: i,
        description: String(it.description ?? '').slice(0, 500),
        unit: String(it.unit ?? '').slice(0, 20),
        quantity,
        material_unit_cost: material,
        labour_hours_per_unit: hours,
      });
    }
  }

  const merged = { ...current.data, ...row };
  const lines = items ?? (await supabase.from('estimate_items').select('*').eq('estimate_id', id)).data ?? [];
  const t = estimateTotals(lines, merged.labourRate, merged.markupPercentage, merged.taxPercentage);
  Object.assign(row, { total_material_cost: t.material, estimated_labor_hours: t.labourHours, estimated_labor_cost: t.labour, total_bid: t.total });

  if (items) {
    // Add the new lines before removing the old ones so a failed save never empties the estimate
    const old = await supabase.from('estimate_items').select('id').eq('estimate_id', id);
    if (old.error) return fail(old.error.message);
    if (items.length) {
      const ins = await supabase.from('estimate_items').insert(items);
      if (ins.error) return fail(ins.error.message);
    }
    const oldIds = old.data.map((r) => r.id);
    if (oldIds.length) {
      const del = await supabase.from('estimate_items').delete().in('id', oldIds);
      if (del.error) return fail(del.error.message);
    }
  }

  const { data, error } = await supabase.from('estimates').update(row).eq('id', id).select().maybeSingle();
  if (error) return fail(error.message);
  return NextResponse.json({ success: true, data: { ...data, totals: t } });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return unavailable();
  if (!validId(id)) return notFound();
  const { data, error } = await supabase.from('estimates').delete().eq('id', id).select('id');
  if (error) return fail(error.message);
  if (!data.length) return notFound();
  await supabase.from('estimate_items').delete().eq('estimate_id', id);
  return NextResponse.json({ success: true });
}
