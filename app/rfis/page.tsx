"use client";

import { useState } from "react";

export default function RfiPage() {
  const [rfiSubject, setRfiSubject] = useState("Feeder Conduit Routing Conflict near Main Breaker Panel");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [assignedTo, setAssignedTo] = useState("Plant Senior Electrical Engineer");
  const [priority, setPriority] = useState("High");
  const [question, setQuestion] = useState("Existing structural steel I-beam blocks designated 3-inch rigid conduit path. Can we reroute 15 inches to the east?");
  const [proposedSolution, setProposedSolution] = useState("Reroute conduit 15 inches east using two 45-degree elbows with secondary support hangers.");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/rfis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfiSubject, projectName, assignedTo, priority, question, proposedSolution })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — RFI Tracking & Technical Clarifications</h1>
        <p className="text-slate-400 mb-8">Submit and track requests for information with engineers and project managers.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">RFI Subject / Title</label>
              <input 
                type="text" 
                value={rfiSubject} 
                onChange={(e) => setRfiSubject(e.target.value)}
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
              <label className="block text-sm font-medium text-slate-300 mb-1">Assigned To (Recipient)</label>
              <input 
                type="text" 
                value={assignedTo} 
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Priority Level</label>
              <select 
                value={priority} 
                onChange={(e) => setPriority(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="Normal">Normal</option>
                <option value="High">High (Shutdown Critical)</option>
                <option value="Emergency">Emergency</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Status</label>
              <input 
                type="text" 
                value="Open - Pending Review" 
                disabled
                className="w-full bg-slate-900/50 border border-slate-800 rounded-lg p-3 text-slate-400 font-mono text-sm cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Technical Question / Description</label>
            <textarea 
              rows={3}
              value={question} 
              onChange={(e) => setQuestion(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Proposed Contractor Solution</label>
            <textarea 
              rows={3}
              value={proposedSolution} 
              onChange={(e) => setProposedSolution(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Submitting RFI..." : "Submit Request for Information (RFI)"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-cyan-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-cyan-400 mb-2">RFI Submitted Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
