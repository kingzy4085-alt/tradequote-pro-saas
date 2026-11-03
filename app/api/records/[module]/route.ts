import { supabase } from '@/lib/supabase';
import { fail, isDate, ok, text } from '@/lib/api-helpers';
import { RECORD_MODULES } from '@/lib/records';

export async function GET(_request: Request, { params }: { params: { module: string } }) {
  const m = RECORD_MODULES[params.module];
  if (!m) return fail('Unknown module.', 404);
  if (!supabase) return fail('Database unavailable.', 503);
  const { data, error } = await supabase
    .from(m.table)
    .select('id, created_at, project, record_date, status, data, signatures, photos')
    .order('record_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return fail(error.message);
  return ok(data);
}

export async function POST(request: Request, { params }: { params: { module: string } }) {
  const m = RECORD_MODULES[params.module];
  if (!m) return fail('Unknown module.', 404);
  if (!supabase) return fail('Database unavailable.', 503);
  const body = await request.json().catch(() => ({}));
  const project = text(body.project, 200)?.trim();
  if (!project) return fail('Project is required.', 400);
  const { data, error } = await supabase
    .from(m.table)
    .insert([{ project, name: project, record_date: isDate(body.record_date) ? body.record_date : undefined, status: m.status([]) }])
    .select()
    .single();
  if (error) return fail(error.message);
  return ok(data);
}
