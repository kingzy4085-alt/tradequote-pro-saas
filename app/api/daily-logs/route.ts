import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectName, superintendent, weather, totalManpowerHours, safetyIncidents, workCompleted } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        dailyLog: {
          id: "mock-log-001",
          projectName,
          superintendent,
          weather,
          totalManpowerHours,
          safetyIncidents,
          workCompleted,
          loggedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("daily_logs")
      .insert([{ 
        project_name: projectName, 
        superintendent, 
        weather, 
        total_manpower_hours: totalManpowerHours, 
        safety_incidents: safetyIncidents, 
        work_completed: workCompleted 
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
