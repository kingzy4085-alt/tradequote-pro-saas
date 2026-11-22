import { ceil, compact, core, fmt, free, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const fields: CalcField[] = [
  numField('length', 'Total wall length', 'ft', 40, 1, 2000, 1),
  numField('height', 'Wall height', 'ft', 8, 6, 12, 0.5, 'Over 8 ft the studs come in 10 ft lengths.'),
  selField('studSize', 'Stud size', '2x4', [['2x4', '2 x 4'], ['2x6', '2 x 6']]),
  selField('spacing', 'Stud spacing', '16', [['16', '16 in on centre'], ['24', '24 in on centre']]),
  numField('openings', 'Windows and doors', undefined, 4, 0, 100, 1),
  numField('openingWidth', 'Average opening width', 'ft', 3, 1, 12, 0.5),
  numField('corners', 'Corners and wall intersections', undefined, 4, 0, 100, 1, 'Each gets two extra studs for nailing.'),
  boolField('doublePlate', 'Double top plate', true),
  boolField('sheathing', 'Sheathe one face with OSB', true),
  numField('waste', 'Lumber waste', '%', 7, 0, 25, 1),
];

export const wallFraming: Calculator = {
  id: 'wall-framing',
  name: 'Wall framing calculator',
  trade: 'carpentry',
  category: 'Building takeoff',
  summary: 'Studs, plates, headers, OSB sheathing and nails for stud walls at 16 or 24 inch centres, with openings and a double top plate.',
  fields,
  keywords: ['framing', 'studs', 'plates', 'wall', 'lumber', 'osb', 'headers', 'sheathing', '2x4', '2x6'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const L = p.n('length'), H = p.n('height');
    const sp = Number(p.s('spacing'));
    const openings = Math.round(p.n('openings'));
    const w = 1 + p.n('waste') / 100;
    const base = ceil((L * 12) / sp) + 1;
    const extras = Math.round(p.n('corners')) * 2 + openings * 4; // two kings and two jacks per opening
    const studs = ceil((base + extras) * w);
    const plateLf = L * (p.b('doublePlate') ? 3 : 2);
    const size = p.s('studSize');
    const tall = H > 8;
    const studCode = size === '2x4' ? (tall ? 'LUMBER-2X4-10' : 'LUMBER-2X4-8') : tall ? undefined : 'LUMBER-2X6-8';
    const plateCode = size === '2x4' ? 'LUMBER-2X4-10' : 'LUMBER-2X6-12';
    const plateLen = size === '2x4' ? 10 : 12;
    const plates = ceil((plateLf * w) / plateLen);
    const headerLf = openings * 2 * (p.n('openingWidth') + 0.25);
    const headers = ceil((headerLf * w) / 12);
    const wallArea = L * H;
    const sheetArea = Math.max(0, wallArea - openings * p.n('openingWidth') * 4.5);
    const sheets = p.b('sheathing') ? ceil((sheetArea * 1.1) / 32) : 0;
    const nails = studs * 6 + plates * 6 + sheets * 70;
    const boxes = nails / 2000;
    if (size === '2x6' && tall) warnings.push('2 x 6 studs over 8 ft are not in the catalog; the line has no code and needs a price.');
    if (H > 10) warnings.push('Walls over 10 ft usually need engineered studs or balloon framing; check the structural drawings.');
    if (sp === 24 && size === '2x4') warnings.push('2 x 4 studs at 24 in are limited to certain loads and heights; check NBC 9.23.10 or the engineer.');
    warnings.push('Headers are sized as two 2 x 10 members for every opening. Check lintel tables or the drawings for each span (NBC 9.23.12).');
    warnings.push('Cripples, blocking, fire-stops and bracing are not counted.');
    const labourHrs = wallArea * 0.05 + sheetArea * (p.b('sheathing') ? 0.02 : 0);
    const takeoff = compact([
      studCode ? core(studCode, studs) : free(`SPF ${size.replace('x', ' x ')} stud, ${H > 8 ? 10 : 8} ft`, studs, 'ea'),
      core(plateCode, plates, { description: undefined, note: 'plates' }),
      core('LUMBER-2X10-12', headers, { note: 'header stock' }),
      core('OSB-7/16', sheets),
      core('NAILS-FRAMING', boxes),
    ]);
    return {
      summary: [
        { label: 'Studs', value: `${studs} of ${size.replace('x', ' x ')}, ${tall ? 10 : 8} ft`, emphasis: true },
        { label: 'Plates', value: `${plates} pieces of ${plateLen} ft (${fmt(plateLf, 0)} lin ft before waste)` },
        { label: 'Headers', value: `${headers} pieces of 2 x 10 x 12 ft` },
        { label: 'OSB sheathing', value: `${sheets} sheets of 4 x 8 ft` },
        { label: 'Framing nails', value: `${ceil(boxes)} box${ceil(boxes) > 1 ? 'es' : ''}` },
        { label: 'Wall area', value: `${fmt(wallArea, 0)} sq ft` },
        { label: 'Framing labour estimate', value: `${fmt(labourHrs, 0)} hours` },
      ],
      values: values({ studs, plates, plate_lin_ft: round(plateLf, 1), headers, osb_sheets: sheets, nail_boxes: round(boxes, 2), wall_area_sqft: round(wallArea, 1), stud_spacing_in: sp }),
      takeoff,
      warnings,
      references: [
        'Studs = length / spacing + 1, plus two per corner and four (two kings, two jacks) per opening, plus waste',
        'NBC 2020 Section 9.23 (wood-frame construction), 9.23.10 stud sizes and spacing, 9.23.12 lintels',
        'Nails: 6 per stud and plate piece, 70 per OSB sheet; labour 0.05 hours per sq ft of wall is an estimating assumption',
      ],
    };
  },
};
