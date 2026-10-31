'use client';

import { useState, useEffect } from 'react';

interface JobCost {
  id: string;
  projectName: string;
  clientName: string;
  contractValue: number;
  laborCost: number;
  materialCost: number;
  equipmentCost: number;
  created_at: string;
}

export default function JobCostingPage() {
  const [jobs, setJobs] = useState<JobCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [clientName, setClientName] = useState('');
  const [contractValue, setContractValue] = useState('50000');
  const [laborCost, setLaborCost] = useState('18000');
  const [materialCost, setMaterialCost] = useState('12000');
  const [equipmentCost, setEquipmentCost] = useState('5000');

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/job-costing');
      const json = await res.json();
      if (json.success) {
        setJobs(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch job costs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/job-costing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          projectName, 
          clientName, 
          contractValue: Number(contractValue),
          laborCost: Number(laborCost),
          materialCost: Number(materialCost),
          equipmentCost: Number(equipmentCost)
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setProjectName('');
        setClientName('');
        setContractValue('50000');
        setLaborCost('18000');
        setMaterialCost('12000');
        setEquipmentCost('5000');
        fetchJobs();
      }
    } catch (err) {
      console.error('Failed to create job cost record', err);
    }
  };

  const filteredJobs = jobs.filter(job => 
    job.projectName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    job.clientName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Job Costing & Profit Margins</h1>
            <p className="text-slate-400 mt-1">Track live labor, material, and equipment expenses against contract values.</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg shadow transition-colors flex items-center gap-2"
          >
            + New Job Costing Record
          </button>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search projects or clients..."
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
                  <th className="p-4">Contract Value</th>
                  <th className="p-4">Total Expenses</th>
                  <th className="p-4">Net Profit</th>
                  <th className="p-4">Margin (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">Loading job costing data...</td>
                  </tr>
                ) : filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">No active job costing records found. Add one above!</td>
                  </tr>
                ) : (
                  filteredJobs.map((job) => {
                    const contract = Number(job.contractValue || 0);
                    const labor = Number(job.laborCost || 0);
                    const material = Number(job.materialCost || 0);
                    const equipment = Number(job.equipmentCost || 0);
                    const totalExpenses = labor + material + equipment;
                    const netProfit = contract - totalExpenses;
                    const margin = contract > 0 ? ((netProfit / contract) * 100).toFixed(1) : '0';
                    const isHealthy = Number(margin) >= 20;

                    return (
                      <tr key={job.id || Math.random()} className="hover:bg-slate-850/50 transition-colors">
                        <td className="p-4 font-medium text-white">{job.projectName || 'Untitled Project'}</td>
                        <td className="p-4 text-slate-300">{job.clientName || 'N/A'}</td>
                        <td className="p-4 text-slate-200">${contract.toLocaleString()}</td>
                        <td className="p-4 text-amber-400">${totalExpenses.toLocaleString()}</td>
                        <td className="p-4 text-emerald-400 font-semibold">${netProfit.toLocaleString()}</td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${isHealthy ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                            {margin}%
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-4">New Job Costing Record</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Project Name</label>
                  <input
                    type="text"
                    required
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g. Canola Plant Shutdown Phase 2"
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
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Contract Value ($)</label>
                  <input
                    type="number"
                    required
                    value={contractValue}
                    onChange={(e) => setContractValue(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Labor Cost ($)</label>
                    <input
                      type="number"
                      required
                      value={laborCost}
                      onChange={(e) => setLaborCost(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Material ($)</label>
                    <input
                      type="number"
                      required
                      value={materialCost}
                      onChange={(e) => setMaterialCost(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Equipment ($)</label>
                    <input
                      type="number"
                      required
                      value={equipmentCost}
                      onChange={(e) => setEquipmentCost(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 text-sm"
                    />
                  </div>
                </div>
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
                    Save Job Record
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
