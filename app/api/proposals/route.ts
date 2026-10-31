import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase.from('proposals').select('*');
    if (error) throw error;
    return NextResponse.json({ success: true, proposals: data || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, proposals: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = {
      project_name: body.project_name || body.proposalTitle || "Industrial Shutdown Project",
      client_name: body.client_name || body.clientName || "General Contractor",
      amount: body.amount || body.totalAmount || 0,
      scope_details: body.scope_details || body.scopeOfWork || "",
      status: "draft"
    };
    const { data, error } = await supabase.from('proposals').insert([payload]).select();
    if (error) throw error;
    return NextResponse.json({ success: true, data: data?.[0] || payload, message: 'Proposal saved to Supabase.' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
