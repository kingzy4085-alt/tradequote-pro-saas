import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { COMPANY_PROFILE_COLUMNS } from '@/lib/company';
import { getPageContext } from '@/lib/context';
import { PROJECT_MONEY_RANK, withCompanyRates } from '@/lib/project-money';
import { hasRank } from '@/lib/roles';
import CompanyForm, { type Profile } from './company-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Company · TradeQuote PRO' };

export default async function CompanyPage() {
  const result = await getPageContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;
  const { data } = await ctx.supabase.from('companies').select(COMPANY_PROFILE_COLUMNS).eq('id', ctx.company.id).maybeSingle();
  const full = await withCompanyRates(ctx.supabase, ctx.role, data ?? { name: ctx.company.name, province: ctx.company.province });
  if ('error' in full) throw new Error('Could not load the company profile.');

  return (
    <>
      <PageHeader title="Company" subtitle="Your company details and estimating defaults, shown on proposals." back={{ href: '/', label: 'Back to Command Center' }} />
      <CompanyForm initial={full.profile as Profile} canEdit={hasRank(ctx.role, 4)} canSeeRates={hasRank(ctx.role, PROJECT_MONEY_RANK)} />
    </>
  );
}
