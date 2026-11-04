import { redirect } from 'next/navigation';
import { getPageContext } from '@/lib/context';
import OnboardingForm from './onboarding-form';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const result = await getPageContext();
  if (result.status === 'signed-out') redirect('/login');
  if (result.status === 'ok') redirect('/');

  const { data: invitations } = await result.supabase.rpc('pending_invitations');
  return <OnboardingForm email={result.user.email ?? ''} invitations={(invitations ?? []) as { token: string; company_name: string; role: string }[]} />;
}
