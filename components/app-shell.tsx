'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export interface NavGroup {
  label: string;
  items: { href: string; label: string }[];
}

interface Props {
  groups: NavGroup[];
  companyName: string;
  userLabel: string;
  canWrite: boolean;
  trialDaysLeft: number | null;
  canManageBilling: boolean;
  children: React.ReactNode;
}

export default function AppShell({ groups, companyName, userLabel, canWrite, trialDaysLeft, canManageBilling, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'));

  const nav = (
    <nav aria-label="Main" className="space-y-6">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{g.label}</p>
          <ul>
            {g.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive(item.href) ? 'bg-amber-500/10 text-amber-400 font-semibold' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 lg:flex print:block print:bg-white print:text-black">
      {/* Mobile top bar */}
      <header className="print:hidden lg:hidden sticky top-0 z-40 flex items-center justify-between bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <Link href="/" className="font-extrabold tracking-tight text-white">
          TradeQuote <span className="text-amber-500">PRO</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </header>
      {open && (
        <div id="mobile-nav" className="lg:hidden fixed inset-0 top-[57px] z-30 overflow-y-auto bg-slate-950 p-4">
          {nav}
          <SignOut userLabel={userLabel} />
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden print:!hidden lg:flex lg:flex-col w-64 shrink-0 h-screen sticky top-0 border-r border-slate-800 bg-slate-950">
        <div className="px-6 py-5 border-b border-slate-800">
          <Link href="/" className="text-lg font-extrabold tracking-tight text-white">
            TradeQuote <span className="text-amber-500">PRO</span>
          </Link>
          <p className="text-xs text-slate-400 mt-1 truncate" title={companyName}>
            {companyName}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">{nav}</div>
        <div className="border-t border-slate-800 p-4">
          <SignOut userLabel={userLabel} />
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {!canWrite && (
          <div role="alert" className="print:hidden bg-red-500/10 border-b border-red-500/30 px-4 py-3 text-sm text-red-300">
            Your trial or subscription has ended — records are read-only.{' '}
            {canManageBilling ? (
              <Link href="/settings/billing" className="font-semibold underline">
                Update billing
              </Link>
            ) : (
              'Ask your company owner to update billing.'
            )}
          </div>
        )}
        {canWrite && trialDaysLeft !== null && trialDaysLeft <= 7 && (
          <div className="print:hidden bg-amber-500/10 border-b border-amber-500/30 px-4 py-3 text-sm text-amber-200">
            {trialDaysLeft === 0 ? 'Your trial ends today.' : `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in your free trial.`}{' '}
            {canManageBilling && (
              <Link href="/settings/billing" className="font-semibold underline">
                Subscribe
              </Link>
            )}
          </div>
        )}
        <main className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SignOut({ userLabel }: { userLabel: string }) {
  return (
    <form action="/auth/signout" method="post" className="mt-4 lg:mt-0">
      <p className="text-xs text-slate-400 truncate mb-2" title={userLabel}>
        {userLabel}
      </p>
      <button type="submit" className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors">
        Sign Out
      </button>
    </form>
  );
}
