import { compact, core, fmt, free, numField, readFields, round, selField, stdAtLeast, values } from '../common';
import { STD_OCPD } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

/** Standard kVA ratings of dry-type distribution transformers. */
export const KVA_3PH = [3, 6, 9, 15, 30, 45, 75, 112.5, 150, 225, 300, 500, 750, 1000];
export const KVA_1PH = [1, 1.5, 2, 3, 5, 7.5, 10, 15, 25, 37.5, 50, 75, 100, 167, 250];

const fields: CalcField[] = [
  selField('mode', 'Load entered as', 'kva', [['kva', 'kVA'], ['amps', 'Secondary amperes']]),
  numField('load', 'Load', 'kVA', 30, 0.1, 5000, 0.5, 'Used when the load is entered as kVA.'),
  numField('loadAmps', 'Load current', 'A', 100, 0.1, 10000, 1, 'Used when the load is entered as secondary amperes.'),
  selField('phase', 'Phases', '3', [['3', 'Three-phase'], ['1', 'Single-phase']]),
  selField('primary', 'Primary voltage', '600', [['600', '600 V'], ['480', '480 V'], ['347', '347 V'], ['240', '240 V'], ['208', '208 V']]),
  selField('secondary', 'Secondary voltage', '208', [['208', '208Y/120 V'], ['240', '240 V'], ['120', '120 V'], ['480', '480 V']]),
  numField('margin', 'Spare capacity', '%', 20, 0, 100, 5, 'Growth allowance added to the load before choosing a standard size.'),
];

export const transformerSizing: Calculator = {
  id: 'transformer-sizing',
  name: 'Transformer sizing calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Standard transformer kVA for a load, primary and secondary full-load currents, and overcurrent protection guidance under CEC Section 26.',
  fields,
  keywords: ['transformer', 'kva', 'dry-type', 'primary', 'secondary', 'rule 26-254', '600-120/208'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const three = p.s('phase') === '3';
    const vp = Number(p.s('primary'));
    const vs = Number(p.s('secondary'));
    const k = three ? Math.sqrt(3) : 1;
    const loadKva = p.s('mode') === 'amps' ? (k * vs * p.n('loadAmps')) / 1000 : p.n('load');
    const required = loadKva * (1 + p.n('margin') / 100);
    const list = three ? KVA_3PH : KVA_1PH;
    const std = stdAtLeast(list, required);
    if (!std) warnings.push('The load is above the largest standard size in the list; use several units or a pad-mount transformer.');
    const kva = std ?? list[list.length - 1];
    const ip = (kva * 1000) / (k * vp);
    const is = (kva * 1000) / (k * vs);
    if (vp === vs) warnings.push('Primary and secondary voltages are the same; an isolation transformer is rated the same way.');
    const primaryMax = ip * 1.25;
    const primaryStd = stdAtLeast(STD_OCPD, primaryMax);
    const secondaryMax = is * 1.25;
    const secondaryStd = stdAtLeast(STD_OCPD, secondaryMax);
    warnings.push(`Primary-only protection: not above 125% of the primary current (${fmt(primaryMax, 1)} A), with the next standard size permitted where that does not match (Rule 26-254, Table 13).`);
    warnings.push(`With secondary protection at up to 125% of the secondary current (${fmt(secondaryMax, 1)} A, Rule 26-256) the primary protection may be set higher. Read the rule for the exact limits and the 9 A and 2 A steps.`);
    if (three && (kva === 15 || kva === 45)) {
      if (!(three && vp === 600 && vs === 208)) warnings.push('The catalog transformers are 600-120/208 V three-phase. Check the price for your voltages.');
    }
    const takeoff = compact([
      three && kva === 15 ? core('XFMR-15KVA', 1) : three && kva === 45 ? core('XFMR-45KVA', 1) : free(`Dry-type transformer ${kva} kVA, ${three ? 'three' : 'single'}-phase, ${vp}-${vs} V`, 1, 'ea'),
    ]);
    return {
      summary: [
        { label: 'Standard transformer', value: `${kva} kVA ${three ? 'three-phase' : 'single-phase'}`, emphasis: true },
        { label: 'Load including spare capacity', value: `${fmt(required, 1)} kVA (load ${fmt(loadKva, 1)} kVA)` },
        { label: 'Primary full-load current', value: `${fmt(ip, 1)} A at ${vp} V` },
        { label: 'Secondary full-load current', value: `${fmt(is, 1)} A at ${vs} V` },
        { label: 'Primary protection, 125%', value: `${fmt(primaryMax, 1)} A calculated; ${primaryStd ?? 'n/a'} A standard` },
        { label: 'Secondary protection, 125%', value: `${fmt(secondaryMax, 1)} A calculated; ${secondaryStd ?? 'n/a'} A standard` },
      ],
      values: values({ kva, required_kva: round(required, 2), load_kva: round(loadKva, 2), primary_a: round(ip, 2), secondary_a: round(is, 2), primary_ocpd_a: primaryStd, secondary_ocpd_a: secondaryStd, phases: three ? 3 : 1 }),
      takeoff,
      warnings,
      references: [
        'kVA = V x I (single-phase) or 1.732 x V x I (three-phase) / 1000; standard distribution kVA ratings',
        'CEC 2024 Rules 26-250 to 26-256 (transformer overcurrent protection), Rule 14-104 and Table 13 (standard ratings)',
      ],
    };
  },
};
