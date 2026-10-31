import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { workerName, role, projectName, regularHours, overtimeHours, shutdownRate, workDate } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    const regTotal = Number(regularHours) * 45.00;
    const otTotal = Number(overtimeHours) * (shutdownRate ? 67.50 : 45.00);
    const grossPay = regTotal + otTotal;

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        timecard: {
          id: "mock-time-001",
          workerName,
          role,
          projectName,
          regularHours,
          overtimeHours,
          shutdownRate,
          workDate,
          grossPay,
          status: "Approved for Payroll",
          submittedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("timecards")
      .insert([{ 
        worker_name: workerName, 
        role, 
        project_name: projectName, 
        regular_hours: regularHours, 
        overtime_hours: overtimeHours, 
        shutdown_rate: shutdownRate, 
        work_date: workDate,
        gross_pay: grossPay,
        status: "Approved for Payroll"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
