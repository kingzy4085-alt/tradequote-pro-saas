import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TABLE_NAME = 'estimates';

export async function GET() {
  if (!supabase) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });
  const { data, error } = await supabase.from(TABLE_NAME).select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, module: 'estimates', data });
}

export async function POST(request: Request) {
  if (!supabase) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  delete body.company_id;
  const { data, error } = await supabase.from(TABLE_NAME).insert([body]).select().single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, module: 'estimates', data });
}
