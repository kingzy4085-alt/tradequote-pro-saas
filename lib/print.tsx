import type { ReactNode } from 'react';
import { COMPANY_LOGOS_BUCKET, LOGO_URL_SECONDS } from '@/lib/company-logo';
import type { AppContext } from '@/lib/context';

// Columns of the companies row that print pages show. Only what a client may see.
const LETTERHEAD_COLUMNS = 'name, province, contact, phone, email, address, tax_number, default_terms';

export interface LetterheadCompany {
  name: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  /** GST/HST registration number. A Canadian customer needs it on an invoice to claim the tax back. */
  tax_number?: string | null;
  default_terms?: string | null;
  /** Where the logo is kept in private storage. Pages show it through logo_url, never this path. */
  logo_path?: string | null;
  /** A short-lived signed link to the logo, set by loadLetterhead when the company has one. */
  logo_url?: string | null;
}

/** A link to the logo that works for a few minutes, or null. A missing file or a storage outage only leaves the logo off. */
async function signedLogoUrl(ctx: Pick<AppContext, 'supabase'>, path: string): Promise<string | null> {
  try {
    const { data, error } = await ctx.supabase.storage.from(COMPANY_LOGOS_BUCKET).createSignedUrl(path, LOGO_URL_SECONDS);
    if (error || !data?.signedUrl) {
      if (error) console.error('Could not sign the company logo link', error);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    console.error('Could not sign the company logo link', err);
    return null;
  }
}

/**
 * Reads the company details for a print page, as the signed-in user, with a short-lived link to the
 * logo when there is one. Falls back to the name already in the session. The logo is extra: if it
 * can't be read or signed, the page prints without it.
 */
export async function loadLetterhead(ctx: Pick<AppContext, 'supabase' | 'company'>): Promise<LetterheadCompany> {
  const companies = () => ctx.supabase.from('companies');
  let { data, error } = await companies().select(`${LETTERHEAD_COLUMNS}, logo_path`).eq('id', ctx.company.id).maybeSingle();
  // A database the logo migration hasn't reached yet still prints the rest of the letterhead
  if (error) ({ data } = await companies().select(LETTERHEAD_COLUMNS).eq('id', ctx.company.id).maybeSingle());
  const company = (data as LetterheadCompany | null) ?? { name: ctx.company.name };
  if (!company.logo_path) return company;
  return { ...company, logo_url: await signedLogoUrl(ctx, company.logo_path) };
}

/** The top of every printed document: company on the left; document name and any dates on the right. */
export function Letterhead({ company, document, children }: { company: LetterheadCompany; document: string; children?: ReactNode }) {
  return (
    <header className="flex justify-between gap-6 border-b-2 border-black pb-5">
      <div>
        {company.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to private storage
          <img src={company.logo_url} alt="" className="mb-3 h-16 w-auto max-w-[240px] object-contain object-left" />
        )}
        <h1 className="text-2xl font-bold text-black">{company.name}</h1>
        {company.address && <p>{company.address}</p>}
        <p>{[company.contact, company.phone, company.email].filter(Boolean).join(' · ')}</p>
        {company.tax_number && <p>{`GST/HST No. ${company.tax_number}`}</p>}
      </div>
      <div className="text-right">
        <p className="text-xl font-bold text-black uppercase tracking-wide">{document}</p>
        {children}
      </div>
    </header>
  );
}
