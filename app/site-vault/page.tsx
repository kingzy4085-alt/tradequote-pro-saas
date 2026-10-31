"use client";

import { useState } from "react";

export default function SiteVaultPage() {
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [docType, setDocType] = useState("Site Photo");
  const [fileName, setFileName] = useState("panel-upgrade-feeder-run.jpg");
  const [notes, setNotes] = useState("Completed main electrical service run and verified proper delineation.");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/site-vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, docType, fileName, notes })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Job Site Photo & Document Vault</h1>
        <p className="text-slate-400 mb-8">Upload and organize site photos, inspection sheets, and compliance documents.</p>

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
              <label className="block text-sm font-medium text-slate-300 mb-1">Document Type</label>
              <select 
                value={docType} 
                onChange={(e) => setDocType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="Site Photo">Site Photo</option>
                <option value="Safety Form">Safety Observation Form</option>
                <option value="Inspection Certificate">Inspection Certificate</option>
                <option value="Blueprint / Schematic">Blueprint / Schematic</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">File Name / Reference</label>
              <input 
                type="text" 
                value={fileName} 
                onChange={(e) => setFileName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 font-mono text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Observation Notes</label>
              <input 
                type="text" 
                value={notes} 
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Uploading to Vault..." : "Upload File to Project Vault"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-purple-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-purple-400 mb-2">File Uploaded Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
