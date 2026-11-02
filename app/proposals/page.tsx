"use client";

import { useState } from "react";

export default function ProposalsPage() {
  const [proposalTitle, setProposalTitle] = useState("Industrial Shutdown Maintenance & Panel Upgrades");
  const [clientName, setClientName] = useState("Cargill Ltd.");
  const [totalAmount, setTotalAmount] = useState(14500.00);
  const [scopeOfWork, setScopeOfWork] = useState("Complete electrical service run, breaker tie-in, and full safety delineation verification during shutdown window.");
  const [terms, setTerms] = useState("50% deposit required upon signing. Net 30 days upon project completion.");
  const [clientSignature, setClientSignature] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalTitle, clientName, totalAmount, scopeOfWork, terms, clientSignature })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Digital Proposals</h1>
        <p className="text-slate-400 mb-8">Generate professional client proposals with terms and digital signature authorization.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Proposal Title</label>
              <input 
                type="text" 
                value={proposalTitle} 
                onChange={(e) => setProposalTitle(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Client Name</label>
              <input 
                type="text" 
                value={clientName} 
                onChange={(e) => setClientName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Total Amount ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={totalAmount} 
                onChange={(e) => setTotalAmount(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Client Digital Signature (Type Full Name)</label>
              <input 
                type="text" 
                value={clientSignature} 
                onChange={(e) => setClientSignature(e.target.value)}
                placeholder="e.g., John Doe (Authorized Representative)"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-serif italic focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Scope of Work</label>
            <textarea 
              rows={3}
              value={scopeOfWork} 
              onChange={(e) => setScopeOfWork(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Terms & Conditions</label>
            <textarea 
              rows={3}
              value={terms} 
              onChange={(e) => setTerms(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Publishing Proposal..." : "Publish & Issue Proposal"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-blue-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-blue-400 mb-2">Proposal Issued Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
