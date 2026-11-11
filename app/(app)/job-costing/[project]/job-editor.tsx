'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, ButtonLink, FieldError, Input, Label, PageHeader, Panel, Select, StatCard } from '@/components/ui';
import { formatMoney, formatValue } from '@/lib/format';
import { ENTRY_CATEGORIES, apiCall, statusTone, type CostEntry, type JobCost } from '@/lib/job-cost';

const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const hours = (v: unknown) => `${Number(v ?? 0)} h`;

export default function JobEditor({ job, entries, today, canWrite }: { job: JobCost; entries: CostEntry[]; today: string; canWrite: boolean }) {
  const router = useRouter();
  const blankEntry = { category: 'Material', description: '', amount: '', entry_date: today };
  const [budget, setBudget] = useState({ hours: asText(job.budget_labour_hours), labour: asText(job.budget_labour), material: asText(job.budget_material), other: asText(job.budget_other) });
  const [entry, setEntry] = useState(blankEntry);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [entryError, setEntryError] = useState('');
  const [notice, setNotice] = useState('');
  const closed = job.status === 'Closed';

  async function run(name: string, work: () => Promise<unknown>, done: string, onError = setError) {
    setBusy(name);
    setError('');
    setEntryError('');
    setNotice('');
    try {
      await work();
      setNotice(done);
      router.refresh();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy('');
    }
  }

  const saveBudget = (e: React.FormEvent) => {
    e.preventDefault();
    return run('budget', () => apiCall(`/api/job-costing/${job.project_id}`, 'PATCH', budget), 'Budget saved.');
  };

  const setClosed = (value: boolean) => run('close', () => apiCall(`/api/job-costing/${job.project_id}`, 'PATCH', { closed: value }), value ? 'Job closed.' : 'Job reopened.');

  async function saveEntry(e: React.FormEvent) {
    e.preventDefault();
    const url = editingId ? `/api/job-costing/entries/${editingId}` : `/api/job-costing/${job.project_id}/entries`;
    const ok = await run('entry', () => apiCall(url, editingId ? 'PUT' : 'POST', entry), editingId ? 'Cost updated.' : 'Cost added.', setEntryError);
    if (ok) {
      setEntry(blankEntry);
      setEditingId(null);
    }
  }

  function startEdit(row: CostEntry) {
    setEditingId(row.id);
    setEntryError('');
    setEntry({ category: row.category, description: row.description, amount: asText(row.amount), entry_date: row.entry_date });
  }

  function removeEntry(row: CostEntry) {
    if (!window.confirm(`Delete "${row.description}"? This can't be undone.`)) return;
    void run('entry', () => apiCall(`/api/job-costing/entries/${row.id}`, 'DELETE'), 'Cost deleted.');
  }

  const breakdown: { label: string; budget: unknown; actual: unknown; note?: string }[] = [
    { label: 'Labour', budget: job.budget_labour, actual: job.actual_labour, note: `${hours(job.actual_labour_hours)} of ${hours(Number(job.budget_labour_hours ?? 0) + Number(job.co_labour_hours ?? 0))}` },
    { label: 'Material', budget: job.budget_material, actual: job.actual_material, note: 'Approved and paid bills, plus material entries' },
    { label: 'Equipment, subcontract and other', budget: job.budget_other, actual: job.actual_other },
    { label: 'Approved change orders', budget: job.co_cost, actual: null, note: `${formatMoney(job.co_revenue)} added to the contract` },
  ];

  const budgetField = (key: keyof typeof budget, label: string, step = '0.01') => (
    <div>
      <Label htmlFor={`b-${key}`}>{label}</Label>
      <Input id={`b-${key}`} type="number" inputMode="decimal" min={0} step={step} value={budget[key]} disabled={!canWrite} onChange={(e) => setBudget((b) => ({ ...b, [key]: e.target.value }))} />
    </div>
  );

  return (
    <>
      <PageHeader
        title={job.project_title}
        subtitle={job.client_name ?? undefined}
        back={{ href: '/job-costing', label: 'Back to Job Costing' }}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-block border px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusTone(job.status)}`}>{job.status}</span>
            <ButtonLink variant="secondary" href={`/projects/${job.project_id}`}>
              Open project
            </ButtonLink>
            {canWrite && (
              <Button variant="secondary" disabled={!!busy} onClick={() => setClosed(!closed)}>
                {closed ? 'Reopen job' : 'Close job'}
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {!canWrite && <Alert tone="info">You can view this job but not change it.</Alert>}
        {closed && <Alert tone="info">This job is closed, so its status stays Closed. Costs that come in late still count in the numbers.</Alert>}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Budget" value={formatMoney(job.budget)} caption={job.cost_used_pct === null ? 'No budget set' : `${Number(job.cost_used_pct)}% used`} />
          <StatCard label="Actual cost" value={formatMoney(job.actual_cost)} caption={`${formatMoney(job.committed)} more committed on POs`} />
          <StatCard label="Billed" value={formatMoney(job.billed_amount)} caption={`${formatMoney(job.paid_amount)} paid, before tax`} />
          <StatCard label="Margin" value={formatMoney(job.margin)} caption={job.margin_pct === null ? `On ${formatMoney(job.revised_contract)}` : `${Number(job.margin_pct)}% of ${formatMoney(job.revised_contract)}`} />
        </div>

        <Panel title="Budget against actual">
          <ul className="divide-y divide-slate-800 text-sm">
            {breakdown.map((row) => (
              <li key={row.label} className="grid grid-cols-2 sm:grid-cols-[1fr_8rem_8rem] gap-x-4 gap-y-1 py-3">
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-white">{row.label}</p>
                  {row.note && <p className="text-xs text-slate-400">{row.note}</p>}
                </div>
                <p className="sm:text-right text-slate-300">
                  <span className="sm:hidden text-xs text-slate-400">Budget </span>
                  {formatMoney(row.budget ?? 0)}
                </p>
                <p className="text-right text-slate-300">
                  <span className="sm:hidden text-xs text-slate-400">Actual </span>
                  {row.actual === null ? '—' : formatMoney(row.actual)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>

        {canWrite && (
          <Panel title="Set the budget" description="Starts from the estimate when the project was made from one. Approved change orders add to it on their own.">
            <form onSubmit={saveBudget} noValidate>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {budgetField('hours', 'Labour hours')}
                {budgetField('labour', 'Labour $')}
                {budgetField('material', 'Material $')}
                {budgetField('other', 'Other $')}
              </div>
              <div className="flex justify-end mt-4">
                <Button type="submit" disabled={!!busy}>
                  {busy === 'budget' ? 'Saving…' : 'Save budget'}
                </Button>
              </div>
            </form>
          </Panel>
        )}

        <Panel title="Other costs" description="Costs that don't come in on a timecard or a bill: rentals, subs paid outside payables, shop stock. A negative amount is a credit.">
          {canWrite && (
            <form onSubmit={saveEntry} noValidate className="mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[10rem_1fr_9rem_10rem] gap-4">
                <div>
                  <Label htmlFor="e-category">Category</Label>
                  <Select id="e-category" options={[...ENTRY_CATEGORIES]} value={entry.category} onChange={(e) => setEntry((x) => ({ ...x, category: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="e-description">Description</Label>
                  <Input id="e-description" value={entry.description} maxLength={300} placeholder="e.g. 60 ft boom lift, 2 weeks" onChange={(e) => setEntry((x) => ({ ...x, description: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="e-amount">Amount</Label>
                  <Input id="e-amount" type="number" inputMode="decimal" step="0.01" value={entry.amount} onChange={(e) => setEntry((x) => ({ ...x, amount: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="e-date">Date</Label>
                  <Input id="e-date" type="date" value={entry.entry_date} onChange={(e) => setEntry((x) => ({ ...x, entry_date: e.target.value }))} />
                </div>
              </div>
              <FieldError message={entryError} />
              <div className="flex justify-end gap-3 mt-4">
                {editingId && (
                  <Button
                    variant="ghost"
                    disabled={!!busy}
                    onClick={() => {
                      setEditingId(null);
                      setEntry(blankEntry);
                      setEntryError('');
                    }}
                  >
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={!!busy}>
                  {busy === 'entry' ? 'Saving…' : editingId ? 'Save cost' : 'Add cost'}
                </Button>
              </div>
            </form>
          )}

          {entries.length === 0 ? (
            <p className="text-center text-slate-400 py-4">No other costs on this job yet.</p>
          ) : (
            <ul className="divide-y divide-slate-800 text-sm">
              {entries.map((row) => (
                <li key={row.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-white break-words">{row.description}</p>
                    <p className="text-xs text-slate-400">
                      {row.category} · {formatValue('date', row.entry_date)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <span className={Number(row.amount) < 0 ? 'font-semibold text-emerald-300' : 'font-semibold text-white'}>
                      {formatMoney(row.amount)}
                      {Number(row.amount) < 0 && ' credit'}
                    </span>
                    {canWrite && (
                      <span className="flex gap-2">
                        <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => startEdit(row)}>
                          Edit
                        </Button>
                        <Button variant="danger" size="sm" disabled={!!busy} onClick={() => removeEntry(row)}>
                          Delete
                        </Button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
