import { supabase } from '@/lib/supabase';
import { fail, isUuid, ok } from '@/lib/api-helpers';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!supabase) return fail('Database unavailable.', 503);
  if (!isUuid(params.id)) return fail('Cost not found.', 404);
  const { data, error } = await supabase.from('job-costing').delete().eq('id', params.id).select('id');
  if (error) return fail(error.message);
  if (!data.length) return fail('Cost not found.', 404);
  return ok(null);
}
