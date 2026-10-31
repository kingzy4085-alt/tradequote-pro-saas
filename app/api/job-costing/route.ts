import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectName, budgetedLabor, actualLabor, budgetedMaterials, actualMaterials, budgetedEquipment, actualEquipment } = body;

    const totalBudget = Number(budgetedLabor) + Number(budgetedMaterials) + Number(budgetedEquipment);
    const totalActual = Number(actualLabor) + Number(actualMaterials) + Number(actualEquipment);
    const variance = totalBudget - totalActual;
    const marginPercent = totalBudget > 0 ? ((totalBudget - totalActual) / totalBudget) * 100 : 0;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        jobCosting: {
          id: "mock-cost-001",
          projectName,
          totalBudget,
          totalActual,
          variance,
          marginPercent: marginPercent.toFixed(2) + "%",
          status: variance >= 0 ? "Under Budget / Profitable" : "Over Budget / Variance Alert",
          loggedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("job_costing")
      .insert([{ 
        project_name: projectName, 
        budgeted_labor: budgetedLabor, 
        actual_labor: actualLabor, 
        budgeted_materials: budgetedMaterials, 
        actual_materials: actualMaterials, 
        budgeted_equipment: budgetedEquipment, 
        actual_equipment: actualEquipment,
        total_budget: totalBudget,
        total_actual: totalActual,
        variance,
        margin_percent: marginPercent
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
