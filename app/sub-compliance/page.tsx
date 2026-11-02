"use client";

import { useState } from "react";

export default function SubCompliancePage() {
  const [companyName, setCompanyName] = useState("Apex Industrial Insulation & Rigging");
  const [tradeType, setTradeType] = useState("Mechanical Insulation & Lagging");
  const [wcbAccountNumber, setWcbAccountNumber] = useState("WCB-SK-8849201");
  const [generalLiabilityExpiry, setGeneralLiabilityExpiry] = useState("2027-10-31");
  const [safetyCertVerified, setSafetyCertVerified] = useState(true);
  const [contactPerson, setContactPerson] = useState("Dave Miller (Field Superintendent)");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/sub-compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, tradeType, wcbAccountNumber, generalLiabilityExpiry, safetyCertVerified, contactPerson })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Subcontractor Compliance & Insurance</h1>
        <p className="text-slate-400 mb-8">Verify subcontractor WCB standing, liability insurance expiration dates, and safety credentials.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Subcontractor Company Name</label>
              <input 
                type="text" 
                value={companyName} 
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Trade / Service Specialty</label>
              <input 
                type="text" 
                value={tradeType} 
                onChange={(e) => setTradeType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">WCB Account Number</label>
              <input 
                type="text" 
                value={wcbAccountNumber} 
                onChange={(e) => setWcbAccountNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">General Liability Expiry</label>
              <input 
                type="date" 
                value={generalLiabilityExpiry} 
                onChange={(e) => setGeneralLiabilityExpiry(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Primary Contact Person</label>
              <input 
                type="text" 
                value={contactPerson} 
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
          </div>

          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex items-center space-x-3">
            <input 
              type="checkbox" 
              checked={safetyCertVerified} 
              onChange={(e) => setSafetyCertVerified(e.target.checked)}
              className="w-5 h-5 rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm font-medium text-slate-200">
              COR / SECOR Safety Certification and WCB Good Standing Certificate Verified
            </span>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Saving Compliance Record..." : "Verify & Save Subcontractor Compliance"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-emerald-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-emerald-400 mb-2">Compliance Record Saved Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
