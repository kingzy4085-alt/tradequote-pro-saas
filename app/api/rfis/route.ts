import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { rfiSubject, projectName, assignedTo, priority, question, proposedSolution } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        rfi: {
          id: "mock-rfi-001",
          rfiSubject,
          projectName,
          assignedTo,
          priority,
          question,
          proposedSolution,
          status: "Open - Pending Review",
          submittedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("rfis")
      .insert([{ 
        rfi_subject: rfiSubject, 
        project_name: projectName, 
        assigned_to: assignedTo, 
        priority, 
        question, 
        proposed_solution: proposedSolution,
        status: "Open - Pending Review"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
