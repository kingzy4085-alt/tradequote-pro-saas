import { NextResponse } from 'next/server';
import { getModule, type ModuleDef } from '@/lib/modules';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { parseRecord, uuidSchema } from '@/lib/validation';
import { JOB_PHOTOS_BUCKET } from '@/lib/daily-log';

const MAX_LIMIT = 200;

type Params = { params: { module: string; id?: string } };

function resolve(slug: string): ModuleDef | Response {
  return getModule(slug) ?? jsonError(404, 'Unknown module');
}

/** Escapes characters that are special inside a PostgREST ilike filter. */
export function escapeSearch(q: string): string {
  return q.replace(/[\\%_]/g, (c) => '\\' + c).replace(/[,()]/g, ' ');
}

async function parseBody(request: Request) {
  try {
    return { ok: true as const, body: await readJson(request) };
  } catch (err) {
    return { ok: false as const, response: jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON') };
  }
}

export async function listRecords(request: Request, { params }: Params) {
  const mod = resolve(params.module);
  if (mod instanceof Response) return mod;
  const ctx = await requireApi({ minRank: mod.read });
  if (ctx instanceof Response) return ctx;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), MAX_LIMIT);
  const q = url.searchParams.get('q')?.trim().slice(0, 100);
  const status = url.searchParams.get('status');

  let query = ctx.supabase.from(mod.table).select('*', { count: 'exact' }).order('created_at', { ascending: false }).limit(limit);
  if (q) query = query.ilike('title', `%${escapeSearch(q)}%`);
  if (status && mod.statuses.includes(status)) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) return dbError(error, `loading ${mod.label}`);
  return NextResponse.json({ data, count });
}

export async function createRecord(request: Request, { params }: Params) {
  const mod = resolve(params.module);
  if (mod instanceof Response) return mod;
  const ctx = await requireApi({ minRank: mod.write, write: true });
  if (ctx instanceof Response) return ctx;

  const body = await parseBody(request);
  if (!body.ok) return body.response;
  const parsed = parseRecord(mod, body.body, 'create');
  if (!parsed.ok) return jsonError(400, 'Please fix the highlighted fields', parsed.errors);

  // company_id and created_by come from database defaults tied to the session — never from the client
  const { data, error } = await ctx.supabase.from(mod.table).insert(parsed.data).select().single();
  if (error) return dbError(error, `saving ${mod.label}`);
  return NextResponse.json({ data }, { status: 201 });
}

export async function getRecord(_request: Request, { params }: Params) {
  const mod = resolve(params.module);
  if (mod instanceof Response) return mod;
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: mod.read });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.from(mod.table).select('*').eq('id', params.id!).maybeSingle();
  if (error) return dbError(error, `loading ${mod.label}`);
  if (!data) return jsonError(404, 'Not found');
  return NextResponse.json({ data });
}

export async function updateRecord(request: Request, { params }: Params) {
  const mod = resolve(params.module);
  if (mod instanceof Response) return mod;
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: mod.write, write: true });
  if (ctx instanceof Response) return ctx;

  const body = await parseBody(request);
  if (!body.ok) return body.response;
  const parsed = parseRecord(mod, body.body, 'update');
  if (!parsed.ok) return jsonError(400, 'Please fix the highlighted fields', parsed.errors);

  const { data, error } = await ctx.supabase.from(mod.table).update(parsed.data).eq('id', params.id!).select().maybeSingle();
  if (error) return dbError(error, `updating ${mod.label}`);
  if (!data) return jsonError(404, 'Not found');
  return NextResponse.json({ data });
}

export async function deleteRecord(_request: Request, { params }: Params) {
  const mod = resolve(params.module);
  if (mod instanceof Response) return mod;
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: mod.remove });
  if (ctx instanceof Response) return ctx;

  const hasPhotos = mod.slug === 'daily-logs';
  const { data, error } = await ctx.supabase.from(mod.table).delete().eq('id', params.id!).select(hasPhotos ? 'id, photos' : 'id');
  if (error) return dbError(error, `deleting from ${mod.label}`);
  if (!data?.length) return jsonError(404, 'Not found');
  // Daily log photos live in storage, not the row; remove them with the log
  if (hasPhotos) {
    const photos = ((data[0] as { photos?: unknown }).photos ?? []) as string[];
    if (photos.length) {
      const { error: storageError } = await ctx.supabase.storage.from(JOB_PHOTOS_BUCKET).remove(photos);
      if (storageError) console.error('Could not remove daily log photos', storageError);
    }
  }
  return NextResponse.json({ ok: true });
}
