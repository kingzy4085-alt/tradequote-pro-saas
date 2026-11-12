import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { ATTACHMENT_COLUMNS, attachmentFolder, attachmentModuleDef, parseAttachmentUpload, recordNoun } from '@/lib/attachments';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: { module: string; id: string } };

// The files on one drawing, document or vault item. The browser puts a file in storage itself, with
// the user's own session, then posts here to record it. Everything runs as the signed-in user, so
// the database and storage rules (20261113000130_attachments.sql) have the last word.

export async function GET(_request: Request, { params }: Params) {
  const mod = attachmentModuleDef(params.module);
  if (!mod || !uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: mod.read });
  if (ctx instanceof Response) return ctx;

  const { data: record, error: recordError } = await ctx.supabase.from(mod.table).select('id').eq('id', params.id).maybeSingle();
  if (recordError) return dbError(recordError, 'loading the files');
  if (!record) return jsonError(404, 'Not found');
  const { data, error } = await ctx.supabase
    .from('record_attachments')
    .select(ATTACHMENT_COLUMNS)
    .eq('module', mod.slug)
    .eq('record_id', params.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) return dbError(error, 'loading the files');
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: Request, { params }: Params) {
  const mod = attachmentModuleDef(params.module);
  if (!mod || !uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: mod.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 5_000);
  } catch (err) {
    return jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON');
  }
  // The folder comes from the session's company and the address, never from the request body
  const parsed = parseAttachmentUpload(body, attachmentFolder(ctx.company.id, mod.slug, params.id));
  if (!parsed.ok) return jsonError(400, parsed.error);

  const { data: record, error: recordError } = await ctx.supabase.from(mod.table).select('id').eq('id', params.id).maybeSingle();
  if (recordError) return dbError(recordError, `adding a file to this ${recordNoun(mod)}`);
  if (!record) return jsonError(404, 'Not found');

  // company_id and created_by come from database defaults tied to the session
  const { data, error } = await ctx.supabase
    .from('record_attachments')
    .insert({ module: mod.slug, record_id: params.id, ...parsed.data })
    .select(ATTACHMENT_COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505') return jsonError(409, 'That file is already attached.');
    // The rank, company and record were checked above, so what the row rules can still refuse is a file storage doesn't have
    if (error.code === '42501') return jsonError(409, 'The file did not reach storage. Add it again.');
    return dbError(error, `adding a file to this ${recordNoun(mod)}`);
  }
  return NextResponse.json({ data }, { status: 201 });
}
