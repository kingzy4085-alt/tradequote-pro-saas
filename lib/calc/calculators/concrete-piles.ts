import { compact, core, fmt, free, numField, readFields, round, selField, values, ceil } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const BAG_YIELD_M3 = 0.014; // a 30 kg bag of mix yields about 0.014 m3 (0.5 cu ft)
const fields: CalcField[] = [
  numField('count', 'Number of piles', undefined, 6, 1, 500, 1),
  selField('diameter', 'Tube diameter', '300', [['200', '200 mm (8 in)'], ['250', '250 mm (10 in)'], ['300', '300 mm (12 in)'], ['350', '350 mm (14 in)'], ['400', '400 mm (16 in)'], ['450', '450 mm (18 in)'], ['600', '600 mm (24 in)']]),
  numField('depth', 'Depth below grade', 'm', 1.8, 0.5, 12, 0.1, 'Must reach below frost depth and to the bearing layer your engineer or permit requires.'),
  numField('above', 'Height above grade', 'm', 0.2, 0, 2, 0.05),
  numField('waste', 'Waste allowance', '%', 10, 0, 30, 1, 'Holes are rarely exact; 10% is typical.'),
  selField('supply', 'Concrete supply', 'readymix', [['readymix', 'Ready-mix truck'], ['bags', '30 kg bags mixed on site']]),
];

export const concretePiles: Calculator = {
  id: 'concrete-piles',
  name: 'Concrete pile and pier calculator',
  trade: 'concrete',
  category: 'Building takeoff',
  summary: 'Concrete volume for round form-tube piles for decks and footings, as ready-mix cubic metres or 30 kg bags, with the tubes needed.',
  fields,
  keywords: ['piles', 'piers', 'sonotube', 'form tube', 'deck footing', 'bags', 'concrete', 'post'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const d = Number(p.s('diameter')) / 1000;
    const count = Math.round(p.n('count'));
    const lenEach = p.n('depth') + p.n('above');
    const each = (Math.PI / 4) * d * d * lenEach;
    const total = each * count * (1 + p.n('waste') / 100);
    const bags = ceil(total / BAG_YIELD_M3);
    const ordered = Math.ceil(total * 4 - 1e-9) / 4;
    const bagMode = p.s('supply') === 'bags';
    if (!bagMode && ordered < 1) warnings.push('Under about 1 m³ a truck is rarely worth it; bags may cost less.');
    if (bagMode && bags > 120) warnings.push(`${bags} bags is a lot of hand mixing (about ${fmt((bags * 30) / 1000, 1)} tonnes). Ready-mix may be better.`);
    if (!bagMode && ordered > 0 && ordered < 3) warnings.push('Small ready-mix orders usually carry a short-load charge.');
    warnings.push('Check pile depth against local frost depth and the permit drawings; this calculator does not size piles.');
    const takeoff = compact([
      bagMode ? core('CONC-BAG-30KG', bags, { note: `${BAG_YIELD_M3} m³ per bag` }) : core('CONC-25MPA', ordered, { description: 'Ready-mix concrete 25 MPa, piles' }),
      free(`Form tube ${Number(p.s('diameter'))} mm x ${round(lenEach, 1)} m`, count, 'ea', { materialUnitCost: 0 }),
    ]);
    return {
      summary: [
        { label: bagMode ? '30 kg bags' : 'Concrete to order', value: bagMode ? `${bags} bags (${fmt(total, 2)} m³)` : `${ordered} m³ (${round(ordered * 1.30795, 2)} yd³)`, emphasis: true },
        { label: 'Volume per pile', value: `${fmt(each, 3)} m³` },
        { label: 'Total with waste', value: `${fmt(total, 2)} m³` },
        { label: 'Bags if mixed on site', value: `${bags}` },
        { label: 'Form tubes', value: `${count} x ${fmt(lenEach, 1)} m` },
      ],
      values: values({ volume_each_m3: round(each, 4), total_m3: round(total, 3), order_m3: ordered, bags, tubes: count, tube_length_m: round(lenEach, 2) }),
      takeoff,
      warnings,
      references: [
        'Volume = pi/4 x diameter² x length per pile, plus waste; ready-mix in 0.25 m³ steps',
        'A 30 kg bag of mix yields about 0.014 m³ (manufacturer data)',
      ],
    };
  },
};
