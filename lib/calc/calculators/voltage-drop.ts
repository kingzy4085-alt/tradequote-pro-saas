import { AHJ_CHECK_LINE, M_PER_FT, compact, coreOrFree, fmt, numField, readFields, round, selField, values, awgLabel } from '../common';
import { SIZES, TYPICAL_REACTANCE_OHM_PER_KM, resistanceOhmPerM, sizesFor, wireCode } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

export const SYSTEMS: Record<string, { label: string; volts: number; phases: 1 | 3 | 0; conductors: number }> = {
  'ac1-120': { label: 'Single-phase 120 V', volts: 120, phases: 1, conductors: 2 },
  'ac1-240': { label: 'Single-phase 120/240 V (240 V load)', volts: 240, phases: 1, conductors: 2 },
  'ac3-208': { label: 'Three-phase 208 V', volts: 208, phases: 3, conductors: 3 },
  'ac3-480': { label: 'Three-phase 480 V', volts: 480, phases: 3, conductors: 3 },
  'ac3-600': { label: 'Three-phase 600 V', volts: 600, phases: 3, conductors: 3 },
  dc: { label: 'DC', volts: 0, phases: 0, conductors: 2 },
};

const fields: CalcField[] = [
  selField('system', 'System', 'ac1-120', Object.entries(SYSTEMS).map(([k, v]) => [k, v.label] as [string, string]), 'For a 120 V load on a 120/240 V system choose the 120 V option.'),
  numField('dcVolts', 'DC system voltage', 'V', 24, 6, 600, 1, 'Used only for the DC system.'),
  selField('material', 'Conductor material', 'cu', [['cu', 'Copper'], ['al', 'Aluminum']]),
  selField('size', 'Conductor size', '12', SIZES.map((s) => [s, awgLabel(s)] as [string, string]), 'Aluminum starts at 12 AWG; a smaller choice is raised to 12. Resistance is computed from the size.'),
  numField('length', 'One-way length', undefined, 30, 0.1, 2000, 0.5, 'Run length from source to load, one way. The calculator doubles it for the return path.'),
  selField('lengthUnit', 'Length unit', 'm', [['m', 'Metres'], ['ft', 'Feet']]),
  numField('load', 'Load current', 'A', 15, 0.1, 2000, 0.5),
  numField('pf', 'Power factor', undefined, 1, 0.5, 1, 0.01, 'Use 1.00 for resistive loads such as heaters and lighting; 0.8 to 0.9 for motors.'),
  selField('raceway', 'Wiring method', 'nonmag', [['nonmag', 'PVC conduit, aluminum conduit or non-metallic cable'], ['steel', 'Steel conduit, EMT or armoured cable']], 'Picks the typical reactance estimate used for AC circuits when no reactance is entered below.'),
  numField('reactance', 'Reactance (optional)', 'ohm/km', 0, 0, 1, 0.01, `AC only, and it matters when the power factor is below 1. Enter the figure from the conductor or cable maker. Leave at 0 to use a typical estimate: ${TYPICAL_REACTANCE_OHM_PER_KM.nonmag} ohm/km for non-metallic and aluminum wiring, ${TYPICAL_REACTANCE_OHM_PER_KM.steel} ohm/km for steel.`),
  selField('circuit', 'Circuit type', 'branch', [['branch', 'Branch circuit'], ['feeder', 'Feeder']], 'Rule 8-102 allows 3% in either one.'),
  numField('upstream', 'Drop already used upstream', '%', 0, 0, 5, 0.1, 'Feeder drop ahead of a branch circuit, so the 5% total can be checked.'),
];

export const voltageDrop: Calculator = {
  id: 'voltage-drop',
  name: 'Voltage drop calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Voltage drop in volts and per cent for copper or aluminum conductors, checked against the Canadian Electrical Code 3% and 5% limits, with the smallest size that passes.',
  fields,
  keywords: ['voltage drop', 'wire size', 'rule 8-102', 'feeder', 'branch circuit', 'conductor', 'length'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const sys = SYSTEMS[p.s('system')];
    const material = p.s('material') as 'cu' | 'al';
    let size = p.s('size');
    if (material === 'al' && size === '14') {
      warnings.push(`${awgLabel(size)} is not made in aluminum for building wire; ${awgLabel('12')} was used.`);
      size = '12';
    }
    const volts = sys.phases === 0 ? p.n('dcVolts') : sys.volts;
    const lengthFt = p.s('lengthUnit') === 'm' ? p.n('length') / M_PER_FT : p.n('length');
    const lengthM = lengthFt * M_PER_FT;
    const typical = TYPICAL_REACTANCE_OHM_PER_KM[p.s('raceway') === 'steel' ? 'steel' : 'nonmag'];
    const xKm = p.n('reactance') > 0 ? p.n('reactance') : typical;
    const reactanceNote = p.n('reactance') > 0 ? `entered reactance ${fmt(xKm, 3)} ohm/km` : `typical reactance estimate ${fmt(xKm, 2)} ohm/km (not entered)`;
    const load = p.n('load');
    const pf = sys.phases === 0 ? 1 : p.n('pf');
    const sinPhi = Math.sqrt(Math.max(0, 1 - pf * pf));

    const dropFor = (s: string): number => {
      const r = resistanceOhmPerM(s, material); // ohm per metre, computed from resistivity and conductor area
      const z = sys.phases === 0 ? r : r * pf + (xKm / 1000) * sinPhi;
      const k = sys.phases === 3 ? Math.sqrt(3) : 2;
      return k * load * lengthM * z;
    };
    const vd = dropFor(size);
    const pct = (vd / volts) * 100;
    const limit = 3;
    const upstream = p.n('upstream');
    const total = pct + upstream;

    const list = sizesFor(material);
    const allowed = Math.min(limit, 5 - upstream);
    const best = list.find((s) => (dropFor(s) / volts) * 100 <= allowed + 1e-9);

    if (sys.phases !== 0 && pf < 1 && p.n('reactance') <= 0) warnings.push(`Power factor is below 1 and no reactance was entered, so the ${fmt(xKm, 2)} ohm/km typical estimate was used. Enter the maker's reactance for a closer figure.`);
    if (pct > limit) warnings.push(`Voltage drop of ${fmt(pct, 2)}% is over the ${limit}% limit for a ${p.s('circuit')} (Rule 8-102).`);
    if (total > 5) warnings.push(`Total drop of ${fmt(total, 2)}% from the service is over the 5% limit (Rule 8-102).`);
    if (!best) warnings.push(`No size up to 500 kcmil keeps the drop within ${fmt(allowed, 1)}%. Use parallel conductors or a higher voltage.`);
    if (lengthFt <= 0) warnings.push('Enter a length to see the drop.');
    if (sys.phases !== 0 && /^\d{3}$/.test(size) && Number(size) >= 250) warnings.push(`Resistance here is the DC value. At ${awgLabel(size)} and above, skin and proximity effects make the AC drop higher than this figure shows, so treat the result as optimistic and use the conductor maker's AC resistance for a closer figure.`);
    if (sys.phases === 0) warnings.push('DC drop uses resistance only. Check the conductor ampacity separately, and confirm any extra-low-voltage limits with the authority having jurisdiction.');

    const takeoff = compact([
      lengthM > 0 ? coreOrFree(wireCode(material, size), `RW90 ${material === 'cu' ? 'copper' : 'aluminum'} ${awgLabel(size)}`, round(lengthM * sys.conductors, 1), 'm', { note: `${sys.conductors} conductors x ${round(lengthM, 1)} m, no ground wire counted` }) : null,
    ]);
    const passes = pct <= limit && total <= 5;
    const smallestOk = best ? awgLabel(best) : 'none up to 500 kcmil';
    return {
      summary: [
        { label: 'Voltage drop', value: `${fmt(vd, 2)} V (${fmt(pct, 2)}%)`, emphasis: true },
        { label: passes ? 'Within the voltage drop limits' : pct > limit ? 'Over the 3% limit' : 'Over the 5% total limit', value: passes ? 'Pass' : 'Fail' },
        { label: 'Smallest size within the limit', value: smallestOk },
        { label: 'Total with upstream drop', value: `${fmt(total, 2)}% (limit 5%)` },
        { label: 'Voltage at the load', value: `${fmt(volts - vd, 1)} V of ${fmt(volts, 0)} V` },
      ],
      values: values({ reactance_ohm_per_km: sys.phases === 0 ? 0 : xKm, reactance_entered: p.n('reactance') > 0, voltage_drop_v: round(vd, 3), voltage_drop_pct: round(pct, 3), limit_pct: limit, total_pct: round(total, 3), passes, smallest_size: best ?? null, size: size, material, length_m: round(lengthM, 2), load_a: load }),
      takeoff,
      warnings,
      references: [
        'CEC 2024 Rule 8-102 (voltage drop limits: 3% in a feeder or branch circuit, 5% total)',
        'Resistance is computed, not looked up: copper 0.017241 and aluminum 0.028264 ohm.mm2/m at 20 °C, temperature coefficients 0.00393 and 0.00403 per °C, worked at 75 °C, with a stranding factor of 1.02. AWG area from d = 0.127 mm x 92^((36-n)/39); kcmil x 0.5067 mm2',
        `Reactance: ${reactanceNote}`,
        'Method: drop = 2 x I x L x Z (single-phase, DC) or 1.732 x I x L x Z (three-phase), with Z = R cos(phi) + X sin(phi)',
        'Voltage drop only: check the conductor ampacity separately with the conductor check calculator',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
