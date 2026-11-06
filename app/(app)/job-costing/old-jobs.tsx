'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Panel } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { apiCall } from '@/lib/job-cost';

export interface OldJob {
  id: string;
  title: string;
  budget: number | string | null;
  actual_cost: number | string | null;
}

/** Rows typed in before job costing, with no project to roll up from. They are kept as they were, for reference. */
export default function OldJobs({ jobs, canDelete }: { jobs: OldJob[]; canDelete: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');

  async function remove(job: OldJob) {
    if (!window.confirm(`Delete "${job.title}"? This can't be undone.`)) return;
    setError('');
    try {
      await apiCall(`/api/modules/job-costing/${job.id}`, 'DELETE');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
    }
  }

  return (
    <Panel title="Older typed-in jobs" description="These were typed in by hand and aren't tied to a project, so nothing updates them and they aren't in the totals above." className="mt-8">
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <ul className="divide-y divide-slate-800">
        {jobs.map((job) => (
          <li key={job.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <p className="text-white break-words">{job.title}</p>
              <p className="text-xs text-slate-400">
                Budget {formatMoney(job.budget ?? 0)} · Actual {formatMoney(job.actual_cost ?? 0)}
              </p>
            </div>
            {canDelete && (
              <Button variant="danger" size="sm" onClick={() => remove(job)} className="self-start sm:self-auto">
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
