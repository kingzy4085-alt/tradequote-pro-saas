'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { QuickAction } from '@/lib/search';

/** The floating "+" button: start a new estimate, client, invoice or log from any page. */
export default function QuickAdd({ actions }: { actions: QuickAction[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (!actions.length) return null;

  return (
    <div ref={root} className="print:hidden fixed right-4 bottom-24 lg:bottom-6 lg:right-6 z-40 flex flex-col items-end gap-2">
      {open && (
        <ul id="quick-add-menu" aria-label="Create" className="w-56 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 p-1 shadow-2xl">
          {actions.map((a) => (
            <li key={a.href}>
              <Link href={a.href} className="flex items-center min-h-[48px] rounded-xl px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-amber-500/10 hover:text-amber-300">
                {a.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="quick-add-menu"
        aria-label={open ? 'Close the create menu' : 'Create something new'}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-3xl font-bold leading-none text-slate-950 shadow-xl shadow-black/40 transition-transform hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        <span aria-hidden="true" className={`transition-transform ${open ? 'rotate-45' : ''}`}>
          +
        </span>
      </button>
    </div>
  );
}
