"use client";

import { useState } from "react";

export default function ProgressBillingPage() {
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [clientName, setClientName] = useState("Cargill Canada Inc.");
  const [contractSum, setContractSum] = useState(48500.00);
  const [prevBilled, setPrevBilled] = useState(15000.00);
  const [currentCompleted, setCurrentCompleted] = useState(24000.00);
  const [holdbackPercent, setHoldbackPercent] = useState(10);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/progress-billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, clientName, contractSum, prevBilled, currentCompleted, holdbackPercent })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Progress Billing & Schedule of Values</h1>
        <p className="text-slate-400 mb-8">Generate schedule of values progress billings, track statutory holdbacks, and calculate net payment applications.</p>

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
              <label className="block text-sm font-medium text-slate-300 mb-1">Client / Owner Name</label>
              <input 
                type="text" 
                value={clientName} 
                onChange={(e) => setClientName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Total Contract Sum ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={contractSum} 
                onChange={(e) => setContractSum(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Previously Billed ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={prevBilled} 
                onChange={(e) => setPrevBilled(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Current Period Completed ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={currentCompleted} 
                onChange={(e) => setCurrentCompleted(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Holdback / Retention (%)</label>
              <input 
                type="number" 
                value={holdbackPercent} 
                onChange={(e) => setHoldbackPercent(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Calculating Billing..." : "Generate Progress Billing Application"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-emerald-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-emerald-400 mb-2">Progress Billing Calculated Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
