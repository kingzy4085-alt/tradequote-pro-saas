import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { vendorName, tradeCategory, contactPerson, phone, email, wcbStatus, insuranceExpiry } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        vendor: {
          id: "mock-vendor-001",
          vendorName,
          tradeCategory,
          contactPerson,
          phone,
          email,
          wcbStatus,
          insuranceExpiry,
          status: "Verified & Approved",
          registeredAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("vendors")
      .insert([{ 
        vendor_name: vendorName, 
        trade_category: tradeCategory, 
        contact_person: contactPerson, 
        phone, 
        email, 
        wcb_status: wcbStatus, 
        insurance_expiry: insuranceExpiry,
        status: "Verified & Approved"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
