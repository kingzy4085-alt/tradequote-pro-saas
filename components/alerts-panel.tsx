'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { alertHref, groupBySeverity, lastCheckedLabel, moduleLabel, SEVERITY_LABEL, type AlertRow, type AlertSeverity, type AlertSummary } from '@/lib/alerts';
import { formatValue } from '@/lib/format';

const SEVERITY_STYLE: Record<AlertSeverity, { heading: string; bar: string }> = {
  critical: { heading: 'text-red-400', bar: 'border-l-red-500' },
  warning: { heading: 'text-amber-400', bar: 'border-l-amber-500' },
  info: { heading: 'text-slate-400', bar: 'border-l-slate-600' },
};

/**
 * What needs attention for the signed-in user: most urgent first, with snooze and dismiss,
 * which only affect them. Used inside the bell's drawer and on the alerts page, where it can be
 * narrowed to one severity or one module.
 */
export default function AlertsPanel({ canWrite = true, onCountChange, onNavigate, severity, module }: { canWrite?: boolean; onCountChange?: (total: number) => void; onNavigate?: () => void; severity?: AlertSeverity; module?: string }) {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/alerts', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load');
      const json = await res.json();
      setAlerts(json.data ?? []);
      setSummary(json.summary ?? null);
      onCountChange?.(json.summary?.total ?? 0);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(alert: AlertRow, body: { action: 'snooze'; days: number } | { action: 'dismiss' }) {
    setBusyId(alert.id);
    setActionError('');
    try {
      const res = await fetch(`/api/alerts/${alert.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json.error ?? 'That did not save. Try again.');
        return;
      }
      setAlerts((list) => list.filter((a) => a.id !== alert.id));
      setSummary((s) => {
        if (!s) return s;
        const next = { ...s, total: Math.max(0, s.total - 1), [alert.severity]: Math.max(0, s[alert.severity] - 1) };
        onCountChange?.(next.total);
        return next;
      });
    } catch {
      setActionError('Network error. Check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (status === 'loading') {
    return (
      <div aria-busy="true" className="space-y-3" role="status" aria-label="Loading alerts">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-slate-800/60 animate-pulse" />
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="text-center py-8 text-slate-400">
        <p className="mb-3">Your alerts could not be loaded.</p>
        <Button variant="secondary" size="sm" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  const shown = alerts.filter((a) => (!severity || a.severity === severity) && (!module || a.module === module));
  // The server counts everything but sends the most urgent first, so only these totals can be trusted past the list's end
  const expected = module ? shown.length : severity ? summary?.[severity] ?? shown.length : summary?.total ?? shown.length;
  const extra = expected - shown.length;

  return (
    <div>
      {actionError && (
        <div className="mb-4">
          <Alert>{actionError}</Alert>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="text-center py-8">
          <p className="font-semibold text-white">{severity || module ? 'Nothing here right now' : 'Nothing needs your attention'}</p>
          <p className="text-sm text-slate-400 mt-1">Overdue invoices, expiring insurance and open safety items show up here.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupBySeverity(shown).map((group) => (
            <section key={group.severity}>
              <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${SEVERITY_STYLE[group.severity].heading}`}>
                {SEVERITY_LABEL[group.severity]} ({module ? group.alerts.length : summary?.[group.severity] ?? group.alerts.length})
              </h3>
              <ul className="space-y-2">
                {group.alerts.map((alert) => (
                  <li key={alert.id} className={`rounded-xl border border-slate-800 border-l-4 bg-slate-950/60 p-3 ${SEVERITY_STYLE[alert.severity].bar}`}>
                    <Link href={alertHref(alert)} onClick={onNavigate} className="block font-medium text-white hover:text-amber-400 break-words">
                      {alert.title}
                    </Link>
                    <p className="text-sm text-slate-300 mt-0.5 break-words">{alert.message}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {moduleLabel(alert.module)}
                      {alert.due_on ? ` · ${formatValue('date', alert.due_on)}` : ''}
                    </p>
                    {canWrite && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        <Button variant="ghost" size="sm" className="min-h-[36px]" disabled={busyId === alert.id} onClick={() => act(alert, { action: 'snooze', days: 1 })}>
                          Snooze a day
                        </Button>
                        <Button variant="ghost" size="sm" className="min-h-[36px]" disabled={busyId === alert.id} onClick={() => act(alert, { action: 'snooze', days: 7 })}>
                          Snooze a week
                        </Button>
                        <Button variant="ghost" size="sm" className="min-h-[36px]" disabled={busyId === alert.id} onClick={() => act(alert, { action: 'dismiss' })}>
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {extra > 0 && <p className="text-sm text-slate-400">Showing the first {shown.length}. Clear some to see the other {extra}.</p>}
        </div>
      )}

      <p className="text-xs text-slate-500 mt-6">{lastCheckedLabel(summary?.last_checked)}</p>
    </div>
  );
}
