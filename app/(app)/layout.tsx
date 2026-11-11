import { redirect } from 'next/navigation';
import AppShell, { type NavGroup } from '@/components/app-shell';
import { getPageContext } from '@/lib/context';
import { MODULE_GROUPS, MODULES } from '@/lib/modules';
import { ROLE_LABEL, hasRank } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const result = await getPageContext();
  if (result.status === 'signed-out') redirect('/login');
  if (result.status === 'no-company') redirect('/onboarding');
  const { ctx } = result;

  const groups: NavGroup[] = [
    {
      label: 'Workspace',
      items: [
        { href: '/', label: 'Command Center' },
        { href: '/assistant', label: 'AI Assistant' },
        { href: '/help', label: 'How to Use' },
      ],
    },
    ...MODULE_GROUPS.map((group) => ({
      label: group,
      items: MODULES.filter((m) => m.group === group && hasRank(ctx.role, m.read)).map((m) => ({ href: `/${m.slug}`, label: m.label })),
    })).filter((g) => g.items.length > 0),
    {
      label: 'Company',
      items: [
        { href: '/settings/company', label: 'Company Profile' },
        ...(hasRank(ctx.role, 4) ? [{ href: '/settings/team', label: 'Team' }] : []),
        ...(hasRank(ctx.role, 4) ? [{ href: '/settings/billing', label: 'Billing' }] : []),
        { href: '/settings/account', label: 'My Account' },
      ],
    },
  ];

  const trialDaysLeft =
    ctx.company.subscription_status === 'trialing'
      ? Math.max(0, Math.ceil((new Date(ctx.company.trial_ends_at).getTime() - Date.now()) / 86_400_000))
      : null;

  return (
    <AppShell
      groups={groups}
      companyName={ctx.company.name}
      userLabel={`${ctx.user.email ?? ''} · ${ROLE_LABEL[ctx.role]}`}
      canWrite={ctx.canWrite}
      trialDaysLeft={trialDaysLeft}
      canManageBilling={hasRank(ctx.role, 4)}
    >
      {children}
    </AppShell>
  );
}
