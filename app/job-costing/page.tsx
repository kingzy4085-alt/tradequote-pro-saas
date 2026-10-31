"use client";

import { useState } from "react";

export default function JobCostingPage() {
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [budgetedLabor, setBudgetedLabor] = useState(15000.00);
  const [actualLabor, setActualLabor] = useState(13800.00);
  const [budgetedMaterials, setBudgetedMaterials] = useState(8500.00);
  const [actualMaterials, setActualMaterials] = useState(8900.00);
  const [budgetedEquipment, setBudgetedEquipment] = useState(4500.00);
  const [actualEquipment, setActualEquipment] = useState(4200.00);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/job-costing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, budgetedLabor, actualLabor, budgetedMaterials, actualMaterials, budgetedEquipment, actualEquipment })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Job Costing & Budget Tracking</h1>
        <p className="text-slate-400 mb-8">Compare estimated budgets against actual job costs, labor hours, and equipment expenditures.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
            <div>
              <h3 className="text-sm font-bold uppercase text-slate-400 tracking-wider mb-4">Labor Costs</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Budgeted Labor ($)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={budgetedLabor} 
                    onChange={(e) => setBudgetedLabor(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                    required 
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Actual Labor ($)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={actualLabor} 
                    onChange={(e) => setActualLabor(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                    required 
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold uppercase text-slate-400 tracking-wider mb-4">Material Costs</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Budgeted Materials ($)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={budgetedMaterials} 
                    onChange={(e) => setBudgetedMaterials(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                    required 
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Actual Materials ($)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={actualMaterials} 
                    onChange={(e) => setActualMaterials(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                    required 
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
            <div>
              <h3 className="text-sm font-bold uppercase text-slate-400 tracking-wider mb-4">Equipment Rental Costs</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Budgeted Equipment ($)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={budgetedEquipment} 
                    onChange={(e) => setBudgetedEquipment(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                    required 
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Actual Equipment ($)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={actualEquipment} 
                    onChange={(e) => setActualEquipment(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                    required 
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-end">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-slate-400">
                <span className="block text-slate-200 font-semibold mb-1">Cost Analysis Note:</span>
                Totals are automatically aggregated across labor, materials, and equipment to compute profit margins and real-time project variance.
              </div>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Calculating Job Costing..." : "Calculate Job Costing & Budget Variance"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-emerald-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-emerald-400 mb-2">Job Costing Analysis Computed Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
