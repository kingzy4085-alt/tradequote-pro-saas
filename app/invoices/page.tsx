'use client';

import { useEffect, useState } from 'react';
import { money } from '@/lib/estimate-math';

interface Invoice {
  id: string;
  invoice_number: number | null;
  project: string | null;
  client_name: string | null;
  issue_date: string | null;
  due_date: string | null;
  status: string | null;
  total: number | null;
}

const today = () => new Date().toLocaleDateString('en-CA');

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [estimates, setEstimates] = useState<{ id: number; projectName: string; clientName: string; clientAddress?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');
  const [project, setProject] = useState('');
  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');

  useEffect(() => {
    fetch('/api/invoices').then((r) => r.json()).then((j) => (j.success ? setInvoices(j.data) : setError(j.error))).catch(() => setError('Could not load invoices.')).finally(() => setLoading(false));
    fetch('/api/estimates').then((r) => r.json()).then((j) => j.success && setEstimates(j.data)).catch(() => {});
  }, []);

  function pickEstimate(id: string) {
    const e = estimates.find((x) => String(x.id) === id);
    if (e) { setProject(e.projectName || ''); setClient(e.clientName || ''); setAddress(e.clientAddress || ''); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, client_name: client, client_address: address }) })
      .then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (res.success) window.location.href = `/invoices/${res.data.id}`;
    else setError(res.error);
  }

  const overdue = (i: Invoice) => i.status === 'Sent' && !!i.due_date && i.due_date < today();
  const outstanding = invoices.filter((i) => i.status === 'Sent').reduce((s, i) => s + Number(i.total || 0), 0);
  const overdueAmt = invoices.filter(overdue).reduce((s, i) => s + Number(i.total || 0), 0);
  const shown = invoices.filter((i) => filter === 'All' || (filter === 'Overdue' ? overdue(i) : i.status === filter));
  const input = 'bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Invoices</h1>
            <p className="text-slate-400 mt-1">Progress bills against your estimates, approved change orders, and anything else, with holdback and tax.</p>
          </div>
          <div className="flex gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-3"><p className="text-xs uppercase tracking-wider text-slate-400">Owed to you</p><p className="text-2xl font-bold text-white">{money(outstanding)}</p></div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-3"><p className="text-xs uppercase tracking-wider text-slate-400">Overdue</p><p className={`text-2xl font-bold ${overdueAmt ? 'text-red-400' : 'text-white'}`}>{money(overdueAmt)}</p></div>
          </div>
        </div>

        <form onSubmit={create} className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select defaultValue="" onChange={(e) => pickEstimate(e.target.value)} className={input} aria-label="Fill from estimate">
            <option value="">Fill from estimate…</option>
            {estimates.map((e) => <option key={e.id} value={e.id}>#{e.id} {e.projectName}</option>)}
          </select>
          <input required placeholder="Project / job" value={project} onChange={(e) => setProject(e.target.value)} className={input} aria-label="Project" />
          <input placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} className={input} aria-label="Client" />
          <input placeholder="Client address" value={address} onChange={(e) => setAddress(e.target.value)} className={input} aria-label="Client address" />
          <button className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">+ New Invoice</button>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          {['All', 'Draft', 'Sent', 'Overdue', 'Paid'].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === f ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400 hover:text-white'}`}>{f}</button>
          ))}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                <th className="p-4">Invoice #</th><th className="p-4">Project</th><th className="p-4">Client</th><th className="p-4">Issued</th><th className="p-4">Due</th><th className="p-4">Status</th><th className="p-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Loading…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">No invoices here.</td></tr>
              ) : shown.map((i) => (
                <tr key={i.id} onClick={() => (window.location.href = `/invoices/${i.id}`)} className="hover:bg-slate-800/50 cursor-pointer">
                  <td className="p-4 text-white font-medium"><a href={`/invoices/${i.id}`}>{i.invoice_number ?? '—'}</a></td>
                  <td className="p-4 text-slate-300">{i.project}</td>
                  <td className="p-4 text-slate-300">{i.client_name || '—'}</td>
                  <td className="p-4 text-slate-400">{i.issue_date}</td>
                  <td className="p-4 text-slate-400">{i.due_date}</td>
                  <td className={`p-4 ${overdue(i) ? 'text-red-400' : i.status === 'Paid' ? 'text-emerald-400' : i.status === 'Sent' ? 'text-amber-400' : 'text-slate-300'}`}>{overdue(i) ? 'Overdue' : i.status || 'Draft'}</td>
                  <td className="p-4 text-slate-300 text-right">{money(Number(i.total || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
