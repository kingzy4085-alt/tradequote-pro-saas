import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Panel } from '@/components/ui';
import { getPageContext } from '@/lib/context';
import { provinceName } from '@/lib/provinces';
import { ROLE_LABEL, hasRank } from '@/lib/roles';
import { ClosePanel, ExportPanel } from './owner-tools';

export const dynamic = 'force-dynamic';

/** Downloading everything and closing the account are for the owner alone (rank 5). */
const OWNER_RANK = 5;

export default async function AccountPage() {
  const result = await getPageContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;
  const isOwner = hasRank(ctx.role, OWNER_RANK);

  return (
    <>
      <PageHeader title="My Account" back={{ href: '/', label: 'Back to Command Center' }} />
      <div className="space-y-6">
        <Panel title="Profile">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Email</dt>
              <dd className="text-white mt-1">{ctx.user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Role</dt>
              <dd className="text-white mt-1">{ROLE_LABEL[ctx.role]}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Company</dt>
              <dd className="text-white mt-1">{ctx.company.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Province</dt>
              <dd className="text-white mt-1">{provinceName(ctx.company.province)}</dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/update-password" className="min-h-[48px] lg:min-h-0 inline-flex items-center text-amber-400 hover:underline">
              Change password
            </Link>
            <Link href="/legal/privacy" className="min-h-[48px] lg:min-h-0 inline-flex items-center text-amber-400 hover:underline">
              Privacy Policy
            </Link>
            <Link href="/legal/terms" className="min-h-[48px] lg:min-h-0 inline-flex items-center text-amber-400 hover:underline">
              Terms of Service
            </Link>
          </div>
          {!isOwner && <p className="mt-4 text-sm text-slate-400">The company owner can download all of the company&apos;s data or close the company account from this page.</p>}
        </Panel>
        {isOwner && (
          <>
            <ExportPanel />
            <ClosePanel companyName={ctx.company.name} />
          </>
        )}
      </div>
    </>
  );
}
