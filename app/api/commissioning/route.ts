import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { equipmentTag, projectName, voltageLevel, rotationVerified, tripSettingsChecked, relayTestPassed, commissioningLead, notes } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    const allPassed = rotationVerified && tripSettingsChecked && relayTestPassed;

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        commissioningRecord: {
          id: "mock-comm-001",
          equipmentTag,
          projectName,
          voltageLevel,
          rotationVerified,
          tripSettingsChecked,
          relayTestPassed,
          commissioningLead,
          notes,
          status: allPassed ? "Ready for Energization / Commissioned" : "Pending Outstanding Checks",
          completedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("commissioning")
      .insert([{ 
        equipment_tag: equipmentTag, 
        project_name: projectName, 
        voltage_level: voltageLevel, 
        rotation_verified: rotationVerified, 
        trip_settings_checked: tripSettingsChecked, 
        relay_test_passed: relayTestPassed,
        commissioning_lead: commissioningLead,
        notes,
        status: allPassed ? "Ready for Energization / Commissioned" : "Pending Outstanding Checks"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
