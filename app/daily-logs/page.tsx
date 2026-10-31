"use client";

import { useState } from "react";

export default function DailyLogsPage() {
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [superintendent, setSuperintendent] = useState("Kyle Ingalls");
  const [weather, setWeather] = useState("Clear, +12°C, Wind NW 15 km/h");
  const [totalManpowerHours, setTotalManpowerHours] = useState(120);
  const [safetyIncidents, setSafetyIncidents] = useState("0 incidents. Proper delineation verified.");
  const [workCompleted, setWorkCompleted] = useState("Completed main feeder cable run, breaker tie-in, and lock-out tag-out verification.");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/daily-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, superintendent, weather, totalManpowerHours, safetyIncidents, workCompleted })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Superintendent Daily Field Log</h1>
        <p className="text-slate-400 mb-8">Record daily site progress, weather conditions, manpower hours, and safety logs.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Project Name</label>
              <input 
                type="text" 
                value={projectName} 
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Superintendent / Lead</label>
              <input 
                type="text" 
                value={superintendent} 
                onChange={(e) => setSuperintendent(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Weather & Site Conditions</label>
              <input 
                type="text" 
                value={weather} 
                onChange={(e) => setWeather(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Total Manpower Hours Today</label>
              <input 
                type="number" 
                value={totalManpowerHours} 
                onChange={(e) => setTotalManpowerHours(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Work Completed Summary</label>
            <textarea 
              rows={3}
              value={workCompleted} 
              onChange={(e) => setWorkCompleted(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Safety & Compliance Notes</label>
            <input 
              type="text" 
              value={safetyIncidents} 
              onChange={(e) => setSafetyIncidents(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Submitting Daily Log..." : "Submit Superintendent Daily Log"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-amber-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-amber-400 mb-2">Daily Log Recorded Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
