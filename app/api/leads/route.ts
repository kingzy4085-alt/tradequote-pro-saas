import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Public founding-list signup from /pricing. Stores only the form's fields.
const FIELDS = ['name', 'company', 'email', 'phone', 'tier', 'billing'];

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const row: Record<string, string> = {};
  for (const f of FIELDS) if (typeof body[f] === 'string') row[f] = body[f].trim().slice(0, 200);
  if (!row.name || !row.company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email || '')) {
    return NextResponse.json({ success: false, error: 'Name, company and a valid email are required.' }, { status: 400 });
  }
  if (!supabase) return NextResponse.json({ success: false, error: 'Signups are unavailable.' }, { status: 503 });
  const { error } = await supabase.from('leads').insert([row]);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
