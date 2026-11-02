import Link from 'next/link';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-xs font-semibold text-amber-500 hover:underline uppercase tracking-wider">
          ← TradeQuote PRO
        </Link>
        <article className="mt-6 space-y-4 text-slate-300 leading-relaxed [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-white [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-8 [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </article>
      </div>
    </main>
  );
}
