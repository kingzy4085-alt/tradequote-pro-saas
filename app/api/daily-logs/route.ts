import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const fail = (message: string, status = 500) => NextResponse.json({ success: false, error: message }, { status });

export async function GET() {
  if (!supabase) return fail('Database unavailable.', 503);
  const { data, error } = await supabase
    .from('daily-logs')
    .select('id, created_at, log_date, project, crew, crew_count, hours, weather, photos, signed_by, signed_at')
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return fail(error.message);
  return NextResponse.json({ success: true, data });
}

// Starts a new log for today; details are filled in on the log page
export async function POST(request: Request) {
  if (!supabase) return fail('Database unavailable.', 503);
  const body = await request.json().catch(() => ({}));
  const project = typeof body.project === 'string' ? body.project.trim().slice(0, 200) : '';
  if (!project) return fail('Project is required.', 400);
  const log_date = /^\d{4}-\d{2}-\d{2}$/.test(body.log_date) ? body.log_date : undefined;
  const { data, error } = await supabase.from('daily-logs').insert([{ project, name: project, log_date }]).select().single();
  if (error) return fail(error.message);
  return NextResponse.json({ success: true, data });
}
