import { NextResponse } from 'next/server';
import { emailSettings, runAutomationJob, sendImmediateAlerts, sendWith } from '@/lib/automation';
import { requireCron } from '@/lib/cron';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily (vercel.json): status flips and alerts for every active company, then any safety email still waiting. */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;
  const admin = createSupabaseAdminClient();
  const summary = await runAutomationJob(admin);

  let immediate = null;
  const settings = emailSettings();
  if (settings) {
    try {
      immediate = await sendImmediateAlerts(admin, settings, sendWith(settings));
    } catch (err) {
      console.error('Safety alert sweep failed', err);
    }
  }
  return NextResponse.json({ ...summary, immediate, emailConfigured: !!settings });
}
