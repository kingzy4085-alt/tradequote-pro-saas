'use client';

import { Bell, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AlertsPanel from '@/components/alerts-panel';

const REFRESH_MS = 5 * 60_000;

/** The bell with its count. Opens the alerts in a drawer: a side panel on a computer, the whole screen on a phone. */
export default function AlertsBell({ canWrite }: { canWrite: boolean }) {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    let asked = false;
    async function refresh() {
      // The shell has a phone bell and a computer bell, and only one is on screen. Only that one asks.
      if (!bellRef.current?.offsetParent) return;
      asked = true;
      // A missed count is not worth an error on every page. The drawer shows one if it matters.
      try {
        const res = await fetch('/api/alerts?summary=1', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setCount(json.summary?.total ?? 0);
      } catch {
        // Offline on site. Keep the last count.
      }
    }
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    // Turning a tablet can bring the other bell on screen. Only its first look counts: phones fire this while scrolling.
    const onResize = () => {
      if (!asked) refresh();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [pathname]);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const bell = bellRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    // The page behind stays put while the drawer scrolls
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      bell?.focus();
    };
  }, [open]);

  const label = count ? `Alerts, ${count} need attention` : 'Alerts';

  return (
    <>
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {!!count && (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-[11px] font-bold leading-5 text-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {/* On the body, because the phone header's backdrop-blur would shrink a fixed drawer to the header's height */}
      {open && createPortal(
        <div className="print:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-950/70" onClick={() => setOpen(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="Alerts" className="absolute inset-y-0 right-0 flex w-full sm:max-w-md flex-col bg-slate-900 sm:border-l border-slate-800 shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <h2 className="text-lg font-bold text-white">Alerts</h2>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close alerts" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <AlertsPanel canWrite={canWrite} onCountChange={setCount} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
