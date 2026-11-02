import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Panel } from '@/components/ui';
import { getContext } from '@/lib/context';
import { provinceName } from '@/lib/provinces';
import { ROLE_LABEL } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const result = await getContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;

  return (
    <>
      <PageHeader title="My Account" back={{ href: '/', label: 'Back to Command Center' }} />
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
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/update-password" className="text-amber-400 hover:underline">
            Change password
          </Link>
          <Link href="/legal/privacy" className="text-amber-400 hover:underline">
            Privacy Policy
          </Link>
          <Link href="/legal/terms" className="text-amber-400 hover:underline">
            Terms of Service
          </Link>
        </div>
      </Panel>
    </>
  );
}
