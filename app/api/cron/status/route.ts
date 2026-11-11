import { NextResponse } from 'next/server';
import { checkAutomationHealth, emailSettings, sendWith } from '@/lib/automation';
import { requireCron } from '@/lib/cron';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Whether the automation is running. 503 when it is not, so an uptime monitor can watch this too. */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;
  const settings = emailSettings();
  const health = await checkAutomationHealth(createSupabaseAdminClient(), settings, settings && sendWith(settings));
  return NextResponse.json(health, { status: health.healthy ? 200 : 503 });
}
