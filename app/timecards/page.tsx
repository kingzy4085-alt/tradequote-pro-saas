'use client';

import { useState, useEffect } from 'react';

interface RecordItem {
  id: string;
  title?: string;
  name?: string;
  status?: string;
  created_at?: string;
}

export default function Page() {
  const [items, setItems] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [recordName, setRecordName] = useState('');
  const [status, setStatus] = useState('Active');

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/timecards');
      const json = await res.json();
      if (json.success) {
        setItems(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch Timecards records', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/timecards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: recordName, status }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setRecordName('');
        setStatus('Active');
        fetchItems();
      }
    } catch (err) {
      console.error('Failed to create Timecards record', err);
    }
  };

  const filteredItems = items.filter(item =>
    (item.name || item.title || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Timecards Module</h1>
            <p className="text-slate-400 mt-1">Manage industrial Timecards logs, compliance records, and site documentation.</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg shadow transition-colors"
          >
            + New Timecards Record
          </button>
        </div>

        <div className="mb-6">
          <input
            type="text"
            placeholder="Search records..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full md:w-96 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="p-4">Record Name / Title</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Created Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr><td colSpan={3} className="p-8 text-center text-slate-500">Loading records...</td></tr>
                ) : filteredItems.length === 0 ? (
                  <tr><td colSpan={3} className="p-8 text-center text-slate-500">No records found. Create your first one above!</td></tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id || Math.random()} className="hover:bg-slate-850/50 transition-colors">
                      <td className="p-4 font-medium text-white">{item.name || item.title || 'Untitled Record'}</td>
                      <td className="p-4">
                        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25">
                          {item.status || 'Active'}
                        </span>
                      </td>
                      <td className="p-4 text-slate-400 text-sm">{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Just now'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-4">Create New Timecards Record</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Record Title / Name</label>
                  <input type="text" required value={recordName} onChange={(e) => setRecordName(e.target.value)} placeholder="e.g. Substation Inspection Phase 1" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-amber-500" />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button type="button" onClick={() => setShowModal(false)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg transition-colors">Cancel</button>
                  <button type="submit" className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2 rounded-lg transition-colors">Save Record</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
