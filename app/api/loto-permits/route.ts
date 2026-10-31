import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { permitNumber, projectName, equipmentIsolated, energySource, lockNumbers, authorizedLead, zeroEnergyVerified } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        lotoRecord: {
          id: "mock-loto-001",
          permitNumber,
          projectName,
          equipmentIsolated,
          energySource,
          lockNumbers,
          authorizedLead,
          zeroEnergyVerified,
          status: zeroEnergyVerified ? "Isolation Active & Verified" : "Pending Zero Energy Check",
          issuedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("loto_permits")
      .insert([{ 
        permit_number: permitNumber, 
        project_name: projectName, 
        equipment_isolated: equipmentIsolated, 
        energy_source: energySource, 
        lock_numbers: lockNumbers, 
        authorized_lead: authorizedLead, 
        zero_energy_verified: zeroEnergyVerified,
        status: zeroEnergyVerified ? "Isolation Active & Verified" : "Pending Zero Energy Check"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
