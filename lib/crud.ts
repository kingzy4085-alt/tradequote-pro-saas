import { NextResponse } from 'next/server';
import { getModule, type ModuleDef } from '@/lib/modules';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { parseRecord, uuidSchema } from '@/lib/validation';
import { JOB_PHOTOS_BUCKET } from '@/lib/daily-log';
import { parsePage } from '@/lib/pagination';

type Params = { params: { module: string; id?: string } };

function resolve(slug: string): ModuleDef | Response {
  return getModule(slug) ?? jsonError(404, 'Unknown module');
}

/** Escapes characters that are special inside a PostgREST ilike filter. */
export function escapeSearch(q: string): string {
  return q.replace(/[\\%_]/g, (c) => '\\' + c).replace(/[,()]/g, ' ');
}

/**
 * Columns a list returns. Explicit, so signature images and other large extras stay on the detail pages.
 * Linked names come along as row.project.title and row.client.title. Row level security applies to
 * them too, so someone who can't read clients gets null and the list falls back to the typed name.
 */
export function listColumns(mod: ModuleDef): string {
  const links = mod.fields.flatMap((f) => (f.type === 'project' ? ['project:projects!project_id(title)'] : f.type === 'client' ? ['client:crm!client_id(title)'] : []));
  return ['id', 'title', 'status', 'notes', 'created_at', 'updated_at', ...mod.fields.map((f) => f.key), ...links].join(', ');
}

/** Columns a picker needs: nothing else about the record leaves the database. */
export const PICKER_COLUMNS = 'id, title';

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
  const { limit, offset } = parsePage(url.searchParams);
  const q = url.searchParams.get('q')?.trim().slice(0, 100);
  const status = url.searchParams.get('status');
  const project = url.searchParams.get('project');
  const picker = url.searchParams.get('picker') === '1';
  const filtersByProject = !!project && mod.fields.some((f) => f.type === 'project');
  if (filtersByProject && !uuidSchema.safeParse(project).success) return jsonError(400, 'That project was not found');

  let query = ctx.supabase
    .from(mod.table)
    .select(picker ? PICKER_COLUMNS : listColumns(mod), { count: 'exact' })
    .order(picker ? 'title' : 'created_at', { ascending: picker })
    .order('id', { ascending: false });
  if (q) query = query.ilike('title', `%${escapeSearch(q)}%`);
  if (status && mod.statuses.includes(status)) query = query.eq('status', status);
  if (filtersByProject) query = query.eq('project_id', project);

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return dbError(error, `loading ${mod.label}`);
  return NextResponse.json({ data, count, limit, offset });
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
  const ctx = await requireApi({ minRank: mod.remove, write: true });
  if (ctx instanceof Response) return ctx;

  // Daily log photos live in storage, not the row. Storage only lets photos go while
  // their log exists and is unsigned, so they have to be removed before the log.
  if (mod.slug === 'daily-logs') {
    const { data: log, error: readError } = await ctx.supabase.from(mod.table).select('id, photos, signed_at').eq('id', params.id!).maybeSingle();
    if (readError) return dbError(readError, `deleting from ${mod.label}`);
    if (!log) return jsonError(404, 'Not found');
    if (log.signed_at) return jsonError(409, 'This log is signed. Reopen it before deleting it.');
    const photos = (log.photos ?? []) as string[];
    if (photos.length) {
      const { error: storageError } = await ctx.supabase.storage.from(JOB_PHOTOS_BUCKET).remove(photos);
      if (storageError) {
        console.error('Could not remove daily log photos', storageError);
        return jsonError(502, 'Could not remove the photos, so the log was kept. Try again.');
      }
    }
  }

  const { data, error } = await ctx.supabase.from(mod.table).delete().eq('id', params.id!).select('id');
  if (error) return dbError(error, `deleting from ${mod.label}`);
  if (!data?.length) return jsonError(404, 'Not found');
  return NextResponse.json({ ok: true });
}
