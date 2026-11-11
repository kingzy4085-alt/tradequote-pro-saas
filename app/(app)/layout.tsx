import { redirect } from 'next/navigation';
import AppShell, { type NavGroup } from '@/components/app-shell';
import { getPageContext } from '@/lib/context';
import { MODULE_GROUPS, MODULES, getModule } from '@/lib/modules';
import { ROLE_LABEL, hasRank, type Role } from '@/lib/roles';
import { quickActions } from '@/lib/search';

export const dynamic = 'force-dynamic';

// The phone's bottom bar, in order of preference. The first four this role can open are shown.
const MOBILE_TABS: { href: string; label: string; slug?: string }[] = [
  { href: '/', label: 'Home' },
  { href: '/pipeline', label: 'Quotes', slug: 'estimates' },
  { href: '/crm', label: 'Clients', slug: 'crm' },
  { href: '/timecards', label: 'Time', slug: 'timecards' },
  { href: '/daily-logs', label: 'Logs', slug: 'daily-logs' },
  { href: '/crew-schedule', label: 'Schedule', slug: 'crew-schedule' },
];

const canOpen = (role: Role, slug: string) => hasRank(role, getModule(slug)!.read);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const result = await getPageContext();
  if (result.status === 'signed-out') redirect('/login');
  if (result.status === 'no-company') redirect('/onboarding');
  const { ctx } = result;

  const seesPipeline = canOpen(ctx.role, 'estimates') && canOpen(ctx.role, 'proposals');
  const groups: NavGroup[] = [
    {
      label: 'Workspace',
      items: [
        { href: '/', label: 'Command Center' },
        ...(seesPipeline ? [{ href: '/pipeline', label: 'Quote Pipeline' }] : []),
        { href: '/calendar', label: 'Calendar' },
        ...(canOpen(ctx.role, 'estimates') ? [{ href: '/assemblies', label: 'Assemblies' }] : []),
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

  const mobileTabs = MOBILE_TABS.filter((t) => (t.href === '/pipeline' ? seesPipeline : !t.slug || canOpen(ctx.role, t.slug)))
    .slice(0, 4)
    .map(({ href, label }) => ({ href, label }));

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
      pastDue={ctx.company.subscription_status === 'past_due'}
      quickActions={quickActions(ctx.role, ctx.canWrite)}
      mobileTabs={mobileTabs}
    >
      {children}
    </AppShell>
  );
}
