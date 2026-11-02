import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Pages for signed-in users who may not belong to a company yet.
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const {
    data: { user },
  } = await createSupabaseServerClient().auth.getUser();
  if (!user) redirect('/login');
  return children;
}
