import { supabase } from '@/lib/supabase';
import { fail, isUuid, ok, text } from '@/lib/api-helpers';
import { TIMECARD_COLS, costOf, parseEntry } from '@/lib/timecards';

const notFound = () => fail('Timecard not found.', 404);

// Edit a submitted entry, or approve / unapprove it. Approved entries are locked.
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  if (!supabase) return fail('Database unavailable.', 503);
  if (!isUuid(params.id)) return notFound();
  const body = await request.json().catch(() => ({}));
  const cur = await supabase.from('timecards').select(TIMECARD_COLS).eq('id', params.id).maybeSingle();
  if (cur.error) return fail(cur.error.message);
  if (!cur.data) return notFound();

  let row: Record<string, unknown>;
  if (body.action === 'approve') {
    const by = text(body.approved_by, 200)?.trim();
    if (!by) return fail('Enter who is approving.', 400);
    row = { status: 'Approved', approved_by: by, approved_at: new Date().toISOString() };
  } else if (body.action === 'unapprove') {
    row = { status: 'Submitted', approved_by: null, approved_at: null };
  } else {
    if (cur.data.status === 'Approved') return fail('Approved timecards are locked. Unapprove it first.', 409);
    const p = parseEntry({ ...cur.data, ...body });
    if (!p.row) return fail(p.error!, 400);
    row = { ...p.row, total_cost: await costOf(p.row.regular_hours, p.row.overtime_hours, p.row.hourly_cost) };
  }
  const { data, error } = await supabase.from('timecards').update(row).eq('id', params.id).select(TIMECARD_COLS).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return notFound();
  return ok(data);
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!supabase) return fail('Database unavailable.', 503);
  if (!isUuid(params.id)) return notFound();
  const cur = await supabase.from('timecards').select('status').eq('id', params.id).maybeSingle();
  if (!cur.data) return notFound();
  if (cur.data.status === 'Approved') return fail('Approved timecards can\'t be deleted. Unapprove it first.', 409);
  const { error } = await supabase.from('timecards').delete().eq('id', params.id);
  if (error) return fail(error.message);
  return ok(null);
}
