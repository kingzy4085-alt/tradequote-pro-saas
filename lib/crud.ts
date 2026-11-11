import { NextResponse } from 'next/server';
import { companyToday } from '@/lib/alerts';
import { listViewFilter } from '@/lib/list-views';
import type { AppContext } from '@/lib/context';
import { getModule, type ModuleDef } from '@/lib/modules';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { withRestrictedMoney } from '@/lib/project-money';
import { parseRecord, uuidSchema } from '@/lib/validation';
import { JOB_PHOTOS_BUCKET } from '@/lib/daily-log';
import { LINK_OPTION_LIMIT, parsePage } from '@/lib/pagination';
import { RECORD_MODULES, deleteBlock } from '@/lib/records';
import { IMMEDIATE_MODULES, notifyImmediateAlerts } from '@/lib/automation';

type Params = { params: { module: string; id?: string } };

function resolve(slug: string): ModuleDef | Response {
  return getModule(slug) ?? jsonError(404, 'Unknown module');
}

/** Escapes characters that are special inside a PostgREST ilike filter. */
export function escapeSearch(q: string): string {
  return q.replace(/[\\%_]/g, (c) => '\\' + c).replace(/[,()]/g, ' ');
}

/** Columns a list returns. Explicit, so signature images and other large extras stay on the detail pages. */
export function listColumns(mod: ModuleDef): string {
  return ['id', 'title', 'status', 'notes', 'created_at', 'updated_at', ...mod.fields.filter((f) => f.type !== 'list' && !f.restricted).map((f) => f.key)].join(', ');
}

/** Columns one record returns. Everything, unless the database hides a column from signed-in users, which makes `*` fail outright. */
export function recordColumns(mod: ModuleDef): string {
  if (!mod.fields.some((f) => f.restricted)) return '*';
  return ['id', 'company_id', 'title', 'status', 'notes', 'created_by', 'created_at', 'updated_at', ...mod.fields.filter((f) => !f.restricted).map((f) => f.key), ...(RECORD_EXTRAS[mod.slug] ?? [])].join(', ');
}

// Columns on the row that aren't registry fields, which `*` would otherwise have brought
const RECORD_EXTRAS: Record<string, string[]> = { 'change-orders': ['signature', 'billed_in_old_app'] };

async function parseBody(request: Request) {
  try {
    return { ok: true as const, body: await readJson(request) };
  } catch (err) {
    return { ok: false as const, response: jsonError(err instanceof RangeError ? 413 : 400, err instanceof RangeError ? 'Request too large' : 'Invalid JSON') };
  }
}

/** Adds the columns only a rank-gated function can read, for those who may see them. Without them a project manager's edit form would save a blank contract. */
async function withRestricted<T extends { id: string }>(ctx: Pick<AppContext, 'supabase' | 'role'>, mod: ModuleDef, rows: T[]) {
  return withRestrictedMoney(mod.slug, ctx.supabase, ctx.role, rows);
}

export async function listRecords(request: Request, { params }: Params) {
  const mod = resolve(params.module);
  if (mod instanceof Response) return mod;
  const ctx = await requireApi({ minRank: mod.read });
  if (ctx instanceof Response) return ctx;

  const url = new URL(request.url);
  const { limit, offset } = parsePage(url.searchParams);
  const q = url.searchParams.get('q')?.trim().slice(0, 100);
  const statuses = url.searchParams.getAll('status').filter((s) => mod.statuses.includes(s));
  const project = url.searchParams.get('project');
  const view = listViewFilter(mod.slug, url.searchParams.get('view'), companyToday(ctx.company.province));
  const projectField = mod.fields.find((f) => f.type === 'project');
  if (project && projectField && !uuidSchema.safeParse(project).success) return jsonError(400, 'Unknown project');

  let query = ctx.supabase
    .from(mod.table)
    .select(listColumns(mod), { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (q) query = query.ilike('title', `%${escapeSearch(q)}%`);
  if (statuses.length === 1) query = query.eq('status', statuses[0]);
  else if (statuses.length > 1) query = query.in('status', statuses);
  if (project && projectField) query = query.eq(projectField.key, project);
  if (view) query = query.or(view);

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return dbError(error, `loading ${mod.label}`);
  const full = await withRestricted(ctx, mod, (data ?? []) as unknown as { id: string }[]);
  if ('error' in full) return dbError(full.error, `loading ${mod.label}`);
  return NextResponse.json({ data: full.rows, count, limit, offset });
}

const LINK_MODULES: Record<string, string> = { project: 'projects', client: 'crm', purchase_order: 'purchase-orders' };

/** The choices for a project or client picker: id and title only, as the signed-in user sees them. */
export async function listLinkOptions(request: Request) {
  const mod = getModule(LINK_MODULES[new URL(request.url).searchParams.get('type') ?? ''] ?? '');
  if (!mod) return jsonError(400, 'Unknown list');
  const ctx = await requireApi({ minRank: mod.read });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.from(mod.table).select('id, title').order('title', { ascending: true }).order('id', { ascending: true }).limit(LINK_OPTION_LIMIT);
  if (error) return dbError(error, `loading ${mod.label}`);
  return NextResponse.json({ data });
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
  const { data, error } = await ctx.supabase.from(mod.table).insert(parsed.data).select(recordColumns(mod)).single();
  if (error) return dbError(error, `saving ${mod.label}`);
  const full = await withRestricted(ctx, mod, [data as unknown as { id: string }]);
  if ('error' in full) return dbError(full.error, `saving ${mod.label}`);
  // A trigger raised any safety alert with the save. Its email goes out now, and a failure here doesn't touch the record.
  if (IMMEDIATE_MODULES.has(mod.slug)) await notifyImmediateAlerts(ctx.company.id);
  return NextResponse.json({ data: full.rows[0] }, { status: 201 });
}

export async function getRecord(_request: Request, { params }: Params) {
  const mod = resolve(params.module);
  if (mod instanceof Response) return mod;
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: mod.read });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.from(mod.table).select(recordColumns(mod)).eq('id', params.id!).maybeSingle();
  if (error) return dbError(error, `loading ${mod.label}`);
  if (!data) return jsonError(404, 'Not found');
  const full = await withRestricted(ctx, mod, [data as unknown as { id: string }]);
  if ('error' in full) return dbError(full.error, `loading ${mod.label}`);
  return NextResponse.json({ data: full.rows[0] });
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

  const { data, error } = await ctx.supabase.from(mod.table).update(parsed.data).eq('id', params.id!).select(recordColumns(mod)).maybeSingle();
  if (error) return dbError(error, `updating ${mod.label}`);
  if (!data) return jsonError(404, 'Not found');
  const full = await withRestricted(ctx, mod, [data as unknown as { id: string }]);
  if ('error' in full) return dbError(full.error, `updating ${mod.label}`);
  if (IMMEDIATE_MODULES.has(mod.slug)) await notifyImmediateAlerts(ctx.company.id);
  return NextResponse.json({ data: full.rows[0] });
}

// Modules whose rows list storage photos: what to read before a delete, and why a delete is refused.
const PHOTO_DELETE_RULES: Record<string, { columns: string; noun: string; block: (row: Record<string, unknown>) => string | null }> = {
  'daily-logs': { columns: 'id, photos, signed_at', noun: 'log', block: (row) => (row.signed_at ? 'This log is signed. Reopen it before deleting it.' : null) },
  ...Object.fromEntries(Object.values(RECORD_MODULES).map((c) => [c.slug, { columns: 'id, photos, signatures, reopen_log', noun: c.noun, block: deleteBlock }])),
};

export async function deleteRecord(_request: Request, { params }: Params) {
  const mod = resolve(params.module);
  if (mod instanceof Response) return mod;
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: mod.remove, write: true });
  if (ctx instanceof Response) return ctx;

  // Photos live in storage, not the row. Storage only lets them go while their record
  // exists and is unsigned, so they have to be removed before the record.
  const rule = PHOTO_DELETE_RULES[mod.slug];
  if (rule) {
    const { data: row, error: readError } = await ctx.supabase.from(mod.table).select(rule.columns).eq('id', params.id!).maybeSingle();
    if (readError) return dbError(readError, `deleting from ${mod.label}`);
    if (!row) return jsonError(404, 'Not found');
    const record = row as unknown as Record<string, unknown>;
    const blocked = rule.block(record);
    if (blocked) return jsonError(409, blocked);
    const photos = (record.photos ?? []) as string[];
    if (photos.length) {
      const { error: storageError } = await ctx.supabase.storage.from(JOB_PHOTOS_BUCKET).remove(photos);
      if (storageError) {
        console.error(`Could not remove ${mod.label} photos`, storageError);
        return jsonError(502, `Could not remove the photos, so the ${rule.noun} was kept. Try again.`);
      }
    }
  }

  const { data, error } = await ctx.supabase.from(mod.table).delete().eq('id', params.id!).select('id');
  if (error) return dbError(error, `deleting from ${mod.label}`);
  if (!data?.length) return jsonError(404, 'Not found');
  return NextResponse.json({ ok: true });
}
