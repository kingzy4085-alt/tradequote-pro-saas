"use client";

import { useState } from "react";

export default function LotoPage() {
  const [permitNumber, setPermitNumber] = useState("PTW-LOTO-2026-042");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [equipmentIsolated, setEquipmentIsolated] = useState("Main 4160V Distribution Transformer T-2");
  const [energySource, setEnergySource] = useState("Electrical 4160V 3-Phase Feed + Control Power 120V");
  const [lockNumbers, setLockNumbers] = useState("MasterLock #42, #43, #44 (Red Safety Series)");
  const [authorizedLead, setAuthorizedLead] = useState("Kyle Ingalls (Electrical Lead)");
  const [zeroEnergyVerified, setZeroEnergyVerified] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/loto-permits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permitNumber, projectName, equipmentIsolated, energySource, lockNumbers, authorizedLead, zeroEnergyVerified })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Lockout-Tagout (LOTO) & Permit to Work</h1>
        <p className="text-slate-400 mb-8">Issue energy isolation permits, record safety lock numbers, and verify zero-energy states before work.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Permit Number / ID</label>
              <input 
                type="text" 
                value={permitNumber} 
                onChange={(e) => setPermitNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500"
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Equipment / System Isolated</label>
              <input 
                type="text" 
                value={equipmentIsolated} 
                onChange={(e) => setEquipmentIsolated(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Energy Source Description</label>
              <input 
                type="text" 
                value={energySource} 
                onChange={(e) => setEnergySource(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm font-mono"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Safety Padlock Serial Numbers</label>
              <input 
                type="text" 
                value={lockNumbers} 
                onChange={(e) => setLockNumbers(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm font-mono"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Authorized Lead / Issuer</label>
              <input 
                type="text" 
                value={authorizedLead} 
                onChange={(e) => setAuthorizedLead(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex items-center space-x-3">
            <input 
              type="checkbox" 
              checked={zeroEnergyVerified} 
              onChange={(e) => setZeroEnergyVerified(e.target.checked)}
              className="w-5 h-5 rounded bg-slate-900 border-slate-700 text-rose-600 focus:ring-rose-500"
            />
            <span className="text-sm font-medium text-slate-200">
              Zero Energy State Verified & Tested with Calibrated Multimeter / Voltage Detector
            </span>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-rose-600 hover:bg-rose-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Issuing Permit..." : "Issue LOTO Isolation & Permit to Work"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-rose-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-rose-400 mb-2">LOTO Permit Issued Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
