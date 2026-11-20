import { AHJ_CHECK_LINE, awgLabel, ceil, compact, core, coreOrFree, fmt, free, numField, readFields, round, selField, values } from '../common';
import { CONDUIT_METRIC, CONDUIT_SIZES, EMT_AREA_MM2, EMT_CODE_SIZES, PVC_AREA_MM2, PVC_CODE_SIZES, SIZES, nylonAreaMm2, rw90AreaMm2, wireCode } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const sizeOptions = SIZES.map((s) => [s, awgLabel(s)] as [string, string]);
const fields: CalcField[] = [
  selField('wire', 'Conductor type', 'rw90', [['rw90', 'RW90 XLPE (600 V, unjacketed)'], ['nylon', 'T90 Nylon / TWN75']]),
  selField('conduit', 'Conduit type', 'emt', [['emt', 'EMT'], ['pvc', 'Rigid PVC']]),
  selField('size1', 'Conductor size A', '12', sizeOptions),
  numField('count1', 'Number of conductors, size A', undefined, 3, 0, 100, 1),
  selField('size2', 'Conductor size B (optional)', '12', sizeOptions, 'For a different bonding conductor or a second size.'),
  numField('count2', 'Number of conductors, size B', undefined, 1, 0, 100, 1, 'Bonding conductors count in conduit fill.'),
  numField('length', 'Run length', 'm', 15, 0.5, 1000, 0.5),
  numField('runs', 'Identical runs', undefined, 1, 1, 100, 1),
];

export const conduitFill: Calculator = {
  id: 'conduit-fill',
  name: 'Conduit fill calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Smallest EMT or rigid PVC trade size for a set of conductors under the Canadian Electrical Code 53/31/40 per cent fill limits, with conduit, couplings, connectors and wire for the takeoff.',
  fields,
  keywords: ['conduit', 'emt', 'pvc', 'fill', 'raceway', 'rule 12-910', 'trade size'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const area = (s: string) => (p.s('wire') === 'rw90' ? rw90AreaMm2(s) : nylonAreaMm2(s));
    const n1 = Math.round(p.n('count1'));
    const n2 = Math.round(p.n('count2'));
    const n = n1 + n2;
    const total = n1 * area(p.s('size1')) + n2 * area(p.s('size2'));
    const limit = n <= 1 ? 53 : n === 2 ? 31 : 40;
    const areas = p.s('conduit') === 'emt' ? EMT_AREA_MM2 : PVC_AREA_MM2;
    if (n === 0) warnings.push('Enter at least one conductor.');
    const fit = CONDUIT_SIZES.find((s) => total <= (areas[s] * limit) / 100 + 1e-9);
    if (!fit && n > 0) warnings.push('The conductors do not fit a 4 in conduit; split them between runs.');
    const fillPct = fit ? (total / areas[fit]) * 100 : 0;
    if (fit && fillPct > 35) warnings.push(`Fill is ${fmt(fillPct, 0)}% of the area. On long runs or with several bends consider the next size for pulling.`);
    if (p.s('wire') === 'rw90') warnings.push('RW90 XLPE areas are calculated from CEC Table 6A insulation thickness at 14, 12, 6 AWG and 500 kcmil; confirm 1 AWG to 4/0 against Table 6A.');
    warnings.push('Conduit areas follow NEC Table 4 / CEC Table 9 dimensions; 16 mm EMT uses the CEC figure. Manufacturers vary slightly.');
    const len = p.n('length');
    const runs = Math.round(p.n('runs'));
    const code = fit && (p.s('conduit') === 'emt' ? EMT_CODE_SIZES : PVC_CODE_SIZES).has(fit) ? `${p.s('conduit') === 'emt' ? 'EMT' : 'PVC'}-${fit}` : undefined;
    const couplings = Math.max(0, ceil(len / 3) - 1) * runs;
    const connectors = 2 * runs;
    const conduitName = p.s('conduit') === 'emt' ? 'EMT' : 'rigid PVC';
    const wire = (s: string, count: number) => (count > 0 ? coreOrFree(wireCode('cu', s), `RW90 copper ${awgLabel(s)}`, round(count * len * runs, 1), 'm', { note: p.s('wire') === 'nylon' ? 'T90 Nylon priced as RW90' : undefined }) : null);
    const takeoff = !fit ? [] : compact([
      coreOrFree(code, `${conduitName} conduit ${fit} in`, round(len * runs, 1), 'm'),
      p.s('conduit') === 'emt' && EMT_CODE_SIZES.has(fit) ? core(`EMT-COUP-${fit}`, couplings) : free(`${conduitName} coupling ${fit} in`, couplings, 'ea'),
      p.s('conduit') === 'emt' && EMT_CODE_SIZES.has(fit) ? core(`EMT-CONN-${fit}`, connectors) : free(`${conduitName} terminal adapter ${fit} in`, connectors, 'ea'),
      ...(p.s('size1') === p.s('size2') ? [wire(p.s('size1'), n1 + n2)] : [wire(p.s('size1'), n1), wire(p.s('size2'), n2)]),
    ]);
    return {
      summary: [
        { label: 'Minimum conduit', value: fit ? `${fit} in (${CONDUIT_METRIC[fit]} mm) ${conduitName}` : 'Larger than 4 in', emphasis: true },
        { label: 'Fill', value: fit ? `${fmt(fillPct, 1)}% of the area (limit ${limit}%)` : 'n/a' },
        { label: 'Conductor area', value: `${fmt(total, 1)} mm² for ${n} conductors` },
        { label: 'Allowed area in that size', value: fit ? `${fmt((areas[fit] * limit) / 100, 0)} mm²` : 'n/a' },
        { label: 'Couplings and connectors', value: `${couplings} couplings, ${connectors} connectors` },
      ],
      values: values({ trade_size: fit ?? null, metric_size: fit ? CONDUIT_METRIC[fit] : null, fill_pct: round(fillPct, 2), limit_pct: limit, conductor_area_mm2: round(total, 2), conductors: n, conduit_m: round(len * runs, 1), couplings, connectors }),
      takeoff,
      warnings,
      references: [
        'CEC 2024 Rule 12-910 and Table 8: 53% for one conductor, 31% for two, 40% for three or more',
        'Conductor areas: CEC Table 6A (RW90 XLPE) and Table 6K (T90 Nylon); conduit areas: CEC Table 9 series / NEC Chapter 9 Table 4',
        'Couplings every 3 m (10 ft) and two connectors per run are estimating assumptions',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
