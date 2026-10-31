import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectName, docType, fileName, notes } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        document: {
          id: "mock-doc-001",
          projectName,
          docType,
          fileName,
          notes,
          uploadedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("site_vault")
      .insert([{ project_name: projectName, doc_type: docType, file_name: fileName, notes }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
