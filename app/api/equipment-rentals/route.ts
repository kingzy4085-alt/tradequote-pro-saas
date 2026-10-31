import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { equipmentName, rentalCompany, poNumber, dailyRate, rentalStartDate, estimatedReturnDate, notes } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        rental: {
          id: "mock-rental-001",
          equipmentName,
          rentalCompany,
          poNumber,
          dailyRate,
          rentalStartDate,
          estimatedReturnDate,
          notes,
          status: "On Site / Active",
          loggedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("equipment_rentals")
      .insert([{ 
        equipment_name: equipmentName, 
        rental_company: rentalCompany, 
        po_number: poNumber, 
        daily_rate: dailyRate, 
        rental_start_date: rentalStartDate, 
        estimated_return_date: estimatedReturnDate,
        notes,
        status: "On Site / Active"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
