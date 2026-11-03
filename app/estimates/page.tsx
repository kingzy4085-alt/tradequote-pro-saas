'use client';

import { useState, useEffect } from 'react';
import { money } from '@/lib/estimate-math';

interface Estimate {
  id: string;
  projectName: string;
  clientName: string;
  markupPercentage: number;
  total_bid: number | null;
  status: string | null;
  created_at: string;
}

export default function EstimatesPage() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [clientName, setClientName] = useState('');
  const [markupPercentage, setMarkupPercentage] = useState('15');
  const [companyDefaults, setCompanyDefaults] = useState<any>({});
  const [error, setError] = useState('');

  const fetchEstimates = async () => {
    try {
      const res = await fetch('/api/estimates');
      const json = await res.json();
      if (json.success) {
        setEstimates(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch estimates', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEstimates();
    // Start new estimates from the default markup saved in Settings
    fetch('/api/company').then((r) => r.json()).then((j) => {
      if (j.data) setCompanyDefaults(j.data);
      if (j.data?.default_markup != null) setMarkupPercentage(String(j.data.default_markup));
    }).catch(() => {});
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName,
          clientName,
          markupPercentage: Number(markupPercentage),
          taxPercentage: Number(companyDefaults.default_tax ?? 5),
          labourRate: Number(companyDefaults.default_labour_rate ?? 0),
        }),
      });
      const json = await res.json();
      if (json.success) window.location.href = `/estimates/${json.data.id}`;
      else setError(json.error || 'Could not save the estimate.');
    } catch (err) {
      console.error('Failed to create estimate', err);
    }
  };

  const filteredEstimates = estimates.filter(est => 
    est.projectName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    est.clientName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Estimates & Bidding</h1>
            <p className="text-slate-400 mt-1">Manage industrial shutdowns, electrical projects, and client bids.</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg shadow transition-colors flex items-center gap-2"
          >
            + New Estimate
          </button>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search estimates by project or client..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full md:w-96 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        {/* Data Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="p-4">Project Name</th>
                  <th className="p-4">Client</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Total</th>
                  <th className="p-4">Created Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">Loading estimates...</td>
                  </tr>
                ) : filteredEstimates.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">No estimates found. Create your first one above!</td>
                  </tr>
                ) : (
                  filteredEstimates.map((est) => (
                    <tr key={est.id} onClick={() => (window.location.href = `/estimates/${est.id}`)} className="hover:bg-slate-800/50 transition-colors cursor-pointer">
                      <td className="p-4 font-medium text-white"><a href={`/estimates/${est.id}`}>{est.projectName || 'Untitled Project'}</a></td>
                      <td className="p-4 text-slate-300">{est.clientName || 'N/A'}</td>
                      <td className="p-4 text-slate-300">{est.status || 'Draft'}</td>
                      <td className="p-4 text-slate-300 text-right">{est.total_bid != null ? money(Number(est.total_bid)) : '—'}</td>
                      <td className="p-4 text-slate-400 text-sm">{est.created_at ? new Date(est.created_at).toLocaleDateString() : 'Just now'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-4">Create New Estimate</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Project Name</label>
                  <input
                    type="text"
                    required
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g. Canola Plant Shutdown Maintenance"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Client Name</label>
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Cargill Ltd."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Markup Percentage (%)</label>
                  <input
                    type="number"
                    required
                    value={markupPercentage}
                    onChange={(e) => setMarkupPercentage(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2 rounded-lg transition-colors"
                  >
                    Save Estimate
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
