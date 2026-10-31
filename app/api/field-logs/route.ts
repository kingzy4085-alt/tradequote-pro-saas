import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectId, logDate, weatherSummary, notes } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        data: [{ id: "mock-log-001", project_id: projectId, log_date: logDate, weather_summary: weatherSummary, notes }] 
      });
    }

    const { data, error } = await supabase
      .from("site_logs")
      .insert([{ project_id: projectId, log_date: logDate, weather_summary: weatherSummary, notes }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
