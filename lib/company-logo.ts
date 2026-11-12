// The company logo printed on letterheads. The file is in a private storage bucket at
// <company id>/<file>; the database only accepts a path of that shape (companies_logo_path_check),
// and only the owner and admins can add or remove a file (20261113000140_company_logo_and_closure.sql).

export const COMPANY_LOGOS_BUCKET = 'company-logos';
/** The bucket refuses anything larger. */
export const MAX_LOGO_BYTES = 1024 * 1024;
/** Long enough for a print page to load the image when it opens, short enough not to matter if the link is passed on. */
export const LOGO_URL_SECONDS = 600;

export type LogoType = 'image/png' | 'image/jpeg';
const EXTENSIONS: Record<LogoType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

/** What a file really is, from its first bytes. The name and the browser's stated type can say anything. */
export function sniffLogoType(bytes: Uint8Array): LogoType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/** A new, never-reused name, so a replaced logo can't be served from a cache. */
export function newLogoPath(companyId: string, type: LogoType, id: string = crypto.randomUUID()): string {
  return `${companyId}/logo-${id}.${EXTENSIONS[type]}`;
}

/** True for a path the database would accept for this company: a PNG or JPEG directly in its folder. */
export function isLogoPath(companyId: string, path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith(`${companyId}/`)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.(png|jpg|jpeg)$/.test(path.slice(companyId.length + 1));
}

/** Why a chosen file can't be a logo, checked in the browser before it is sent. Null if it may be. */
export function logoFileProblem(file: { size: number; type: string }): string | null {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return 'Choose a PNG or JPEG image.';
  if (file.size > MAX_LOGO_BYTES) return 'That image is over 1 MB. Save it smaller and try again.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}
