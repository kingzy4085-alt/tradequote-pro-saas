export default function TimecardsLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-pulse space-y-6">
      <span className="sr-only">Loading timecards...</span>
      <div className="h-8 w-48 max-w-full rounded-lg bg-slate-800" />
      <div className="h-10 w-80 max-w-full rounded-lg bg-slate-800/70" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-slate-800 bg-slate-900" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6 space-y-3">
          <div className="h-5 w-40 rounded bg-slate-800" />
          <div className="h-10 w-full rounded bg-slate-800/70" />
        </div>
      ))}
    </div>
  );
}
