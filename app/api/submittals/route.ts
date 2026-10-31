import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { submittalTitle, projectName, specSection, supplier, documentUrl, notes } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        submittal: {
          id: "mock-sub-001",
          submittalTitle,
          projectName,
          specSection,
          supplier,
          documentUrl,
          notes,
          status: "Pending Engineer Review",
          submittedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("submittals")
      .insert([{ 
        submittal_title: submittalTitle, 
        project_name: projectName, 
        spec_section: specSection, 
        supplier, 
        document_url: documentUrl, 
        notes,
        status: "Pending Engineer Review"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
