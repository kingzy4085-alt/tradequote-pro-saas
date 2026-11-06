export default function AppLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-pulse space-y-6">
      <span className="sr-only">Loading...</span>
      <div className="h-8 w-64 max-w-full rounded-lg bg-slate-800" />
      <div className="h-4 w-96 max-w-full rounded bg-slate-800/70" />
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="h-4 w-full rounded bg-slate-800" />
        <div className="h-4 w-5/6 rounded bg-slate-800" />
        <div className="h-4 w-4/6 rounded bg-slate-800" />
      </div>
    </div>
  );
}
