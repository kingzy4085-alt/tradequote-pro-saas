import { AHJ_CHECK_LINE, M_PER_FT, compact, coreOrFree, fmt, numField, readFields, round, selField, values, awgLabel } from '../common';
import { R_AL, R_CU, SIZES, T2_CU, T4_AL, XL, sizesFor, wireCode } from '../electrical-data';
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
  selField('size', 'Conductor size', '12', SIZES.map((s) => [s, awgLabel(s)] as [string, string]), 'Aluminum starts at 12 AWG; a smaller choice is raised to 12.'),
  numField('length', 'One-way length', undefined, 30, 0.1, 2000, 0.5, 'Run length from source to load, one way. The calculator doubles it for the return path.'),
  selField('lengthUnit', 'Length unit', 'm', [['m', 'Metres'], ['ft', 'Feet']]),
  numField('load', 'Load current', 'A', 15, 0.1, 2000, 0.5),
  numField('pf', 'Power factor', undefined, 1, 0.5, 1, 0.01, 'Use 1.00 for resistive loads such as heaters and lighting; 0.8 to 0.9 for motors.'),
  selField('raceway', 'Wiring method', 'nonmag', [['nonmag', 'PVC conduit, aluminum conduit or non-metallic cable'], ['steel', 'Steel conduit, EMT or armoured cable']], 'Sets the reactance used for AC circuits.'),
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
  keywords: ['voltage drop', 'wire size', 'cec 8-102', 'feeder', 'branch circuit', 'conductor', 'length'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const sys = SYSTEMS[p.s('system')];
    const material = p.s('material') as 'cu' | 'al';
    let size = p.s('size');
    if (material === 'al' && !R_AL[size]) {
      warnings.push(`${awgLabel(size)} is not made in aluminum for building wire; ${awgLabel('12')} was used.`);
      size = '12';
    }
    const volts = sys.phases === 0 ? p.n('dcVolts') : sys.volts;
    const lengthFt = p.s('lengthUnit') === 'm' ? p.n('length') / M_PER_FT : p.n('length');
    const lengthM = lengthFt * M_PER_FT;
    const load = p.n('load');
    const pf = sys.phases === 0 ? 1 : p.n('pf');
    const sinPhi = Math.sqrt(Math.max(0, 1 - pf * pf));
    const react = p.s('raceway') === 'steel' ? 1 : 0;

    const dropFor = (s: string): number => {
      const r = (material === 'cu' ? R_CU[s] : R_AL[s]) / 1000; // ohm per ft
      const z = sys.phases === 0 ? r : r * pf + (XL[s]?.[react] ?? 0) / 1000 * sinPhi;
      const k = sys.phases === 3 ? Math.sqrt(3) : 2;
      return k * load * lengthFt * z;
    };
    const vd = dropFor(size);
    const pct = (vd / volts) * 100;
    const limit = 3;
    const upstream = p.n('upstream');
    const total = pct + upstream;

    const list = sizesFor(material);
    const allowed = Math.min(limit, 5 - upstream);
    const best = list.find((s) => (dropFor(s) / volts) * 100 <= allowed + 1e-9);

    const amp = (material === 'cu' ? T2_CU : T4_AL)[size];
    if (amp && load > amp[1]) warnings.push(`${load} A is above the ${amp[1]} A that ${awgLabel(size)} carries at 75 °C (Table ${material === 'cu' ? 2 : 4}). Size the conductor for ampacity first.`);
    if (pct > limit) warnings.push(`Voltage drop of ${fmt(pct, 2)}% is over the ${limit}% limit for a ${p.s('circuit')} (Rule 8-102).`);
    if (total > 5) warnings.push(`Total drop of ${fmt(total, 2)}% from the service is over the 5% limit (Rule 8-102).`);
    if (!best) warnings.push(`No size up to 500 kcmil keeps the drop within ${fmt(allowed, 1)}%. Use parallel conductors or a higher voltage.`);
    if (lengthFt <= 0) warnings.push('Enter a length to see the drop.');
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
      values: values({ voltage_drop_v: round(vd, 3), voltage_drop_pct: round(pct, 3), limit_pct: limit, total_pct: round(total, 3), passes, smallest_size: best ?? null, size: size, material, length_m: round(lengthM, 2), load_a: load }),
      takeoff,
      warnings,
      references: [
        'CEC 2024 Rule 8-102 (voltage drop limits: 3% in a feeder or branch circuit, 5% total)',
        'Conductor resistance at 75 °C: NEC Chapter 9 Table 8 values (basis of CEC Appendix D Table D3); reactance: NEC Chapter 9 Table 9',
        'Method: drop = 2 x I x L x Z (single-phase, DC) or 1.732 x I x L x Z (three-phase), with Z = R cos(phi) + X sin(phi)',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
