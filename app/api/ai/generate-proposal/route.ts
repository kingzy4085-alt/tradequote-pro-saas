import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TABLE_NAME = 'ai_generate_proposal';

export async function GET() {
  if (!supabase) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });
  try {
    const { data, error } = await supabase.from(TABLE_NAME).select('*');
    if (error) {
      return NextResponse.json({ success: true, module: 'ai/generate-proposal', data: [], warning: error.message });
    }
    return NextResponse.json({ success: true, module: 'ai/generate-proposal', data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!supabase) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });
  try {
    const body = await request.json();
    const { data, error } = await supabase.from(TABLE_NAME).insert([body]).select();
    if (error) {
      return NextResponse.json({ success: true, module: 'ai/generate-proposal', received: body, warning: error.message });
    }
    return NextResponse.json({ success: true, module: 'ai/generate-proposal', data: data ? data[0] : body });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
