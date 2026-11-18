'use client';

import { useEffect } from 'react';
import { SupportLine, useSupportEmail } from '@/components/support-contact';
import { Button, ButtonLink } from '@/components/ui';
import { reportClientError } from '@/lib/error-report';

/**
 * The body of every error boundary: says what happened, offers a retry and a way home, and says who
 * to ask. Each error is reported once to /api/client-errors, without waiting for an answer.
 */
export default function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const supportEmail = useSupportEmail();

  useEffect(() => {
    console.error(error);
    reportClientError(error);
  }, [error]);

  return (
    <div className="max-w-md text-center" role="alert">
      <p className="text-sm font-bold uppercase tracking-wider text-amber-400">TradeQuote PRO</p>
      <h1 className="mt-3 text-3xl font-bold text-white">Something went wrong</h1>
      <p className="mt-3 text-slate-400">We couldn't load this page. Your saved work is safe. Try again, and if it keeps happening, give it a few minutes.</p>
      {error.digest && <p className="mt-3 text-xs text-slate-500">{`Reference: ${error.digest}`}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="secondary">
          Back to Command Center
        </ButtonLink>
      </div>
      <SupportLine email={supportEmail} lead="Still not working?" subject={error.digest ? `TradeQuote PRO error, reference ${error.digest}` : 'TradeQuote PRO error'} />
    </div>
  );
}
