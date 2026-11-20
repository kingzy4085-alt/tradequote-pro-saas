// Every calculator, in the order the tools page shows them. Consumers use only the exports below:
// CALCULATORS, getCalculator, defaultInput, runCalculator, inputSchema and numberInput.
//
// Order: electrical design, electrical takeoff, building takeoff, then mechanical.
import type { CalcInput, CalcValue, Calculator } from './types';
import { boxFill } from './calculators/box-fill';
import { concreteFootingWall } from './calculators/concrete-footing-wall';
import { concretePiles } from './calculators/concrete-piles';
import { concreteSlab } from './calculators/concrete-slab';
import { conductorSize } from './calculators/conductor-size';
import { conduitFill } from './calculators/conduit-fill';
import { drywall } from './calculators/drywall';
import { dwellingLoad } from './calculators/dwelling-load';
import { evChargerCircuit } from './calculators/ev-charger-circuit';
import { flooring } from './calculators/flooring';
import { heatLoss } from './calculators/heat-loss';
import { insulation } from './calculators/insulation';
import { lightingLayout } from './calculators/lighting-layout';
import { motorCircuit } from './calculators/motor-circuit';
import { paint } from './calculators/paint';
import { residentialWiringTakeoff } from './calculators/residential-wiring-takeoff';
import { roofing } from './calculators/roofing';
import { transformerSizing } from './calculators/transformer-sizing';
import { voltageDrop } from './calculators/voltage-drop';
import { wallFraming } from './calculators/wall-framing';
import { waterHeaterSizing } from './calculators/water-heater-sizing';

export type * from './types';
export { numberInput } from './common';

export const CALCULATORS: readonly Calculator[] = [
  voltageDrop,
  conductorSize,
  conduitFill,
  boxFill,
  motorCircuit,
  dwellingLoad,
  residentialWiringTakeoff,
  evChargerCircuit,
  transformerSizing,
  lightingLayout,
  concreteSlab,
  concreteFootingWall,
  concretePiles,
  drywall,
  paint,
  wallFraming,
  roofing,
  flooring,
  insulation,
  heatLoss,
  waterHeaterSizing,
];

export function getCalculator(id: string): Calculator | undefined {
  return CALCULATORS.find((c) => c.id === id);
}

/** Each field's default, which is what a fresh form shows. */
export function defaultInput(calc: Calculator): CalcInput {
  return Object.fromEntries(calc.fields.map((f) => [f.key, f.default])) as Record<string, CalcValue>;
}

/** Runs a calculator by id, or returns null for an unknown id. */
export function runCalculator(id: string, input: CalcInput): ReturnType<Calculator['run']> | null {
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
