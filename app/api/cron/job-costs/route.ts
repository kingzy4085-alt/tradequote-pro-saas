import { NextResponse } from 'next/server';
import { requireCron } from '@/lib/cron';
import { reconcileAllJobCosts } from '@/lib/job-cost';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Nightly (vercel.json): recomputes every job from scratch, as a safety net behind the triggers. A second run changes nothing. */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;
  return NextResponse.json(await reconcileAllJobCosts(createSupabaseAdminClient()));
}
