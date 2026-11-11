'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, Input, Label, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { apiCall } from '@/lib/job-cost';

export interface Proposal {
  id: string;
  title: string;
  status: string;
  notes: string | null;
  client_name: string | null;
  total_amount: number | string | null;
  valid_until: string | null;
  scope_of_work: string | null;
  terms: string | null;
  project_id: string | null;
  estimate_id: string | null;
}

const KEYS = ['title', 'status', 'client_name', 'total_amount', 'valid_until', 'scope_of_work', 'terms', 'notes'] as const;
type Fields = Record<(typeof KEYS)[number], string>;
const toFields = (p: Proposal): Fields => Object.fromEntries(KEYS.map((k) => [k, p[k] === null || p[k] === undefined ? '' : String(p[k])])) as Fields;

export default function ProposalEditor({ initial, madeProject, statuses, canWrite, canCreateProject }: { initial: Proposal; madeProject: boolean; statuses: string[]; canWrite: boolean; canCreateProject: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [fields, setFields] = useState(() => toFields(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const edit = (k: keyof Fields, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setDirty(true);
    setNotice('');
  };

  // Built from an estimate: the price is that estimate's, and the database keeps it that way
  const fromEstimate = !!saved.estimate_id;

  async function save() {
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const { total_amount, ...rest } = fields;
      const data = await apiCall<Proposal>(`/api/modules/proposals/${saved.id}`, 'PUT', fromEstimate ? rest : { ...rest, total_amount });
      setSaved(data);
      setFields(toFields(data));
      setDirty(false);
      setNotice('Saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy('');
    }
  }

  async function createProject() {
    setBusy('project');
    setError('');
    setNotice('');
    try {
      const data = await apiCall<{ id: string }>(`/api/proposals/${saved.id}/convert`, 'POST');
      router.push(`/projects/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the project.');
      setBusy('');
    }
  }

  const accepted = saved.status === 'Accepted';

  return (
    <>
      <PageHeader
        title={fields.title || 'Untitled proposal'}
        subtitle={fields.client_name || undefined}
        back={{ href: '/proposals', label: 'Back to Proposals' }}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
            <ButtonLink variant="secondary" href={`/print/proposal/${saved.id}`}>
              Print
            </ButtonLink>
            {canWrite && (
              <Button onClick={save} disabled={!!busy || !dirty}>
                {busy === 'save' ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        {notice && !dirty && <Alert tone="success">{notice}</Alert>}
        {!canWrite && <Alert tone="info">You can view this proposal but not change it.</Alert>}

        {madeProject && saved.project_id ? (
          <Panel>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-slate-300">This proposal has a project.</p>
              <ButtonLink href={`/projects/${saved.project_id}`}>Open project</ButtonLink>
            </div>
          </Panel>
        ) : accepted ? (
          <Panel>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-slate-300">
                {saved.project_id
                  ? 'The client accepted, and this quote is for a job you already have. Applying it marks the estimate won, and fills in the contract and budget only if the job has none yet.'
                  : `The client accepted. Create the project to start tracking the job. ${saved.estimate_id ? 'Its budget comes from the estimate.' : 'You can set its budget on the job cost page.'}`}
              </p>
              <div className="flex flex-wrap gap-3 shrink-0">
                {saved.project_id && (
                  <ButtonLink variant="secondary" href={`/projects/${saved.project_id}`}>
                    Open project
                  </ButtonLink>
                )}
                {canCreateProject && (
                  <Button onClick={createProject} disabled={!!busy || dirty} title={dirty ? 'Save your changes first' : undefined}>
                    {busy === 'project' ? 'Working…' : saved.project_id ? 'Apply to project' : 'Create project'}
                  </Button>
                )}
              </div>
            </div>
          </Panel>
        ) : (
          <Alert tone="info">Sending to the client is up to you: print this proposal and send it. When they accept, set the status to Accepted to {saved.project_id ? 'apply it to its project' : 'create the project'}.</Alert>
        )}

        <Panel>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label htmlFor="p-title">Proposal</Label>
              <Input id="p-title" value={fields.title} maxLength={300} disabled={!canWrite} onChange={(e) => edit('title', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="p-client">Client</Label>
              <Input id="p-client" value={fields.client_name} maxLength={300} disabled={!canWrite} onChange={(e) => edit('client_name', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="p-status">Status</Label>
              {madeProject ? (
                <p className="py-3">
                  <Badge>{saved.status}</Badge>
                </p>
              ) : (
                <Select id="p-status" options={statuses} value={fields.status} disabled={!canWrite} onChange={(e) => edit('status', e.target.value)} />
              )}
            </div>
            <div>
              <Label htmlFor="p-total">Total</Label>
              {fromEstimate ? (
                <>
                  <p id="p-total" className="py-3 text-xl font-bold text-white">
                    {formatMoney(saved.total_amount)}
                  </p>
                  <p className="text-xs text-slate-400">
                    Comes from{' '}
                    <Link href={`/estimates/${saved.estimate_id}`} className="text-amber-400 hover:underline">
                      the estimate
                    </Link>
                    , with tax.
                  </p>
                </>
              ) : (
                <Input id="p-total" type="number" inputMode="decimal" step="0.01" value={fields.total_amount} disabled={!canWrite} onChange={(e) => edit('total_amount', e.target.value)} />
              )}
            </div>
            <div>
              <Label htmlFor="p-valid">Prices valid until</Label>
              <Input id="p-valid" type="date" value={fields.valid_until} disabled={!canWrite} onChange={(e) => edit('valid_until', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="p-scope">Scope of work</Label>
              <Textarea id="p-scope" rows={5} value={fields.scope_of_work} disabled={!canWrite} onChange={(e) => edit('scope_of_work', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="p-terms">Terms (blank uses your company terms)</Label>
              <Textarea id="p-terms" rows={4} value={fields.terms} disabled={!canWrite} onChange={(e) => edit('terms', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="p-notes">Internal notes (not printed)</Label>
              <Textarea id="p-notes" rows={2} value={fields.notes} disabled={!canWrite} onChange={(e) => edit('notes', e.target.value)} />
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
