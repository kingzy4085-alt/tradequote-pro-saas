import { NextResponse } from 'next/server';
import { checkAutomationHealth, emailSettings, runDigestJob, sendImmediateAlerts, sendWith } from '@/lib/automation';
import { requireCron } from '@/lib/cron';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily (vercel.json): each foreman and up gets the alerts that changed for them. Also checks the automation is healthy. */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;
  const admin = createSupabaseAdminClient();
  const settings = emailSettings();
  if (!settings) {
    await checkAutomationHealth(admin, null, null);
    return NextResponse.json({ sent: 0, notConfigured: true });
  }
  const send = sendWith(settings);
  try {
    await sendImmediateAlerts(admin, settings, send);
  } catch (err) {
    console.error('Safety alert sweep failed', err);
  }
  const summary = await runDigestJob(admin, settings, send);
  const health = await checkAutomationHealth(admin, settings, send);
  return NextResponse.json({ ...summary, healthy: health.healthy });
}
