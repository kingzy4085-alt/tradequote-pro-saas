"use client";

import { useState } from "react";

export default function PunchListPage() {
  const [itemTitle, setItemTitle] = useState("Label Main 4160V Switchgear Breakers");
  const [projectName, setProjectName] = useState("Cargill Canola Plant Shutdown");
  const [assignedTrade, setAssignedTrade] = useState("Electrical Crew A");
  const [priority, setPriority] = useState("High");
  const [location, locationSet] = useState("Electrical Room 3B");
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0]);
  const [description, setDescription] = useState("Engrave and affix phenolic warning labels on all newly installed breaker compartments per ESA standards.");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/punch-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemTitle, projectName, assignedTrade, priority, location, dueDate, description })
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
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Project Punch List & Deficiencies</h1>
        <p className="text-slate-400 mb-8">Track inspection punch items, deficiency corrections, and trade sign-offs.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Punch Item Title</label>
              <input 
                type="text" 
                value={itemTitle} 
                onChange={(e) => setItemTitle(e.target.value)}
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

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Assigned Trade</label>
              <input 
                type="text" 
                value={assignedTrade} 
                onChange={(e) => setAssignedTrade(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Priority</label>
              <select 
                value={priority} 
                onChange={(e) => setPriority(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="Normal">Normal</option>
                <option value="High">High</option>
                <option value="Critical / Inspection Blocker">Critical / Inspection Blocker</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Location / Area</label>
              <input 
                type="text" 
                value={location} 
                onChange={(e) => locationSet(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Target Due Date</label>
              <input 
                type="date" 
                value={dueDate} 
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Deficiency Description & Correction Requirements</label>
            <textarea 
              rows={3}
              value={description} 
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 text-sm"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-rose-600 hover:bg-rose-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Logging Punch Item..." : "Add Punch List Deficiency Item"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-rose-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-rose-400 mb-2">Punch Item Logged Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
