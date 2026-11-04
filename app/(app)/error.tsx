'use client';

import ErrorView from '@/components/error-view';

// Renders inside the app shell, so the menu stays available
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex justify-center py-16">
      <ErrorView error={error} reset={reset} />
    </div>
  );
}
