'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function Page() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('Active');

  useEffect(() => {
    fetchItems();
  }, []);

  async function fetchItems() {
    try {
      const res = await fetch('/api/site-vault');
      const json = await res.json();
      setItems(json.data || []);
    } catch (err) {
      console.error('Failed to fetch site-vault', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    try {
      const res = await fetch('/api/site-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, title: name, status })
      });
      const json = await res.json();
      if (json.success) {
        setName('');
        fetchItems();
      }
    } catch (err) {
      console.error('Failed to create record', err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch('/api/site-vault/' + id, { method: 'DELETE' });
      fetchItems();
    } catch (err) {
      console.error('Failed to delete record', err);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <Link href="/" className="text-xs font-semibold text-amber-500 hover:underline uppercase tracking-wider">← Back to Command Center</Link>
            <h1 className="text-3xl font-bold tracking-tight text-white mt-1">Site Vault Management</h1>
          </div>
        </div>

        {/* Create Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8">
          <h2 className="text-lg font-bold text-white mb-4">Add New Record</h2>
          <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              placeholder="Record Name / Title..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500"
            >
              <option value="Active">Active</option>
              <option value="Pending">Pending</option>
              <option value="Completed">Completed</option>
            </select>
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-6 py-3 rounded-xl transition-colors"
            >
              Add Record
            </button>
          </form>
        </div>

        {/* Data Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-6 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white">Records ({items.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="p-4">ID / Name</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Created Date</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-sm">
                {loading ? (
                  <tr><td colSpan={4} className="p-6 text-center text-slate-500">Loading records...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-slate-500">No records found. Add one above.</td></tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/50">
                      <td className="p-4 font-medium text-white">{item.name || item.title || 'Untitled'}</td>
                      <td className="p-4">
                        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-full text-xs font-semibold">
                          {item.status || 'Active'}
                        </span>
                      </td>
                      <td className="p-4 text-slate-400">{new Date(item.created_at || Date.now()).toLocaleDateString()}</td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}