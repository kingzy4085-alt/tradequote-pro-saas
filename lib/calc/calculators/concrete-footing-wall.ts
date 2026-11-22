import { ceil, compact, core, fmt, free, numField, readFields, round, selField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const fields: CalcField[] = [
  numField('perimeter', 'Total length of footing and wall', 'm', 40, 1, 1000, 0.5, 'Centre-line length of the wall.'),
  numField('footW', 'Footing width', 'mm', 600, 250, 2000, 25),
  numField('footD', 'Footing thickness', 'mm', 250, 150, 1000, 25),
  numField('wallT', 'Wall thickness', 'mm', 200, 150, 500, 25, '200 mm (8 in) is common for a basement wall.'),
  numField('wallH', 'Wall height', 'm', 2.4, 0.5, 6, 0.05),
  selField('strength', 'Concrete strength', '25', [['25', '25 MPa'], ['32', '32 MPa']], 'Foundation walls with exposure to freezing and de-icing salts are often specified at 32 MPa.'),
  numField('waste', 'Waste allowance', '%', 5, 0, 20, 1),
  numField('footBars', 'Continuous 15M bars in the footing', undefined, 2, 0, 8, 1),
  numField('vSpacing', 'Wall vertical 10M bar spacing', 'mm', 600, 200, 1200, 50, '0 is not allowed; use a large spacing for lightly reinforced walls.'),
  numField('hRows', 'Wall horizontal 10M rows', undefined, 3, 0, 12, 1),
];

export const concreteFootingWall: Calculator = {
  id: 'concrete-footing-wall',
  name: 'Footing and foundation wall calculator',
  trade: 'concrete',
  category: 'Building takeoff',
  summary: 'Concrete in cubic metres for a strip footing and foundation wall, with rebar and the formwork area.',
  fields,
  keywords: ['footing', 'foundation', 'wall', 'strip footing', 'forms', 'rebar', 'basement', 'concrete'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const L = p.n('perimeter');
    const footM3 = L * (p.n('footW') / 1000) * (p.n('footD') / 1000);
    const wallM3 = L * (p.n('wallT') / 1000) * p.n('wallH');
    const total = (footM3 + wallM3) * (1 + p.n('waste') / 100);
    const ordered = Math.ceil(total * 4 - 1e-9) / 4;
    const footForm = 2 * L * (p.n('footD') / 1000);
    const wallForm = 2 * L * p.n('wallH');
    const formArea = footForm + wallForm;
    const footRebar = p.n('footBars') * L * 1.1;
    const vert = L / (p.n('vSpacing') / 1000) + 1;
    const vertM = vert * (p.n('wallH') + 0.4); // dowel into footing and lap at the top
    const horizM = p.n('hRows') * L * 1.1;
    const rebar10 = (vertM + horizM) * 1.05;
    if (p.n('wallT') < 200) warnings.push('Walls under 200 mm are thin for a basement; check the engineer or the NBC Part 9 foundation tables.');
    if (p.n('footW') < p.n('wallT') * 2) warnings.push('The footing is narrower than twice the wall thickness; check the bearing width required for the soil and load (NBC 9.15.3).');
    warnings.push('Footings must sit below frost depth on undisturbed soil; the depth is not part of this takeoff.');
    const code = p.s('strength') === '32' ? 'CONC-32MPA' : 'CONC-25MPA';
    const takeoff = compact([
      core(code, ordered, { description: `Ready-mix concrete ${p.s('strength')} MPa, footing and foundation wall` }),
      core('REBAR-15M', footRebar, { note: '10% for laps' }),
      core('REBAR-10M', rebar10, { note: 'vertical bars with dowels plus horizontal rows' }),
      free('Formwork, footing and wall, both faces', formArea, 'sqm', { labourHoursPerUnit: 0.6, labourClass: 'carpenter', note: 'supply and strip; set material cost for your forming system' }),
    ]);
    return {
      summary: [
        { label: 'Concrete to order', value: `${ordered} m³ (${round(ordered * 1.30795, 2)} yd³)`, emphasis: true },
        { label: 'Footing', value: `${fmt(footM3, 2)} m³` },
        { label: 'Wall', value: `${fmt(wallM3, 2)} m³` },
        { label: 'Form area', value: `${fmt(formArea, 0)} m² (footing ${fmt(footForm, 0)}, wall ${fmt(wallForm, 0)})` },
        { label: 'Rebar', value: `${fmt(footRebar, 0)} m 15M, ${fmt(rebar10, 0)} m 10M (${fmt(footRebar * 1.57 + rebar10 * 0.785, 0)} kg)` },
      ],
      values: values({ footing_m3: round(footM3, 3), wall_m3: round(wallM3, 3), total_m3: round(total, 3), order_m3: ordered, form_area_m2: round(formArea, 1), rebar_15m_m: round(footRebar, 1), rebar_10m_m: round(rebar10, 1), vertical_bars: ceil(vert) }),
      takeoff,
      warnings,
      references: [
        'Volume = length x width x thickness for the footing and the wall, plus waste; ordered in 0.25 m³ steps',
        'Form area = both faces of the wall plus both sides of the footing; rebar masses 10M 0.785 kg/m, 15M 1.57 kg/m',
        'Applicable foundation requirements in the building code adopted in your jurisdiction; confirm with the project drawings and authority having jurisdiction',
      ],
    };
  },
};
