'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Input, Label, PageHeader, Panel, Select } from '@/components/ui';
import { formatMoney, formatValue } from '@/lib/format';
import { hoursProblem, weekStart, type DecideAction, type ProjectOption, type Timecard, type Worker } from '@/lib/timecards';
import StatusPill from '../status-pill';

const OTHER_JOB = 'other';
const KEEP_WORKER = 'keep';
const workerValue = (w: Worker) => (w.user_id ? `u:${w.user_id}` : `e:${w.employee_id}`);
const num = (v: unknown) => (v === null || v === undefined ? '' : String(Number(v)));

export default function TimecardEditor({
  initial,
  workers,
  projects,
  canWrite,
  canApprove,
  isCrewLead,
  canSeePay,
  canReopen,
  canDelete,
}: {
  initial: Timecard;
  workers: Worker[];
  projects: ProjectOption[];
  canWrite: boolean;
  canApprove: boolean;
  isCrewLead: boolean;
  canSeePay: boolean;
  canReopen: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const card = initial;
  const locked = card.status === 'Approved' || card.status === 'Exported';
  const editable = canWrite && !locked;

  const [workDate, setWorkDate] = useState(card.work_date ?? '');
  const [job, setJob] = useState(card.project_id ?? OTHER_JOB);
  const [jobName, setJobName] = useState(card.title);
  const [worker, setWorker] = useState(KEEP_WORKER);
  const [regular, setRegular] = useState(num(card.regular_hours));
  const [overtime, setOvertime] = useState(num(card.overtime_hours));
  const [notes, setNotes] = useState(card.notes ?? '');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const backHref = `/timecards${card.work_date ? `?week=${weekStart(card.work_date)}` : ''}`;
  // The card is linked to a project this person's list doesn't reach
  const jobOptions = [...projects.map((p) => ({ value: p.id, label: p.title })), ...(card.project_id && !projects.some((p) => p.id === card.project_id) ? [{ value: card.project_id, label: card.title }] : []), { value: OTHER_JOB, label: 'Other (shop, travel, training)' }];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaved('');
    const problem = hoursProblem(Number(regular || 0), Number(overtime || 0));
    if (problem) return setError(problem);
    if (!workDate) return setError('Pick a date.');
    if (job === OTHER_JOB && !jobName.trim()) return setError('Type the job, such as Shop or Travel.');

    const picked = workers.find((w) => workerValue(w) === worker);
    const body: Record<string, unknown> = {
      work_date: workDate,
      project_id: job === OTHER_JOB ? null : job,
      title: job === OTHER_JOB ? jobName.trim() : projects.find((p) => p.id === job)?.title ?? card.title,
      regular_hours: regular || 0,
      overtime_hours: overtime || 0,
      notes,
    };
    if (picked) Object.assign(body, { employee_name: picked.name, employee_id: picked.employee_id, worker_user_id: picked.user_id });
    // Fixing a rejected card sends it back for approval
    if (card.status === 'Rejected') body.status = 'Submitted';

    setBusy(true);
    try {
      const res = await fetch(`/api/timecards/${card.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return setError(out.error ?? 'Could not save the card. Try again.');
      setSaved(card.status === 'Rejected' ? 'Saved and sent back for approval.' : 'Saved.');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: DecideAction, why?: string) {
    setError('');
    setSaved('');
    setBusy(true);
    try {
      const res = await fetch('/api/timecards/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [card.id], action, reason: why }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return setError(out.error ?? 'Could not update the card. Try again.');
      if (out.skipped?.length) return setError(out.skipped[0].reason);
      if (!out.done) return setError('This card changed while you had it open. Reload and try again.');
      setRejecting(false);
      setReason('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/modules/timecards/${card.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        setError(out.error ?? 'Could not delete the card. Try again.');
        setConfirmDelete(false);
        return;
      }
      router.push(backHref);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const fact = (label: string, value: string) => (
    <div>
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</dt>
      <dd className="text-white mt-0.5 break-words">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title={card.employee_name} subtitle={`${card.work_date ? formatValue('date', card.work_date) : 'No date'} · ${card.title}`} back={{ href: backHref, label: 'Timecards' }} actions={<StatusPill status={card.status} />} />

      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}
      {!canWrite && <Alert tone="info">Your trial or subscription has ended, so this card is read-only.</Alert>}
      {card.status === 'Rejected' && (
        <Alert>
          <strong>Rejected:</strong> {card.reject_reason || 'No reason given.'}
          {canWrite && <span className="block mt-1">Fix the card below to send it back for approval.</span>}
        </Alert>
      )}
      {canWrite && locked && (
        <Alert tone="info">
          {card.status === 'Exported' ? 'This card has gone to payroll and is locked.' : isCrewLead ? 'This card is approved and locked. Un-approve it to make changes.' : 'This card is approved and locked. Ask your foreman or project manager if something is wrong.'}
        </Alert>
      )}

      {locked || !canWrite ? (
        <Panel className="!p-4 sm:!p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fact('Regular hours', num(card.regular_hours) || '0')}
            {fact('Overtime hours', num(card.overtime_hours) || '0')}
            {card.notes && fact('Notes', card.notes)}
          </dl>
        </Panel>
      ) : null}

      {(card.approved_at || card.exported_at || (canSeePay && card.labour_cost !== null)) && (
        <Panel title="Approval" className="!p-4 sm:!p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {card.approved_at && fact('Approved by', card.approved_by_name ?? 'System')}
            {card.approved_at && fact('Approved', formatValue('datetime', card.approved_at))}
            {card.exported_at && fact('Exported', formatValue('datetime', card.exported_at))}
            {canSeePay && card.hourly_cost !== null && fact('Frozen hourly cost', Number(card.hourly_cost) > 0 ? formatMoney(card.hourly_cost) : 'No rate on file')}
            {canSeePay && card.labour_cost !== null && fact('Labour cost', formatMoney(card.labour_cost))}
          </dl>
        </Panel>
      )}

      {editable && (
        <Panel title="Edit card" className="!p-4 sm:!p-6">
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {isCrewLead && (
                <div className="sm:col-span-2">
                  <Label htmlFor="tc-worker">Worker</Label>
                  <Select id="tc-worker" value={worker} onChange={(e) => setWorker(e.target.value)} options={[{ value: KEEP_WORKER, label: card.employee_name }, ...workers.map((w) => ({ value: workerValue(w), label: w.name }))]} />
                </div>
              )}
              <div>
                <Label htmlFor="tc-date">Date</Label>
                <Input id="tc-date" className="[color-scheme:dark]" type="date" required value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="tc-job">Job</Label>
                <Select id="tc-job" value={job} onChange={(e) => setJob(e.target.value)} options={jobOptions} />
              </div>
              {job === OTHER_JOB && (
                <div className="sm:col-span-2">
                  <Label htmlFor="tc-job-name">What job?</Label>
                  <Input id="tc-job-name" value={jobName} maxLength={300} onChange={(e) => setJobName(e.target.value)} />
                </div>
              )}
              <div>
                <Label htmlFor="tc-reg">Regular hours</Label>
                <Input id="tc-reg" type="number" inputMode="decimal" min={0} max={24} step="0.25" value={regular} onChange={(e) => setRegular(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="tc-ot">Overtime hours</Label>
                <Input id="tc-ot" type="number" inputMode="decimal" min={0} max={24} step="0.25" value={overtime} onChange={(e) => setOvertime(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="tc-notes">Notes</Label>
                <Input id="tc-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={busy} className="w-full sm:w-auto">
              {busy ? 'Saving...' : card.status === 'Rejected' ? 'Save and resubmit' : 'Save changes'}
            </Button>
          </form>
        </Panel>
      )}

      {rejecting && (
        <Panel className="!p-4 sm:!p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              decide('reject', reason);
            }}
            className="space-y-3"
          >
            <div>
              <Label htmlFor="tc-reason">Why is it being rejected?</Label>
              <Input id="tc-reason" autoFocus value={reason} maxLength={500} placeholder="The worker sees this" onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="danger" disabled={busy}>Reject card</Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {!rejecting && (canApprove || canDelete) && (
        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
          {canApprove && (card.status === 'Submitted' || card.status === 'Rejected') && <Button disabled={busy} onClick={() => decide('approve')}>Approve</Button>}
          {canApprove && (card.status === 'Submitted' || card.status === 'Approved') && <Button variant="danger" disabled={busy} onClick={() => setRejecting(true)}>Reject</Button>}
          {canApprove && card.status === 'Approved' && <Button variant="secondary" disabled={busy} onClick={() => decide('unapprove')}>Un-approve</Button>}
          {canReopen && card.status === 'Exported' && <Button variant="secondary" disabled={busy} onClick={() => decide('reopen')}>Reopen</Button>}
          {canDelete && !locked && !confirmDelete && <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</Button>}
          {canDelete && !locked && confirmDelete && (
            <>
              <Button variant="danger" disabled={busy} onClick={remove}>Yes, delete this card</Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
