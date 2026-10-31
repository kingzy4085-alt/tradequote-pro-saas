"use client";

import { useState } from "react";

export default function ChangeOrdersPage() {
  const [coTitle, setCoTitle] = useState("Additional Emergency Breaker Installation");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [clientName, setClientName] = useState("Cargill Ltd.");
  const [costImpact, setCostImpact] = useState(2450.00);
  const [scheduleImpactDays, setScheduleImpactDays] = useState(1);
  const [description, setDescription] = useState("Client requested additional 400A breaker tie-in and secondary conduit run not included in original scope.");
  const [authorizedBy, setAuthorizedBy] = useState("John Doe (Plant Supervisor)");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/change-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coTitle, projectName, clientName, costImpact, scheduleImpactDays, description, authorizedBy })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Subcontractor Change Orders & Cost Variations</h1>
        <p className="text-slate-400 mb-8">Document out-of-scope cost variations, schedule adjustments, and client authorizations.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Change Order Title</label>
              <input 
                type="text" 
                value={coTitle} 
                onChange={(e) => setCoTitle(e.target.value)}
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
              <label className="block text-sm font-medium text-slate-300 mb-1">Client Name</label>
              <input 
                type="text" 
                value={clientName} 
                onChange={(e) => setClientName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Cost Impact ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={costImpact} 
                onChange={(e) => setCostImpact(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Schedule Impact (Days)</label>
              <input 
                type="number" 
                value={scheduleImpactDays} 
                onChange={(e) => setScheduleImpactDays(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Scope Variation Description</label>
            <textarea 
              rows={3}
              value={description} 
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Client Authorization Signature</label>
            <input 
              type="text" 
              value={authorizedBy} 
              onChange={(e) => setAuthorizedBy(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-serif italic focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Issuing Change Order..." : "Issue & Approve Change Order"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-emerald-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-emerald-400 mb-2">Change Order Issued Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
