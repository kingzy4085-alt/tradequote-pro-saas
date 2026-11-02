import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json({ success: true, data: [] }, { status: 200 });
    }
    const { data, error } = await supabase.from('site-vault').select('*').order('created_at', { ascending: false });
    if (error) {
      return NextResponse.json({ success: true, data: [] }, { status: 200 });
    }
    return NextResponse.json({ success: true, data: data || [] }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: true, data: [] }, { status: 200 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!supabase) {
      return NextResponse.json({ success: true, data: body }, { status: 200 });
    }
    const { data, error } = await supabase.from('site-vault').insert([body]).select();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: data?.[0] || body }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Request failed' }, { status: 500 });
  }
}
