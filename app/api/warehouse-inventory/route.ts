import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { itemName, partNumber, binLocation, quantityInStock, minThreshold, unitCost, warehouseLocation } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    const needsReorder = Number(quantityInStock) <= Number(minThreshold);

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        inventoryRecord: {
          id: "mock-inv-001",
          itemName,
          partNumber,
          binLocation,
          quantityInStock,
          minThreshold,
          unitCost,
          warehouseLocation,
          status: needsReorder ? "Low Stock - Reorder Required" : "Optimal Stock Level",
          loggedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("warehouse_inventory")
      .insert([{ 
        item_name: itemName, 
        part_number: partNumber, 
        bin_location: binLocation, 
        quantity_in_stock: quantityInStock, 
        min_threshold: minThreshold, 
        unit_cost: unitCost,
        warehouse_location: warehouseLocation,
        status: needsReorder ? "Low Stock - Reorder Required" : "Optimal Stock Level"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
