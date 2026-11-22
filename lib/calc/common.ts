// Small helpers every calculator shares: reading and clamping input, building fields and takeoff lines.
// Nothing here throws, and nothing imports prices: lines name only codes from CORE_ITEMS, in that item's unit.
import { CORE_ITEMS } from '@/lib/costbook/codes';
import type { LabourClass } from '@/lib/costbook/types';
import type { CalcField, CalcInput, CalcValue, TakeoffLine } from './types';

export const round = (x: number, dp = 2): number => {
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** dp;
  return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
};

/** Rounds up, ignoring floating point dust such as 3.0000000001. */
export const ceil = (x: number): number => Math.ceil(x - 1e-9);

/** A number from the input, clamped to the field's limits, with a warning when it had to change. */
export function numberInput(input: CalcInput, field: CalcField, warnings: string[]): number {
  const raw = input[field.key];
  let x = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(x)) {
    x = Number(field.default);
    if (raw !== undefined && raw !== '') warnings.push(`${field.label} was not a number, so ${x} was used.`);
  }
  if (field.min !== undefined && x < field.min) {
    warnings.push(`${field.label} was raised to the minimum of ${field.min}.`);
    x = field.min;
  }
  if (field.max !== undefined && x > field.max) {
    warnings.push(`${field.label} was lowered to the maximum of ${field.max}.`);
    x = field.max;
  }
  return x;
}

/** A select value that is one of the field's options, or the default (with a warning) when it is not. */
export function selectInput(input: CalcInput, field: CalcField, warnings: string[]): string {
  const raw = input[field.key];
  const values = (field.options ?? []).map((o) => o.value);
  const s = raw === undefined || raw === null ? '' : String(raw);
  if (values.includes(s)) return s;
  const d = String(field.default);
  if (s !== '') warnings.push(`${field.label} "${s}" is not an option, so "${d}" was used.`);
  return d;
}

export function boolInput(input: CalcInput, field: CalcField): boolean {
  const raw = input[field.key];
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === 'false' || raw === 0 || raw === '0') return false;
  return Boolean(field.default);
}

/** Reads every field once, by type, and exposes typed getters. */
export function readFields(input: CalcInput, fields: CalcField[], warnings: string[]) {
  const nums: Record<string, number> = {};
  const strs: Record<string, string> = {};
  const bools: Record<string, boolean> = {};
  for (const f of fields) {
    if (f.type === 'number') nums[f.key] = numberInput(input, f, warnings);
    else if (f.type === 'select') strs[f.key] = selectInput(input, f, warnings);
    else bools[f.key] = boolInput(input, f);
  }
  return {
    n: (k: string): number => nums[k] ?? 0,
    s: (k: string): string => strs[k] ?? '',
    b: (k: string): boolean => bools[k] ?? false,
  };
}

// Field builders keep the definitions short and uniform.
export const numField = (key: string, label: string, unit: string | undefined, def: number, min: number, max: number, step: number, help?: string): CalcField => ({
  key, label, type: 'number', unit, default: def, min, max, step, help,
});
export const selField = (key: string, label: string, def: string, options: [string, string][], help?: string): CalcField => ({
  key, label, type: 'select', default: def, options: options.map(([value, label]) => ({ value, label })), help,
});
export const boolField = (key: string, label: string, def: boolean, help?: string): CalcField => ({ key, label, type: 'boolean', default: def, help });

const WHOLE_UNITS = new Set(['ea', 'sheet', 'bundle', 'box', 'bag', 'roll', 'can', 'pail', 'haul', 'week', 'day', 'month']);

/** A takeoff line for a catalog item. Quantity is in the catalog's unit and whole packs round up. Null when nothing is needed. */
export function core(code: string, quantity: number, opts: { description?: string; note?: string; labourHoursPerUnit?: number } = {}): TakeoffLine | null {
  const item = CORE_ITEMS[code];
  if (!item || !Number.isFinite(quantity) || quantity <= 0) return null;
  const q = WHOLE_UNITS.has(item.unit) ? ceil(quantity) : round(quantity, 2);
  if (q <= 0) return null;
  return { code, description: opts.description ?? item.description, quantity: q, unit: item.unit, ...(opts.note ? { note: opts.note } : {}), ...(opts.labourHoursPerUnit !== undefined ? { labourHoursPerUnit: opts.labourHoursPerUnit } : {}) };
}

/** A line without a catalog code: priced by its own figure, or labour only. */
export function free(description: string, quantity: number, unit: string, opts: { materialUnitCost?: number; labourHoursPerUnit?: number; labourClass?: LabourClass; note?: string } = {}): TakeoffLine | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const q = WHOLE_UNITS.has(unit) ? ceil(quantity) : round(quantity, 2);
  return { description, quantity: q, unit, ...opts };
}

/** Uses the catalog line when the code exists, otherwise a code-less line with the description. */
export function coreOrFree(code: string | undefined, description: string, quantity: number, unit: string, opts: { note?: string; labourClass?: LabourClass } = {}): TakeoffLine | null {
  if (code && CORE_ITEMS[code] && CORE_ITEMS[code].unit === unit) return core(code, quantity, { note: opts.note });
  return free(description, quantity, unit, { materialUnitCost: 0, ...opts });
}

export const compact = (lines: (TakeoffLine | null)[]): TakeoffLine[] => lines.filter((l): l is TakeoffLine => l !== null);

/** Smallest standard rating at or above the target, or null above the top of the list. */
export function stdAtLeast(list: readonly number[], x: number): number | null {
  for (const v of list) if (v >= x - 1e-9) return v;
  return null;
}
/** Largest standard rating not above the target, or null below the bottom of the list. */
export function stdAtMost(list: readonly number[], x: number): number | null {
  let best: number | null = null;
  for (const v of list) if (v <= x + 1e-9) best = v;
  return best;
}

/** One plain reminder carried in the references of every calculator whose result reads like a pass or fail ruling. */
export const AHJ_CHECK_LINE = 'Check against the CEC edition and amendments your province adopts; confirm with the authority having jurisdiction.';

/** The termination question every ampacity check asks, so the user reads the right code book column. */
export const terminationField = (): CalcField => selField('termination', 'Termination temperature rating', '60', [['60', '60 °C'], ['75', '75 °C'], ['90', '90 °C']], 'Defaults to 60 °C. Choose 75 °C only when the equipment is marked for 75 °C conductors. The conductor ampacity at this temperature limits the result.');
export const TERMINATION_WARNING = 'Read the ampacity from the 60 °C column unless the equipment is marked for 75 °C or higher conductors, or enter the ampacity at the termination temperature.';

export const M_PER_FT = 0.3048;
export const SQFT_PER_M2 = 10.7639;
export const fmt = (x: number, dp = 1): string => round(x, dp).toLocaleString('en-CA', { maximumFractionDigits: dp });
export const awgLabel = (s: string): string => (/^\d{3}$/.test(s) ? `${s} kcmil` : `${s} AWG`);

/** A value is emitted in `values` only if it is machine-readable. */
export function values(v: Record<string, CalcValue | null | undefined>): Record<string, CalcValue> {
  const out: Record<string, CalcValue> = {};
  for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) out[k] = x;
  return out;
}
