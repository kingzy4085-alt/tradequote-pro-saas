import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { drawingNumber, drawingTitle, projectName, revision, discipline, fileUrl, uploadedBy } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        drawing: {
          id: "mock-dwg-001",
          drawingNumber,
          drawingTitle,
          projectName,
          revision,
          discipline,
          fileUrl,
          uploadedBy,
          status: "Latest Revision - Approved",
          uploadedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("drawings")
      .insert([{ 
        drawing_number: drawingNumber, 
        drawing_title: drawingTitle, 
        project_name: projectName, 
        revision, 
        discipline, 
        file_url: fileUrl, 
        uploaded_by: uploadedBy,
        status: "Latest Revision - Approved"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
