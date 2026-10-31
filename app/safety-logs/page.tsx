"use client";

import { useState } from "react";

export default function SafetyLogsPage() {
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [incidentType, setIncidentType] = useState("Near Miss");
  const [severity, setSeverity] = useState("Low / Controlled");
  const [location, setLocation] = useState("Main Electrical Switchgear Bay B");
  const [description, setDescription] = useState("Temporary cable run draped near overhead walkway without adequate clearance flagging.");
  const [correctiveAction, setCorrectiveAction] = useState("Immediately installed high-visibility safety delineation and hung cables on overhead swing arms.");
  const [reportedBy, setReportedBy] = useState("Kyle Ingalls (4th-Year Electrical Apprentice)");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/safety-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, incidentType, severity, location, description, correctiveAction, reportedBy })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Safety Incident & Near Miss Logging</h1>
        <p className="text-slate-400 mb-8">Maintain rigorous safety compliance, document near misses, and verify hazard corrective actions.</p>

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
              <label className="block text-sm font-medium text-slate-300 mb-1">Reported By</label>
              <input 
                type="text" 
                value={reportedBy} 
                onChange={(e) => setReportedBy(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Observation Type</label>
              <select 
                value={incidentType} 
                onChange={(e) => setIncidentType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="Near Miss">Near Miss</option>
                <option value="Safety Hazard">Safety Hazard</option>
                <option value="First Aid Incident">First Aid Incident</option>
                <option value="Positive Safety Observation">Positive Safety Observation</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Severity Level</label>
              <select 
                value={severity} 
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="Low / Controlled">Low / Controlled</option>
                <option value="Medium / Requires Attention">Medium / Requires Attention</option>
                <option value="High / Stop Work">High / Stop Work</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Site Location</label>
              <input 
                type="text" 
                value={location} 
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Incident / Hazard Description</label>
            <textarea 
              rows={3}
              value={description} 
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Corrective Action Taken</label>
            <textarea 
              rows={3}
              value={correctiveAction} 
              onChange={(e) => setCorrectiveAction(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-rose-600 hover:bg-rose-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Logging Safety Report..." : "Submit Safety & Compliance Log"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-rose-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-rose-400 mb-2">Safety Log Recorded Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
