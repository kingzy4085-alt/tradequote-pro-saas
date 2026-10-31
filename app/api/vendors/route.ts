import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json({ success: true, data: [] }, { status: 200 });
    }
    const { data, error } = await supabase.from('vendors').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Failed to fetch vendors' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!supabase) {
      return NextResponse.json({ success: true, data: body }, { status: 200 });
    }
    const { data, error } = await supabase.from('vendors').insert([body]).select();
    if (error) throw error;
    return NextResponse.json({ success: true, data: data?.[0] || body }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Failed to create vendor' }, { status: 500 });
  }
}
