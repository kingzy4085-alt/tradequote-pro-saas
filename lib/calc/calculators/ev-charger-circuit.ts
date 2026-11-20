import { AHJ_CHECK_LINE, M_PER_FT, awgLabel, compact, core, coreOrFree, fmt, free, numField, readFields, round, selField, boolField, stdAtLeast, values } from '../common';
import { R_AL, R_CU, STD_OCPD, T2_CU, T4_AL, sizesFor, wireCode } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const fields: CalcField[] = [
  numField('charger', 'Charger rated current', 'A', 40, 8, 80, 1, 'The charger output, e.g. 32 A, 40 A or 48 A at 240 V.'),
  numField('distance', 'Distance from the panel to the charger', 'm', 15, 1, 300, 0.5),
  selField('material', 'Conductor material', 'cu', [['cu', 'Copper'], ['al', 'Aluminum']]),
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
  keywords: ['ev charger', 'evse', 'level 2', 'electric vehicle', 'breaker', 'evems', 'rule 86-300'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const material = p.s('material') as 'cu' | 'al';
    const amps = p.n('charger');
    const need = amps * 1.25;
    const breaker = stdAtLeast(STD_OCPD, need);
    if (!breaker) warnings.push('The charger needs more than 2000 A of protection, which is not a residential circuit.');
    const table = material === 'cu' ? T2_CU : T4_AL;
    const lenFt = p.n('distance') / M_PER_FT;
    const vdPct = (s: string) => (2 * amps * lenFt * ((material === 'cu' ? R_CU[s] : R_AL[s]) / 1000)) / 240 * 100;
    const sizes = sizesFor(material);
    const byAmp = sizes.find((s) => table[s][1] >= need - 1e-9);
    const sized = sizes.find((s) => table[s][1] >= need - 1e-9 && vdPct(s) <= 3 + 1e-9);
    if (byAmp && sized && sized !== byAmp) warnings.push(`${awgLabel(byAmp)} carries the current, but ${awgLabel(sized)} was chosen to keep voltage drop within 3% over ${fmt(p.n('distance'), 0)} m.`);
    if (!sized) warnings.push('No conductor up to 500 kcmil meets both ampacity and 3% drop; reduce the distance or use a larger run.');
    const drop = sized ? vdPct(sized) : 0;
    if (breaker && sized && breaker > table[sized][1] + 1e-9) warnings.push(`The ${breaker} A breaker is above the ${table[sized][1]} A conductor ampacity. Use the next larger conductor or a lower charger setting.`);
    const have = p.n('service') - p.n('existing');
    const short = amps - have;
    let evemsNote = '';
    if (short > 0) {
      const cap = Math.max(0, Math.floor(have));
      evemsNote = p.b('evems')
        ? `With the energy management system the charger is limited to ${cap} A and the load stays within the service.`
        : `Only ${fmt(have, 0)} A is free on the ${p.n('service')} A service, ${fmt(short, 0)} A short. An energy management system (CEC Rule 8-106 11) can limit the charger to ${cap} A, or upgrade the service to ${stdAtLeast([100, 125, 150, 200, 300, 400], p.n('existing') + amps) ?? 400} A.`;
      warnings.push(evemsNote);
    }
    warnings.push('The charger is counted at 100% of its rating in the service calculation (Rule 8-200 1) a) vi); the 125% applies to the branch circuit.');
    const hs = sized ?? byAmp;
    const code = breaker && [15, 20, 30, 40, 50, 60, 100].includes(breaker) ? `BKR-2P-${breaker}A` : undefined;
    const takeoff = compact([
      core('EVSE-L2-48A', 1, { note: amps > 48 ? 'catalog unit is 48 A; confirm the model' : amps < 48 ? `set to ${amps} A on the unit` : undefined }),
      breaker ? coreOrFree(code, `Breaker ${breaker} A 2-pole`, 1, 'ea') : null,
      hs ? coreOrFree(wireCode(material, hs), `RW90 ${material === 'cu' ? 'copper' : 'aluminum'} ${awgLabel(hs)}`, round(p.n('distance') * 3, 1), 'm', { note: '2 hot conductors and 1 bonding conductor; size the bonding conductor from the CEC bonding table for the overcurrent device rating' }) : null,
    ]);
    return {
      summary: [
        { label: 'Breaker', value: breaker ? `${breaker} A 2-pole (${fmt(need, 1)} A at 125%)` : 'n/a', emphasis: true },
        { label: 'Conductor', value: hs ? `${awgLabel(hs)} ${material === 'cu' ? 'copper' : 'aluminum'}, ${table[hs][1]} A at 75 °C` : 'n/a' },
        { label: 'Voltage drop', value: sized ? `${fmt(drop, 2)}% over ${fmt(p.n('distance'), 0)} m` : 'n/a' },
        { label: 'Service capacity', value: short > 0 ? `Short by ${fmt(short, 0)} A` : `${fmt(have - amps, 0)} A to spare` },
        { label: 'Load management', value: short > 0 ? (p.b('evems') ? 'EVEMS covers the shortfall' : 'EVEMS or a service upgrade needed') : 'Not needed' },
      ],
      values: values({ charger_a: amps, breaker_a: breaker, required_ampacity_a: round(need, 1), conductor_size: hs ?? null, voltage_drop_pct: round(drop, 2), free_capacity_a: round(have, 1), short_a: round(Math.max(0, short), 1), evems_needed: short > 0 && !p.b('evems') }),
      takeoff,
      warnings,
      references: [
        'CEC 2024 Section 86 (electric vehicle charging; branch circuit at 125% of the continuous current), Rule 8-104',
        'CEC Table 2 and Table 4 ampacity at 75 °C; Rule 8-102 voltage drop; Rule 8-200 1) a) vi) and Rule 8-106 11) (EVEMS)',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
