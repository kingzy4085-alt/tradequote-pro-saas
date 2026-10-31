import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectName, incidentType, severity, location, description, correctiveAction, reportedBy } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        safetyLog: {
          id: "mock-safety-001",
          projectName,
          incidentType,
          severity,
          location,
          description,
          correctiveAction,
          reportedBy,
          status: "Resolved & Closed",
          reportedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("safety_logs")
      .insert([{ 
        project_name: projectName, 
        incident_type: incidentType, 
        severity, 
        location, 
        description, 
        corrective_action: correctiveAction, 
        reported_by: reportedBy,
        status: "Resolved & Closed"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
