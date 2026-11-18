import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { COMPANY_LOGOS_BUCKET, LOGO_URL_SECONDS, MAX_LOGO_BYTES, isLogoPath, newLogoPath, sniffLogoType } from '@/lib/company-logo';

export const dynamic = 'force-dynamic';

// Room for the multipart wrapping around a file at the limit
const MAX_BODY_BYTES = MAX_LOGO_BYTES + 64 * 1024;

/** Removes every file in the company's logo folder except `keep`. Best effort: a file left behind is only clutter. */
async function removeOtherLogos(supabase: SupabaseClient, companyId: string, keep: string | null, known: (string | null | undefined)[] = []) {
  const storage = supabase.storage.from(COMPANY_LOGOS_BUCKET);
  const paths = new Set(known.filter((p): p is string => isLogoPath(companyId, p)));
  const { data: listed, error: listError } = await storage.list(companyId, { limit: 100 });
  if (listError) console.error('Could not list the company logo folder', listError);
  for (const file of listed ?? []) if (file.id) paths.add(`${companyId}/${file.name}`);
  if (keep) paths.delete(keep);
  if (!paths.size) return;
  const { error } = await storage.remove([...paths]);
  if (error) console.error('Could not remove an old company logo', error);
}

/** The logo currently on the company row, or an error response. */
async function currentLogo(supabase: SupabaseClient, companyId: string): Promise<{ path: string | null } | Response> {
  const { data, error } = await supabase.from('companies').select('logo_path').eq('id', companyId).maybeSingle();
  if (error) return dbError(error, 'loading the company logo');
  return { path: (data as { logo_path: string | null } | null)?.logo_path ?? null };
}

// Owner and admins: upload a new logo, which replaces the old one. PNG or JPEG, up to 1 MB.
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: 4, write: true });
  if (ctx instanceof Response) return ctx;
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return jsonError(413, 'That image is over 1 MB. Save it smaller and try again.');

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('logo');
  } catch {
    return jsonError(400, 'Choose an image to upload.');
  }
  if (!file || typeof file === 'string') return jsonError(400, 'Choose an image to upload.');
  if (file.size > MAX_LOGO_BYTES) return jsonError(413, 'That image is over 1 MB. Save it smaller and try again.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The bytes decide, not the file name or the type the browser claims
  const type = sniffLogoType(bytes);
  if (!type) return jsonError(400, 'Choose a PNG or JPEG image.');

  const before = await currentLogo(ctx.supabase, ctx.company.id);
  if (before instanceof Response) return before;

  const path = newLogoPath(ctx.company.id, type);
  const storage = ctx.supabase.storage.from(COMPANY_LOGOS_BUCKET);
  const { error: uploadError } = await storage.upload(path, bytes, { contentType: type, upsert: false, cacheControl: '3600' });
  if (uploadError) {
    console.error('Company logo upload failed', uploadError);
    return jsonError(502, 'The logo could not be uploaded. Try again in a moment.');
  }

  const { data, error } = await ctx.supabase.from('companies').update({ logo_path: path }).eq('id', ctx.company.id).select('logo_path').maybeSingle();
  if (error || !data) {
    await storage.remove([path]);
    return error ? dbError(error, 'saving the company logo') : jsonError(403, 'Only the owner or an admin can change the logo');
  }
  await removeOtherLogos(ctx.supabase, ctx.company.id, path, [before.path]);

  const { data: signed } = await storage.createSignedUrl(path, LOGO_URL_SECONDS);
  return NextResponse.json({ data: { logo_path: path, logo_url: signed?.signedUrl ?? null } });
}

// Owner and admins: take the logo off. Documents print without one from then on.
export async function DELETE() {
  const ctx = await requireApi({ minRank: 4, write: true });
  if (ctx instanceof Response) return ctx;

  const before = await currentLogo(ctx.supabase, ctx.company.id);
  if (before instanceof Response) return before;
  const { data, error } = await ctx.supabase.from('companies').update({ logo_path: null }).eq('id', ctx.company.id).select('id').maybeSingle();
  if (error) return dbError(error, 'removing the company logo');
  if (!data) return jsonError(403, 'Only the owner or an admin can change the logo');
  await removeOtherLogos(ctx.supabase, ctx.company.id, null, [before.path]);
  return NextResponse.json({ data: { logo_path: null, logo_url: null } });
}
