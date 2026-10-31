import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { clientName, contactPerson, phone, email, projectSite, status } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        client: {
          id: "mock-client-001",
          clientName,
          contactPerson,
          phone,
          email,
          projectSite,
          status,
          createdAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("clients")
      .insert([{ client_name: clientName, contact_person: contactPerson, phone, email, project_site: projectSite, status }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
