import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { meetingTopic, projectName, leadName, attendeeCount, hazardsDiscussed, weatherConditions } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        tailgateRecord: {
          id: "mock-tailgate-001",
          meetingTopic,
          projectName,
          leadName,
          attendeeCount,
          hazardsDiscussed,
          weatherConditions,
          status: "Safety Meeting Logged & Signed",
          loggedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("tailgate_logs")
      .insert([{ 
        meeting_topic: meetingTopic, 
        project_name: projectName, 
        lead_name: leadName, 
        attendee_count: attendeeCount, 
        hazards_discussed: hazardsDiscussed, 
        weather_conditions: weatherConditions,
        status: "Safety Meeting Logged & Signed"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
