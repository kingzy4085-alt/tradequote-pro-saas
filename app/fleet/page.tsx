"use client";

import { useState } from "react";

export default function FleetPage() {
  const [vehicleUnit, setVehicleUnit] = useState("Service Truck #4 (Ford F-350 Crew Cab)");
  const [licensePlate, setLicensePlate] = useState("SK-TRK-408");
  const [currentMileage, setCurrentMileage] = useState(84200);
  const [lastServiceDate, setLastServiceDate] = useState("2026-08-15");
  const [nextServiceMileage, setNextServiceMileage] = useState(90000);
  const [serviceType, setServiceType] = useState("Synthetic Oil Change & Brake Inspection");
  const [assignedDriver, setAssignedDriver] = useState("Kyle Ingalls");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleUnit, licensePlate, currentMileage, lastServiceDate, nextServiceMileage, serviceType, assignedDriver })
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Fleet & Service Vehicle Maintenance</h1>
        <p className="text-slate-400 mb-8">Track service truck mileage, maintenance intervals, driver assignments, and safety inspections.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Vehicle Unit / Make & Model</label>
              <input 
                type="text" 
                value={vehicleUnit} 
                onChange={(e) => setVehicleUnit(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">License Plate / Registration ID</label>
              <input 
                type="text" 
                value={licensePlate} 
                onChange={(e) => setLicensePlate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Current Mileage (km)</label>
              <input 
                type="number" 
                value={currentMileage} 
                onChange={(e) => setCurrentMileage(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Last Service Date</label>
              <input 
                type="date" 
                value={lastServiceDate} 
                onChange={(e) => setLastServiceDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Next Service Mileage (km)</label>
              <input 
                type="number" 
                value={nextServiceMileage} 
                onChange={(e) => setNextServiceMileage(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Service Type & Maintenance Notes</label>
              <input 
                type="text" 
                value={serviceType} 
                onChange={(e) => setServiceType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Primary Assigned Driver</label>
              <input 
                type="text" 
                value={assignedDriver} 
                onChange={(e) => setAssignedDriver(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Saving Fleet Record..." : "Save Fleet Maintenance Record"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-teal-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-teal-400 mb-2">Fleet Record Saved Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
