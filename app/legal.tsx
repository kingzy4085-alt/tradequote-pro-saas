// Shared layout for the Terms and Privacy pages.
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: [string, string][] }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
        <p className="text-slate-400 mt-1 text-sm">Last updated {updated}</p>
        <div className="mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          {sections.map(([h, body]) => (
            <section key={h}>
              <h2 className="text-lg font-bold text-white">{h}</h2>
              <p className="text-slate-300 mt-2 text-sm leading-6">{body}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
