import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { workerName, role, projectName, hoursAllocated, shiftDate } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        assignment: {
          id: "mock-crew-001",
          workerName,
          role,
          projectName,
          hoursAllocated,
          shiftDate,
          status: "Scheduled"
        }
      });
    }

    const { data, error } = await supabase
      .from("crew_schedules")
      .insert([{ 
        worker_name: workerName, 
        role, 
        project_name: projectName, 
        hours_allocated: hoursAllocated, 
        shift_date: shiftDate,
        status: "Scheduled"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
