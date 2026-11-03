'use client';

import { useEffect, useState } from 'react';
import { money } from '@/lib/estimate-math';

interface CO {
  id: string;
  co_number: number | null;
  project: string | null;
  client_name: string | null;
  status: string | null;
  price: number | null;
  total: number | null;
  invoice_id: string | null;
}

const STATUS_COLOR: Record<string, string> = { Draft: 'text-slate-300', Sent: 'text-amber-400', Approved: 'text-emerald-400', Rejected: 'text-red-400' };

export default function ChangeOrdersPage() {
  const [cos, setCos] = useState<CO[]>([]);
  const [estimates, setEstimates] = useState<{ id: number; projectName: string; clientName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [estimateId, setEstimateId] = useState('');
  const [project, setProject] = useState('');
  const [client, setClient] = useState('');

  useEffect(() => {
    fetch('/api/change-orders').then((r) => r.json()).then((j) => (j.success ? setCos(j.data) : setError(j.error))).catch(() => setError('Could not load change orders.')).finally(() => setLoading(false));
    fetch('/api/estimates').then((r) => r.json()).then((j) => j.success && setEstimates(j.data)).catch(() => {});
  }, []);

  function pickEstimate(id: string) {
    setEstimateId(id);
    const e = estimates.find((x) => String(x.id) === id);
    if (e) { setProject(e.projectName || ''); setClient(e.clientName || ''); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/change-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, client_name: client, estimate_id: estimateId || null }) })
      .then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (res.success) window.location.href = `/change-orders/${res.data.id}`;
    else setError(res.error);
  }

  const approvedUnbilled = cos.filter((c) => c.status === 'Approved' && !c.invoice_id).reduce((s, c) => s + Number(c.price || 0), 0);
  const input = 'bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Change Orders</h1>
            <p className="text-slate-400 mt-1">Price extra work, get the client&apos;s signature, then bill it on an invoice.</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-3">
            <p className="text-xs uppercase tracking-wider text-slate-400">Approved, not yet invoiced</p>
            <p className="text-2xl font-bold text-emerald-400">{money(approvedUnbilled)}</p>
          </div>
        </div>

        <form onSubmit={create} className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select value={estimateId} onChange={(e) => pickEstimate(e.target.value)} className={input} aria-label="From estimate">
            <option value="">No linked estimate</option>
            {estimates.map((e) => <option key={e.id} value={e.id}>#{e.id} {e.projectName}</option>)}
          </select>
          <input required placeholder="Project / job" value={project} onChange={(e) => setProject(e.target.value)} className={input} aria-label="Project" />
          <input placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} className={input} aria-label="Client" />
          <button className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">+ New Change Order</button>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                <th className="p-4">CO #</th><th className="p-4">Project</th><th className="p-4">Client</th><th className="p-4">Status</th><th className="p-4 text-right">Price</th><th className="p-4">Billing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">Loading…</td></tr>
              ) : cos.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">No change orders yet.</td></tr>
              ) : cos.map((c) => (
                <tr key={c.id} onClick={() => (window.location.href = `/change-orders/${c.id}`)} className="hover:bg-slate-800/50 cursor-pointer">
                  <td className="p-4 text-white font-medium"><a href={`/change-orders/${c.id}`}>#{c.co_number ?? '—'}</a></td>
                  <td className="p-4 text-slate-300">{c.project}</td>
                  <td className="p-4 text-slate-300">{c.client_name || '—'}</td>
                  <td className={`p-4 ${STATUS_COLOR[c.status || 'Draft'] || 'text-slate-300'}`}>{c.status || 'Draft'}</td>
                  <td className="p-4 text-slate-300 text-right">{money(Number(c.price || 0))}</td>
                  <td className="p-4 text-slate-400">{c.invoice_id ? 'Invoiced' : c.status === 'Approved' ? 'Ready to bill' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
