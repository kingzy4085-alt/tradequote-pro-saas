"use client";

import { useState } from "react";

export default function TimecardsPage() {
  const [workerName, setWorkerName] = useState("Kyle Ingalls");
  const [role, setRole] = useState("4th-Year Electrical Apprentice");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [regularHours, setRegularHours] = useState(8);
  const [overtimeHours, setOvertimeHours] = useState(4);
  const [shutdownRate, setShutdownRate] = useState(true);
  const [workDate, setWorkDate] = useState(new Date().toISOString().split("T")[0]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/timecards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerName, role, projectName, regularHours, overtimeHours, shutdownRate, workDate })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Crew Timecard & Payroll Export</h1>
        <p className="text-slate-400 mb-8">Record daily trade hours, overtime multipliers, and industrial shutdown premium rates.</p>

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
              <label className="block text-sm font-medium text-slate-300 mb-1">Trade Classification / Role</label>
              <input 
                type="text" 
                value={role} 
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Project Name</label>
              <input 
                type="text" 
                value={projectName} 
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Regular Hours</label>
              <input 
                type="number" 
                value={regularHours} 
                onChange={(e) => setRegularHours(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Overtime Hours</label>
              <input 
                type="number" 
                value={overtimeHours} 
                onChange={(e) => setOvertimeHours(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Work Date</label>
              <input 
                type="date" 
                value={workDate} 
                onChange={(e) => setWorkDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={shutdownRate} 
                  onChange={(e) => setShutdownRate(e.target.checked)}
                  className="w-5 h-5 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-slate-200">Apply Industrial Shutdown Overtime Premium (1.5x)</span>
              </label>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Submitting Timecard..." : "Submit Timecard & Calculate Payroll"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-indigo-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-indigo-400 mb-2">Timecard Recorded Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
