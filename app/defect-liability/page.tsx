"use client";

import { useState } from "react";

export default function DefectLiabilityPage() {
  const [defectTitle, setDefectTitle] = useState("Vibration Isolation Pad Adjustment on Crusher Motor");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [reportedBy, setReportedBy] = useState("Plant Maintenance Supervisor");
  const [severity, setSeverity] = useState("Medium");
  const [correctiveAction, setCorrectiveAction] = useState("Dispatched electrical crew to retorque terminal lugs and realign motor vibration dampeners.");
  const [resolutionDate, setResolutionDate] = useState(new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/defect-liability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defectTitle, projectName, reportedBy, severity, correctiveAction, resolutionDate })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Defect Liability & Warranty Claims</h1>
        <p className="text-slate-400 mb-8">Track post-completion warranty claims, deficiency notices, and corrective site actions during the liability period.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Defect / Claim Title</label>
              <input 
                type="text" 
                value={defectTitle} 
                onChange={(e) => setDefectTitle(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Reported By (Client Contact)</label>
              <input 
                type="text" 
                value={reportedBy} 
                onChange={(e) => setReportedBy(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Severity / Urgency</label>
              <select 
                value={severity} 
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High (Urgent Shutdown)">High (Urgent Shutdown)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Target Resolution Date</label>
              <input 
                type="date" 
                value={resolutionDate} 
                onChange={(e) => setResolutionDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Corrective Action Plan & Field Notes</label>
            <textarea 
              rows={4}
              value={correctiveAction} 
              onChange={(e) => setCorrectiveAction(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Logging Defect Claim..." : "Log Defect Liability Claim & Action Plan"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-blue-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-blue-400 mb-2">Defect Liability Claim Logged Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
