import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TABLE_NAME = 'proposals';

export async function GET() {
  if (!supabase) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });
  try {
    const { data, error } = await supabase.from(TABLE_NAME).select('*');
    if (error) {
      return NextResponse.json({ success: true, module: 'proposals', data: [], warning: error.message });
    }
    return NextResponse.json({ success: true, module: 'proposals', data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!supabase) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });
  try {
    const body = await request.json();
    // Fill the original proposals columns from the form's fields
    const row = {
      ...body,
      project_name: body.project_name ?? body.proposalTitle ?? 'Untitled Proposal',
      client_name: body.client_name ?? body.clientName ?? null,
      amount: body.amount ?? body.totalAmount ?? null,
      scope_details: body.scope_details ?? body.scopeOfWork ?? null,
      status: body.status ?? 'Draft',
    };
    const { data, error } = await supabase.from(TABLE_NAME).insert([row]).select();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, module: 'proposals', data: data ? data[0] : body });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
