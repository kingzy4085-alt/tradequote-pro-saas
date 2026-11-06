import type { TimecardStatus } from '@/lib/timecards';

const STYLES: Record<TimecardStatus, string> = {
  Submitted: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  Approved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  Rejected: 'bg-red-500/10 text-red-300 border-red-500/30',
  Exported: 'bg-slate-700/40 text-slate-300 border-slate-600',
};

export default function StatusPill({ status }: { status: TimecardStatus }) {
  return <span className={`inline-block border px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${STYLES[status] ?? STYLES.Exported}`}>{status}</span>;
}
