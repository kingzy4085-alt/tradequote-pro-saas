"use client";

import { useState } from "react";

export default function WarrantyPage() {
  const [equipmentName, setEquipmentName] = useState("Main 400A Distribution Switchgear");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [supplier, setSupplier] = useState("Schneider Electric Canada");
  const [warrantyMonths, setWarrantyMonths] = useState(24);
  const [installationDate, setInstallationDate] = useState(new Date().toISOString().split("T")[0]);
  const [contactPerson, setContactPerson] = useState("Service Support: 1-800-555-SERV");
  const [notes, setNotes] = useState("Includes full parts and labor replacement warranty against manufacturer defects.");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/warranty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipmentName, projectName, supplier, warrantyMonths, installationDate, contactPerson, notes })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Warranty & Maintenance Service Tracking</h1>
        <p className="text-slate-400 mb-8">Register equipment warranties, track coverage periods, and manage service support contacts.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Equipment / System Name</label>
              <input 
                type="text" 
                value={equipmentName} 
                onChange={(e) => setEquipmentName(e.target.value)}
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
              <label className="block text-sm font-medium text-slate-300 mb-1">Manufacturer / Supplier</label>
              <input 
                type="text" 
                value={supplier} 
                onChange={(e) => setSupplier(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Warranty Term (Months)</label>
              <input 
                type="number" 
                value={warrantyMonths} 
                onChange={(e) => setWarrantyMonths(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Installation Date</label>
              <input 
                type="date" 
                value={installationDate} 
                onChange={(e) => setInstallationDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Manufacturer Support Contact / Phone</label>
            <input 
              type="text" 
              value={contactPerson} 
              onChange={(e) => setContactPerson(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm font-mono"
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Warranty Coverage Notes & Terms</label>
            <textarea 
              rows={3}
              value={notes} 
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Registering Warranty..." : "Register Equipment Warranty"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-blue-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-blue-400 mb-2">Warranty Registered Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
