import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Reports whether the app can reach its database. Never returns keys.
export async function GET() {
  if (!supabase) return NextResponse.json({ database: 'not configured' });
  const { error } = await supabase.from('projects').select('id', { head: true, count: 'exact' }).limit(1);
  return NextResponse.json({ database: error ? 'error' : 'connected', detail: error?.message });
}
