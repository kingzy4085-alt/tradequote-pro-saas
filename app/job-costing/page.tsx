'use client';

import { Fragment, useEffect, useState } from 'react';
import { money } from '@/lib/estimate-math';

interface Job {
  project: string;
  estimates: number[];
  contract: number;
  change_orders: number;
  budget_material: number;
  budget_labour: number;
  budget_hours: number;
  budget_total: number;
  actual_material: number;
  actual_labour: number;
  actual_hours: number;
  actual_costs: Record<string, number>;
  actual_total: number;
  margin: number;
  margin_pct: number | null;
  cost_used_pct: number | null;
  billed: number;
  paid: number;
}
interface Cost { id: string; project: string; category: string; vendor: string | null; description: string | null; amount: number; cost_date: string }

const today = () => new Date().toLocaleDateString('en-CA');

export default function JobCostingPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [categories, setCategories] = useState<string[]>(['Material']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const [form, setForm] = useState({ project: '', category: 'Material', vendor: '', description: '', amount: '', cost_date: today() });

  const load = () =>
    fetch('/api/job-costing').then((r) => r.json()).then((j) => {
      if (!j.success) return setError(j.error);
      setJobs(j.data.jobs);
      setCosts(j.data.costs);
      setCategories(j.data.categories);
    }).catch(() => setError('Could not load job costs.')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/job-costing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }).then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (!res.success) return setError(res.error);
    setForm({ ...form, vendor: '', description: '', amount: '' });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this cost?')) return;
    const res = await fetch(`/api/job-costing/${id}`, { method: 'DELETE' }).then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (!res.success) return setError(res.error);
    load();
  }

  const totals = jobs.reduce((t, j) => ({ contract: t.contract + j.contract, actual: t.actual + j.actual_total, billed: t.billed + j.billed }), { contract: 0, actual: 0, billed: 0 });
  const input = 'bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 w-full';
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const bar = (pct: number | null) => (
    <div className="h-2 bg-slate-800 rounded-full overflow-hidden w-full">
      <div className={`h-full ${pct == null ? '' : pct > 100 ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct || 0)}%` }} />
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Job Costing</h1>
          <p className="text-slate-400 mt-1">Budget from your estimates and approved change orders, against actual labour from timecards and the costs you log here.</p>
        </div>

        <div className="grid sm:grid-cols-4 gap-4">
          {[['Contract value', money(totals.contract), 'text-white'], ['Actual cost', money(totals.actual), 'text-white'], ['Margin', money(totals.contract - totals.actual), totals.contract - totals.actual < 0 ? 'text-red-400' : 'text-emerald-400'], ['Billed', money(totals.billed), 'text-white']].map(([k, v, c]) => (
            <div key={k} className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-4"><p className="text-xs uppercase tracking-wider text-slate-400">{k}</p><p className={`text-2xl font-bold ${c}`}>{v}</p></div>
          ))}
        </div>

        <form onSubmit={add} className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div className="col-span-2"><label className="text-xs text-slate-400">Project</label><input required list="jobs" value={form.project} onChange={set('project')} className={input} /></div>
          <div><label className="text-xs text-slate-400">Category</label><select value={form.category} onChange={set('category')} className={input}>{categories.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="text-xs text-slate-400">Amount $</label><input required type="number" step="any" value={form.amount} onChange={set('amount')} className={input} /></div>
          <div className="col-span-2"><label className="text-xs text-slate-400">Date</label><input type="date" required value={form.cost_date} onChange={set('cost_date')} className={input} /></div>
          <div className="col-span-2"><label className="text-xs text-slate-400">Vendor</label><input value={form.vendor} onChange={set('vendor')} className={input} placeholder="Wesco, Graybar, rental yard…" /></div>
          <div className="col-span-2 md:col-span-3"><label className="text-xs text-slate-400">Description</label><input value={form.description} onChange={set('description')} className={input} placeholder="Invoice #, what it was for" /></div>
          <button className="col-span-2 md:col-span-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2 rounded-lg">+ Log cost</button>
          <datalist id="jobs">{jobs.map((j) => <option key={j.project} value={j.project} />)}</datalist>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                <th className="p-3">Job</th><th className="p-3 text-right">Contract</th><th className="p-3 text-right">Budget cost</th><th className="p-3 text-right">Actual cost</th><th className="p-3 w-40">Budget used</th><th className="p-3 text-right">Hours (budget / actual)</th><th className="p-3 text-right">Margin</th><th className="p-3 text-right">Billed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? <tr><td colSpan={8} className="p-6 text-center text-slate-500">Loading…</td></tr>
                : jobs.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-slate-500">No jobs yet. Jobs appear here from estimates, change orders, timecards and logged costs with the same project name.</td></tr>
                : jobs.map((j) => (
                  <Fragment key={j.project}>
                    <tr onClick={() => setOpen(open === j.project ? '' : j.project)} className="hover:bg-slate-800/50 cursor-pointer">
                      <td className="p-3 text-white font-medium">{open === j.project ? '▾' : '▸'} {j.project}</td>
                      <td className="p-3 text-right text-slate-300">{money(j.contract)}</td>
                      <td className="p-3 text-right text-slate-300">{money(j.budget_total)}</td>
                      <td className="p-3 text-right text-slate-300">{money(j.actual_total)}</td>
                      <td className="p-3"><div className="flex items-center gap-2">{bar(j.cost_used_pct)}<span className="text-xs text-slate-400 w-12 text-right">{j.cost_used_pct == null ? '—' : `${j.cost_used_pct}%`}</span></div></td>
                      <td className="p-3 text-right text-slate-300">{j.budget_hours} / <span className={j.actual_hours > j.budget_hours && j.budget_hours ? 'text-red-400' : ''}>{j.actual_hours}</span></td>
                      <td className={`p-3 text-right font-semibold ${j.margin < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{money(j.margin)}{j.margin_pct != null && <span className="text-xs font-normal text-slate-400"> ({j.margin_pct}%)</span>}</td>
                      <td className="p-3 text-right text-slate-300">{money(j.billed)}</td>
                    </tr>
                    {open === j.project && (
                      <tr className="bg-slate-950/40">
                        <td colSpan={8} className="p-4">
                          <div className="grid md:grid-cols-3 gap-4 text-sm">
                            <div>
                              <p className="text-xs uppercase text-slate-400 mb-1">Budget</p>
                              <p>Material {money(j.budget_material)}</p><p>Labour {money(j.budget_labour)}</p>
                              <p className="text-slate-400">Includes {money(j.change_orders)} of approved change orders{j.estimates.length ? ` · Estimate ${j.estimates.map((e) => `#${e}`).join(', ')}` : ''}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase text-slate-400 mb-1">Actual</p>
                              <p>Labour (timecards) {money(j.actual_labour)}</p>
                              {Object.entries(j.actual_costs).map(([k, v]) => <p key={k}>{k} {money(v)}</p>)}
                            </div>
                            <div>
                              <p className="text-xs uppercase text-slate-400 mb-1">Logged costs</p>
                              {costs.filter((c) => c.project.trim().toLowerCase() === j.project.toLowerCase()).map((c) => (
                                <p key={c.id} className="flex justify-between gap-2"><span className="text-slate-300">{c.cost_date} · {c.category}{c.vendor ? ` · ${c.vendor}` : ''}</span><span>{money(Number(c.amount))} <button onClick={() => remove(c.id)} className="text-slate-500 hover:text-red-400 ml-1" aria-label="Delete cost">✕</button></span></p>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">Match project names across estimates, timecards, change orders and costs so they roll up to the same job. Lost estimates are left out.</p>
      </div>
    </main>
  );
}
