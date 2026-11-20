import { ceil, compact, core, fmt, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const TYPES: Record<string, { label: string; code: string; straight: number; diagonal: number; underlay: boolean }> = {
  lvp: { label: 'Luxury vinyl plank', code: 'FLOOR-LVP', straight: 7, diagonal: 12, underlay: false },
  laminate: { label: 'Laminate', code: 'FLOOR-LAMINATE', straight: 7, diagonal: 12, underlay: true },
  engineered: { label: 'Engineered hardwood', code: 'FLOOR-ENG-HW', straight: 8, diagonal: 15, underlay: true },
  tile: { label: 'Porcelain tile', code: 'FLOOR-TILE', straight: 10, diagonal: 15, underlay: false },
};

const fields: CalcField[] = [
  numField('area', 'Floor area', 'sq ft', 400, 5, 50000, 5),
  selField('type', 'Flooring', 'lvp', Object.entries(TYPES).map(([k, v]) => [k, v.label] as [string, string])),
  selField('layout', 'Layout', 'straight', [['straight', 'Straight (parallel to the walls)'], ['diagonal', 'Diagonal or herringbone']]),
  numField('waste', 'Waste override (0 = use the type and layout default)', '%', 0, 0, 40, 1),
  boolField('underlay', 'Underlayment', true, 'Foam underlayment under laminate and engineered hardwood; many vinyl planks have it attached.'),
  numField('tileLength', 'Tile length', 'mm', 600, 50, 1200, 10, 'Tile only.'),
  numField('tileWidth', 'Tile width', 'mm', 300, 50, 1200, 10, 'Tile only.'),
  numField('tileThickness', 'Tile thickness', 'mm', 9, 5, 25, 1, 'Tile only.'),
  numField('joint', 'Grout joint width', 'mm', 3, 1, 12, 0.5, 'Tile only.'),
  numField('thinsetCoverage', 'Thinset coverage per 23 kg bag', 'sq ft', 60, 30, 120, 5, 'Tile only. Large tile and deep trowel notches cover less.'),
];

export const flooring: Calculator = {
  id: 'flooring',
  name: 'Flooring calculator',
  trade: 'flooring',
  category: 'Building takeoff',
  summary: 'Flooring quantity with waste for the type and layout, plus underlayment, and thinset and grout for tile.',
  fields,
  keywords: ['flooring', 'lvp', 'vinyl plank', 'laminate', 'hardwood', 'tile', 'thinset', 'grout', 'underlayment', 'waste'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const t = TYPES[p.s('type')];
    const wastePct = p.n('waste') > 0 ? p.n('waste') : p.s('layout') === 'diagonal' ? t.diagonal : t.straight;
    const area = p.n('area');
    const need = area * (1 + wastePct / 100);
    const isTile = p.s('type') === 'tile';
    const underlay = p.b('underlay') && !isTile ? area : 0;
    const thinset = isTile ? ceil(area / p.n('thinsetCoverage')) : 0;
    const L = p.n('tileLength'), W = p.n('tileWidth');
    // Grout litres per m2 = (L + W) / (L x W) x joint x thickness, with L, W, joint and thickness in mm; density 1.6 kg/L, 25% for waste and fill
    const groutKgPerM2 = ((L + W) / (L * W)) * p.n('joint') * p.n('tileThickness') * 1.6 * 1.25;
    const groutKg = isTile ? groutKgPerM2 * (area / 10.7639) : 0;
    const grout = ceil(groutKg / 10);
    if (isTile && Math.max(L, W) >= 600) warnings.push('Large-format tile needs a flat substrate (about 3 mm in 3 m) and a deeper trowel; thinset coverage may be nearer 40 sq ft per bag.');
    if (p.b('underlay') && p.s('type') === 'lvp') warnings.push('Most vinyl plank has an attached pad; a second underlayment can void the warranty.');
    if (p.n('waste') > 0 && p.n('waste') < t.straight) warnings.push(`The ${p.n('waste')}% waste is below the usual ${t.straight}% for this flooring.`);
    warnings.push('Buy full boxes and keep one box spare for future repairs; the quantity shown is square feet of coverage.');
    const takeoff = compact([
      core(t.code, need),
      core('UNDERLAY-FOAM', underlay * 1.05),
      core('THINSET-23KG', thinset),
      core('GROUT-10KG', grout),
    ]);
    return {
      summary: [
        { label: 'Flooring to buy', value: `${fmt(need, 0)} sq ft (${fmt(wastePct, 0)}% waste)`, emphasis: true },
        { label: 'Floor area', value: `${fmt(area, 0)} sq ft` },
        { label: 'Underlayment', value: underlay > 0 ? `${fmt(underlay * 1.05, 0)} sq ft` : 'not needed' },
        { label: 'Thinset', value: isTile ? `${thinset} bags of 23 kg` : 'not needed' },
        { label: 'Grout', value: isTile ? `${grout} bags of 10 kg (${fmt(groutKg, 1)} kg)` : 'not needed' },
      ],
      values: values({ area_sqft: round(area, 1), waste_pct: wastePct, order_sqft: round(need, 1), underlay_sqft: round(underlay * 1.05, 1), thinset_bags: thinset, grout_kg: round(groutKg, 2), grout_bags: grout }),
      takeoff,
      warnings,
      references: [
        'Waste: 7% straight and 12% diagonal for vinyl and laminate, 8% and 15% for engineered hardwood, 10% and 15% for tile (typical installer allowances)',
        'Grout: litres per m² = (L + W) / (L x W) x joint x thickness (mm), at 1.6 kg/L with 25% for waste and fill',
        'Thinset coverage varies with trowel size; the figure entered is the manufacturer coverage',
      ],
    };
  },
};
