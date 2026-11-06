'use client';

import ErrorView from '@/components/error-view';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex-1 flex items-center justify-center bg-slate-950 p-6">
      <ErrorView error={error} reset={reset} />
    </main>
  );
}
