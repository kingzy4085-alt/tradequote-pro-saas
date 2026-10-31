import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TABLE_NAME = 'job_costing';

export async function GET() {
  try {
    const { data, error } = await supabase.from(TABLE_NAME).select('*');
    if (error) {
      return NextResponse.json({ success: true, module: 'job-costing', data: [], warning: error.message });
    }
    return NextResponse.json({ success: true, module: 'job-costing', data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data, error } = await supabase.from(TABLE_NAME).insert([body]).select();
    if (error) {
      return NextResponse.json({ success: true, module: 'job-costing', received: body, warning: error.message });
    }
    return NextResponse.json({ success: true, module: 'job-costing', data: data ? data[0] : body });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
