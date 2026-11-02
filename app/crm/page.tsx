"use client";

import { useState } from "react";

export default function CrmPage() {
  const [clientName, setClientName] = useState("Cargill Ltd.");
  const [contactPerson, setContactPerson] = useState("Plant Maintenance Supervisor");
  const [phone, setPhone] = useState("(306) 555-0198");
  const [email, setEmail] = useState("maintenance@cargill-sk.example");
  const [projectSite, setProjectSite] = useState("Canola Crushing Facility, Moose Jaw Region");
  const [status, setStatus] = useState("Active Shutdown");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, contactPerson, phone, email, projectSite, status })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Client & Project Directory CRM</h1>
        <p className="text-slate-400 mb-8">Manage commercial and industrial client accounts, site locations, and project statuses.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Client Company Name</label>
              <input 
                type="text" 
                value={clientName} 
                onChange={(e) => setClientName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Primary Contact / Role</label>
              <input 
                type="text" 
                value={contactPerson} 
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Phone Number</label>
              <input 
                type="text" 
                value={phone} 
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500 font-mono text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Email Address</label>
              <input 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500 font-mono text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Project Status</label>
              <select 
                value={status} 
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
              >
                <option value="Active Shutdown">Active Shutdown</option>
                <option value="Pending Estimate">Pending Estimate</option>
                <option value="Proposal Issued">Proposal Issued</option>
                <option value="Project Completed">Project Completed</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Project Site Location</label>
            <input 
              type="text" 
              value={projectSite} 
              onChange={(e) => setProjectSite(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-amber-500"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Saving Client..." : "Save Client & Project Record"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-emerald-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-emerald-400 mb-2">{result?.success === false ? 'Save failed: ' + result.error : 'Client Saved Successfully!'}</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
