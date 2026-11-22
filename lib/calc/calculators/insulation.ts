import { ceil, compact, core, fmt, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

/** Batt R-values in the catalog and the deepest cavity they fit. */
const BATTS: { r: number; code: string; fits: string[] }[] = [
  { r: 12, code: 'INSUL-BATT-R12', fits: ['wall-2x4', 'wall-2x6', 'attic'] },
  { r: 14, code: 'INSUL-BATT-R14', fits: ['wall-2x4', 'wall-2x6', 'attic'] },
  { r: 20, code: 'INSUL-BATT-R20', fits: ['wall-2x6', 'attic'] },
  { r: 22, code: 'INSUL-BATT-R22', fits: ['wall-2x6', 'attic'] },
  { r: 24, code: 'INSUL-BATT-R24', fits: ['wall-2x6', 'attic'] },
  { r: 31, code: 'INSUL-BATT-R31', fits: ['attic'] },
];

const fields: CalcField[] = [
  numField('area', 'Area to insulate', 'sq ft', 1000, 10, 50000, 10),
  selField('assembly', 'Assembly', 'wall-2x6', [['wall-2x4', '2 x 4 wall (3-1/2 in cavity)'], ['wall-2x6', '2 x 6 wall (5-1/2 in cavity)'], ['attic', 'Attic or ceiling']]),
  numField('target', 'Target R-value', 'R', 24, 8, 80, 1, 'Imperial R-value; RSI = R / 5.678. Check NBC 9.36 or your province for the minimum in your climate zone.'),
  selField('material', 'Insulation', 'batt', [['batt', 'Batts'], ['blown', 'Blown-in (attic only)']]),
  boolField('vapour', 'Vapour barrier (6 mil polyethylene)', true, 'On the warm side of the insulation, with 10% for laps.'),
];

export const insulation: Calculator = {
  id: 'insulation',
  name: 'Insulation calculator',
  trade: 'insulation',
  category: 'Building takeoff',
  summary: 'Batts or blown insulation for a target R-value, with the continuous insulation needed when the cavity falls short, and the vapour barrier.',
  fields,
  keywords: ['insulation', 'batts', 'blown', 'r-value', 'rsi', 'attic', 'vapour barrier', 'wall', 'xps'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const area = p.n('area'), target = p.n('target');
    const assembly = p.s('assembly');
    let material = p.s('material');
    if (material === 'blown' && assembly !== 'attic') {
      warnings.push('Blown-in insulation is priced for attics only here; batts were used for the wall.');
      material = 'batt';
    }
    let achieved = 0;
    const lines: (ReturnType<typeof core>)[] = [];
    let desc = '';
    let rigidLayers = 0;
    if (material === 'blown') {
      achieved = target;
      desc = `blown to R-${target} (priced as R-50 per sq ft x ${fmt(target / 50, 2)})`;
      lines.push(core('INSUL-BLOWN-R50', (area * target) / 50, { note: `R-${target} is ${fmt(target / 50, 2)} of the R-50 depth; quantity is area x ${fmt(target / 50, 2)}` }));
      if (target < 20) warnings.push('Blown-in insulation below R-20 leaves little thickness to hold its depth evenly.');
    } else {
      const fitting = BATTS.filter((b) => b.fits.includes(assembly));
      const maxR = fitting[fitting.length - 1].r;
      const pick = fitting.find((b) => b.r >= target) ?? fitting[fitting.length - 1];
      let layers = 1;
      let batt = pick;
      if (target > maxR && assembly === 'attic') {
        layers = ceil(target / maxR);
        batt = BATTS[BATTS.length - 1];
        warnings.push(`Reaching R-${target} with batts takes ${layers} layers of R-${batt.r}; lay the second layer across the first.`);
      }
      const cavityR = batt.r * layers;
      achieved = cavityR;
      desc = `${layers > 1 ? layers + ' layers of ' : ''}R-${batt.r} batts`;
      lines.push(core(batt.code, area * layers, { note: assembly === 'attic' ? 'attic' : 'cavity' }));
      if (assembly !== 'attic' && cavityR < target) {
        const gap = target - cavityR;
        rigidLayers = ceil(gap / 10);
        achieved = cavityR + rigidLayers * 10;
        warnings.push(`The cavity gives R-${cavityR}. The remaining R-${gap} needs continuous exterior insulation; ${rigidLayers} layer${rigidLayers > 1 ? 's' : ''} of 2 in XPS (about R-10 each) was added.`);
        lines.push(core('XPS-2IN', ceil((area * 1.1 * rigidLayers) / 32)));
      } else if (pick.r > target) warnings.push(`The nearest batt, R-${pick.r}, is above the R-${target} target.`);
    }
    if (assembly === 'wall-2x4' && target > 14 && material === 'batt') warnings.push('A 2 x 4 wall holds at most R-14 batts; thermal bridging through the studs lowers the effective value.');
    const poly = p.b('vapour') ? area * 1.1 : 0;
    lines.push(core('POLY-6MIL', poly));
    const final = compact(lines);
    return {
      summary: [
        { label: 'Insulation', value: desc, emphasis: true },
        { label: 'Achieved', value: `R-${fmt(achieved, 0)} (RSI ${fmt(achieved / 5.678, 2)}) against R-${target}` },
        { label: 'Area', value: `${fmt(area, 0)} sq ft` },
        { label: 'Continuous insulation added', value: rigidLayers > 0 ? `${rigidLayers} layer${rigidLayers > 1 ? 's' : ''} of 2 in XPS` : 'none' },
        { label: 'Vapour barrier', value: poly > 0 ? `${fmt(poly, 0)} sq ft` : 'none' },
      ],
      values: values({ achieved_r: round(achieved, 1), achieved_rsi: round(achieved / 5.678, 2), target_r: target, area_sqft: round(area, 1), xps_layers: rigidLayers, poly_sqft: round(poly, 1) }),
      takeoff: final,
      warnings,
      references: [
        'NBC 2020 Section 9.36 (energy efficiency: minimum insulation by climate zone) and 9.25 (vapour barrier on the warm side)',
        'RSI = R / 5.678; batt R-values per the catalog (R-12 to R-31); extruded polystyrene about R-5 per inch',
        'Blown attic insulation priced per sq ft at R-50; other depths are scaled by R-value',
      ],
    };
  },
};
