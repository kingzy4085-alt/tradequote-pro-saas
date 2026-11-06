import { z } from 'zod';
import { pickableStatuses, type FieldDef, type ModuleDef } from './modules';

const TEXT_MAX = 300;
const LONG_TEXT_MAX = 10_000;

const camelToSnake = (key: string) => key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

/** Maps aliases and camelCase keys onto the module's column names. Unknown keys are left for zod to drop. */
export function normalizeKeys(module: ModuleDef, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const key = module.aliases?.[rawKey] ?? camelToSnake(rawKey);
    // An explicit column wins over an alias that maps onto it
    if (key in out && rawKey !== key) continue;
    out[key] = value;
  }
  return out;
}

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** True for a real YYYY-MM-DD date. Date.parse alone would accept 2026-02-31. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function fieldSchema(def: FieldDef, mode: 'create' | 'update'): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (def.type) {
    case 'textarea':
      base = z.string().trim().max(LONG_TEXT_MAX);
      break;
    case 'email':
      base = z.string().trim().email().max(TEXT_MAX);
      break;
    case 'tel':
      base = z.string().trim().max(40);
      break;
    case 'number':
      base = z.coerce.number().finite().min(def.min ?? -1e9).max(1e9);
      break;
    case 'money':
      base = z.coerce.number().finite().min(def.min ?? -1e11).max(1e11).transform((n) => Math.round(n * 100) / 100);
      break;
    case 'project':
    case 'client':
    case 'uuid':
      // That it belongs to the caller's company is enforced by a database trigger
      base = z.string().uuid('Pick one from the list');
      break;
    case 'date':
      base = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(isCalendarDate, 'That date does not exist');
      break;
    case 'datetime':
      base = z.string().datetime({ offset: true });
      break;
    case 'select':
      base = z.enum(def.options as [string, ...string[]]);
      break;
    case 'boolean':
      base = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());
      break;
    default:
      base = z.string().trim().max(TEXT_MAX);
  }
  // Required fields must be present on create and can never be cleared to null
  if (def.required) {
    const schema = z.preprocess(emptyToNull, base);
    return mode === 'create' ? schema : schema.optional();
  }
  return z.preprocess(emptyToNull, base.nullable()).optional();
}

/** Builds the strict input schema for a module. `create` requires a title; `update` makes every field optional. */
export function recordSchema(module: ModuleDef, mode: 'create' | 'update') {
  const shape: Record<string, z.ZodTypeAny> = {
    title: mode === 'create' ? z.string().trim().min(1, `${module.titleLabel} is required`).max(TEXT_MAX) : z.string().trim().min(1, `${module.titleLabel} is required`).max(TEXT_MAX).optional(),
    status: z.enum(pickableStatuses(module) as [string, ...string[]]).optional(),
    notes: z.preprocess(emptyToNull, z.string().trim().max(LONG_TEXT_MAX).nullable()).optional(),
  };
  // Computed fields stay out of the shape, so whatever the client sends for them is dropped
  for (const def of module.fields) if (!def.computed) shape[def.key] = fieldSchema(def, mode);
  // .strip() (the default) drops id, company_id, created_by and anything else not in the shape
  return z.object(shape).strip();
}

/** The validator's own wording never reaches a contractor. A message written for a field above is kept as it is. */
function plainMessage(module: ModuleDef, issue: z.core.$ZodIssue): string {
  if (!/expected|received|too small|too big|invalid/i.test(issue.message)) return issue.message;
  const key = String(issue.path[0] ?? '');
  const label = key === 'title' ? module.titleLabel : key === 'status' ? 'Status' : key === 'notes' ? 'Notes' : module.fields.find((f) => f.key === key)?.label ?? 'This field';
  if (/received (null|undefined)/.test(issue.message)) return `${label} is required`;
  switch (issue.code) {
    case 'invalid_type':
      return /expected number/.test(issue.message) ? `${label} must be a number` : `${label} is not valid`;
    case 'too_small':
      return issue.origin === 'string' ? `${label} is required` : `${label} must be at least ${String(issue.minimum)}`;
    case 'too_big':
      return issue.origin === 'string' ? `${label} is too long` : `${label} cannot be more than ${String(issue.maximum)}`;
    case 'invalid_value':
      return 'Pick one from the list';
    default:
      return `Enter a valid ${label.toLowerCase()}`;
  }
}

export type ParseResult = { ok: true; data: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

export function parseRecord(module: ModuleDef, input: unknown, mode: 'create' | 'update'): ParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: { _: 'Expected a JSON object' } };
  }
  const result = recordSchema(module, mode).safeParse(normalizeKeys(module, input as Record<string, unknown>));
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[issue.path.join('.') || '_'] = plainMessage(module, issue);
    return { ok: false, errors };
  }
  const data = Object.fromEntries(Object.entries(result.data).filter(([, v]) => v !== undefined));
  if (mode === 'create' && !data.status) data.status = pickableStatuses(module)[0];
  if (mode === 'update' && Object.keys(data).length === 0) {
    return { ok: false, errors: { _: 'Nothing to update' } };
  }
  return { ok: true, data };
}

export const uuidSchema = z.string().uuid();
