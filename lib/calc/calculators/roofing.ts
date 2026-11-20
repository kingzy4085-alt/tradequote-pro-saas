import { ceil, compact, core, fmt, free, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const PITCHES = ['3', '4', '5', '6', '7', '8', '9', '10', '12'];
export const pitchFactor = (rise: number) => Math.sqrt(1 + (rise / 12) ** 2);

const fields: CalcField[] = [
  selField('mode', 'Area entered as', 'footprint', [['footprint', 'Building footprint under the roof'], ['roof', 'Actual roof surface area']]),
  numField('area', 'Area', 'sq ft', 1500, 50, 50000, 10),
  selField('pitch', 'Roof pitch (rise per 12 in run)', '6', PITCHES.map((r) => [r, `${r}/12`] as [string, string])),
  numField('waste', 'Waste allowance', '%', 10, 0, 40, 1, '10% for a simple gable; 15% or more for hips, valleys and dormers.'),
  numField('eave', 'Eave length', 'ft', 80, 0, 2000, 1),
  numField('rake', 'Rake length', 'ft', 60, 0, 2000, 1),
  numField('ridge', 'Ridge and hip length', 'ft', 40, 0, 2000, 1),
  numField('iceWidth', 'Ice and water shield width at the eaves', 'ft', 3, 0, 8, 0.5, 'Eave protection reaches 900 mm up the roof and at least 300 mm inside the wall line.'),
  numField('vent', 'Net free vent area per roof vent', 'sq in', 60, 20, 200, 5),
  boolField('tearOff', 'Tear off existing roofing', false),
  numField('layers', 'Layers to tear off', undefined, 1, 1, 3, 1),
];

export const roofing: Calculator = {
  id: 'roofing',
  name: 'Asphalt shingle roofing calculator',
  trade: 'roofing',
  category: 'Building takeoff',
  summary: 'Squares, shingle bundles, underlayment, ice and water shield, drip edge, starter, ridge cap, nails and vents for an asphalt shingle roof, with optional tear-off.',
  fields,
  keywords: ['roofing', 'shingles', 'squares', 'underlayment', 'ice and water', 'drip edge', 'ridge cap', 'tear off', 'pitch'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const rise = Number(p.s('pitch'));
    const pf = pitchFactor(rise);
    const roofArea = p.s('mode') === 'footprint' ? p.n('area') * pf : p.n('area');
    const footprint = p.s('mode') === 'footprint' ? p.n('area') : p.n('area') / pf;
    const squares = roofArea / 100;
    const squaresWaste = (roofArea * (1 + p.n('waste') / 100)) / 100;
    const bundles = ceil(squaresWaste * 3);
    const iceSqft = p.n('eave') * p.n('iceWidth');
    const iceRolls = ceil((iceSqft * 1.1) / 200);
    const underRolls = ceil(((roofArea - iceSqft) * 1.05) / 1000);
    const drip = ceil(((p.n('eave') + p.n('rake')) * 1.05) / 10);
    const starter = ceil((p.n('eave') + p.n('rake')) / 100);
    const ridgeCap = ceil(p.n('ridge') / 25);
    const nails = (squaresWaste * 320) / 7200;
    const nfaNeeded = (footprint * 144) / 300; // 1/300 of the insulated ceiling area, in sq in
    const vents = ceil(nfaNeeded / p.n('vent'));
    const tear = p.b('tearOff');
    const hauls = tear ? ceil((squares * p.n('layers')) / 25) : 0;
    if (rise < 4) warnings.push('Pitches under 4/12 are low-slope: check the shingle manufacturer and NBC 9.26 (low-slope roofs need extra underlay or membrane).');
    if (rise > 9) warnings.push('Steep roofs over 9/12 need fall protection and more labour; the nail and waste allowances may need to rise.');
    if (p.n('waste') < 8) warnings.push('Under 8% waste is tight; cuts at valleys, hips and the rake waste more.');
    if (p.n('eave') <= 0) warnings.push('No eave length entered, so no ice and water shield, drip edge or starter was counted at the eaves.');
    warnings.push(`Attic ventilation: ${fmt(nfaNeeded, 0)} sq in of net free vent area (1/300 of the ceiling area, NBC 9.19.1.2); split roughly half low (soffit) and half high.`);
    if (tear && hauls > 0) warnings.push('Disposal assumes one 20 yd bin per 25 squares of one layer; heavy or multiple layers fill a bin sooner.');
    const takeoff = compact([
      core('SHINGLE-ARCH', bundles, { note: '3 bundles per square' }),
      core('UNDERLAY-SYN', underRolls),
      core('ICE-WATER', iceRolls, { note: `${p.n('iceWidth')} ft wide strip at the eaves` }),
      core('DRIP-EDGE', drip),
      core('STARTER-STRIP', starter),
      core('RIDGE-CAP', ridgeCap),
      core('ROOF-NAILS', nails),
      core('ROOF-VENT', vents),
      tear ? free('Tear off and clean up existing shingles (labour only)', squares * p.n('layers'), 'square', { labourHoursPerUnit: 1.0, labourClass: 'roofer', note: 'estimate of 1 labour-hour per square per layer' }) : null,
      tear ? core('BIN-20YD', hauls) : null,
    ]);
    return {
      summary: [
        { label: 'Shingles', value: `${bundles} bundles (${fmt(squaresWaste, 1)} squares ordered, ${fmt(squares, 1)} squares of roof)`, emphasis: true },
        { label: 'Roof surface', value: `${fmt(roofArea, 0)} sq ft at ${rise}/12 (factor ${fmt(pf, 3)})` },
        { label: 'Underlayment', value: `${underRolls} rolls of 10 squares` },
        { label: 'Ice and water shield', value: `${iceRolls} rolls of 2 squares` },
        { label: 'Drip edge and starter', value: `${drip} pieces of 10 ft, ${starter} bundles of starter` },
        { label: 'Ridge cap', value: `${ridgeCap} bundles` },
        { label: 'Nails and vents', value: `${fmt(nails, 1)} boxes, ${vents} roof vents` },
      ],
      values: values({ pitch_factor: round(pf, 4), roof_area_sqft: round(roofArea, 1), squares: round(squares, 2), squares_ordered: round(squaresWaste, 2), bundles, underlay_rolls: underRolls, ice_water_rolls: iceRolls, drip_edge_pieces: drip, starter_bundles: starter, ridge_cap_bundles: ridgeCap, nail_boxes: round(nails, 2), vents, vent_area_sq_in: round(nfaNeeded, 0) }),
      takeoff,
      warnings,
      references: [
        'Roof area = footprint x sqrt(1 + (rise/12)²); 1 square = 100 sq ft; 3 bundles per square',
        'NBC 2020 Section 9.26 (roofing; eave protection against ice damming) and 9.19.1.2 (roof space ventilation at 1/300)',
        'Nails about 320 per square; drip edge, starter and cap quantities from the edge lengths entered',
      ],
    };
  },
};
