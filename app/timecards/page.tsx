'use client';

import { useEffect, useState } from 'react';
import { money } from '@/lib/estimate-math';

interface Entry {
  id: string;
  work_date: string;
  employee_name: string;
  project: string;
  task: string | null;
  regular_hours: number;
  overtime_hours: number;
  hourly_cost: number;
  total_cost: number;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
}

const iso = (d: Date) => d.toLocaleDateString('en-CA');
// Monday of the week containing d
const monday = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const BLANK = { employee_name: '', project: '', task: '', regular_hours: '8', overtime_hours: '0', hourly_cost: '' };

export default function TimecardsPage() {
  const [week, setWeek] = useState(() => monday(new Date()));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ ...BLANK, work_date: iso(new Date()) });
  const from = iso(week), to = iso(addDays(week, 6));

  const load = () => {
    setLoading(true);
    fetch(`/api/timecards?from=${from}&to=${to}`).then((r) => r.json()).then((j) => (j.success ? setEntries(j.data) : setError(j.error))).catch(() => setError('Could not load timecards.')).finally(() => setLoading(false));
  };
  useEffect(load, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetch('/api/company').then((r) => r.json()).then((j) => j.data?.default_labour_rate && setForm((f) => ({ ...f, hourly_cost: f.hourly_cost || String(j.data.default_labour_rate) }))).catch(() => {});
  }, []);

  async function call(url: string, method: string, body?: unknown) {
    setError('');
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (!res.success) setError(res.error);
    return res.success;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await call('/api/timecards', 'POST', form)) {
      setForm({ ...form, task: '' });
      load();
    }
  }

  async function approveAll() {
    if (!confirm('Approve all hours for this week? Approved hours are locked.')) return;
    for (const en of entries.filter((x) => x.status !== 'Approved')) await call(`/api/timecards/${en.id}`, 'PUT', { action: 'approve' });
    load();
  }

  const sum = (list: Entry[], k: 'regular_hours' | 'overtime_hours' | 'total_cost') => list.reduce((s, x) => s + Number(x[k] || 0), 0);
  const group = (k: 'employee_name' | 'project') => Object.entries(entries.reduce<Record<string, Entry[]>>((g, x) => ((g[x[k]] ||= []).push(x), g), {}));
  const input = 'bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 w-full';
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const workers = Array.from(new Set(entries.map((x) => x.employee_name)));
  const projects = Array.from(new Set(entries.map((x) => x.project)));

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Timecards</h1>
            <p className="text-slate-400 mt-1">Hours by worker and job. Labour cost flows into Job Costing.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeek(addDays(week, -7))} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2" aria-label="Previous week">←</button>
            <span className="text-sm text-slate-300 w-48 text-center">Week of {week.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <button onClick={() => setWeek(addDays(week, 7))} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2" aria-label="Next week">→</button>
          </div>
        </div>

        <form onSubmit={add} className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 items-end">
          <div className="col-span-2 md:col-span-1"><label className="text-xs text-slate-400">Date</label><input type="date" required value={form.work_date} onChange={set('work_date')} className={input} /></div>
          <div className="col-span-2"><label className="text-xs text-slate-400">Worker</label><input required list="workers" value={form.employee_name} onChange={set('employee_name')} className={input} /></div>
          <div className="col-span-2"><label className="text-xs text-slate-400">Project</label><input required list="projects" value={form.project} onChange={set('project')} className={input} /></div>
          <div><label className="text-xs text-slate-400">Reg hrs</label><input type="number" min={0} step="0.25" value={form.regular_hours} onChange={set('regular_hours')} className={input} /></div>
          <div><label className="text-xs text-slate-400">OT hrs</label><input type="number" min={0} step="0.25" value={form.overtime_hours} onChange={set('overtime_hours')} className={input} /></div>
          <div><label className="text-xs text-slate-400">Rate $/hr</label><input type="number" min={0} step="any" value={form.hourly_cost} onChange={set('hourly_cost')} className={input} /></div>
          <div className="col-span-2 md:col-span-3 lg:col-span-6"><label className="text-xs text-slate-400">Task / notes</label><input value={form.task} onChange={set('task')} className={input} /></div>
          <button className="col-span-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2 rounded-lg">+ Add hours</button>
          <datalist id="workers">{workers.map((w) => <option key={w} value={w} />)}</datalist>
          <datalist id="projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="grid md:grid-cols-2 gap-4">
          {(['employee_name', 'project'] as const).map((k) => (
            <section key={k} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="font-bold text-white mb-2">By {k === 'project' ? 'job' : 'worker'}</h2>
              {group(k).length === 0 ? <p className="text-sm text-slate-500">No hours this week.</p> : (
                <table className="w-full text-sm">
                  <tbody>
                    {group(k).map(([name, list]) => (
                      <tr key={name} className="border-t border-slate-800"><td className="py-1.5 text-slate-200">{name}</td><td className="py-1.5 text-right text-slate-300">{sum(list, 'regular_hours')} + {sum(list, 'overtime_hours')} OT hrs</td><td className="py-1.5 text-right text-slate-300 w-28">{money(sum(list, 'total_cost'))}</td></tr>
                    ))}
                    <tr className="border-t border-slate-700 font-bold text-white"><td className="py-1.5">Total</td><td className="py-1.5 text-right">{sum(entries, 'regular_hours')} + {sum(entries, 'overtime_hours')} OT hrs</td><td className="py-1.5 text-right">{money(sum(entries, 'total_cost'))}</td></tr>
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                <th className="p-3">Date</th><th className="p-3">Worker</th><th className="p-3">Project</th><th className="p-3">Task</th><th className="p-3 text-right">Reg</th><th className="p-3 text-right">OT</th><th className="p-3 text-right">Cost</th><th className="p-3">Status</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? <tr><td colSpan={9} className="p-6 text-center text-slate-500">Loading…</td></tr>
                : entries.length === 0 ? <tr><td colSpan={9} className="p-6 text-center text-slate-500">No hours entered for this week.</td></tr>
                : entries.map((x) => (
                  <tr key={x.id}>
                    <td className="p-3 text-slate-300 whitespace-nowrap">{x.work_date}</td>
                    <td className="p-3 text-white">{x.employee_name}</td>
                    <td className="p-3 text-slate-300">{x.project}</td>
                    <td className="p-3 text-slate-400">{x.task}</td>
                    <td className="p-3 text-right text-slate-300">{Number(x.regular_hours)}</td>
                    <td className="p-3 text-right text-slate-300">{Number(x.overtime_hours)}</td>
                    <td className="p-3 text-right text-slate-300">{money(Number(x.total_cost))}</td>
                    <td className={`p-3 ${x.status === 'Approved' ? 'text-emerald-400' : 'text-amber-400'}`}>{x.status === 'Approved' ? `Approved ${x.approved_at ? new Date(x.approved_at).toLocaleDateString('en-CA') : ''}` : x.status}</td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {x.status === 'Approved' ? (
                        <button onClick={async () => (await call(`/api/timecards/${x.id}`, 'PUT', { action: 'unapprove' })) && load()} className="text-xs text-slate-400 hover:text-amber-400">Unapprove</button>
                      ) : (
                        <button onClick={async () => confirm('Delete this entry?') && (await call(`/api/timecards/${x.id}`, 'DELETE')) && load()} className="text-slate-500 hover:text-red-400 px-2" aria-label="Delete entry">✕</button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {entries.some((x) => x.status !== 'Approved') && (
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <button onClick={approveAll} className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold px-5 py-2 rounded-lg">Approve all for this week</button>
          </div>
        )}
      </div>
    </main>
  );
}
