'use client';

import { useState, useEffect } from 'react';

interface DailyLog {
  id: string;
  projectName: string;
  supervisorName: string;
  weatherConditions: string;
  workPerformed: string;
  safetyIncidents: string;
  created_at: string;
}

export default function DailyLogsPage() {
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [supervisorName, setSupervisorName] = useState('');
  const [weatherConditions, setWeatherConditions] = useState('Clear, +15°C');
  const [workPerformed, setWorkPerformed] = useState('');
  const [safetyIncidents, setSafetyIncidents] = useState('None');

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/daily-logs');
      const json = await res.json();
      if (json.success) {
        setLogs(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch daily logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/daily-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          projectName, 
          supervisorName, 
          weatherConditions, 
          workPerformed,
          safetyIncidents
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setProjectName('');
        setSupervisorName('');
        setWeatherConditions('Clear, +15°C');
        setWorkPerformed('');
        setSafetyIncidents('None');
        fetchLogs();
      }
    } catch (err) {
      console.error('Failed to create daily log', err);
    }
  };

  const filteredLogs = logs.filter(log => 
    log.projectName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.supervisorName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.workPerformed?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Daily Field Logs</h1>
            <p className="text-slate-400 mt-1">Record site progress, workforce activity, weather conditions, and safety updates.</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg shadow transition-colors flex items-center gap-2"
          >
            + New Daily Log
          </button>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search logs by project, supervisor, or work performed..."
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
                  <th className="p-4">Supervisor</th>
                  <th className="p-4">Weather</th>
                  <th className="p-4">Work Performed</th>
                  <th className="p-4">Safety Incidents</th>
                  <th className="p-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">Loading daily logs...</td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">No daily logs found. Create your first one above!</td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id || Math.random()} className="hover:bg-slate-850/50 transition-colors">
                      <td className="p-4 font-medium text-white">{log.projectName || 'Untitled Project'}</td>
                      <td className="p-4 text-slate-300">{log.supervisorName || 'N/A'}</td>
                      <td className="p-4 text-slate-300 text-sm">{log.weatherConditions || 'N/A'}</td>
                      <td className="p-4 text-slate-300 truncate max-w-xs">{log.workPerformed || 'No details provided.'}</td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${log.safetyIncidents && log.safetyIncidents.toLowerCase() !== 'none' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                          {log.safetyIncidents || 'None'}
                        </span>
                      </td>
                      <td className="p-4 text-slate-400 text-sm">{log.created_at ? new Date(log.created_at).toLocaleDateString() : 'Just now'}</td>
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
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-4">Create New Daily Log</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Project Name</label>
                  <input
                    type="text"
                    required
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g. Canola Plant Shutdown Phase 1"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Supervisor Name</label>
                  <input
                    type="text"
                    required
                    value={supervisorName}
                    onChange={(e) => setSupervisorName(e.target.value)}
                    placeholder="e.g. Kyle Ingalls"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Weather Conditions</label>
                  <input
                    type="text"
                    required
                    value={weatherConditions}
                    onChange={(e) => setWeatherConditions(e.target.value)}
                    placeholder="e.g. Clear, +12°C, Wind NW 15km/h"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Work Performed</label>
                  <textarea
                    rows={3}
                    required
                    value={workPerformed}
                    onChange={(e) => setWorkPerformed(e.target.value)}
                    placeholder="Detail work completed, equipment maintained, or circuits tested..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Safety Incidents</label>
                  <input
                    type="text"
                    required
                    value={safetyIncidents}
                    onChange={(e) => setSafetyIncidents(e.target.value)}
                    placeholder="e.g. None / Toolbox talk completed"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
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
                    Save Daily Log
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
