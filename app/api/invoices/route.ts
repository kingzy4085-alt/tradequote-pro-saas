import { supabase } from '@/lib/supabase';
import { fail, ok, text } from '@/lib/api-helpers';

export async function GET() {
  if (!supabase) return fail('Database unavailable.', 503);
  const { data, error } = await supabase
    .from('invoices')
    .select('id, created_at, invoice_number, project, client_name, issue_date, due_date, status, total, paid_at')
    .order('created_at', { ascending: false });
  if (error) return fail(error.message);
  return ok(data);
}

// New draft invoice, numbered after the company's last one; due in 30 days by default
export async function POST(request: Request) {
  if (!supabase) return fail('Database unavailable.', 503);
  const body = await request.json().catch(() => ({}));
  const project = text(body.project, 200)?.trim();
  if (!project) return fail('Project is required.', 400);

  const [last, company] = await Promise.all([
    supabase.from('invoices').select('invoice_number').not('invoice_number', 'is', null).order('invoice_number', { ascending: false }).limit(1),
    supabase.rpc('current_company_id').then(({ data: id }) => supabase!.from('companies').select('default_tax').eq('id', id).maybeSingle()),
  ]);
  if (last.error) return fail(last.error.message);
  const due = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-CA');
  const { data, error } = await supabase
    .from('invoices')
    .insert([{
      project,
      name: project,
      client_name: text(body.client_name, 200),
      client_address: text(body.client_address, 500),
      invoice_number: (last.data[0]?.invoice_number || 1000) + 1,
      tax_pct: company.data?.default_tax ?? 5,
      due_date: due,
      status: 'Draft',
    }])
    .select()
    .single();
  if (error) return fail(error.message);
  return ok(data);
}
