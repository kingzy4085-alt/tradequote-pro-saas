import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase.from('estimates').select('*');
    if (error) throw error;
    return NextResponse.json({ success: true, estimates: data || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, estimates: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const payload = {
      job_number: body.job_number || body.jobNumber || "JOB-DEFAULT",
      client_name: body.client_name || body.clientName || "General Contractor",
      total_bid: body.total_bid || body.totalBid || body.total_amount || 0,
      conduit_spec: body.conduit_spec || body.conduitSpec || "1-inch EMT",
      conduit_length: body.conduit_length || body.conduitLength || 0,
      wire_gauge: body.wire_gauge || body.wireGauge || "12 AWG",
      wire_count: body.wire_count || body.wireCount || 3,
      total_material_cost: body.total_material_cost || body.totalMaterialCost || 0,
      estimated_labor_hours: body.estimated_labor_hours || body.estimatedLaborHours || 0,
      estimated_labor_cost: body.estimated_labor_cost || body.estimatedLaborCost || 0,
      risk_notes: body.risk_notes || body.riskNotes || ""
    };

    const { data, error } = await supabase.from('estimates').insert([payload]).select();
    if (error) throw error;
    return NextResponse.json({ success: true, data: data?.[0] || payload });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
