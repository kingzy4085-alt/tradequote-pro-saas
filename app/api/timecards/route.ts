import { supabase } from '@/lib/supabase';
import { fail, isDate, ok } from '@/lib/api-helpers';
import { TIMECARD_COLS as COLS, costOf, parseEntry } from '@/lib/timecards';

// Entries between ?from and ?to (inclusive), newest first
export async function GET(request: Request) {
  if (!supabase) return fail('Database unavailable.', 503);
  const q = new URL(request.url).searchParams;
  let query = supabase.from('timecards').select(COLS).order('work_date', { ascending: false }).order('created_at', { ascending: false });
  if (isDate(q.get('from'))) query = query.gte('work_date', q.get('from')!);
  if (isDate(q.get('to'))) query = query.lte('work_date', q.get('to')!);
  const { data, error } = await query.limit(2000);
  if (error) return fail(error.message);
  return ok(data);
}

export async function POST(request: Request) {
  if (!supabase) return fail('Database unavailable.', 503);
  const body = await request.json().catch(() => ({}));
  const p = parseEntry(body);
  if (!p.row) return fail(p.error!, 400);
  const { data: { user } } = await supabase.auth.getUser();
  const total_cost = await costOf(p.row.regular_hours, p.row.overtime_hours, p.row.hourly_cost);
  const { data, error } = await supabase.from('timecards').insert([{ ...p.row, total_cost, user_id: user?.id, status: 'Submitted' }]).select(COLS).single();
  if (error) return fail(error.message);
  return ok(data);
}
