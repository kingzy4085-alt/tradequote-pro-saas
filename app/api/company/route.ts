import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const FIELDS = ['company_name', 'phone', 'email', 'address', 'province', 'contact', 'default_markup', 'default_tax', 'default_labour_rate', 'default_terms'];

// The signed-in user's company profile (row security returns only their own)
export async function GET() {
  if (!supabase) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });
  const { data: id } = await supabase.rpc('current_company_id');
  const { data, error } = await supabase.from('companies').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}

export async function PUT(request: Request) {
  if (!supabase) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const row: Record<string, unknown> = {};
  for (const f of FIELDS) if (f in body) row[f] = body[f] === '' ? null : body[f];
  const { data: id } = await supabase.rpc('current_company_id');
  if (!id) return NextResponse.json({ success: false, error: 'No company found.' }, { status: 404 });
  const { data, error } = await supabase.from('companies').update(row).eq('id', id).select().maybeSingle();
  if (!error && !data) return NextResponse.json({ success: false, error: 'Only the company owner or an admin can change these details.' }, { status: 403 });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}
