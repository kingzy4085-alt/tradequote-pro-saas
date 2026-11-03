import { supabase } from '@/lib/supabase';
import { fail, ok, text } from '@/lib/api-helpers';

export async function GET() {
  if (!supabase) return fail('Database unavailable.', 503);
  const { data, error } = await supabase
    .from('change-orders')
    .select('id, created_at, co_number, project, client_name, status, price, total, approved_at, invoice_id')
    .order('created_at', { ascending: false });
  if (error) return fail(error.message);
  return ok(data);
}

// New change order, numbered after the company's last one, with the company's pricing defaults
export async function POST(request: Request) {
  if (!supabase) return fail('Database unavailable.', 503);
  const body = await request.json().catch(() => ({}));
  const project = text(body.project, 200)?.trim();
  if (!project) return fail('Project is required.', 400);

  const [last, company] = await Promise.all([
    supabase.from('change-orders').select('co_number').not('co_number', 'is', null).order('co_number', { ascending: false }).limit(1),
    supabase.rpc('current_company_id').then(({ data: id }) => supabase!.from('companies').select('default_markup, default_tax, default_labour_rate').eq('id', id).maybeSingle()),
  ]);
  if (last.error) return fail(last.error.message);
  const c = company.data || {};
  const row = {
    project,
    name: project,
    client_name: text(body.client_name, 200),
    estimate_id: /^\d+$/.test(String(body.estimate_id ?? '')) ? Number(body.estimate_id) : null,
    co_number: (last.data[0]?.co_number || 0) + 1,
    markup_pct: c.default_markup ?? 0,
    tax_pct: c.default_tax ?? 0,
    labour_rate: c.default_labour_rate ?? 0,
    status: 'Draft',
  };
  const { data, error } = await supabase.from('change-orders').insert([row]).select().single();
  if (error) return fail(error.message);
  return ok(data);
}
