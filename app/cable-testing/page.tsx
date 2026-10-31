"use client";

import { useState } from "react";

export default function CableTestingPage() {
  const [cableId, setCableId] = useState("FEEDER-4160V-M1");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [fromLocation, setFromLocation] = useState("Main 4160V Switchgear (Cubicle 4)");
  const [toLocation, setToLocation] = useState("Primary Crusher Motor Drive");
  const [cableSpec, setCableSpec] = useState("3/C #2/0 AWG TECK90 5kV");
  const [pullLengthFt, setPullLengthFt] = useState(245);
  const [meggerVoltage, setMeggerVoltage] = useState("2500V DC");
  const [insulationResistanceMohm, setInsulationResistanceMohm] = useState(450);
  const [testedBy, setTestedBy] = useState("Kyle Ingalls (4th-Year Electrical Apprentice)");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/cable-testing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cableId, projectName, fromLocation, toLocation, cableSpec, pullLengthFt, meggerVoltage, insulationResistanceMohm, testedBy })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Cable Pulling & Megger Insulation Testing</h1>
        <p className="text-slate-400 mb-8">Record cable pull runs, conduit lengths, and high-voltage insulation resistance (Megger IR) test records.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Cable Tag / ID</label>
              <input 
                type="text" 
                value={cableId} 
                onChange={(e) => setCableId(e.target.value)}
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
              <label className="block text-sm font-medium text-slate-300 mb-1">From Location (Source)</label>
              <input 
                type="text" 
                value={fromLocation} 
                onChange={(e) => setFromLocation(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">To Location (Destination)</label>
              <input 
                type="text" 
                value={toLocation} 
                onChange={(e) => setToLocation(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Cable Specification</label>
              <input 
                type="text" 
                value={cableSpec} 
                onChange={(e) => setCableSpec(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm font-mono"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Pull Length (ft)</label>
              <input 
                type="number" 
                value={pullLengthFt} 
                onChange={(e) => setPullLengthFt(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Megger Test Voltage</label>
              <select 
                value={meggerVoltage} 
                onChange={(e) => setMeggerVoltage(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              >
                <option value="500V DC">500V DC</option>
                <option value="1000V DC">1000V DC</option>
                <option value="2500V DC">2500V DC</option>
                <option value="5000V DC">5000V DC</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Insulation Resistance (MΩ)</label>
              <input 
                type="number" 
                step="0.1"
                value={insulationResistanceMohm} 
                onChange={(e) => setInsulationResistanceMohm(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Tested By / Electrical Inspector</label>
            <input 
              type="text" 
              value={testedBy} 
              onChange={(e) => setTestedBy(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Recording Test..." : "Save Cable Pull & Megger Test Record"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-cyan-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-cyan-400 mb-2">Cable Test Record Saved Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
