import type { SupabaseClient } from '@supabase/supabase-js';

export const LETTERHEAD_COLUMNS = 'name, province, contact, phone, email, address, default_terms';

export interface LetterheadCompany {
  name: string;
  province?: string | null;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  default_terms?: string | null;
}

/** Reads the signed-in user's company for a printed document. If that read fails, the name on hand still prints. */
export async function loadLetterhead(ctx: { supabase: SupabaseClient; company: { id: string; name: string } }): Promise<LetterheadCompany> {
  const { data } = await ctx.supabase.from('companies').select(LETTERHEAD_COLUMNS).eq('id', ctx.company.id).maybeSingle();
  return (data as LetterheadCompany | null) ?? { name: ctx.company.name };
}

/** A date as printed on documents, e.g. November 4, 2026. */
export const printDate = (d: Date) => d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

/** Top of every printed document: company on the left, document name and its dates on the right. */
export function Letterhead({ company, title, details = [], tagline }: { company: LetterheadCompany; title: string; details?: string[]; tagline?: string }) {
  const contact = [company.contact, company.phone, company.email].filter(Boolean).join(' · ');
  return (
    <header className="flex justify-between gap-6 border-b-2 border-black pb-5">
      <div>
        <h1 className="text-2xl font-bold text-black">{company.name}</h1>
        {tagline && <p>{tagline}</p>}
        {company.address && <p>{company.address}</p>}
        {contact && <p>{contact}</p>}
      </div>
      <div className="text-right">
        <p className="text-xl font-bold text-black uppercase tracking-wide">{title}</p>
        {details.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </header>
  );
}
