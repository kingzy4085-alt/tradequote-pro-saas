import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TEXT = ['project', 'crew', 'weather', 'work_done', 'delays', 'safety_notes'];
const fail = (message: string, status = 500) => NextResponse.json({ success: false, error: message }, { status });
const notFound = () => fail('Log not found.', 404);
const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id) || /^\d+$/.test(id);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return fail('Database unavailable.', 503);
  if (!validId(id)) return notFound();
  const { data, error } = await supabase.from('daily-logs').select('*').eq('id', id).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return notFound();
  return NextResponse.json({ success: true, data });
}

// Saves log details, photos, and signs or reopens the log.
// A signed log can't be edited; reopening it clears the signature.
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return fail('Database unavailable.', 503);
  if (!validId(id)) return notFound();
  const body = await request.json().catch(() => ({}));
  const current = await supabase.from('daily-logs').select('id, signed_at, company_id').eq('id', id).maybeSingle();
  if (current.error) return fail(current.error.message);
  if (!current.data) return notFound();

  const row: Record<string, unknown> = {};
  if (body.action === 'reopen') {
    Object.assign(row, { signed_by: null, signature: null, signed_at: null });
  } else {
    if (current.data.signed_at) return fail('This log is signed. Reopen it to make changes.', 409);
    for (const f of TEXT) if (f in body) row[f] = typeof body[f] === 'string' ? body[f].slice(0, 20000) : null;
    if ('project' in row) row.name = row.project;
    if ('log_date' in body) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.log_date)) return fail('Date must be YYYY-MM-DD.', 400);
      row.log_date = body.log_date;
    }
    for (const f of ['crew_count', 'hours']) {
      if (!(f in body)) continue;
      const n = body[f] === '' ? 0 : Number(body[f]);
      if (!Number.isFinite(n) || n < 0) return fail(`${f === 'hours' ? 'Hours' : 'Crew size'} must be 0 or more.`, 400);
      row[f] = f === 'crew_count' ? Math.round(n) : n;
    }
    if ('photos' in body) {
      // Photos must sit in this company's own storage folder
      const prefix = `${current.data.company_id}/`;
      if (!Array.isArray(body.photos) || body.photos.length > 50 || body.photos.some((p: unknown) => typeof p !== 'string' || !p.startsWith(prefix)))
        return fail('Invalid photo list.', 400);
      row.photos = body.photos;
    }
    if (body.action === 'sign') {
      const name = typeof body.signed_by === 'string' ? body.signed_by.trim().slice(0, 200) : '';
      if (!name) return fail('Enter the name of the person signing.', 400);
      if (typeof body.signature !== 'string' || !body.signature.startsWith('data:image/png;base64,') || body.signature.length > 300000)
        return fail('Draw a signature first.', 400);
      Object.assign(row, { signed_by: name, signature: body.signature, signed_at: new Date().toISOString() });
    }
  }

  const { data, error } = await supabase.from('daily-logs').update(row).eq('id', id).select().maybeSingle();
  if (error) return fail(error.message);
  return NextResponse.json({ success: true, data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!supabase) return fail('Database unavailable.', 503);
  if (!validId(id)) return notFound();
  const { data, error } = await supabase.from('daily-logs').delete().eq('id', id).select('photos');
  if (error) return fail(error.message);
  if (!data.length) return notFound();
  const photos = (data[0].photos as string[]) || [];
  if (photos.length) await supabase.storage.from('job-photos').remove(photos);
  return NextResponse.json({ success: true });
}
