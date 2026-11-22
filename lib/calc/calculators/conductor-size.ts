import { AHJ_CHECK_LINE, awgLabel, compact, coreOrFree, fmt, numField, readFields, round, selField, boolField, stdAtLeast, stdAtMost, terminationField, TERMINATION_WARNING, values } from '../common';
import { SIZES, SMALL_CONDUCTOR_MAX, STD_OCPD, wireCode } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const fields: CalcField[] = [
  numField('load', 'Load current', 'A', 40, 0.1, 1500, 0.5),
  boolField('continuous', 'Continuous load', true, 'A load that persists for more than 1 hour in any 2-hour period where the load is 225 A or less, or more than 3 hours in any 6-hour period above 225 A (CEC Rule 8-104). The conductor must then be sized with the continuous-load factor.'),
  selField('rating', 'Equipment and overcurrent device rating for continuous loads', '80', [['80', 'Rated for 80% continuous loading (standard)'], ['100', 'Marked for 100% continuous loading']], 'Sets the continuous-load factor: 80% of ampacity in a raceway or cable (100% if the equipment is marked for it); 70% of free-air ampacity (85% if marked for 100%).'),
  selField('method', 'Installation', 'raceway', [['raceway', 'In a raceway or cable'], ['air', 'Single conductors in free air']], 'Decides which continuous-load factor applies, and which ampacity table you read from your code book.'),
  numField('tableAmpacity', 'Conductor ampacity from the code book', 'A', 0, 0, 2000, 1, 'Read it from the code book ampacity table for your conductor material and installation, in the column for the conductor insulation temperature. Not supplied by this calculator. 0 means not entered yet.'),
  numField('ambientFactor', 'Ambient temperature correction factor', undefined, 1, 0, 1.5, 0.01, 'Read it from the code book ambient correction table for your insulation and ambient temperature. Use 1 at the table base temperature.'),
  numField('derating', 'Derating factor for more than three conductors', undefined, 1, 0, 1, 0.01, 'Read it from the code book table for the number of conductors in the raceway or cable. Use 1 for three or fewer.'),
  terminationField(),
  numField('terminationAmpacity', 'Ampacity at the termination temperature (optional)', 'A', 0, 0, 2000, 1, 'The same code book table, read in the column for the termination temperature above. Leave at 0 if the ampacity typed above is already read at that column.'),
  selField('material', 'Conductor material for pricing', 'cu', [['cu', 'Copper'], ['al', 'Aluminum']]),
  selField('size', 'Conductor size for pricing (optional)', 'none', [['none', 'No takeoff'], ...SIZES.map((s) => [s, awgLabel(s)] as [string, string])], 'Only used to price the wire and for the small-conductor limit. It does not set any ampacity: the ampacity is the figure you typed from the code book.'),
  numField('conductors', 'Conductors to price', undefined, 2, 1, 100, 1, 'Used with the length for the wire takeoff.'),
  numField('length', 'Length to price', 'm', 0, 0, 2000, 0.5, 'Leave at 0 for no takeoff.'),
];

export const conductorSize: Calculator = {
  id: 'conductor-size',
  name: 'Conductor check (ampacity)',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Checks a conductor against a load: required ampacity with the continuous-load factor against the ampacity you read from your code book, corrected for ambient and conductor count, with pass or fail.',
  fields,
  keywords: ['ampacity', 'conductor check', 'wire size', 'conductor', 'derating', 'termination', 'continuous load', 'rule 8-104'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const material = p.s('material') as 'cu' | 'al';
    const term = Number(p.s('termination'));
    const freeAir = p.s('method') === 'air';
    const load = p.n('load');
    const rated100 = p.s('rating') === '100';
    const continuous = p.b('continuous');
    const contFactor = !continuous ? 1 : freeAir ? (rated100 ? 0.85 : 0.7) : (rated100 ? 1 : 0.8);
    const required = load / contFactor;
    const table = p.n('tableAmpacity');
    const entered = table > 0;
    const corrected = table * p.n('ambientFactor') * p.n('derating');
    const termAmp = p.n('terminationAmpacity');
    const termLimit = termAmp > 0 ? termAmp : null;
    const size = p.s('size');
    const hasSize = size !== 'none';
    // Rule 14-104 caps overcurrent protection of small conductors, and so the ampacity the circuit can use
    const smallLimit = hasSize ? (SMALL_CONDUCTOR_MAX[material][size] ?? null) : null;
    const usable = termLimit !== null ? Math.min(corrected, termLimit) : corrected;
    const effective = smallLimit !== null ? Math.min(usable, smallLimit) : usable;
    const pass = entered && effective >= required - 1e-9;
    const wanted = stdAtLeast(STD_OCPD, required);
    const ocpd = wanted !== null && smallLimit !== null && wanted > smallLimit + 1e-9 ? stdAtMost(STD_OCPD, smallLimit) : wanted;

    if (!entered) warnings.push('Enter the conductor ampacity from your code book to get a pass or fail.');
    if (entered && p.n('ambientFactor') <= 0) warnings.push('An ambient factor of 0 leaves no ampacity; use insulation rated for the ambient temperature.');
    if (entered && !pass) warnings.push(`The usable ampacity of ${fmt(effective, 1)} A is below the ${fmt(required, 1)} A required. Use a larger conductor or reduce the load, then enter the new code book ampacity.`);
    if (entered && termLimit !== null && termLimit < corrected) warnings.push(`The ${term} °C termination limit of ${fmt(termLimit, 0)} A is below the corrected ampacity of ${fmt(corrected, 1)} A, so it governs.`);
    if (entered && termLimit === null && term === 60) warnings.push(`${TERMINATION_WARNING.replace('termination temperature.', 'termination temperature above.')}`);
    if (freeAir && p.n('derating') < 1) warnings.push('A derating factor was entered for free air; check that your code book applies it to single conductors in free air.');
    if (entered && ocpd !== null && ocpd > effective + 1e-9) warnings.push(`The next standard device above the required ampacity is ${ocpd} A, larger than the ${fmt(effective, 0)} A usable ampacity. A higher standard overcurrent-device rating is permitted only where allowed by the electrical code adopted in your jurisdiction; otherwise select a compliant rating.`);
    if (hasSize) {
      const cap = smallLimit;
      if (cap) warnings.push(`${awgLabel(size)} ${material === 'cu' ? 'copper' : 'aluminum'} is limited to ${cap} A overcurrent protection (Rule 14-104), so no more than ${cap} A is counted as usable and the overcurrent device is capped at ${cap} A.`);
      else if (material === 'al' && size === '14') warnings.push('Aluminum building wire is not made in 14 AWG; check the size.');
    }

    const len = p.n('length');
    const takeoff = hasSize && len > 0
      ? compact([coreOrFree(wireCode(material, size), `RW90 ${material === 'cu' ? 'copper' : 'aluminum'} ${awgLabel(size)}`, round(len * p.n('conductors'), 1), 'm', { note: `${Math.round(p.n('conductors'))} conductors x ${round(len, 1)} m` })])
      : [];

    return {
      summary: [
        { label: 'Result', value: !entered ? 'Enter the code book ampacity' : pass ? 'Pass' : 'Fail', emphasis: true },
        { label: 'Required ampacity', value: `${fmt(required, 1)} A${continuous ? ` (continuous load: ${fmt(load, 1)} A at ${round(contFactor * 100, 0)}% of ${freeAir ? 'free-air' : 'raceway or cable'} ampacity allowed)` : ''}` },
        { label: 'Corrected available ampacity', value: entered ? `${fmt(effective, 1)} A${effective < usable - 1e-9 ? ` (small-conductor limit of ${smallLimit} A applied)` : ''}` : 'n/a' },
        { label: 'Continuous factor used', value: `${contFactor}` },
        { label: 'Code book ampacity before correction', value: entered ? `${fmt(table, 1)} A x ambient ${p.n('ambientFactor')} x derating ${p.n('derating')} = ${fmt(corrected, 1)} A` : 'n/a' },
        { label: 'Termination limit', value: termLimit !== null ? `${fmt(termLimit, 0)} A at ${term} °C` : 'not entered' },
        { label: 'Smallest standard overcurrent device', value: ocpd ? `${ocpd} A${wanted !== null && ocpd < wanted ? ` (capped at the ${smallLimit} A small-conductor limit; the load needs ${wanted} A, so use a larger conductor)` : ''}` : 'above 2000 A' },
      ],
      values: values({
        passes: entered ? pass : null,
        required_ampacity_a: round(required, 2),
        continuous_factor: contFactor,
        table_ampacity_a: entered ? table : null,
        ambient_factor: p.n('ambientFactor'),
        derating_factor: p.n('derating'),
        corrected_ampacity_a: entered ? round(corrected, 1) : null,
        termination_ampacity_a: termLimit,
        usable_ampacity_a: entered ? round(effective, 1) : null,
        small_conductor_limit_a: smallLimit,
        margin_a: entered ? round(effective - required, 1) : null,
        ocpd_a: ocpd,
        size: hasSize ? size : null,
      }),
      takeoff,
      warnings,
      references: [
        'Ampacity, ambient correction and derating figures are typed by the user from their own code book; this calculator does the arithmetic only',
        'CEC Rule 8-104 continuous loads: 80% or 100% of ampacity in a raceway or cable, 70% or 85% of free-air ampacity (summary)',
        'CEC Rule 14-104 overcurrent protection of conductors, including the limits for small conductors (summary)',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
