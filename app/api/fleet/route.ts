import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { vehicleUnit, licensePlate, currentMileage, lastServiceDate, nextServiceMileage, serviceType, assignedDriver } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const isPlaceholder = !supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseUrl.startsWith("http");

    if (isPlaceholder) {
      return NextResponse.json({ 
        success: true, 
        mock: true,
        fleetRecord: {
          id: "mock-fleet-001",
          vehicleUnit,
          licensePlate,
          currentMileage,
          lastServiceDate,
          nextServiceMileage,
          serviceType,
          assignedDriver,
          status: "Service Up to Date",
          loggedAt: new Date().toISOString()
        }
      });
    }

    const { data, error } = await supabase
      .from("fleet_maintenance")
      .insert([{ 
        vehicle_unit: vehicleUnit, 
        license_plate: licensePlate, 
        current_mileage: currentMileage, 
        last_service_date: lastServiceDate, 
        next_service_mileage: nextServiceMileage, 
        service_type: serviceType,
        assigned_driver: assignedDriver,
        status: "Service Up to Date"
      }])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
