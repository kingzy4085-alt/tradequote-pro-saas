import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { ATTACHMENTS_BUCKET, ATTACHMENT_LINK_SECONDS, attachmentModuleDef, withDownloadName } from '@/lib/attachments';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: { module: string; id: string; file: string } };

const NO_STORE = { 'Cache-Control': 'private, no-store' };

// Opens one file through a short-lived signed link made for this request, and deletes one file.
// Runs as the signed-in user, so storage only signs a file their rank may read.
export async function GET(request: Request, { params }: Params) {
  const mod = attachmentModuleDef(params.module);
  if (!mod || !uuidSchema.safeParse(params.id).success || !uuidSchema.safeParse(params.file).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: mod.read });
  if (ctx instanceof Response) return ctx;

  const { data: row, error } = await ctx.supabase
    .from('record_attachments')
    .select('path, file_name')
    .eq('id', params.file)
    .eq('module', mod.slug)
    .eq('record_id', params.id)
    .maybeSingle();
  if (error) return dbError(error, 'opening the file');
  if (!row) return jsonError(404, 'That file could not be found. It may have been deleted.');
  const file = row as { path: string; file_name: string };

  const { data: signed, error: signError } = await ctx.supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(file.path, ATTACHMENT_LINK_SECONDS);
  if (signError || !signed?.signedUrl) {
    console.error('Could not sign an attachment link', signError);
    return jsonError(404, 'That file could not be opened. It may have been deleted from storage.');
  }
  const query = new URL(request.url).searchParams;
  const url = query.get('download') === '1' ? withDownloadName(signed.signedUrl, file.file_name) : signed.signedUrl;
  if (query.get('json') === '1') return NextResponse.json({ data: { url } }, { headers: NO_STORE });
  return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
}

export async function DELETE(_request: Request, { params }: Params) {
  const mod = attachmentModuleDef(params.module);
  if (!mod || !uuidSchema.safeParse(params.id).success || !uuidSchema.safeParse(params.file).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: mod.remove, write: true });
  if (ctx instanceof Response) return ctx;

  const { data: row, error } = await ctx.supabase
    .from('record_attachments')
    .select('id, path')
    .eq('id', params.file)
    .eq('module', mod.slug)
    .eq('record_id', params.id)
    .maybeSingle();
  if (error) return dbError(error, 'deleting the file');
  if (!row) return jsonError(404, 'Not found');
  const file = row as { id: string; path: string };

  // The file first, while its row still says it exists: if storage fails, both stay and a retry works
  const { error: storageError } = await ctx.supabase.storage.from(ATTACHMENTS_BUCKET).remove([file.path]);
  if (storageError) {
    console.error('Could not remove an attachment from storage', storageError);
    return jsonError(502, 'The file could not be deleted. Try again.');
  }
  const { data: gone, error: deleteError } = await ctx.supabase.from('record_attachments').delete().eq('id', file.id).select('id');
  if (deleteError) return dbError(deleteError, 'deleting the file');
  if (!gone?.length) return jsonError(404, 'Not found');
  return NextResponse.json({ ok: true });
}
