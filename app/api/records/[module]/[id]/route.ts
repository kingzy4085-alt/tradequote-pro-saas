import { supabase } from '@/lib/supabase';
import { fail, isDate, isSignature, isUuid, ok, text } from '@/lib/api-helpers';
import { RECORD_MODULES, isLocked, type Signature } from '@/lib/records';

const notFound = () => fail('Record not found.', 404);

export async function GET(_request: Request, { params }: { params: { module: string; id: string } }) {
  const m = RECORD_MODULES[params.module];
  if (!m || !isUuid(params.id)) return notFound();
  if (!supabase) return fail('Database unavailable.', 503);
  const { data, error } = await supabase.from(m.table).select('*').eq('id', params.id).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return notFound();
  return ok(data);
}

// Saves fields/photos, adds a signature in the module's order, or reopens (clearing signatures)
export async function PUT(request: Request, { params }: { params: { module: string; id: string } }) {
  const m = RECORD_MODULES[params.module];
  if (!m || !isUuid(params.id)) return notFound();
  if (!supabase) return fail('Database unavailable.', 503);
  const body = await request.json().catch(() => ({}));
  const cur = await supabase.from(m.table).select('*').eq('id', params.id).maybeSingle();
  if (cur.error) return fail(cur.error.message);
  if (!cur.data) return notFound();
  const sigs: Signature[] = cur.data.signatures || [];
  const row: Record<string, unknown> = {};

  if (body.action === 'reopen') {
    row.signatures = [];
  } else {
    if (isLocked(m, sigs)) return fail('This record is signed off. Reopen it to make changes.', 409);
    if ('project' in body) {
      const p = text(body.project, 200)?.trim();
      if (!p) return fail('Project is required.', 400);
      row.project = row.name = p;
    }
    if ('record_date' in body) {
      if (!isDate(body.record_date)) return fail('Date must be YYYY-MM-DD.', 400);
      row.record_date = body.record_date;
    }
    if ('data' in body) {
      const data: Record<string, unknown> = {};
      for (const f of m.fields) {
        const v = body.data?.[f.key];
        if (v == null) continue;
        if (f.type === 'checklist') data[f.key] = Array.isArray(v) ? v.filter((x) => f.options.includes(x)) : [];
        else if (f.type === 'select') { if (f.options.includes(v)) data[f.key] = v; }
        else data[f.key] = String(v).slice(0, 20000);
      }
      row.data = data;
    }
    if ('photos' in body) {
      const prefix = `${cur.data.company_id}/`;
      if (!Array.isArray(body.photos) || body.photos.length > 50 || body.photos.some((p: unknown) => typeof p !== 'string' || !p.startsWith(prefix)))
        return fail('Invalid photo list.', 400);
      row.photos = body.photos;
    }
    if (body.action === 'sign') {
      const slot = m.slots.find((s) => s.role === body.role);
      if (!slot) return fail('Unknown sign-off.', 400);
      const name = text(body.name, 200)?.trim();
      if (!name) return fail('Enter the name of the person signing.', 400);
      if (!isSignature(body.signature)) return fail('Draw a signature first.', 400);
      if (!slot.multi && sigs.some((s) => s.role === slot.role)) return fail(`${slot.label} is already signed.`, 409);
      if (slot.after && !sigs.some((s) => s.role === slot.after)) {
        const need = m.slots.find((s) => s.role === slot.after)!;
        return fail(`"${need.label}" has to be signed first.`, 409);
      }
      const data = (row.data || cur.data.data || {}) as Record<string, unknown>;
      const missing = m.required.filter((k) => !String(data[k] ?? '').trim());
      if (missing.length) return fail(`Fill in ${missing.map((k) => m.fields.find((f) => f.key === k)!.label).join(', ')} before signing.`, 400);
      row.signatures = [...sigs, { role: slot.role, name, signature: body.signature, signed_at: new Date().toISOString() }];
    }
  }
  if (row.signatures) row.status = m.status((row.signatures as Signature[]).map((s) => s.role));

  const { data, error } = await supabase.from(m.table).update(row).eq('id', params.id).select().maybeSingle();
  if (error) return fail(error.message);
  return ok(data);
}

export async function DELETE(_request: Request, { params }: { params: { module: string; id: string } }) {
  const m = RECORD_MODULES[params.module];
  if (!m || !isUuid(params.id)) return notFound();
  if (!supabase) return fail('Database unavailable.', 503);
  const cur = await supabase.from(m.table).select('signatures, photos').eq('id', params.id).maybeSingle();
  if (!cur.data) return notFound();
  if ((cur.data.signatures || []).length) return fail('Signed records can\'t be deleted. They are part of your safety record.', 409);
  const { error } = await supabase.from(m.table).delete().eq('id', params.id);
  if (error) return fail(error.message);
  if ((cur.data.photos || []).length) await supabase.storage.from('job-photos').remove(cur.data.photos);
  return ok(null);
}
