import type { ReactNode } from 'react';
import type { AppContext } from '@/lib/context';

// Columns of the companies row that print pages show. Only what a client may see.
const LETTERHEAD_COLUMNS = 'name, province, contact, phone, email, address, default_terms';

export interface LetterheadCompany {
  name: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  default_terms?: string | null;
}

/** Reads the company details for a print page, as the signed-in user. Falls back to the name already in the session. */
export async function loadLetterhead(ctx: Pick<AppContext, 'supabase' | 'company'>): Promise<LetterheadCompany> {
  const { data } = await ctx.supabase.from('companies').select(LETTERHEAD_COLUMNS).eq('id', ctx.company.id).maybeSingle();
  return (data as LetterheadCompany | null) ?? { name: ctx.company.name };
}

/** The top of every printed document: company on the left; document name and any dates on the right. */
export function Letterhead({ company, document, children }: { company: LetterheadCompany; document: string; children?: ReactNode }) {
  return (
    <header className="flex justify-between gap-6 border-b-2 border-black pb-5">
      <div>
        <h1 className="text-2xl font-bold text-black">{company.name}</h1>
        {company.address && <p>{company.address}</p>}
        <p>{[company.contact, company.phone, company.email].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="text-right">
        <p className="text-xl font-bold text-black uppercase tracking-wide">{document}</p>
        {children}
      </div>
    </header>
  );
}
