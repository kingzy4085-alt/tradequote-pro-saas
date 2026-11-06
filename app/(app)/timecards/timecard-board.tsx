'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Alert, Button, ButtonLink, Input, Label, PageHeader, Panel } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import {
  DECIDE_BATCH,
  MAX_DAY_HOURS,
  addDays,
  formatDay,
  formatWeek,
  groupCards,
  hoursOf,
  totals,
  weekDays,
  weekStart,
  type CardGroup,
  type DecideAction,
  type ProjectOption,
  type Timecard,
  type Worker,
} from '@/lib/timecards';
import CrewEntry from './crew-entry';
import StatusPill from './status-pill';

type Notice = { tone: 'success' | 'error' | 'info'; text: string; details?: string[] };

const hrs = (n: number) => n.toLocaleString('en-CA', { maximumFractionDigits: 2 });

/** Sends a decision, in as many batches as it takes, and adds up what happened. */
async function decide(ids: string[], action: DecideAction, reason?: string): Promise<{ done: number; skipped: { worker: string; reason: string }[]; error?: string }> {
  const result = { done: 0, skipped: [] as { worker: string; reason: string }[] };
  for (let i = 0; i < ids.length; i += DECIDE_BATCH) {
    try {
      const res = await fetch('/api/timecards/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids.slice(i, i + DECIDE_BATCH), action, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ...result, error: body.error ?? 'Could not update the timecards. Try again.' };
      result.done += body.done ?? 0;
      result.skipped.push(...(body.skipped ?? []));
    } catch {
      return { ...result, error: 'Could not reach the server. Check your connection and try again.' };
    }
  }
  return result;
}

const DONE_WORD: Record<DecideAction, string> = { approve: 'approved', reject: 'rejected', unapprove: 'un-approved', reopen: 'reopened' };

export default function TimecardBoard({
  week,
  today,
  project,
  cards,
  partial,
  workers,
  projects,
  canEnter,
  canApprove,
  isCrewLead,
  canSeePay,
  canExport,
  canWrite,
  canManageBilling = false,
  canEditRates = false,
}: {
  week: string;
  today: string;
  project: string | null;
  cards: Timecard[];
  partial: boolean;
  workers: Worker[];
  projects: ProjectOption[];
  canEnter: boolean;
  canApprove: boolean;
  isCrewLead: boolean;
  canSeePay: boolean;
  canExport: boolean;
  canWrite: boolean;
  /** Billing and pay rates open at owner or admin. Nobody gets a link to a page that won't open for them. */
  canManageBilling?: boolean;
  canEditRates?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<'worker' | 'job'>('worker');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState({ from: week, to: addDays(week, 6) });

  const weekHref = (start: string) => {
    const qs = new URLSearchParams({ week: start });
    if (project) qs.set('project', project);
    return `/timecards?${qs}`;
  };

  const days = useMemo(() => weekDays(week), [week]);
  const groups = useMemo(() => groupCards(cards, view), [cards, view]);
  const sum = useMemo(() => totals(cards), [cards]);
  const waiting = cards.filter((c) => c.status === 'Submitted');
  const approved = cards.filter((c) => c.status === 'Approved');
  const noRate = canSeePay ? approved.filter((c) => Number(c.hourly_cost) === 0).length : 0;
  const projectName = project ? projects.find((p) => p.id === project)?.title ?? 'this project' : null;

  async function run(ids: string[], action: DecideAction, why?: string) {
    setBusy(true);
    setNotice(null);
    const result = await decide(ids, action, why);
    setBusy(false);
    setConfirmAll(false);
    setRejecting(null);
    setReason('');
    if (result.error) setNotice({ tone: 'error', text: result.error });
    else if (result.skipped.length) {
      setNotice({
        tone: result.done ? 'info' : 'error',
        text: `${result.done} ${result.done === 1 ? 'card' : 'cards'} ${DONE_WORD[action]}. ${result.skipped.length} could not be:`,
        details: result.skipped.map((s) => `${s.worker}: ${s.reason}`),
      });
    } else setNotice({ tone: 'success', text: `${result.done} ${result.done === 1 ? 'card' : 'cards'} ${DONE_WORD[action]}.` });
    router.refresh();
  }

  async function runExport(again: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/timecards/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...range, again }) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNotice({ tone: 'error', text: body.error ?? 'Could not export payroll. Try again.' });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-${range.from}-to-${range.to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const count = res.headers.get('X-Timecard-Count') ?? '';
      setNotice({ tone: 'success', text: again ? `Payroll file downloaded again with ${count} cards.` : `${count} cards exported and locked. If the download didn't start, use Download again.` });
      setExporting(false);
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server. If the cards show as Exported, use Download again to get the file.' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const stat = (label: string, value: string, caption?: string) => (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-extrabold text-white mt-1">{value}</p>
      {caption && <p className="text-xs text-slate-400 mt-1">{caption}</p>}
    </div>
  );

  function cardActions(card: Timecard) {
    if (!canApprove) return null;
    if (rejecting === card.id) {
      return (
        <form
          className="flex flex-col sm:flex-row gap-2 w-full"
          onSubmit={(e) => {
            e.preventDefault();
            run([card.id], 'reject', reason);
          }}
        >
          <Input aria-label="Why it is being rejected" autoFocus className="!py-1.5 text-sm" maxLength={500} placeholder="Why? The worker sees this." value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={busy}>Reject</Button>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>Cancel</Button>
          </div>
        </form>
      );
    }
    return (
      <div className="flex flex-wrap gap-2">
        {(card.status === 'Submitted' || card.status === 'Rejected') && (
          <Button size="sm" disabled={busy} onClick={() => run([card.id], 'approve')}>Approve</Button>
        )}
        {(card.status === 'Submitted' || card.status === 'Approved') && (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => { setRejecting(card.id); setReason(''); }}>Reject</Button>
        )}
        {card.status === 'Approved' && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run([card.id], 'unapprove')}>Un-approve</Button>
        )}
        {card.status === 'Exported' && canExport && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run([card.id], 'reopen')}>Reopen</Button>
        )}
      </div>
    );
  }

  function groupPanel(group: CardGroup) {
    const t = totals(group.cards);
    const groupWaiting = group.cards.filter((c) => c.status === 'Submitted');
    const perDay = days.map((d) => group.cards.filter((c) => c.work_date === d && c.status !== 'Rejected').reduce((n, c) => n + hoursOf(c), 0));
    return (
      <Panel key={group.key} className="!p-4 sm:!p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-white break-words">{group.label}</h3>
            <p className="text-sm text-slate-400">
              {hrs(t.regular)} regular, {hrs(t.overtime)} overtime
              {canSeePay && t.cost > 0 && <> · {formatMoney(t.cost)} approved</>}
            </p>
          </div>
          {canApprove && groupWaiting.length > 0 && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(groupWaiting.map((c) => c.id), 'approve')}>
              Approve {groupWaiting.length}
            </Button>
          )}
        </div>

        {view === 'worker' && (
          <div className="grid grid-cols-7 gap-1 mt-3" aria-label="Hours by day">
            {days.map((d, i) => (
              <div key={d} className={`rounded-lg px-1 py-1.5 text-center ${perDay[i] > MAX_DAY_HOURS ? 'bg-red-500/20 border border-red-500/40' : perDay[i] > 0 ? 'bg-slate-800' : 'bg-slate-950'}`} title={perDay[i] > MAX_DAY_HOURS ? 'More than 24 hours on this day. Check for a double entry.' : formatDay(d)}>
                <p className="text-[10px] uppercase text-slate-500">{formatDay(d).slice(0, 3)}</p>
                <p className={`text-sm font-semibold ${perDay[i] > 0 ? 'text-white' : 'text-slate-600'}`}>{perDay[i] > 0 ? hrs(perDay[i]) : '-'}</p>
              </div>
            ))}
          </div>
        )}

        <ul className="mt-3 divide-y divide-slate-800">
          {group.cards.map((card) => (
            <li key={card.id} className="py-3 flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
              <div className="flex-1 min-w-0">
                <Link href={`/timecards/${card.id}`} className="inline-flex items-center min-h-[48px] lg:min-h-0 font-semibold text-slate-100 hover:text-amber-400 break-words">
                  {card.work_date ? formatDay(card.work_date) : 'No date'} · {view === 'worker' ? card.title : card.employee_name}
                </Link>
                <p className="text-sm text-slate-400">
                  {hrs(Number(card.regular_hours ?? 0))} regular
                  {Number(card.overtime_hours ?? 0) > 0 && <>, {hrs(Number(card.overtime_hours))} overtime</>}
                  {canSeePay && card.labour_cost !== null && <> · {formatMoney(card.labour_cost)}</>}
                </p>
                {card.status === 'Rejected' && card.reject_reason && <p className="text-sm text-red-300 mt-1">Rejected: {card.reject_reason}</p>}
                {card.status === 'Approved' && card.approved_by_name && <p className="text-xs text-slate-500 mt-0.5">Approved by {card.approved_by_name}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <StatusPill status={card.status} />
                {cardActions(card)}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timecards"
        subtitle={projectName ? `Hours on ${projectName}` : isCrewLead ? 'Hours by worker and job. Approved cards lock and feed job cost.' : 'Your hours by week. Your foreman or project manager approves them.'}
        actions={
          canExport ? (
            <Button variant="secondary" onClick={() => { setExporting((x) => !x); setRange({ from: week, to: addDays(week, 6) }); }}>
              Export payroll
            </Button>
          ) : undefined
        }
      />

      <nav aria-label="Week" className="flex flex-wrap items-center gap-2">
        <ButtonLink variant="secondary" size="sm" href={weekHref(addDays(week, -7))}>← Previous</ButtonLink>
        <span className="text-sm font-semibold text-white px-2 text-center min-w-[11rem]">{formatWeek(week)}</span>
        <ButtonLink variant="secondary" size="sm" href={weekHref(addDays(week, 7))}>Next →</ButtonLink>
        {weekStart(today) !== week && <ButtonLink variant="ghost" size="sm" href={weekHref(weekStart(today))}>This week</ButtonLink>}
        {project && <ButtonLink variant="ghost" size="sm" href={`/timecards?week=${week}`}>All jobs</ButtonLink>}
      </nav>

      {!canWrite && <Alert tone="info">Your trial or subscription has ended, so timecards are read-only. {canManageBilling ? <><Link className="underline font-semibold" href="/settings/billing">Update billing</Link> to keep entering and approving time.</> : 'Ask your company owner to update billing.'}</Alert>}
      {partial && <Alert tone="info">This week has more cards than can be shown at once. Filter by project to see the rest. Approve all only covers the cards shown.</Alert>}
      {notice && (
        <Alert tone={notice.tone}>
          {notice.text}
          {notice.details && (
            <ul className="list-disc pl-5 mt-1">
              {notice.details.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
        </Alert>
      )}

      {exporting && (
        <Panel title="Export payroll" description="Downloads a spreadsheet of the approved cards in these dates. They move to Exported and stay locked, so they can't be paid twice." className="!p-4 sm:!p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tc-from">From</Label>
              <Input id="tc-from" className="[color-scheme:dark]" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="tc-to">To</Label>
              <Input id="tc-to" className="[color-scheme:dark]" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button disabled={busy || !canWrite} onClick={() => runExport(false)}>{busy ? 'Working...' : 'Export approved cards'}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => runExport(true)}>Download again</Button>
            <Button variant="ghost" onClick={() => setExporting(false)}>Cancel</Button>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stat('Regular hours', hrs(sum.regular))}
        {stat('Overtime hours', hrs(sum.overtime))}
        {stat('Waiting', String(waiting.length), 'Not yet approved')}
        {canSeePay ? stat('Approved labour', formatMoney(sum.cost), 'Includes exported cards') : stat('Approved', String(approved.length + cards.filter((c) => c.status === 'Exported').length))}
      </div>

      {noRate > 0 && (
        <Alert tone="info">
          {noRate} approved {noRate === 1 ? 'card has' : 'cards have'} no pay rate, so {noRate === 1 ? 'it counts' : 'they count'} as $0. {canEditRates ? <>Set the worker&apos;s rate in <Link className="underline font-semibold" href="/employees">Employees</Link> or a default in <Link className="underline font-semibold" href="/settings/company">Company settings</Link>, then un-approve and approve again.</> : 'Ask an owner or admin to set the rate, then un-approve and approve again.'}
        </Alert>
      )}

      {canEnter && <CrewEntry key={week} date={today >= week && today <= addDays(week, 6) ? today : week} initialProject={project} projects={projects} workers={workers} isCrewLead={isCrewLead} onSaved={(savedDate, count) => {
        setNotice({ tone: 'success', text: `${count} ${count === 1 ? 'card' : 'cards'} saved for ${formatDay(savedDate)}.` });
        if (weekStart(savedDate) !== week) router.push(weekHref(weekStart(savedDate)));
      }} />}

      <section className="space-y-4" aria-label="This week's cards">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div role="group" aria-label="Group cards by" className="inline-flex rounded-lg border border-slate-700 overflow-hidden self-start">
            {(['worker', 'job'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`px-4 py-2 min-h-[48px] lg:min-h-0 text-sm font-semibold ${view === v ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                By {v}
              </button>
            ))}
          </div>
          {canApprove && waiting.length > 0 && !confirmAll && <Button onClick={() => setConfirmAll(true)}>Approve all ({waiting.length})</Button>}
        </div>

        {confirmAll && (
          <Alert tone="info">
            <p>Approve {waiting.length} {waiting.length === 1 ? 'card' : 'cards'} for this week{projectName ? ` on ${projectName}` : ''}? Approved cards lock and the pay rate freezes. Any card of your own is left for a project manager.</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Button size="sm" disabled={busy} onClick={() => run(waiting.map((c) => c.id), 'approve')}>{busy ? 'Approving...' : 'Yes, approve all'}</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmAll(false)}>Cancel</Button>
            </div>
          </Alert>
        )}

        {groups.length === 0 ? (
          <Panel className="text-center !py-12">
            <p className="text-white font-semibold">No hours for this week</p>
            <p className="text-sm text-slate-400 mt-1">{canEnter ? 'Enter time above, or look at another week.' : 'Look at another week.'}</p>
          </Panel>
        ) : (
          groups.map(groupPanel)
        )}
      </section>
    </div>
  );
}
