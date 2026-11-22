// Shared class strings for the public site. Every tappable thing is 48px tall on a phone.
export const WRAP = 'mx-auto w-full max-w-7xl px-4 sm:px-8';
export const BTN =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors min-h-[48px] lg:min-h-0 px-6 py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
export const BTN_PRIMARY = `${BTN} bg-amber-500 text-slate-950 hover:bg-amber-400`;
export const BTN_GHOST = `${BTN} bg-slate-900 text-slate-100 border border-slate-700 hover:border-slate-500 hover:bg-slate-800`;
/** Headline face: Archivo, narrowed. */
export const H = 'font-[family-name:var(--font-display)] font-extrabold tracking-tight [font-stretch:80%] leading-[0.98]';
export const money = (x: number) => x.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 });
export const money0 = (x: number) => x.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
