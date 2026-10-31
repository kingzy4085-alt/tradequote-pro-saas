"use client";

import { useState } from "react";

export default function RfqPage() {
  const [rfqTitle, setRfqTitle] = useState("Shutdown Material Package - TECK90 & Breakers");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [supplierName, setSupplierName] = useState("Gescan Electrical Wholesale");
  const [materialList, setMaterialList] = useState("1. 500m 3/C #2/0 AWG TECK90\n2. (2) 400A NEMA 4X Disconnects\n3. (10) 60A 3P Breakers");
  const [targetBudget, setTargetBudget] = useState(12500.00);
  const [responseDeadline, setResponseDeadline] = useState(new Date(Date.now() + 5 * 86400000).toISOString().split("T")[0]);
  const [notes, notesSet] = useState("Please itemize freight charges and confirm stock availability prior to shutdown start date.");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/rfq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfqTitle, projectName, supplierName, materialList, targetBudget, responseDeadline, notes })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Supplier RFQ & Material Bidding</h1>
        <p className="text-slate-400 mb-8">Issue material quotation requests to electrical wholesalers and track supplier bids.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">RFQ Title / Package Name</label>
              <input 
                type="text" 
                value={rfqTitle} 
                onChange={(e) => setRfqTitle(e.target.value)}
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
              <label className="block text-sm font-medium text-slate-300 mb-1">Supplier / Wholesaler</label>
              <input 
                type="text" 
                value={supplierName} 
                onChange={(e) => setSupplierName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Target Budget ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={targetBudget} 
                onChange={(e) => setTargetBudget(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Response Deadline</label>
              <input 
                type="date" 
                value={responseDeadline} 
                onChange={(e) => setResponseDeadline(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Itemized Material List & Quantities</label>
            <textarea 
              rows={4}
              value={materialList} 
              onChange={(e) => setMaterialList(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Special Instructions & Delivery Notes</label>
            <textarea 
              rows={2}
              value={notes} 
              onChange={(e) => notesSet(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Issuing RFQ..." : "Send Request for Quotation (RFQ) to Supplier"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-emerald-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-emerald-400 mb-2">Supplier RFQ Issued Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
