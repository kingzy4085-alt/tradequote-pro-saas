"use client";

import { useState } from "react";

export default function ToolCribPage() {
  const [toolName, setToolName] = useState("Fluke 87-5 Industrial True RMS Multimeter");
  const [assetTag, setAssetTag] = useState("FLK-87V-042");
  const [assignedWorker, setAssignedWorker] = useState("Kyle Ingalls");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [checkoutDate, setCheckoutDate] = useState(new Date().toISOString().split("T")[0]);
  const [condition, setCondition] = useState("Excellent / Calibrated");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/tool-crib", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName, assetTag, assignedWorker, projectName, checkoutDate, condition })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Tool Crib & Inventory Asset Management</h1>
        <p className="text-slate-400 mb-8">Track equipment checkouts, asset tags, assigned trade personnel, and tool conditions.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Tool / Equipment Name</label>
              <input 
                type="text" 
                value={toolName} 
                onChange={(e) => setToolName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Asset Tag / Serial #</label>
              <input 
                type="text" 
                value={assetTag} 
                onChange={(e) => setAssetTag(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 font-mono text-sm"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Assigned Worker</label>
              <input 
                type="text" 
                value={assignedWorker} 
                onChange={(e) => setAssignedWorker(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
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
              <label className="block text-sm font-medium text-slate-300 mb-1">Checkout Date</label>
              <input 
                type="date" 
                value={checkoutDate} 
                onChange={(e) => setCheckoutDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Tool Condition & Calibration Status</label>
            <input 
              type="text" 
              value={condition} 
              onChange={(e) => setCondition(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Checking Out Tool..." : "Checkout Asset to Worker"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-amber-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-amber-400 mb-2">Tool Checked Out Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
