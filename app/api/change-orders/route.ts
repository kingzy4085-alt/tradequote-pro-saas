import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { coTitle, projectName, clientName, costImpact, scheduleImpactDays, description, authorizedBy } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        changeOrder: {
          id: "mock-co-001",
          coTitle,
          projectName,
          clientName,
          costImpact,
          scheduleImpactDays,
          description,
          authorizedBy: authorizedBy || "Pending Client Approval",
          status: authorizedBy ? "Approved & Active" : "Pending Signature",
          createdAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("change_orders")
      .insert([{ 
        co_title: coTitle, 
        project_name: projectName, 
        client_name: clientName, 
        cost_impact: costImpact, 
        schedule_impact_days: scheduleImpactDays, 
        description, 
        authorized_by: authorizedBy,
        status: authorizedBy ? "Approved & Active" : "Pending Signature"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
