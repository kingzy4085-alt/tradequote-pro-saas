'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import AlertsBell from '@/components/alerts-bell';
import CommandPalette from '@/components/command-palette';
import { NavLinksProvider } from '@/components/nav-links';
import QuickAdd from '@/components/quick-add';
import type { QuickAction } from '@/lib/search';

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
  /** The "new" shortcuts this person's role can use. Empty when the company is read-only. */
  quickActions?: QuickAction[];
  /** Up to four pages for the phone's bottom bar. "More" opens the full menu. */
  mobileTabs?: { href: string; label: string }[];
  children: React.ReactNode;
}

export default function AppShell({ groups, companyName, userLabel, canWrite, trialDaysLeft, canManageBilling, quickActions = [], mobileTabs = [], children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  // Ctrl+K or Cmd+K from anywhere, and "/" when not typing in a field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const pages = groups.flatMap((g) => g.items);
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
                  className={`flex items-center min-h-[48px] lg:min-h-0 px-3 py-2 rounded-lg text-sm transition-colors ${
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
    <NavLinksProvider hrefs={pages.map((i) => i.href)}>
    <div className="min-h-screen bg-slate-950 text-slate-100 lg:flex print:block print:bg-white print:text-black">
      {/* Mobile top bar */}
      <header className="print:hidden lg:hidden sticky top-0 z-40 flex items-center justify-between bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <Link href="/" className="inline-flex items-center min-h-[48px] font-extrabold tracking-tight text-white">
          TradeQuote <span className="text-amber-500">PRO</span>
        </Link>
        <div className="flex items-center gap-2">
          <AlertsBell canWrite={canWrite} />
          <button type="button" onClick={() => setSearchOpen(true)} className="min-h-[48px] rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200">
            Search
          </button>
        </div>
      </header>
      {open && (
        <div id="mobile-nav" className="lg:hidden fixed inset-0 top-[73px] z-30 overflow-y-auto bg-slate-950 p-4 pb-28">
          {nav}
          <SignOut userLabel={userLabel} />
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden print:!hidden lg:flex lg:flex-col w-64 shrink-0 h-screen sticky top-0 border-r border-slate-800 bg-slate-950">
        <div className="px-6 py-5 border-b border-slate-800 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href="/" className="inline-flex items-center min-h-[48px] lg:min-h-0 text-lg font-extrabold tracking-tight text-white">
              TradeQuote <span className="text-amber-500">PRO</span>
            </Link>
            <p className="text-xs text-slate-400 mt-1 truncate" title={companyName}>
              {companyName}
            </p>
          </div>
          <div className="hidden lg:block">
            <AlertsBell canWrite={canWrite} />
          </div>
        </div>
        <div className="px-3 pt-4">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex min-h-[48px] lg:min-h-0 w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
          >
            <span>Search…</span>
            <kbd className="rounded border border-slate-700 px-1.5 font-sans text-[11px] text-slate-500">Ctrl K</kbd>
          </button>
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
        {/* Room at the bottom so the phone bar and the + button never cover the last row */}
        <main className="p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-24 print:p-0">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      {/* Phone bottom bar: the pages used most, one thumb away */}
      <nav aria-label="Quick" className="print:hidden lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${mobileTabs.length + 1}, minmax(0, 1fr))` }}>
          {mobileTabs.map((tab) => (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={isActive(tab.href) && !open ? 'page' : undefined}
                className={`flex h-16 w-full items-center justify-center px-1 text-center text-xs font-semibold ${isActive(tab.href) && !open ? 'text-amber-400' : 'text-slate-400'}`}
              >
                {tab.label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              className={`flex h-16 w-full items-center justify-center px-1 text-xs font-semibold ${open ? 'text-amber-400' : 'text-slate-400'}`}
            >
              {open ? 'Close' : 'More'}
            </button>
          </li>
        </ul>
      </nav>

      <QuickAdd actions={quickActions} />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} pages={pages} actions={quickActions} />
    </div>
    </NavLinksProvider>
  );
}

function SignOut({ userLabel }: { userLabel: string }) {
  return (
    <form action="/auth/signout" method="post" className="mt-4 lg:mt-0">
      <p className="text-xs text-slate-400 truncate mb-2" title={userLabel}>
        {userLabel}
      </p>
      <button type="submit" className="w-full min-h-[48px] lg:min-h-0 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors">
        Sign Out
      </button>
    </form>
  );
}
