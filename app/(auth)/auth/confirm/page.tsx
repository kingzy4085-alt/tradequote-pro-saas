import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, AuthCard, Button } from '@/components/ui';
import { safeNext } from '@/lib/safe-redirect';

// The address carries a one-time token: keep it out of search engines and other sites' logs
export const metadata: Metadata = { title: 'Reset your password', robots: { index: false, follow: false }, referrer: 'no-referrer' };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

/**
 * Password-reset links land here instead of being used straight away. Mail scanners
 * open links but don't press buttons, so the token is only spent when the person
 * presses Continue, on whichever device they opened the email.
 */
export default function ConfirmPage({ searchParams }: { searchParams: Params }) {
  const tokenHash = one(searchParams.token_hash);
  const type = one(searchParams.type);
  const rawNext = one(searchParams.next);
  const next = rawNext && safeNext(rawNext) === rawNext ? rawNext : '';

  const footer = (
    <Link href="/login" className="text-amber-400 hover:underline">
      ← Back to sign in
    </Link>
  );

  if (!tokenHash || type !== 'recovery') {
    return (
      <AuthCard title="Reset your password" footer={footer}>
        <Alert>That link is incomplete. Request a new one.</Alert>
        <Link href="/reset-password" className="mt-4 block text-center text-amber-400 hover:underline">
          Request a new reset link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Press continue to choose a new password." footer={footer}>
      <form method="post" action="/auth/callback" className="space-y-4">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        {next && <input type="hidden" name="next" value={next} />}
        <Button type="submit" size="lg" className="w-full">
          Continue
        </Button>
      </form>
    </AuthCard>
  );
}
