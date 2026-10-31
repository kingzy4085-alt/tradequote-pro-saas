"use client";

import { useState } from "react";

export default function DrawingsPage() {
  const [drawingNumber, setDrawingNumber] = useState("E-104-SLD");
  const [drawingTitle, setDrawingTitle] = useState("Main 4160V One-Line Distribution Diagram");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [revision, setRevision] = useState("Rev B");
  const [discipline, setDiscipline] = useState("Electrical");
  const [fileUrl, setFileUrl] = useState("cargill-4160v-one-line-revB.pdf");
  const [uploadedBy, setUploadedBy] = useState("Kyle Ingalls (4th-Year Electrical Apprentice)");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/drawings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drawingNumber, drawingTitle, projectName, revision, discipline, fileUrl, uploadedBy })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Drawings & Blueprints Management</h1>
        <p className="text-slate-400 mb-8">Manage version-controlled electrical schematics, P&IDs, and structural drawings for industrial shutdowns.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Drawing Number / ID</label>
              <input 
                type="text" 
                value={drawingNumber} 
                onChange={(e) => setDrawingNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Drawing Title</label>
              <input 
                type="text" 
                value={drawingTitle} 
                onChange={(e) => setDrawingTitle(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Project Name</label>
              <input 
                type="text" 
                value={projectName} 
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Revision Tag</label>
              <input 
                type="text" 
                value={revision} 
                onChange={(e) => setRevision(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Discipline</label>
              <select 
                value={discipline} 
                onChange={(e) => setDiscipline(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              >
                <option value="Electrical">Electrical</option>
                <option value="Mechanical">Mechanical</option>
                <option value="Structural">Structural</option>
                <option value="Instrumentation & Controls">Instrumentation & Controls</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">PDF File Name</label>
              <input 
                type="text" 
                value={fileUrl} 
                onChange={(e) => setFileUrl(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Uploaded By</label>
            <input 
              type="text" 
              value={uploadedBy} 
              onChange={(e) => setUploadedBy(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Uploading Drawing..." : "Upload & Register Blueprint Revision"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-purple-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-purple-400 mb-2">Blueprint Revision Registered Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
