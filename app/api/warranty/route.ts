import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { equipmentName, projectName, supplier, warrantyMonths, installationDate, contactPerson, notes } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        warrantyRecord: {
          id: "mock-warranty-001",
          equipmentName,
          projectName,
          supplier,
          warrantyMonths,
          installationDate,
          contactPerson,
          notes,
          status: "Warranty Active",
          registeredAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("warranty_tracking")
      .insert([{ 
        equipment_name: equipmentName, 
        project_name: projectName, 
        supplier, 
        warranty_months: warrantyMonths, 
        installation_date: installationDate, 
        contact_person: contactPerson, 
        notes,
        status: "Warranty Active"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
