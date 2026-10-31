import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { toolName, assetTag, assignedWorker, projectName, checkoutDate, condition } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        toolRecord: {
          id: "mock-tool-001",
          toolName,
          assetTag,
          assignedWorker,
          projectName,
          checkoutDate,
          condition,
          status: "Checked Out",
          loggedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("tool_crib")
      .insert([{ 
        tool_name: toolName, 
        asset_tag: assetTag, 
        assigned_worker: assignedWorker, 
        project_name: projectName, 
        checkout_date: checkoutDate, 
        condition,
        status: "Checked Out"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
