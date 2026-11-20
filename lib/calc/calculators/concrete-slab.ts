import { M_PER_FT, compact, core, fmt, free, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const M3_PER_FT3 = 0.0283168;
const fields: CalcField[] = [
  numField('length', 'Length', 'ft', 20, 0, 1000, 0.5),
  numField('width', 'Width', 'ft', 20, 0, 1000, 0.5),
  numField('thickness', 'Thickness', 'in', 4, 2, 24, 0.5, 'Garage and basement floors are usually 4 in; driveways 4 to 6 in.'),
  numField('waste', 'Waste allowance', '%', 8, 0, 30, 1),
  selField('rebar', '10M rebar grid spacing', '0', [['0', 'No rebar'], ['200', '200 mm each way'], ['300', '300 mm each way'], ['400', '400 mm each way'], ['600', '600 mm each way']], 'A grid of 10M bars in both directions at the chosen spacing.'),
  numField('gravel', 'Gravel base depth', 'in', 4, 0, 24, 0.5, '0 for none. 3/4 in crushed stone, compacted.'),
  boolField('vapour', 'Vapour barrier under the slab', true, '6 mil polyethylene with 10% for laps.'),
  boolField('labour', 'Include placing and finishing labour', true, 'Turn off if your catalog concrete price already carries the labour.'),
];

export const concreteSlab: Calculator = {
  id: 'concrete-slab',
  name: 'Concrete slab calculator',
  trade: 'concrete',
  category: 'Building takeoff',
  summary: 'Cubic metres and yards of ready-mix for a slab, with rebar grid, gravel base, vapour barrier and finishing labour.',
  fields,
  keywords: ['concrete', 'slab', 'ready-mix', 'cubic yards', 'cubic metres', 'rebar', 'gravel', 'garage floor'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const length = p.n('length'), width = p.n('width'), thickness = p.n('thickness'), waste = p.n('waste');
    const cubicFeet = length * width * (thickness / 12);
    const m3 = cubicFeet * M3_PER_FT3 * (1 + waste / 100);
    const ordered = Math.ceil(m3 * 4 - 1e-9) / 4; // plants batch in quarter cubic metres
    const area = length * width;
    const spacing = Number(p.s('rebar'));
    let rebarM = 0;
    if (spacing > 0 && area > 0) {
      const L = length * M_PER_FT, W = width * M_PER_FT, s = spacing / 1000, cover = 0.075;
      const barsAlong = Math.floor(W / s) + 1; // bars running the length, spaced across the width
      const barsAcross = Math.floor(L / s) + 1;
      rebarM = (barsAlong * Math.max(L - 2 * cover, 0) + barsAcross * Math.max(W - 2 * cover, 0)) * 1.1; // 10% for laps
    }
    const gravelM3 = area * M_PER_FT * M_PER_FT * (p.n('gravel') * 0.0254) * 1.1;
    if (thickness < 4 && area > 0) warnings.push('Slabs on grade thinner than 4 in crack easily; 4 in is the usual minimum.');
    if (ordered > 0 && ordered < 3) warnings.push('Orders under about 3 m³ often carry a short-load charge; ask the plant, or consider bagged mix.');
    if (spacing === 0 && area > 0) warnings.push('No reinforcing selected. Wire mesh or fibre may still be specified; check the drawings.');
    const sqft = area;
    const takeoff = compact([
      ordered > 0 ? core('CONC-25MPA', ordered, { description: 'Ready-mix concrete 25 MPa, slab' }) : null,
      core('REBAR-10M', rebarM, { note: `${spacing} mm grid, 75 mm cover, 10% for laps` }),
      core('GRAVEL-BASE', gravelM3, { note: '10% for compaction' }),
      p.b('vapour') ? core('POLY-6MIL', sqft * 1.1) : null,
      p.b('labour') && area > 0 ? free('Place, screed and finish slab (labour only)', sqft, 'sqft', { labourHoursPerUnit: 0.025, labourClass: 'concrete_finisher', note: 'estimate of 0.025 labour-hours per sq ft for placing and finishing' }) : null,
    ]);
    return {
      summary: [
        { label: 'Concrete to order', value: `${ordered} m³ (${round(ordered * 1.30795, 2)} yd³)`, emphasis: true },
        { label: 'Slab area', value: `${fmt(area, 1)} sq ft` },
        { label: 'Volume before waste', value: `${round(cubicFeet * M3_PER_FT3, 2)} m³` },
        { label: 'Rebar', value: spacing > 0 ? `${fmt(rebarM, 0)} m of 10M (${fmt(rebarM * 0.785, 0)} kg)` : 'none' },
        { label: 'Gravel base', value: `${fmt(gravelM3, 2)} m³` },
        { label: 'Vapour barrier', value: p.b('vapour') ? `${fmt(sqft * 1.1, 0)} sq ft` : 'none' },
      ],
      values: values({ area_sqft: round(area, 2), volume_m3: round(m3, 3), order_m3: ordered, rebar_m: round(rebarM, 1), rebar_kg: round(rebarM * 0.785, 1), gravel_m3: round(gravelM3, 2) }),
      takeoff,
      warnings,
      references: [
        'Volume = length x width x thickness, plus waste; ordered in 0.25 m³ steps',
        'Rebar: 10M bars both ways at the chosen spacing, 75 mm cover, 10% laps; 10M weighs 0.785 kg/m',
        'Gravel base compacted allowance 10%; labour of 0.025 hours per sq ft is an estimating assumption',
      ],
    };
  },
};
