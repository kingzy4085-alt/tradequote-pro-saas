import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { rfqTitle, projectName, supplierName, materialList, targetBudget, responseDeadline, notes } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        rfqRecord: {
          id: "mock-rfq-001",
          rfqTitle,
          projectName,
          supplierName,
          materialList,
          targetBudget,
          responseDeadline,
          notes,
          status: "RFQ Sent - Awaiting Supplier Bid",
          sentAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("supplier_rfqs")
      .insert([{ 
        rfq_title: rfqTitle, 
        project_name: projectName, 
        supplier_name: supplierName, 
        material_list: materialList, 
        target_budget: targetBudget, 
        response_deadline: responseDeadline, 
        notes,
        status: "RFQ Sent - Awaiting Supplier Bid"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
