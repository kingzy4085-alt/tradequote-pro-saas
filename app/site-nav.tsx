'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/help', label: 'How to Use' },
  { href: '/settings', label: 'Settings' },
  { href: '/about', label: 'About' },
  { href: '/pricing', label: 'Pricing' },
];

export function SiteNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {path !== '/' && (
            <button
              onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.href = '/'))}
              className="text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2 text-sm font-semibold"
              aria-label="Go back"
            >
              ← Back
            </button>
          )}
          <Link href="/" className="flex items-center gap-2">
            <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
            <span className="font-extrabold tracking-tight text-white hidden sm:inline">TradeQuote PRO</span>
          </Link>
        </div>
        <nav className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${active(l.href) ? 'bg-amber-500/10 text-amber-400' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden text-slate-200 border border-slate-700 rounded-lg px-3 py-2 text-sm font-semibold"
          aria-expanded={open}
        >
          Menu
        </button>
      </div>
      {open && (
        <nav className="md:hidden border-t border-slate-800 px-4 py-2 flex flex-col">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={`py-3 text-sm font-medium ${active(l.href) ? 'text-amber-400' : 'text-slate-300'}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-800 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 text-sm text-slate-500 flex flex-col sm:flex-row justify-between gap-3">
        <span>© {new Date().getFullYear()} TradeQuote PRO. All rights reserved · Industrial Shutdown & Electrical Contracting Operations Hub</span>
        <span className="flex gap-4">
          <Link href="/help" className="hover:text-slate-300">How to Use</Link>
          <Link href="/settings" className="hover:text-slate-300">Settings</Link>
          <Link href="/about" className="hover:text-slate-300">About</Link>
          <Link href="/terms" className="hover:text-slate-300">Terms</Link>
          <Link href="/privacy" className="hover:text-slate-300">Privacy</Link>
        </span>
      </div>
    </footer>
  );
}
