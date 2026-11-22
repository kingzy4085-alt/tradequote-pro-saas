import Link from 'next/link';
import { Menu } from 'lucide-react';
import { BTN, WRAP } from './ui';

export const NAV = [
  { href: '/#engines', label: 'Product' },
  { href: '/demo', label: 'Live demo' },
  { href: '/tools', label: 'Free calculators' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
] as const;

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 min-h-[48px] lg:min-h-0 font-extrabold tracking-tight text-white whitespace-nowrap ${className}`} aria-label="TradeQuote PRO home">
      <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-amber-500 text-slate-950 text-sm font-black">T</span>
      <span className="text-base sm:text-lg">
        TradeQuote <span className="text-amber-400">PRO</span>
      </span>
    </Link>
  );
}

/** Sticky site header. The phone menu is a <details>, so it needs no script. */
export function SiteHeader() {
  const link = 'inline-flex items-center min-h-[48px] lg:min-h-0 px-3 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white hover:bg-slate-800/70 transition-colors';
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
      <div className={`${WRAP} flex items-center justify-between gap-3 py-2 lg:py-3`}>
        <Logo />
        <nav aria-label="Main" className="hidden lg:flex items-center gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={link}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className={`${link} hidden sm:inline-flex`}>
            Sign in
          </Link>
          <Link href="/signup" className={`${BTN} bg-amber-500 text-slate-950 hover:bg-amber-400 !px-3 sm:!px-4 !py-2.5 text-sm whitespace-nowrap`}>
            Start free trial
          </Link>
          <details className="relative lg:hidden group">
            <summary className="list-none grid place-items-center h-12 w-12 rounded-lg border border-slate-700 text-slate-200 cursor-pointer [&::-webkit-details-marker]:hidden" aria-label="Menu">
              <Menu className="h-5 w-5" />
            </summary>
            <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className={`${link} w-full`}>
                  {n.label}
                </Link>
              ))}
              <Link href="/login" className={`${link} w-full`}>
                Sign in
              </Link>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
