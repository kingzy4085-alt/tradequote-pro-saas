// File attachments on Drawings, Documents and Site Vault records: which files may be attached, where
// they are stored and how they are described. The browser checks a file with these rules before it
// uploads it, the server checks them again before recording it, and the storage bucket and database
// hold the same rules (supabase/migrations/20261113000130_attachments.sql; tests keep them in step).
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getModule, type ModuleDef } from './modules';

export const ATTACHMENTS_BUCKET = 'attachments';
export const ATTACHMENT_MODULES = ['drawings', 'documents', 'site-vault'] as const;
export type AttachmentModule = (typeof ATTACHMENT_MODULES)[number];

/** The largest file storage accepts: 25 MB. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_FILE_NAME_LENGTH = 200;
export const MAX_ATTACHMENTS_PER_RECORD = 100;
/** How long a link to a file works. Every click on a file asks the server for a new one. */
export const ATTACHMENT_LINK_SECONDS = 300;

export type AttachmentKind = 'image' | 'pdf' | 'file';

export interface AttachmentType {
  /** The type the file is stored and served as. */
  contentType: string;
  /** Other types browsers report for the same kind of file. */
  aliases: readonly string[];
  kind: AttachmentKind;
}

const JPEG: AttachmentType = { contentType: 'image/jpeg', aliases: ['image/pjpeg', 'image/jpg'], kind: 'image' };

/** Every extension that may be attached. */
export const ATTACHMENT_TYPES: Readonly<Record<string, AttachmentType>> = {
  pdf: { contentType: 'application/pdf', aliases: ['application/x-pdf'], kind: 'pdf' },
  png: { contentType: 'image/png', aliases: [], kind: 'image' },
  jpg: JPEG,
  jpeg: JPEG,
  webp: { contentType: 'image/webp', aliases: [], kind: 'image' },
  dwg: {
    contentType: 'image/vnd.dwg',
    aliases: ['application/acad', 'application/x-acad', 'application/autocad_dwg', 'application/dwg', 'application/x-dwg', 'application/x-autocad', 'image/x-dwg', 'drawing/dwg'],
    kind: 'file',
  },
  dxf: { contentType: 'image/vnd.dxf', aliases: ['application/dxf', 'application/x-dxf', 'image/x-dxf', 'application/x-autocad', 'drawing/x-dxf'], kind: 'file' },
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', aliases: [], kind: 'file' },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', aliases: [], kind: 'file' },
  txt: { contentType: 'text/plain', aliases: [], kind: 'file' },
  // Windows with Excel installed calls a CSV an Excel file
  csv: { contentType: 'text/csv', aliases: ['application/csv', 'text/comma-separated-values', 'text/x-csv', 'application/vnd.ms-excel', 'text/plain'], kind: 'file' },
};

export const ATTACHMENT_EXTENSIONS = Object.keys(ATTACHMENT_TYPES);
/** Every type the bucket accepts: one per kind of file. */
export const ATTACHMENT_CONTENT_TYPES = [...new Set(Object.values(ATTACHMENT_TYPES).map((t) => t.contentType))];
/** For the file picker. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(',');
export const ALLOWED_FILES_TEXT = 'PDF, PNG, JPG, WEBP, DWG, DXF, DOCX, XLSX, TXT or CSV';

// What browsers send for a file whose type they don't know. The extension decides then.
const UNKNOWN_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export function isAttachmentModule(slug: unknown): slug is AttachmentModule {
  return typeof slug === 'string' && (ATTACHMENT_MODULES as readonly string[]).includes(slug);
}

/** The registry entry of a module that takes files, or null for any other slug. Its ranks decide who may read, add and delete. */
export function attachmentModuleDef(slug: unknown): (ModuleDef & { slug: AttachmentModule }) | null {
  return isAttachmentModule(slug) ? ((getModule(slug) ?? null) as (ModuleDef & { slug: AttachmentModule }) | null) : null;
}

/** What one record of the module is called in messages, in lower case: "drawing", "vault item". */
export function recordNoun(mod: ModuleDef): string {
  return (mod.recordLabel ?? mod.titleLabel).toLowerCase();
}

export function attachmentType(ext: string): AttachmentType | undefined {
  return Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, ext) ? ATTACHMENT_TYPES[ext] : undefined;
}

/** The extension of a file name in lower case, or '' when it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** How a stored file is shown: as a picture, as a PDF that opens in the browser, or as a file to download. */
export function attachmentKind(contentType: string): AttachmentKind {
  return Object.values(ATTACHMENT_TYPES).find((t) => t.contentType === contentType)?.kind ?? 'file';
}

/** The short label shown in place of a picture: "PDF", "DWG". */
export function typeLabel(fileName: string): string {
  return fileExtension(fileName).toUpperCase() || 'FILE';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A file name as it appears in a message: in quotes, and cut short when long. */
export function quotedName(name: string): string {
  const chars = Array.from(name);
  return `"${chars.length > 60 ? `${chars.slice(0, 57).join('')}...` : name}"`;
}

export type FileCheck = { ok: true; ext: string; contentType: string; kind: AttachmentKind } | { ok: false; error: string };

/** Whether a file may be attached: an allowed extension, a type that agrees with it, and 25 MB or less. */
export function checkAttachmentFile(file: { name: string; type?: string | null; size: number }): FileCheck {
  const ext = fileExtension(file.name);
  const type = attachmentType(ext);
  if (!type) return { ok: false, error: `${quotedName(file.name)} cannot be attached. Attach a ${ALLOWED_FILES_TEXT} file.` };
  const reported = (file.type ?? '').split(';')[0].trim().toLowerCase();
  if (!UNKNOWN_TYPES.has(reported) && reported !== type.contentType && !type.aliases.includes(reported)) {
    return { ok: false, error: `${quotedName(file.name)} does not look like a .${ext} file. Check the file and try again.` };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: `${quotedName(file.name)} is empty.` };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    // Rounded up, so a file just over the limit doesn't read as 25.0 MB
    const mb = (Math.ceil((file.size / (1024 * 1024)) * 10) / 10).toFixed(1);
    return { ok: false, error: `${quotedName(file.name)} is ${mb} MB. Files can be up to 25 MB.` };
  }
  return { ok: true, ext, contentType: type.contentType, kind: type.kind };
}

/** A file name as it is stored and downloaded: one line, no folders, at most 200 characters, extension kept. */
export function cleanFileName(name: string): string {
  const flat = name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(flat);
  if (chars.length <= MAX_FILE_NAME_LENGTH) return flat;
  const dot = flat.lastIndexOf('.');
  const tail = dot > 0 && flat.length - dot <= 10 ? flat.slice(dot) : '';
  const base = Array.from(flat.slice(0, flat.length - tail.length)).slice(0, MAX_FILE_NAME_LENGTH - Array.from(tail).length);
  return `${base.join('').trimEnd()}${tail}`;
}

/** A record's storage folder. Storage and the database accept files directly inside it, and nowhere else. */
export const attachmentFolder = (companyId: string, module: AttachmentModule, recordId: string) => `${companyId}/${module}/${recordId}/`;

/** Where one file is stored: its record's folder, a random id, and the file's extension. */
export const attachmentPath = (folder: string, fileId: string, ext: string) => `${folder}${fileId}.${ext}`;

const STORED_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z]+)$/;

/** The extension of a file stored directly in this folder under a random id, or null for any other path. */
export function storedExtension(folder: string, path: string): string | null {
  if (!path.startsWith(folder)) return null;
  const match = STORED_FILE.exec(path.slice(folder.length));
  return match && attachmentType(match[1]) ? match[1] : null;
}

/** A random id for a stored file. getRandomValues covers a page not served over HTTPS, which has no randomUUID. */
export function newFileId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Where the browser sends a file: the storage service's upload address for that path. */
export function attachmentUploadUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${ATTACHMENTS_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** One stored file, as the list and the page show it. */
export interface Attachment {
  id: string;
  module: AttachmentModule;
  record_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  created_by: string | null;
}

export const ATTACHMENT_COLUMNS = 'id, module, record_id, file_name, content_type, size_bytes, created_at, created_by';

const UploadBody = z.object({
  path: z.string().max(400),
  file_name: z.string().max(1000),
  content_type: z.string().max(200),
  size_bytes: z.number().int(),
});

export interface AttachmentUpload {
  path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
}

/**
 * What the browser sends once a file is in storage, checked as the upload was: the file's rules,
 * and a path inside `folder`, which the server builds from the session's company and never from the request.
 */
export function parseAttachmentUpload(body: unknown, folder: string): { ok: true; data: AttachmentUpload } | { ok: false; error: string } {
  const parsed = UploadBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'Send the file path, name, type and size.' };
  const fileName = cleanFileName(parsed.data.file_name);
  if (!fileName) return { ok: false, error: 'The file needs a name.' };
  const check = checkAttachmentFile({ name: fileName, type: parsed.data.content_type, size: parsed.data.size_bytes });
  if (!check.ok) return check;
  if (storedExtension(folder, parsed.data.path) !== check.ext) return { ok: false, error: 'That file was not uploaded to this record. Add it again.' };
  return { ok: true, data: { path: parsed.data.path, file_name: fileName, content_type: check.contentType, size_bytes: parsed.data.size_bytes } };
}

/** The page of a record's files, for the modules that take them. */
export function filesHref(slug: string, id: string): string | null {
  return isAttachmentModule(slug) ? `/files/${slug}/${id}` : null;
}

/** The route that opens a file: it makes a short-lived link on every request and sends the browser there. With `download`, the file saves under its own name. */
export function attachmentHref(file: Pick<Attachment, 'id' | 'module' | 'record_id'>, download = false): string {
  return `/api/attachments/${file.module}/${file.record_id}/${file.id}${download ? '?download=1' : ''}`;
}

/** The same route, answering with the link as JSON instead of redirecting, so a failure can be shown on the page. */
export function attachmentLinkRequest(file: Pick<Attachment, 'id' | 'module' | 'record_id'>, download = false): string {
  return `${attachmentHref(file, download)}${download ? '&' : '?'}json=1`;
}

/**
 * A signed link that downloads under the file's own name. storage-js's own `download` option encodes the
 * name twice, so "Plan (Rev 2).pdf" would arrive as "Plan %28Rev 2%29.pdf"; this encodes it once.
 */
export function withDownloadName(signedUrl: string, fileName: string): string {
  return `${signedUrl}${signedUrl.includes('?') ? '&' : '?'}download=${encodeURIComponent(fileName)}`;
}

/** What to tell someone whose upload storage refused, in place of the storage service's own words. */
export function storageUploadError(status: number, responseText: string, name: string): string {
  let code = '';
  let message = '';
  try {
    const body = JSON.parse(responseText) as { statusCode?: unknown; error?: unknown; message?: unknown };
    code = String(body.statusCode ?? '');
    message = `${String(body.error ?? '')} ${String(body.message ?? '')}`;
  } catch {
    message = responseText;
  }
  if (status === 0) return `${quotedName(name)} could not be uploaded. Check your connection and try again.`;
  if (status === 413 || code === '413' || /too large|maximum allowed size|exceeded/i.test(message)) return `${quotedName(name)} is over 25 MB. Files can be up to 25 MB.`;
  if (status === 415 || code === '415' || /mime type/i.test(message)) return `${quotedName(name)} cannot be attached. Attach a ${ALLOWED_FILES_TEXT} file.`;
  if (/jwt|"exp" claim/i.test(message)) return 'Your session has ended. Sign in again, then add the file.';
  if (status === 401 || status === 403 || code === '401' || code === '403' || /row-level security|unauthorized/i.test(message)) return 'You do not have permission to add files here.';
  return `${quotedName(name)} could not be uploaded. Try again.`;
}

/**
 * Every stored file of one record: those recorded against it, plus anything else in its folder, such as a
 * file whose record was never saved. Read as the signed-in user, so storage's rules decide what is found.
 */
export async function recordFilePaths(supabase: SupabaseClient, module: AttachmentModule, recordId: string, companyId: string): Promise<{ paths: string[] } | { error: unknown }> {
  const { data: rows, error } = await supabase.from('record_attachments').select('path').eq('module', module).eq('record_id', recordId);
  if (error) return { error };
  const folder = attachmentFolder(companyId, module, recordId);
  const { data: listed, error: listError } = await supabase.storage.from(ATTACHMENTS_BUCKET).list(folder.slice(0, -1), { limit: 1000 });
  if (listError) return { error: listError };
  const paths = new Set<string>(((rows ?? []) as { path: string }[]).map((r) => r.path));
  // Sub-folders come back without an id; there are none here, but they aren't files to remove
  for (const object of listed ?? []) if (object.id) paths.add(`${folder}${object.name}`);
  return { paths: [...paths] };
}
