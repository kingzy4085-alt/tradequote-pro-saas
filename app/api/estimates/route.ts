import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase.from('estimates').select('*');
    if (error) throw error;
    return NextResponse.json({ success: true, estimates: data || [] });
  } catch (err: any) {
    return NextResponse.json({ success: true, estimates: [], warning: err.message });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data, error } = await supabase.from('estimates').insert([body]).select();
    if (error) throw error;
    return NextResponse.json({ success: true, data: data?.[0] || body });
  } catch (err: any) {
    return NextResponse.json({ success: true, data: {}, warning: err.message });
  }
}
