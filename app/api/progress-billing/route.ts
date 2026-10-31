import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectName, clientName, contractSum, prevBilled, currentCompleted, holdbackPercent } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    const totalBilledToDate = Number(prevBilled) + Number(currentCompleted);
    const holdbackAmount = totalBilledToDate * (Number(holdbackPercent) / 100);
    const netPaymentDue = totalBilledToDate - holdbackAmount - Number(prevBilled);

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        billingRecord: {
          id: "mock-bill-001",
          projectName,
          clientName,
          contractSum,
          prevBilled,
          currentCompleted,
          holdbackAmount,
          netPaymentDue,
          status: "Pending Client Approval",
          submittedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("progress_billings")
      .insert([{ 
        project_name: projectName, 
        client_name: clientName, 
        contract_sum: contractSum, 
        prev_billed: prevBilled, 
        current_completed: currentCompleted, 
        holdback_percent: holdbackPercent,
        holdback_amount: holdbackAmount,
        net_payment_due: netPaymentDue,
        status: "Pending Client Approval"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
