import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { defectTitle, projectName, reportedBy, severity, correctiveAction, resolutionDate } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        defectRecord: {
          id: "mock-defect-001",
          defectTitle,
          projectName,
          reportedBy,
          severity,
          correctiveAction,
          resolutionDate,
          status: "Under Rectification / In Progress",
          loggedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("defect_liability")
      .insert([{ 
        defect_title: defectTitle, 
        project_name: projectName, 
        reported_by: reportedBy, 
        severity, 
        corrective_action: correctiveAction, 
        resolution_date: resolutionDate,
        status: "Under Rectification / In Progress"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
