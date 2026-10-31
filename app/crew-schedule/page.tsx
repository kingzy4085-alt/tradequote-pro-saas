"use client";

import { useState } from "react";

export default function CrewSchedulePage() {
  const [workerName, setWorkerName] = useState("Kyle Ingalls");
  const [role, setRole] = useState("4th-Year Electrical Apprentice");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [hoursAllocated, setHoursAllocated] = useState(10);
  const [shiftDate, setShiftDate] = useState(new Date().toISOString().split("T")[0]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/crew-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerName, role, projectName, hoursAllocated, shiftDate })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Crew Scheduling & Labor Tracking</h1>
        <p className="text-slate-400 mb-8">Assign trade personnel to active shutdown projects and track daily shift hours.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Worker Name</label>
              <input 
                type="text" 
                value={workerName} 
                onChange={(e) => setWorkerName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Trade Role</label>
              <input 
                type="text" 
                value={role} 
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-slate-300 mb-1">Project Name</label>
              <input 
                type="text" 
                value={projectName} 
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-slate-300 mb-1">Shift Hours</label>
              <input 
                type="number" 
                value={hoursAllocated} 
                onChange={(e) => setHoursAllocated(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500"
                min="1"
                max="24"
                required 
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-slate-300 mb-1">Shift Date</label>
              <input 
                type="date" 
                value={shiftDate} 
                onChange={(e) => setShiftDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Assigning Crew..." : "Assign Worker to Shift"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-emerald-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-emerald-400 mb-2">Shift Assigned Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
