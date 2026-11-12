import { SupportLine } from '@/components/support-contact';
import { ButtonLink } from '@/components/ui';
import { env } from '@/lib/env';

export const metadata = { title: 'Page not found · TradeQuote PRO' };

export default function NotFound() {
  return (
    <main className="flex-1 flex items-center justify-center bg-slate-950 p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-bold uppercase tracking-wider text-amber-400">TradeQuote PRO</p>
        <h1 className="mt-3 text-3xl font-bold text-white">We can't find that page</h1>
        <p className="mt-3 text-slate-400">The link may be old, or the record may have been deleted. It could also be a page your role doesn't have access to.</p>
        <div className="mt-6 flex justify-center">
          <ButtonLink href="/">Back to Command Center</ButtonLink>
        </div>
        <SupportLine email={env.supportEmail()} lead="Think this page should be here?" subject="TradeQuote PRO page not found" />
      </div>
    </main>
  );
}
