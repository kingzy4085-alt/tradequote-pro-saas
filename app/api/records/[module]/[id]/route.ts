import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { IMMEDIATE_MODULES, notifyImmediateAlerts } from '@/lib/automation';
import { getModule } from '@/lib/modules';
import { REOPEN_RANK, RecordAction, isRecordPhotoPath, recordConfig, recordPhotoFolder } from '@/lib/records';
import { parseRecord, uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// A signature is the biggest thing sent here, and it is capped at 300,000 characters
const MAX_BODY = 400_000;

// Saving, photos, signing and reopening a safety record. The database enforces the
// rules; this route checks the shape of the request and passes the rest on as the user.
export async function PUT(request: Request, { params }: { params: { module: string; id: string } }) {
  const config = recordConfig(params.module);
  const mod = getModule(params.module);
  if (!config || !mod || !uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');

  let body: unknown;
  try {
    body = await readJson(request, MAX_BODY);
  } catch (err) {
    return jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON');
  }
  const parsed = RecordAction.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? 'Invalid request');
  const action = parsed.data;

  const ctx = await requireApi({ minRank: action.action === 'reopen' ? REOPEN_RANK : mod.write, write: true });
  if (ctx instanceof Response) {
    return action.action === 'reopen' && ctx.status === 403 ? jsonError(403, 'Only a project manager or above can reopen a signed record.') : ctx;
  }

  if (action.action === 'sign' || action.action === 'reopen') {
    const { data, error } =
      action.action === 'sign'
        ? await ctx.supabase.rpc('sign_safety_record', { p_module: config.slug, p_id: params.id, p_slot: action.slot, p_name: action.name, p_signature: action.signature })
        : await ctx.supabase.rpc('reopen_safety_record', { p_module: config.slug, p_id: params.id, p_reason: action.reason, p_expected_slot: action.slot ?? null });
    if (error) return dbError(error, `updating this ${config.noun}`);
    return NextResponse.json({ data });
  }

  let update: Record<string, unknown>;
  if (action.action === 'photos') {
    const folder = recordPhotoFolder(ctx.company.id, config.slug, params.id);
    if (!action.photos.every((p) => isRecordPhotoPath(folder, p))) return jsonError(400, 'Invalid photo');
    update = { photos: action.photos };
  } else {
    update = {};
    if (action.fields && Object.keys(action.fields).length) {
      const fields = parseRecord(mod, action.fields, 'update');
      if (!fields.ok) return jsonError(400, 'Please fix the highlighted fields', fields.errors);
      // Status comes from the signatures
      const { status: _status, ...rest } = fields.data;
      update = rest;
    }
    for (const [key, values] of Object.entries(action.checklists ?? {})) {
      const list = config.checklists.find((c) => c.key === key);
      if (!list) return jsonError(400, 'Invalid checklist');
      // An item the record already holds can stay after it leaves the list, same as the trigger
      const offList = values.filter((v) => !list.options.includes(v));
      if (offList.length > 0) {
        const { data: row, error } = await ctx.supabase.from(mod.table).select(key).eq('id', params.id).maybeSingle();
        if (error) return dbError(error, `updating this ${config.noun}`);
        const held = (row as unknown as Record<string, unknown> | null)?.[key];
        if (!Array.isArray(held) || offList.some((v) => !held.includes(v))) return jsonError(400, 'Invalid checklist');
      }
      update[key] = [...new Set(values)];
    }
    if (Object.keys(update).length === 0) return jsonError(400, 'Nothing to update');
  }

  const { data, error } = await ctx.supabase.from(mod.table).update(update).eq('id', params.id).select().maybeSingle();
  if (error) return dbError(error, `updating this ${config.noun}`);
  if (!data) return jsonError(404, 'Not found');
  if (IMMEDIATE_MODULES.has(mod.slug)) await notifyImmediateAlerts(ctx.company.id);
  return NextResponse.json({ data });
}
