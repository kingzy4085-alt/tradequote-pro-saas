import { AHJ_CHECK_LINE, awgLabel, compact, fmt, numField, readFields, round, selField, boolField, stdAtLeast, values } from '../common';
import { SMALL_CONDUCTOR_MAX, STD_OCPD, ambientFactor, countFactor, sizesFor, usableAmpacity } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const temps: [string, string][] = [['60', '60 °C'], ['75', '75 °C'], ['90', '90 °C (RW90, T90 Nylon)']];
const fields: CalcField[] = [
  numField('load', 'Load current', 'A', 40, 0.1, 1500, 0.5),
  boolField('continuous', 'Continuous load', true, 'A load that persists for more than 1 hour in any 2-hour period where the load is 225 A or less, or more than 3 hours in any 6-hour period above 225 A (CEC Rule 8-104). The conductor must then be sized with the continuous-load factor.'),
  selField('rating', 'Equipment and overcurrent device rating for continuous loads', '80', [['80', 'Rated for 80% continuous loading (standard)'], ['100', 'Marked for 100% continuous loading']], 'Sets the continuous-load factor: 80% of ampacity in a raceway or cable (100% if the equipment is marked for it); 70% of free-air ampacity (85% if marked for 100%).'),
  selField('material', 'Conductor material', 'cu', [['cu', 'Copper (Table 2)'], ['al', 'Aluminum (Table 4)']]),
  selField('insulation', 'Insulation temperature rating', '90', temps, 'RW90 and T90 Nylon are 90 °C; the 90 °C column is used for derating only.'),
  selField('termination', 'Termination rating', '60', temps, 'Defaults to 60 °C. Choose 75 °C only when the equipment is marked for 75 °C conductors (Rule 4-006); confirm with the equipment marking.'),
  numField('ambient', 'Ambient temperature', '°C', 30, 10, 70, 1, 'Table 2 and 4 are based on 30 °C.'),
  numField('conductors', 'Conductors in the raceway or cable', undefined, 3, 1, 100, 1, 'Count per Table 5C (neutrals carrying only unbalanced current and bonding conductors are not counted).'),
  selField('method', 'Installation', 'raceway', [['raceway', 'In a raceway or cable (Tables 2 and 4)'], ['air', 'Single conductors in free air (Tables 1 and 3)']]),
];

export const conductorSize: Calculator = {
  id: 'conductor-size',
  name: 'Conductor size (ampacity) calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Smallest copper or aluminum conductor for a load, with continuous-load, ambient, conductor-count and termination-temperature corrections from the Canadian Electrical Code tables.',
  fields,
  keywords: ['ampacity', 'wire size', 'conductor', 'cec table 2', 'derating', 'termination', 'continuous load'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const material = p.s('material') as 'cu' | 'al';
    const ins = Number(p.s('insulation')) as 60 | 75 | 90;
    const term = Number(p.s('termination')) as 60 | 75 | 90;
    const freeAir = p.s('method') === 'air';
    const load = p.n('load');
    const rated100 = p.s('rating') === '100';
    const contFactor = !p.b('continuous') ? 1 : freeAir ? (rated100 ? 0.85 : 0.7) : (rated100 ? 1 : 0.8);
    const design = load / contFactor;
    const sizes = sizesFor(material);
    if (term > ins) warnings.push(`The termination rating is above the insulation rating; ${ins} °C was used as the limit.`);
    if (freeAir && p.n('conductors') > 3) warnings.push('Free-air ampacity ignores the conductor count; Table 5B spacing factors may apply for grouped single conductors.');
    if (ambientFactor(ins, p.n('ambient')) === 0) warnings.push(`At ${p.n('ambient')} °C a ${ins} °C insulation has no ampacity left; use a higher-rated insulation.`);
    const found = sizes.find((s) => {
      const u = usableAmpacity(s, material, ins, term, p.n('ambient'), p.n('conductors'), freeAir);
      return u !== null && u.usable >= design - 1e-9;
    });
    if (!found) warnings.push(`No size up to 500 kcmil carries ${fmt(design, 1)} A under these conditions. Use parallel conductors.`);
    const u = found ? usableAmpacity(found, material, ins, term, p.n('ambient'), p.n('conductors'), freeAir) : null;
    const ocpd = stdAtLeast(STD_OCPD, design);
    if (found && u) {
      if (ocpd !== null && ocpd > u.usable + 1e-9) warnings.push(`The next standard device above the load is ${ocpd} A, larger than the ${fmt(u.usable, 0)} A conductor ampacity. Rule 14-104 and Table 13 allow it only in the cases they list; otherwise use the next lower rating.`);
      const cap = SMALL_CONDUCTOR_MAX[material][found];
      if (cap) warnings.push(`${awgLabel(found)} ${material === 'cu' ? 'copper' : 'aluminum'} is limited to ${cap} A overcurrent protection (Rule 14-104).`);
      if (term === 60 && ins > 60 && u.corrected > u.termination) warnings.push('Termination at 60 °C limits the usable ampacity to the 60 °C column.');
    }
    return {
      summary: [
        { label: 'Minimum conductor size', value: found ? `${awgLabel(found)} ${material === 'cu' ? 'copper' : 'aluminum'}` : 'No single conductor fits', emphasis: true },
        { label: 'Usable ampacity', value: u ? `${fmt(u.usable, 1)} A` : 'n/a' },
        { label: 'Design current', value: `${fmt(design, 1)} A${p.b('continuous') ? ` (continuous load, ${round(contFactor * 100, 0)}% of ${freeAir ? 'free-air' : 'raceway or cable'} ampacity allowed)` : ''}` },
        { label: 'Correction factors', value: `ambient ${u ? u.ambient : ambientFactor(ins, p.n('ambient'))} x count ${freeAir ? 1 : countFactor(p.n('conductors'))}` },
        { label: 'Table ampacity before correction', value: u ? `${u.base} A at ${ins} °C` : 'n/a' },
        { label: 'Termination limit', value: u ? `${u.termination} A at ${Math.min(term, ins)} °C` : 'n/a' },
        { label: 'Smallest standard overcurrent device', value: ocpd ? `${ocpd} A` : 'above 2000 A' },
      ],
      values: values({ size: found ?? null, design_current_a: round(design, 2), continuous_factor: contFactor, corrected_ampacity_a: u ? round(u.corrected, 1) : null, termination_ampacity_a: u ? u.termination : null, usable_ampacity_a: u ? round(u.usable, 1) : null, ambient_factor: u ? u.ambient : null, count_factor: u ? u.count : null, ocpd_a: ocpd }),
      takeoff: compact([]),
      warnings,
      references: [
        'CEC 2024 Table 2 (copper) and Table 4 (aluminum) ampacity; Tables 1 and 3 for free air',
        'CEC Table 5A ambient correction, Table 5C more than three conductors (Rule 4-004)',
        'CEC Rule 4-006 termination temperature, Rule 8-104 continuous loads (80% or 100% of ampacity in a raceway or cable; 70% or 85% of free-air ampacity), Rule 14-104 and Table 13 overcurrent ratings',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
