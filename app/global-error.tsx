'use client';

import ErrorView from '@/components/error-view';
import './globals.css';

// Replaces the root layout when that layout itself fails, so it brings its own html and body
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <ErrorView error={error} reset={reset} />
      </body>
    </html>
  );
}
