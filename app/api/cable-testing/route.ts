import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cableId, projectName, fromLocation, toLocation, cableSpec, pullLengthFt, meggerVoltage, insulationResistanceMohm, testedBy } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    const passTest = Number(insulationResistanceMohm) >= 100; // Standard industrial minimum threshold

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        cableRecord: {
          id: "mock-cable-001",
          cableId,
          projectName,
          fromLocation,
          toLocation,
          cableSpec,
          pullLengthFt,
          meggerVoltage,
          insulationResistanceMohm,
          testedBy,
          testStatus: passTest ? "Passed - Megger IR OK" : "Failed - Low Insulation Resistance",
          testedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("cable_testing")
      .insert([{ 
        cable_id: cableId, 
        project_name: projectName, 
        from_location: fromLocation, 
        to_location: toLocation, 
        cable_spec: cableSpec, 
        pull_length_ft: pullLengthFt, 
        megger_voltage: meggerVoltage,
        insulation_resistance_mohm: insulationResistanceMohm,
        tested_by: testedBy,
        test_status: passTest ? "Passed - Megger IR OK" : "Failed - Low Insulation Resistance"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
