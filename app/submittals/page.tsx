"use client";

import { useState } from "react";

export default function SubmittalsPage() {
  const [submittalTitle, setSubmittalTitle] = useState("400A Industrial Disconnect Switch Cut Sheets");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [specSection, setSpecSection] = useState("Div 26 - Electrical Distribution");
  const [supplier, setSupplier] = useState("Schneider Electric / Gescan");
  const [documentUrl, setDocumentUrl] = useState("schneider-400a-disconnect-spec.pdf");
  const [notes, notesSet] = useState("Meets NEMA 4X rating requirements for corrosive canola processing environment.");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/submittals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submittalTitle, projectName, specSection, supplier, documentUrl, notes })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Material Submittals & Equipment Approvals</h1>
        <p className="text-slate-400 mb-8">Submit equipment specifications, cut sheets, and manufacturer data for engineering approval.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Submittal Title / Equipment</label>
              <input 
                type="text" 
                value={submittalTitle} 
                onChange={(e) => setSubmittalTitle(e.target.value)}
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
              <label className="block text-sm font-medium text-slate-300 mb-1">Specification Section</label>
              <input 
                type="text" 
                value={specSection} 
                onChange={(e) => setSpecSection(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Supplier / Manufacturer</label>
              <input 
                type="text" 
                value={supplier} 
                onChange={(e) => setSupplier(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Document File Name</label>
              <input 
                type="text" 
                value={documentUrl} 
                onChange={(e) => setDocumentUrl(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 font-mono text-sm"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Submittal Notes & Compliance Details</label>
            <textarea 
              rows={3}
              value={notes} 
              onChange={(e) => notesSet(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Submitting Cut Sheet..." : "Submit Material Submittal for Approval"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-indigo-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-indigo-400 mb-2">Material Submittal Created Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
