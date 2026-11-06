'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Input, Label, Panel, Select } from '@/components/ui';
import { hoursProblem, type ProjectOption, type Worker } from '@/lib/timecards';

const OTHER_JOB = 'other';
const TYPED_WORKER = 'typed';

interface Row {
  key: number;
  worker: string;
  typedName: string;
  regular: string;
  overtime: string;
}

const workerValue = (w: Worker) => (w.user_id ? `u:${w.user_id}` : `e:${w.employee_id}`);

/** Enter time: a foreman picks workers and types hours for each; an electrician enters their own. */
export default function CrewEntry({
  date,
  initialProject,
  projects,
  workers,
  isCrewLead,
  onSaved,
}: {
  date: string;
  initialProject: string | null;
  projects: ProjectOption[];
  workers: Worker[];
  isCrewLead: boolean;
  onSaved: (savedDate: string, count: number) => void;
}) {
  const router = useRouter();
  const [workDate, setWorkDate] = useState(date);
  const [job, setJob] = useState(initialProject ?? (projects.length ? '' : OTHER_JOB));
  const [jobName, setJobName] = useState('');
  const [notes, setNotes] = useState('');
  const [nextKey, setNextKey] = useState(1);
  const [rows, setRows] = useState<Row[]>([{ key: 0, worker: '', typedName: '', regular: '', overtime: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    setRows((list) => [...list, { key: nextKey, worker: '', typedName: '', regular: '', overtime: '' }]);
    setNextKey((k) => k + 1);
  };
  const addEveryone = () => {
    const picked = new Set(rows.map((r) => r.worker));
    const missing = workers.filter((w) => !picked.has(workerValue(w)));
    const added = missing.map((w, i) => ({ key: nextKey + i, worker: workerValue(w), typedName: '', regular: '', overtime: '' }));
    // The empty starting row would only be in the way
    setRows((list) => [...list.filter((r) => r.worker || r.typedName || r.regular || r.overtime), ...added]);
    setNextKey((k) => k + added.length);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // A row with no hours is someone who didn't work that day
    const filled = rows.filter((r) => Number(r.regular || 0) + Number(r.overtime || 0) !== 0);
    if (!filled.length) return setError('Enter the hours worked.');
    if (job === '') return setError('Pick a project or type the job.');
    if (job === OTHER_JOB && !jobName.trim()) return setError('Type the job, such as Shop or Travel.');

    const entries = [];
    for (const r of filled) {
      const worker = workers.find((w) => workerValue(w) === r.worker);
      if (isCrewLead && !worker && !(r.worker === TYPED_WORKER && r.typedName.trim())) return setError('Pick a worker on every row that has hours.');
      const problem = hoursProblem(Number(r.regular || 0), Number(r.overtime || 0));
      if (problem) return setError(problem);
      entries.push({
        employee_id: worker?.employee_id ?? null,
        worker_user_id: worker?.user_id ?? null,
        employee_name: r.worker === TYPED_WORKER ? r.typedName.trim() : null,
        regular_hours: r.regular || 0,
        overtime_hours: r.overtime || 0,
      });
    }

    setSaving(true);
    try {
      const res = await fetch('/api/timecards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_date: workDate, project_id: job === OTHER_JOB ? null : job, job: job === OTHER_JOB ? jobName.trim() : null, notes, entries }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? 'Could not save the time. Try again.');
      setRows([{ key: nextKey, worker: '', typedName: '', regular: '', overtime: '' }]);
      setNextKey((k) => k + 1);
      setNotes('');
      onSaved(workDate, body.saved ?? entries.length);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  const hourInput = 'text-center px-2';
  return (
    <Panel title={isCrewLead ? 'Enter crew time' : 'Enter my time'} className="!p-4 sm:!p-6">
      <form onSubmit={save} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="tc-date">Date</Label>
            <Input id="tc-date" className="[color-scheme:dark]" type="date" required value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tc-job">Job</Label>
            <Select id="tc-job" value={job} onChange={(e) => setJob(e.target.value)} placeholder="Pick a project" options={[...projects.map((p) => ({ value: p.id, label: p.title })), { value: OTHER_JOB, label: 'Other (shop, travel, training)' }]} />
          </div>
          {job === OTHER_JOB && (
            <div className="sm:col-span-2">
              <Label htmlFor="tc-job-name">What job?</Label>
              <Input id="tc-job-name" value={jobName} maxLength={300} placeholder="e.g. Shop" onChange={(e) => setJobName(e.target.value)} />
            </div>
          )}
        </div>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_auto] gap-2 sm:gap-3 items-end border-t border-slate-800 pt-3 first:border-t-0 first:pt-0">
              {isCrewLead && (
                <div className="col-span-2 sm:col-span-1">
                  <Label htmlFor={`tc-worker-${r.key}`}>Worker</Label>
                  <Select id={`tc-worker-${r.key}`} value={r.worker} onChange={(e) => update(r.key, { worker: e.target.value })} placeholder="Pick a worker" options={[...workers.map((w) => ({ value: workerValue(w), label: w.name })), { value: TYPED_WORKER, label: 'Someone else (type the name)' }]} />
                  {r.worker === TYPED_WORKER && <Input aria-label="Worker's name" className="mt-2" maxLength={300} placeholder="Worker's name" value={r.typedName} onChange={(e) => update(r.key, { typedName: e.target.value })} />}
                </div>
              )}
              <div>
                <Label htmlFor={`tc-reg-${r.key}`}>Regular</Label>
                <Input id={`tc-reg-${r.key}`} className={hourInput} type="number" inputMode="decimal" min={0} max={24} step="0.25" placeholder="0" value={r.regular} onChange={(e) => update(r.key, { regular: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`tc-ot-${r.key}`}>Overtime</Label>
                <Input id={`tc-ot-${r.key}`} className={hourInput} type="number" inputMode="decimal" min={0} max={24} step="0.25" placeholder="0" value={r.overtime} onChange={(e) => update(r.key, { overtime: e.target.value })} />
              </div>
              {isCrewLead && rows.length > 1 && (
                <Button variant="ghost" size="sm" className="col-span-2 sm:col-span-1 sm:mb-2" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>

        <div>
          <Label htmlFor="tc-notes">Notes (optional)</Label>
          <Input id="tc-notes" value={notes} maxLength={2000} placeholder="What was worked on" onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save time'}</Button>
          {isCrewLead && <Button variant="secondary" onClick={addRow}>Add a worker</Button>}
          {isCrewLead && workers.length > 0 && <Button variant="secondary" onClick={addEveryone}>Add everyone</Button>}
        </div>
      </form>
    </Panel>
  );
}
