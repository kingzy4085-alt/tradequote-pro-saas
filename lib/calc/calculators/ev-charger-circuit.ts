import { AHJ_CHECK_LINE, awgLabel, compact, core, coreOrFree, fmt, free, numField, readFields, round, selField, boolField, stdAtLeast, terminationField, TERMINATION_WARNING, values } from '../common';
import { SIZES, STD_OCPD, resistanceOhmPerM, sizesFor, wireCode } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const fields: CalcField[] = [
  numField('charger', 'Charger rated current', 'A', 40, 8, 80, 1, 'The charger output, e.g. 32 A, 40 A or 48 A at 240 V.'),
  numField('distance', 'Distance from the panel to the charger', 'm', 15, 1, 300, 0.5),
  selField('material', 'Conductor material', 'cu', [['cu', 'Copper'], ['al', 'Aluminum']]),
  selField('size', 'Conductor size for pricing and voltage drop', 'none', [['none', 'Not chosen yet'], ...SIZES.map((s) => [s, awgLabel(s)] as [string, string])], 'You choose the size. It does not set any ampacity: enter the ampacity from your code book below to check it.'),
  numField('conductorAmpacity', 'Ampacity of your chosen conductor (optional)', 'A', 0, 0, 2000, 1, 'Read from the code book ampacity table for your conductor, material and insulation, in the column for the termination temperature chosen below. If you enter it, it is checked against 125% of the charger current. Leave at 0 to skip.'),
  terminationField(),
  numField('service', 'Existing service size', 'A', 100, 60, 800, 5),
  numField('existing', 'Existing calculated load (Rule 8-200)', 'A', 60, 0, 800, 1, 'From the dwelling load calculator, before the charger.'),
  boolField('evems', 'Energy management system installed (EVEMS)', false, 'A system that limits the charger so the service is never overloaded.'),
];

export const evChargerCircuit: Calculator = {
  id: 'ev-charger-circuit',
  name: 'EV charger circuit calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Breaker and conductor size for a Level 2 EV charger at 125% of continuous current, voltage drop over the run, and whether the existing service has room.',
  fields,
  keywords: ['ev charger', 'evse', 'level 2', 'electric vehicle', 'breaker', 'evems'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const material = p.s('material') as 'cu' | 'al';
    const amps = p.n('charger');
    const need = amps * 1.25;
    const breaker = stdAtLeast(STD_OCPD, need);
    if (!breaker) warnings.push('The charger needs more than 2000 A of protection, which is not a residential circuit.');
    const vdPct = (sz: string) => (2 * amps * p.n('distance') * resistanceOhmPerM(sz, material)) / 240 * 100;
    const size = p.s('size');
    const chosen = size !== 'none' && (material === 'cu' || size !== '14') ? size : undefined;
    if (size !== 'none' && !chosen) warnings.push('Aluminum building wire is not made in 14 AWG; choose another size.');
    const dropOk = sizesFor(material).find((sz) => vdPct(sz) <= 3 + 1e-9);
    const drop = chosen ? vdPct(chosen) : null;
    if (chosen && drop !== null && drop > 3) warnings.push(`${awgLabel(chosen)} drops ${fmt(drop, 2)}% over ${fmt(p.n('distance'), 0)} m, over 3% (Rule 8-102).${dropOk ? ` ${awgLabel(dropOk)} is the smallest size within 3%, for voltage drop only.` : ''}`);
    if (!dropOk) warnings.push('No conductor up to 500 kcmil keeps the drop within 3% at this distance; reduce the distance or use a larger run.');
    const cAmp = p.n('conductorAmpacity');
    const ampPass = cAmp > 0 ? cAmp >= need - 1e-9 : null;
    if (cAmp > 0 && p.s('termination') === '60') warnings.push(TERMINATION_WARNING);
    if (cAmp > 0 && !ampPass) warnings.push(`The conductor ampacity of ${fmt(cAmp, 0)} A is below the ${fmt(need, 1)} A required (125% of the charger current). Choose a larger conductor.`);
    if (cAmp > 0 && breaker && breaker > cAmp + 1e-9) warnings.push(`The ${breaker} A breaker is above the ${fmt(cAmp, 0)} A conductor ampacity. Use a larger conductor or a lower charger setting.`);
    if (!chosen) warnings.push('Choose a conductor size to see the voltage drop and to price the wire; the ampacity must come from your code book.');
    const have = p.n('service') - p.n('existing');
    const short = amps - have;
    let evemsNote = '';
    if (short > 0) {
      const cap = Math.max(0, Math.floor(have));
      evemsNote = p.b('evems')
        ? `With the energy management system the charger is limited to ${cap} A and the load stays within the service.`
        : `Only ${fmt(have, 0)} A is free on the ${p.n('service')} A service, ${fmt(short, 0)} A short. An energy management system (CEC Section 86) can limit the charger to ${cap} A, or upgrade the service to ${stdAtLeast([100, 125, 150, 200, 300, 400], p.n('existing') + amps) ?? 400} A.`;
      warnings.push(evemsNote);
    }
    warnings.push('The charger is counted at 100% of its rating in the service calculation (Rule 8-200); the 125% applies to the branch circuit.');
    const hs = chosen;
    const code = breaker && [15, 20, 30, 40, 50, 60, 100].includes(breaker) ? `BKR-2P-${breaker}A` : undefined;
    const takeoff = compact([
      core('EVSE-L2-48A', 1, { note: amps > 48 ? 'catalog unit is 48 A; confirm the model' : amps < 48 ? `set to ${amps} A on the unit` : undefined }),
      breaker ? coreOrFree(code, `Breaker ${breaker} A 2-pole`, 1, 'ea') : null,
      hs ? coreOrFree(wireCode(material, hs), `RW90 ${material === 'cu' ? 'copper' : 'aluminum'} ${awgLabel(hs)}`, round(p.n('distance') * 3, 1), 'm', { note: '2 hot conductors and 1 bonding conductor; size the bonding conductor from the CEC bonding table for the overcurrent device rating' }) : null,
    ]);
    return {
      summary: [
        { label: 'Breaker', value: breaker ? `${breaker} A 2-pole (${fmt(need, 1)} A at 125%)` : 'n/a', emphasis: true },
        { label: 'Required conductor ampacity', value: `${fmt(need, 1)} A (125% of charger current)${ampPass === null ? '' : `; yours ${fmt(cAmp, 0)} A: ${ampPass ? 'Pass' : 'Fail'}`}` },
        { label: 'Conductor chosen', value: hs ? `${awgLabel(hs)} ${material === 'cu' ? 'copper' : 'aluminum'}` : 'not chosen' },
        { label: 'Voltage drop', value: hs && drop !== null ? `${fmt(drop, 2)}% over ${fmt(p.n('distance'), 0)} m` : 'choose a size' },
        { label: 'Smallest size within 3% drop', value: dropOk ? `${awgLabel(dropOk)} (voltage drop only, not ampacity)` : 'none up to 500 kcmil' },
        { label: 'Service capacity', value: short > 0 ? `Short by ${fmt(short, 0)} A` : `${fmt(have - amps, 0)} A to spare` },
        { label: 'Load management', value: short > 0 ? (p.b('evems') ? 'EVEMS covers the shortfall' : 'EVEMS or a service upgrade needed') : 'Not needed' },
      ],
      values: values({ charger_a: amps, breaker_a: breaker, required_ampacity_a: round(need, 1), conductor_size: hs ?? null, conductor_passes: ampPass, min_size_for_drop: dropOk ?? null, voltage_drop_pct: drop !== null ? round(drop, 2) : null, free_capacity_a: round(have, 1), short_a: round(Math.max(0, short), 1), evems_needed: short > 0 && !p.b('evems') }),
      takeoff,
      warnings,
      references: [
        'CEC Section 86 provides the general electric-vehicle-charging context; confirm branch-circuit requirements against the electrical code adopted in the project jurisdiction',
        'Conductor ampacity is typed by the user from their own code book; no ampacity table is built in. Voltage drop (Rule 8-102) uses resistance computed from resistivity and conductor area',
        'Service load for a single dwelling is checked using the Rule 8-200 calculation context; confirm EV energy-management provisions against the electrical code adopted in your province',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
