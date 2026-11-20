import { ceil, compact, core, fmt, free, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const BOARDS: Record<string, { label: string; codes: Record<string, string | undefined> }> = {
  half: { label: '1/2 in regular', codes: { '4x8': 'DRYWALL-1/2-4X8', '4x12': 'DRYWALL-1/2-4X12' } },
  fiveEighths: { label: '5/8 in Type X (fire-rated)', codes: { '4x8': 'DRYWALL-5/8X-4X8' } },
  mr: { label: '1/2 in moisture-resistant', codes: { '4x8': 'DRYWALL-1/2-MR-4X8' } },
};
const SHEET_SQFT: Record<string, number> = { '4x8': 32, '4x12': 48 };
/** Compound (17 L pails per 1,000 sq ft of board) and finishing labour by level of finish. */
const LEVELS: Record<string, { label: string; pails: number; labour: number }> = {
  '1': { label: 'Level 1: tape only (fire-taping)', pails: 0.8, labour: 0.006 },
  '2': { label: 'Level 2: tape and one coat (garage, behind tile)', pails: 1.3, labour: 0.014 },
  '3': { label: 'Level 3: tape and two coats (textured)', pails: 1.8, labour: 0.02 },
  '4': { label: 'Level 4: tape and three coats (flat paint)', pails: 2.3, labour: 0.028 },
  '5': { label: 'Level 5: skim coat (gloss or critical light)', pails: 3.4, labour: 0.04 },
};

const fields: CalcField[] = [
  numField('wallLength', 'Total wall length', 'ft', 120, 0, 5000, 1, 'Add up the lengths of all walls to be boarded.'),
  numField('wallHeight', 'Wall height', 'ft', 8, 6, 20, 0.5),
  numField('ceiling', 'Ceiling area', 'sq ft', 400, 0, 20000, 10),
  numField('openings', 'Doors and windows to subtract', 'sq ft', 60, 0, 5000, 5, 'Only subtract openings larger than about 16 sq ft each; small ones are not worth the cut waste.'),
  selField('board', 'Board', 'half', Object.entries(BOARDS).map(([k, v]) => [k, v.label] as [string, string])),
  selField('size', 'Sheet size', '4x8', [['4x8', '4 x 8 ft'], ['4x12', '4 x 12 ft']], '4 x 12 ft sheets mean fewer butt joints in long rooms.'),
  numField('layers', 'Layers', undefined, 1, 1, 3, 1),
  selField('level', 'Finish', '4', Object.entries(LEVELS).map(([k, v]) => [k, v.label] as [string, string])),
  numField('corners', 'Outside corners', undefined, 6, 0, 100, 1),
  numField('waste', 'Waste allowance', '%', 10, 0, 30, 1),
  boolField('labour', 'Include hanging and finishing labour', true, 'Turn off if your catalog prices already carry the labour.'),
];

export const drywall: Calculator = {
  id: 'drywall',
  name: 'Drywall calculator',
  trade: 'drywall',
  category: 'Building takeoff',
  summary: 'Sheets, joint compound, tape, screws and corner bead for walls and ceilings, with openings, layers and level of finish, plus labour.',
  fields,
  keywords: ['drywall', 'gypsum', 'sheetrock', 'mud', 'tape', 'screws', 'corner bead', 'board', 'finish level'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const wallArea = Math.max(0, p.n('wallLength') * p.n('wallHeight') - p.n('openings'));
    const area = wallArea + p.n('ceiling');
    const layers = Math.round(p.n('layers'));
    const board = BOARDS[p.s('board')];
    let size = p.s('size');
    if (!board.codes[size]) {
      if (size === '4x12') warnings.push(`${board.label} is only priced in 4 x 8 sheets in the catalog, so 4 x 8 was used.`);
      size = '4x8';
    }
    const boardArea = area * layers;
    const sheets = ceil((boardArea * (1 + p.n('waste') / 100)) / SHEET_SQFT[size]);
    const lv = LEVELS[p.s('level')];
    const pails = (area * lv.pails) / 1000;
    const tapeFt = area * 0.37;
    const rolls = tapeFt / 250;
    const screws = boardArea * 1.1;
    const boxes = screws / 1000;
    const beadPieces = (p.n('corners') * p.n('wallHeight')) / 8;
    if (p.b('labour') === false) warnings.push('Labour lines are off; make sure the catalog items carry hanging and finishing labour.');
    if (p.s('board') === 'fiveEighths') warnings.push('Where a fire-resistance rating is required, the assembly (board, layers, framing and fasteners) must match the listed design.');
    if (p.n('wallHeight') > 8 && p.s('size') === '4x8') warnings.push('Walls over 8 ft: use 4 x 12 sheets hung horizontally or add a second course of board.');
    if (area <= 0) warnings.push('Enter wall lengths or a ceiling area.');
    const hang = 0.012, labourHours = boardArea * hang + area * lv.labour;
    const takeoff = compact([
      core(board.codes[size] ?? '', sheets),
      core('MUD-17L', pails, { note: `${lv.label}` }),
      core('TAPE-PAPER', rolls),
      core('SCREWS-DRYWALL', boxes),
      core('CORNER-BEAD', beadPieces),
      p.b('labour') && area > 0 ? free('Hang drywall (labour only)', boardArea, 'sqft', { labourHoursPerUnit: hang, labourClass: 'drywaller', note: 'estimate of 0.012 hours per sq ft' }) : null,
      p.b('labour') && area > 0 ? free(`Tape and finish, ${lv.label} (labour only)`, area, 'sqft', { labourHoursPerUnit: lv.labour, labourClass: 'drywaller' }) : null,
    ]);
    return {
      summary: [
        { label: 'Sheets', value: `${sheets} of ${size.replace('x', ' x ')} ft ${board.label}`, emphasis: true },
        { label: 'Board area', value: `${fmt(boardArea, 0)} sq ft (${fmt(wallArea, 0)} walls, ${fmt(p.n('ceiling'), 0)} ceiling, ${layers} layer${layers > 1 ? 's' : ''})` },
        { label: 'Joint compound', value: `${ceil(pails)} pails of 17 L` },
        { label: 'Tape', value: `${ceil(rolls)} rolls of 250 ft` },
        { label: 'Screws', value: `${ceil(boxes)} box${ceil(boxes) > 1 ? 'es' : ''} of 1,000` },
        { label: 'Corner bead', value: `${ceil(beadPieces)} pieces of 8 ft` },
        { label: 'Labour estimate', value: `${fmt(labourHours, 0)} hours` },
      ],
      values: values({ board_area_sqft: round(boardArea, 1), wall_area_sqft: round(wallArea, 1), sheets, pails_17l: round(pails, 2), tape_rolls: round(rolls, 2), screw_boxes: round(boxes, 2), corner_bead_pieces: round(beadPieces, 2), labour_hours: round(labourHours, 1) }),
      takeoff,
      warnings,
      references: [
        'Area method: (wall length x height - openings + ceiling) x layers, plus waste, divided by the sheet area',
        'Joint compound by level of finish (GA-214 / ASTM C840 levels 1 to 5); about 1.1 screws per sq ft per layer; tape 0.37 ft per sq ft',
        'Labour per sq ft of 0.012 hang and 0.006 to 0.04 finish by level are estimating assumptions',
      ],
    };
  },
};
