import { z } from 'zod';
import { cents } from './billing-math';
import { EstimateLineSchema, type EstimateLine } from './estimate-math';

/** A saved group of estimate lines. The lines have the estimate line shape, so adding one to an estimate is a copy. */
export interface Assembly {
  id: string;
  name: string;
  category: string;
  lines: EstimateLine[];
}

export const MAX_ASSEMBLY_LINES = 200;
export const ASSEMBLY_LIST_LIMIT = 500;
/** What a list of assemblies selects: the assembly and its lines in the estimate line shape. */
export const ASSEMBLY_COLUMNS = 'id, name, category, lines:assembly_lines(sort, description, quantity, unit, material_unit_cost, labour_hours_per_unit)';

export const AssemblySchema = z.object({
  name: z.string().trim().min(1, 'Give the assembly a name').max(120, 'Keep the name under 120 characters'),
  category: z.string().trim().max(60, 'Keep the trade under 60 characters').default(''),
  lines: z.array(EstimateLineSchema).min(1, 'Add at least one line').max(MAX_ASSEMBLY_LINES, `An assembly can have up to ${MAX_ASSEMBLY_LINES} lines`),
});
export type AssemblyInput = z.infer<typeof AssemblySchema>;

/** Checks what a form sent, and words the first problem for the person who typed it. */
export function parseAssembly(body: unknown): { ok: true; data: AssemblyInput } | { ok: false; error: string } {
  const parsed = AssemblySchema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path[0] === 'lines' && typeof issue.path[1] === 'number' ? `Line ${issue.path[1] + 1}: ` : '';
  return { ok: false, error: `${where}${issue?.message ?? 'Some values were not valid'}` };
}

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** A line somebody actually filled in. The estimate editor drops the rest on save, and so does this. */
export const isFilledLine = (l: EstimateLine) => Boolean(String(l.description ?? '').trim() || num(l.material_unit_cost) || num(l.labour_hours_per_unit));

/** A database row with its embedded lines, as the app uses it: lines in order, without the sort column. */
export function toAssembly(row: { id: string; name: string; category: string | null; lines?: (EstimateLine & { sort?: number })[] | null }): Assembly {
  const lines = [...(row.lines ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? '',
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, material_unit_cost: l.material_unit_cost, labour_hours_per_unit: l.labour_hours_per_unit })),
  };
}

/** How many of an assembly to add: a positive number up to 10,000, or 1 when the box is blank or nonsense. */
export function parseMultiplier(value: unknown): number {
  const x = Number(value);
  return Number.isFinite(x) && x > 0 ? Math.min(x, 10_000) : 1;
}

/** The estimate lines for `multiplier` of an assembly. Only quantities scale; unit costs and hours per unit stay as saved. */
export function expandAssembly(lines: EstimateLine[], multiplier: unknown = 1): EstimateLine[] {
  const m = parseMultiplier(multiplier);
  return lines.map((l) => ({
    description: l.description,
    quantity: Math.round(num(l.quantity) * m * 1000) / 1000,
    unit: l.unit,
    material_unit_cost: num(l.material_unit_cost),
    labour_hours_per_unit: num(l.labour_hours_per_unit),
  }));
}

/** Adds lines to an estimate. An estimate that is only blank lines is replaced, not added under. */
export function insertLines(current: EstimateLine[], added: EstimateLine[]): EstimateLine[] {
  return [...(current.some(isFilledLine) ? current : []), ...added];
}

/** Material cost and labour hours for one of an assembly, before rates, markup and tax. */
export function assemblySummary(lines: EstimateLine[]) {
  return {
    material: cents(lines.reduce((s, l) => s + cents(num(l.quantity) * num(l.material_unit_cost)), 0)),
    hours: cents(lines.reduce((s, l) => s + num(l.quantity) * num(l.labour_hours_per_unit), 0)),
  };
}

/** Matches every word typed against the name, the trade and the line descriptions. */
export function filterAssemblies<T extends Pick<Assembly, 'name' | 'category' | 'lines'>>(list: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((a) => {
    const text = [a.name, a.category, ...a.lines.map((l) => l.description)].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

const line = (description: string, quantity: number, unit: string, material_unit_cost: number, labour_hours_per_unit: number) => ({ description, quantity, unit, material_unit_cost, labour_hours_per_unit });

/** Offered to a company with an empty library. Prices are placeholders to edit, not a price book. */
export const STARTER_ASSEMBLIES: AssemblyInput[] = [
  {
    name: '100A Service', category: 'Service',
    lines: [
      line('100A meter socket', 1, 'ea', 140, 1.5),
      line('100A 24-circuit panel with main breaker', 1, 'ea', 260, 3),
      line('Service mast, weatherhead and hardware', 1, 'ea', 180, 2),
      line('#3 copper service conductors', 15, 'm', 9.5, 0.05),
      line('Grounding: plate, #6 bare copper and clamps', 1, 'ea', 85, 1),
      line('Permit and utility coordination', 1, 'ea', 150, 1.5),
    ],
  },
  {
    name: '200A Service', category: 'Service',
    lines: [
      line('200A meter socket', 1, 'ea', 220, 2),
      line('200A 40-circuit panel with main breaker', 1, 'ea', 420, 4),
      line('Service mast, weatherhead and hardware', 1, 'ea', 240, 2.5),
      line('3/0 copper service conductors', 15, 'm', 24, 0.08),
      line('Grounding: plates, #4 bare copper and clamps', 1, 'ea', 120, 1.5),
      line('Permit and utility coordination', 1, 'ea', 150, 1.5),
    ],
  },
  {
    name: 'Panel Upgrade', category: 'Service',
    lines: [
      line('200A 40-circuit panel with main breaker', 1, 'ea', 420, 3),
      line('Breakers, assorted 15A to 40A', 20, 'ea', 14, 0.15),
      line('Remove old panel and re-terminate circuits', 1, 'ea', 0, 5),
      line('Bonding and grounding upgrade', 1, 'ea', 60, 1),
      line('Circuit directory and labelling', 1, 'ea', 10, 0.5),
      line('Permit and inspection', 1, 'ea', 150, 1),
    ],
  },
  {
    name: 'EV Charger', category: 'Residential',
    lines: [
      line('40A 2-pole breaker', 1, 'ea', 35, 0.25),
      line('8/3 NMD90 cable', 15, 'm', 8.5, 0.06),
      line('NEMA 14-50 receptacle with box and cover', 1, 'ea', 45, 0.75),
      line('Mount and connect customer-supplied charger', 1, 'ea', 0, 1.5),
      line('Permit and load calculation', 1, 'ea', 120, 1),
    ],
  },
  {
    name: 'Hot Tub Feed', category: 'Residential',
    lines: [
      line('50A 2-pole GFCI breaker', 1, 'ea', 160, 0.25),
      line('6/3 NMD90 cable', 18, 'm', 12, 0.06),
      line('60A outdoor disconnect', 1, 'ea', 70, 1),
      line('1in liquid-tight flexible conduit with fittings', 3, 'm', 9, 0.3),
      line('Bonding and final connection', 1, 'ea', 20, 1.5),
      line('Permit', 1, 'ea', 120, 0.5),
    ],
  },
  {
    name: 'Range Circuit', category: 'Residential',
    lines: [
      line('40A 2-pole breaker', 1, 'ea', 35, 0.25),
      line('8/3 NMD90 cable', 12, 'm', 8.5, 0.06),
      line('14-50R range receptacle with box', 1, 'ea', 30, 0.75),
    ],
  },
  {
    name: 'Standard Receptacle', category: 'Residential',
    lines: [
      line('15A tamper-resistant duplex receptacle', 1, 'ea', 3.5, 0.3),
      line('Device box and cover plate', 1, 'ea', 4, 0.2),
      line('14/2 NMD90 cable', 8, 'm', 1.6, 0.03),
    ],
  },
  {
    name: 'Pot Light', category: 'Lighting',
    lines: [
      line('4in slim LED pot light', 1, 'ea', 22, 0.5),
      line('14/2 NMD90 cable', 3, 'm', 1.6, 0.03),
      line('Connectors and staples', 1, 'ea', 1.5, 0),
    ],
  },
];
