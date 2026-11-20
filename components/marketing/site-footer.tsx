import Link from 'next/link';
import { COSTBOOK_AS_OF } from '@/lib/costbook';
import { Logo } from './site-header';
import './marketing.css';
import { WRAP } from './ui';

const link = 'inline-flex items-center min-h-[48px] lg:min-h-0 text-sm text-slate-400 hover:text-white';

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className={`${WRAP} py-12 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]`}>
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-slate-400">Estimates, signed proposals, billing and job costing for Canadian contractors.</p>
        </div>
        <nav aria-label="Product" className="flex flex-col">
          <p className="text-sm font-semibold text-white mb-1">Product</p>
          <Link href="/demo" className={link}>Live demo</Link>
          <Link href="/tools" className={link}>Free calculators</Link>
          <Link href="/pricing" className={link}>Pricing</Link>
        </nav>
        <nav aria-label="Company" className="flex flex-col">
          <p className="text-sm font-semibold text-white mb-1">Company</p>
          <Link href="/about" className={link}>About</Link>
          <Link href="/login" className={link}>Sign in</Link>
          <Link href="/signup" className={link}>Start free trial</Link>
        </nav>
        <nav aria-label="Legal" className="flex flex-col">
          <p className="text-sm font-semibold text-white mb-1">Legal</p>
          <Link href="/legal/privacy" className={link}>Privacy policy</Link>
          <Link href="/legal/terms" className={link}>Terms of service</Link>
        </nav>
      </div>
      <div className={`${WRAP} border-t border-slate-800/70 py-6 text-xs text-slate-500 space-y-1`}>
        <p>Reference prices on this site are dated baselines (cost book {COSTBOOK_AS_OF}). Confirm every price with your supplier before you quote. Sales tax and labour rates are starting points you can edit.</p>
        <p>TradeQuote PRO. Prices in Canadian dollars.</p>
      </div>
    </footer>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={"min-h-screen bg-slate-950 text-slate-100"}>
      {children}
    </div>
  );
}
