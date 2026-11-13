"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EstimatesHubPage() {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [markupPct, setMarkupPct] = useState("25");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSaveEstimate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const response = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_name: projectName,
          client_name: clientName,
          markup_pct: Number(markupPct),
          status: "Draft",
          created_at: new Date().toISOString()
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save estimate to database.");
      }

      router.push("/estimates/new");
    } catch (err: any) {
      console.error("Failed to save estimate", err);
      setErrorMsg(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 p-6 lg:p-12 text-slate-100">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Estimates & Bidding Hub</h1>
            <p className="text-slate-400 text-sm mt-1">Manage industrial shutdowns, plant maintenance, and contractor proposals.</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold px-5 py-2.5 rounded-lg text-sm transition-all shadow-lg flex items-center gap-2"
          >
            + New Estimate
          </button>
        </div>

        {/* Empty State / Grid */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center space-y-4">
          <h3 className="text-lg font-semibold text-slate-200">Industrial Estimating Pipeline</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Create high-precision industrial shutdown or motor hookup estimates linked directly to your Supabase CRM.
          </p>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold px-6 py-2 rounded-lg text-sm transition-all"
          >
            Launch Estimating Engine
          </button>
        </div>

        {/* Modal Dialog */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <h2 className="text-xl font-bold text-white">Create New Estimate</h2>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-400 hover:text-white text-sm font-semibold"
                >
                  ✕
                </button>
              </div>

              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm">
                  <strong>Error:</strong> {errorMsg}
                </div>
              )}

              <form onSubmit={handleSaveEstimate} className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1.5">Project Name</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Canola Plant Shutdown Maintenance" 
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-amber-400 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1.5">Client Name</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Cargill Ltd." 
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-amber-400 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1.5">Target Markup Percentage (%)</label>
                  <input 
                    type="number" 
                    required
                    value={markupPct}
                    onChange={(e) => setMarkupPct(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-amber-400 text-sm"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium px-4 py-2 rounded-lg text-sm transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={loading}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm transition-all shadow-lg"
                  >
                    {loading ? "Saving to CRM..." : "Save & Open Estimator"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
