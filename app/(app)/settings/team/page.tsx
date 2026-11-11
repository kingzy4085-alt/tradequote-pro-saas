import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getPageContext } from '@/lib/context';
import { hasRank } from '@/lib/roles';
import TeamManager from './team-manager';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const result = await getPageContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;
  if (!hasRank(ctx.role, 4)) notFound();

  const [{ data: members }, { data: invitations }] = await Promise.all([
    ctx.supabase.from('company_users').select('user_id, role, full_name, email, created_at').order('created_at'),
    ctx.supabase.from('invitations').select('id, email, role, expires_at, created_at').is('accepted_at', null).order('created_at', { ascending: false }),
  ]);

  return (
    <>
      <PageHeader title="Team" subtitle="Invite your office and field staff. Each role only sees what it needs." back={{ href: '/', label: 'Back to Command Center' }} />
      <TeamManager
        currentUserId={ctx.user.id}
        isOwner={ctx.role === 'owner'}
        canWrite={ctx.canWrite}
        members={members ?? []}
        invitations={invitations ?? []}
      />
    </>
  );
}
