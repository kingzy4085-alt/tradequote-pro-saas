'use client';

import { useEffect, useState } from 'react';

interface Log {
  id: string;
  log_date: string | null;
  project: string | null;
  crew: string | null;
  crew_count: number | null;
  hours: number | null;
  photos: string[] | null;
  signed_by: string | null;
  signed_at: string | null;
}

const today = () => new Date().toLocaleDateString('en-CA');

export default function DailyLogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [date, setDate] = useState(today());

  useEffect(() => {
    fetch('/api/daily-logs')
      .then((r) => r.json())
      .then((j) => (j.success ? setLogs(j.data) : setError(j.error)))
      .catch(() => setError('Could not load logs.'))
      .finally(() => setLoading(false));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/daily-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, log_date: date }),
    }).then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (res.success) window.location.href = `/daily-logs/${res.data.id}`;
    else setError(res.error);
  }

  const projects = Array.from(new Set(logs.map((l) => l.project).filter(Boolean))) as string[];
  const shown = logs.filter((l) => `${l.project} ${l.crew} ${l.log_date}`.toLowerCase().includes(search.toLowerCase()));
  const input = 'bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Daily Logs</h1>
          <p className="text-slate-400 mt-1">What happened on site each day: crew, hours, work done, photos and the foreman&apos;s sign-off.</p>
        </div>

        <form onSubmit={create} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row gap-3">
          <input required list="projects" placeholder="Project / job" value={project} onChange={(e) => setProject(e.target.value)} className={`${input} flex-1`} aria-label="Project" />
          <datalist id="projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={input} aria-label="Date" />
          <button className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">+ New Log</button>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <input placeholder="Search by project, crew or date…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${input} w-full md:w-96`} />

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                <th className="p-4">Date</th>
                <th className="p-4">Project</th>
                <th className="p-4">Crew</th>
                <th className="p-4 text-right">Hours</th>
                <th className="p-4 text-right">Photos</th>
                <th className="p-4">Sign-off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">Loading logs…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">No logs yet. Start today&apos;s log above.</td></tr>
              ) : (
                shown.map((l) => (
                  <tr key={l.id} onClick={() => (window.location.href = `/daily-logs/${l.id}`)} className="hover:bg-slate-800/50 cursor-pointer">
                    <td className="p-4 text-slate-300 whitespace-nowrap">{l.log_date}</td>
                    <td className="p-4 font-medium text-white"><a href={`/daily-logs/${l.id}`}>{l.project}</a></td>
                    <td className="p-4 text-slate-300">{l.crew || '—'}{l.crew_count ? ` (${l.crew_count})` : ''}</td>
                    <td className="p-4 text-slate-300 text-right">{Number(l.hours || 0)}</td>
                    <td className="p-4 text-slate-300 text-right">{l.photos?.length || 0}</td>
                    <td className="p-4">{l.signed_at ? <span className="text-emerald-400">Signed · {l.signed_by}</span> : <span className="text-amber-400">Open</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
