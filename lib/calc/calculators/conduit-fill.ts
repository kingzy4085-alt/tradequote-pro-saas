import { AHJ_CHECK_LINE, awgLabel, ceil, compact, core, coreOrFree, fmt, free, numField, readFields, round, selField, values } from '../common';
import { CONDUIT_METRIC, CONDUIT_SIZES, EMT_CODE_SIZES, PVC_CODE_SIZES, SIZES, fillLimitPct, wireCode } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const fields: CalcField[] = [
  numField('conductorOd', 'Conductor outside diameter', 'mm', 0, 0, 60, 0.05, 'Overall diameter of one insulated conductor, from the cable or wire datasheet. Not supplied by this calculator. 0 means not entered yet.'),
  numField('conduitId', 'Conduit internal diameter', 'mm', 0, 0, 200, 0.1, 'Internal diameter of the conduit you will use, from the conduit spec sheet or the manufacturer. 0 means not entered yet.'),
  numField('count', 'Number of conductors', undefined, 4, 0, 200, 1, 'Count every conductor that goes in the conduit, bonding conductors included. This sets the fill limit: 53% for one, 31% for two, 40% for three or more.'),
  selField('conduit', 'Conduit type for pricing', 'emt', [['emt', 'EMT'], ['pvc', 'Rigid PVC']]),
  selField('tradeSize', 'Trade size for pricing', '1/2', CONDUIT_SIZES.map((s) => [s, `${s} in (${CONDUIT_METRIC[s]} mm)`] as [string, string]), 'The size you will buy. It is not checked against the diameter above, so enter the internal diameter of this size.'),
  selField('wireSize', 'Conductor size for pricing', '12', SIZES.map((s) => [s, awgLabel(s)] as [string, string]), 'Copper wire for the takeoff. It does not change the fill, which comes from the outside diameter above.'),
  numField('length', 'Run length', 'm', 15, 0.5, 1000, 0.5),
  numField('runs', 'Identical runs', undefined, 1, 1, 100, 1),
];

export const conduitFill: Calculator = {
  id: 'conduit-fill',
  name: 'Conduit fill calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Conduit fill from the conductor and conduit diameters you enter, checked against the 53/31/40 per cent fill limits, with conduit, couplings, connectors and wire for the takeoff.',
  fields,
  keywords: ['conduit', 'emt', 'pvc', 'fill', 'raceway', 'trade size', 'conductor diameter'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const od = p.n('conductorOd');
    const id = p.n('conduitId');
    const n = Math.round(p.n('count'));
    const oneArea = (Math.PI / 4) * od * od;
    const conduitArea = (Math.PI / 4) * id * id;
    const total = n * oneArea;
    const limit = fillLimitPct(n);
    const allowed = (conduitArea * limit) / 100;
    const fillPct = conduitArea > 0 ? (total / conduitArea) * 100 : 0;
    const entered = od > 0 && id > 0;
    const pass = entered && n > 0 && total <= allowed + 1e-9;
    // Smallest internal diameter that holds n conductors: n x area = limit% x conduit area, so ID = OD x sqrt(n / limit).
    const minId = n > 0 ? od * Math.sqrt(n / (limit / 100)) : 0;
    // Most conductors of this size the conduit takes, each count judged against its own limit.
    let maxCount = 0;
    for (let k = 1; k <= 200; k++) if (k * oneArea <= (conduitArea * fillLimitPct(k)) / 100 + 1e-9) maxCount = k;
    if (n === 0) warnings.push('Enter at least one conductor.');
    if (!entered) warnings.push(`No pass or fail is shown yet. Enter the ${od <= 0 ? 'conductor outside diameter' : ''}${od <= 0 && id <= 0 ? ' and the ' : ''}${id <= 0 ? 'conduit internal diameter' : ''} from the datasheets.`);
    if (entered && n > 0 && !pass) warnings.push(`Fill is ${fmt(fillPct, 1)}% of the conduit area, over the ${limit}% limit. You need an internal diameter of at least ${fmt(minId, 1)} mm, or fewer conductors.`);
    if (entered && pass && fillPct > 35) warnings.push(`Fill is ${fmt(fillPct, 0)}% of the area. On long runs or with several bends consider the next size for pulling.`);
    if (entered && n > 0) warnings.push('The result depends on the diameters you typed. Use the datasheet outside diameter of the actual conductor or cable, and the actual conduit internal diameter.');
    const size = p.s('tradeSize');
    const len = p.n('length');
    const runs = Math.round(p.n('runs'));
    const emt = p.s('conduit') === 'emt';
    const code = (emt ? EMT_CODE_SIZES : PVC_CODE_SIZES).has(size) ? `${emt ? 'EMT' : 'PVC'}-${size}` : undefined;
    const couplings = Math.max(0, ceil(len / 3) - 1) * runs;
    const connectors = 2 * runs;
    const conduitName = emt ? 'EMT' : 'rigid PVC';
    const wireS = p.s('wireSize');
    const takeoff = compact([
      coreOrFree(code, `${conduitName} conduit ${size} in`, round(len * runs, 1), 'm'),
      emt && EMT_CODE_SIZES.has(size) ? core(`EMT-COUP-${size}`, couplings) : free(`${conduitName} coupling ${size} in`, couplings, 'ea'),
      emt && EMT_CODE_SIZES.has(size) ? core(`EMT-CONN-${size}`, connectors) : free(`${conduitName} terminal adapter ${size} in`, connectors, 'ea'),
      n > 0 ? coreOrFree(wireCode('cu', wireS), `RW90 copper ${awgLabel(wireS)}`, round(n * len * runs, 1), 'm') : null,
    ]);
    return {
      summary: [
        { label: 'Result', value: n === 0 ? 'No conductors' : !entered ? 'Enter the diameters' : pass ? 'Pass' : 'Fail', emphasis: true },
        { label: 'Fill', value: entered ? `${fmt(fillPct, 1)}% of the area (limit ${limit}%)` : `not worked out (limit ${limit}%)` },
        { label: 'Conductor area', value: od > 0 ? `${fmt(total, 1)} mm² for ${n} conductors` : 'n/a' },
        { label: 'Allowed area in this conduit', value: id > 0 ? `${fmt(allowed, 0)} mm²` : 'n/a' },
        { label: 'Smallest internal diameter for these conductors', value: n > 0 && od > 0 ? `${fmt(minId, 1)} mm` : 'n/a' },
        { label: 'Most conductors of this size that fit', value: entered ? `${maxCount}` : 'n/a' },
        { label: 'Couplings and connectors', value: `${couplings} couplings, ${connectors} connectors` },
      ],
      values: values({ passes: entered && n > 0 ? pass : null, fill_pct: entered ? round(fillPct, 2) : null, limit_pct: limit, conductor_area_mm2: od > 0 ? round(total, 2) : null, conduit_area_mm2: id > 0 ? round(conduitArea, 1) : null, allowed_area_mm2: id > 0 ? round(allowed, 1) : null, min_conduit_id_mm: od > 0 && n > 0 ? round(minId, 2) : null, max_conductors: entered ? maxCount : null, trade_size: size, conductors: n, conduit_m: round(len * runs, 1), couplings, connectors }),
      takeoff,
      warnings,
      references: [
        'Fill limits as a share of the conduit cross-section: 53% for one conductor, 31% for two, 40% for three or more (summary of the CEC conduit fill rule)',
        'Areas are computed from the diameters you enter: area = pi/4 x diameter squared. No conductor or conduit dimension table is built in',
        'Couplings every 3 m (10 ft) and two connectors per run are estimating assumptions',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
