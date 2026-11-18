// Every calculator, in the order the tools page shows them. Consumers use only the exports below.
//
// CONTRACT STAGE: one worked example (concrete slab) shows the pattern. The full set of electrical,
// building, HVAC and plumbing calculators replaces this list; these exports and their behaviour stay.
import type { CalcField, CalcInput, CalcResult, CalcValue, Calculator } from './types';

export type * from './types';

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

const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;

const slabFields: CalcField[] = [
  { key: 'length', label: 'Length', type: 'number', unit: 'ft', default: 20, min: 0, max: 1000, step: 0.5 },
  { key: 'width', label: 'Width', type: 'number', unit: 'ft', default: 20, min: 0, max: 1000, step: 0.5 },
  { key: 'thickness', label: 'Thickness', type: 'number', unit: 'in', default: 4, min: 2, max: 24, step: 0.5 },
  { key: 'waste', label: 'Waste allowance', type: 'number', unit: '%', default: 8, min: 0, max: 30, step: 1 },
];

const concreteSlab: Calculator = {
  id: 'concrete-slab',
  name: 'Concrete slab calculator',
  trade: 'concrete',
  category: 'Takeoff',
  summary: 'Cubic metres and yards of ready-mix for a slab, with waste and finishing labour.',
  fields: slabFields,
  keywords: ['concrete', 'slab', 'ready-mix', 'cubic yards', 'cubic metres'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const [length, width, thickness, waste] = slabFields.map((f) => numberInput(input, f, warnings));
    const cubicFeet = length * width * (thickness / 12);
    const m3 = cubicFeet * 0.0283168 * (1 + waste / 100);
    const ordered = Math.ceil(m3 * 4) / 4; // plants batch in quarter cubic metres
    const area = length * width;
    return {
      summary: [
        { label: 'Concrete to order', value: `${ordered} m³ (${round(ordered * 1.30795, 2)} yd³)`, emphasis: true },
        { label: 'Slab area', value: `${round(area, 1)} sq ft` },
        { label: 'Volume before waste', value: `${round(cubicFeet * 0.0283168, 2)} m³` },
      ],
      values: { area_sqft: round(area, 2), volume_m3: round(m3, 3), order_m3: ordered },
      takeoff: ordered > 0 ? [{ code: 'CONC-25MPA', description: 'Ready-mix concrete 25 MPa, slab', quantity: ordered, unit: 'm3' }] : [],
      warnings,
      references: ['Volume = length x width x thickness, plus waste; ordered in 0.25 m³ steps'],
    };
  },
};

export const CALCULATORS: readonly Calculator[] = [concreteSlab];

export function getCalculator(id: string): Calculator | undefined {
  return CALCULATORS.find((c) => c.id === id);
}

/** Each field's default, which is what a fresh form shows. */
export function defaultInput(calc: Calculator): CalcInput {
  return Object.fromEntries(calc.fields.map((f) => [f.key, f.default])) as Record<string, CalcValue>;
}

/** Runs a calculator by id, or returns null for an unknown id. */
export function runCalculator(id: string, input: CalcInput): CalcResult | null {
  const calc = getCalculator(id);
  return calc ? calc.run({ ...defaultInput(calc), ...input }) : null;
}

/** JSON Schema for a calculator's input, for the AI assistant's tool definitions. */
export function inputSchema(calc: Calculator): { type: 'object'; properties: Record<string, object>; additionalProperties: false } {
  const properties: Record<string, object> = {};
  for (const f of calc.fields) {
    const description = [f.label, f.unit ? `(${f.unit})` : '', f.help ?? ''].filter(Boolean).join(' ');
    if (f.type === 'number') properties[f.key] = { type: 'number', description, ...(f.min !== undefined ? { minimum: f.min } : {}), ...(f.max !== undefined ? { maximum: f.max } : {}) };
    else if (f.type === 'boolean') properties[f.key] = { type: 'boolean', description };
    else properties[f.key] = { type: 'string', description, enum: (f.options ?? []).map((o) => o.value) };
  }
  return { type: 'object', properties, additionalProperties: false };
}
