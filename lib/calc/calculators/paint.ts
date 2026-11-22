import { ceil, compact, core, fmt, free, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const fields: CalcField[] = [
  numField('walls', 'Wall area', 'sq ft', 800, 0, 50000, 10, 'Length x height of every wall, minus large openings.'),
  numField('ceilings', 'Ceiling area', 'sq ft', 300, 0, 50000, 10),
  selField('surface', 'Surface', 'int', [['int', 'Interior walls'], ['ext', 'Exterior siding or stucco']]),
  numField('coats', 'Finish coats on walls', undefined, 2, 1, 4, 1),
  numField('ceilingCoats', 'Coats on ceilings', undefined, 2, 1, 4, 1),
  boolField('primer', 'Primer on new or patched surfaces', true),
  numField('coverage', 'Coverage of finish paint', 'sq ft per 3.78 L', 350, 150, 500, 10, 'Manufacturers print 350 to 400; 300 to 350 is safer on rough or porous surfaces.'),
  numField('primerCoverage', 'Coverage of primer', 'sq ft per 3.78 L', 300, 150, 450, 10),
  boolField('labour', 'Include painting labour', true, 'Turn off if your catalog prices already carry the labour.'),
];

export const paint: Calculator = {
  id: 'paint',
  name: 'Paint calculator',
  trade: 'painting',
  category: 'Building takeoff',
  summary: 'Cans of paint, primer and caulking for walls and ceilings from the area, number of coats and spreading rate, plus painting labour.',
  fields,
  keywords: ['paint', 'primer', 'coats', 'gallons', 'litres', 'ceiling', 'walls', 'caulk'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const walls = p.n('walls'), ceilings = p.n('ceilings');
    const wallCoats = Math.round(p.n('coats'));
    const ceilCoats = Math.round(p.n('ceilingCoats'));
    const exterior = p.s('surface') === 'ext';
    const wallCans = (walls * wallCoats) / p.n('coverage');
    const ceilCans = exterior ? 0 : (ceilings * ceilCoats) / p.n('coverage');
    const primerCans = p.b('primer') ? (walls + (exterior ? 0 : ceilings)) / p.n('primerCoverage') : 0;
    const perimeterFt = walls / 8;
    const caulk = perimeterFt / 30;
    if (exterior && ceilings > 0) warnings.push('Ceiling area is ignored for an exterior surface.');
    if (walls + ceilings <= 0) warnings.push('Enter a wall or ceiling area.');
    if (wallCoats === 1 && !p.b('primer')) warnings.push('One coat without primer rarely covers well, especially over a colour change.');
    const litres = (ceil(wallCans) + ceil(ceilCans) + ceil(primerCans)) * 3.78;
    const hours = walls * (wallCoats * 0.01 + (p.b('primer') ? 0.008 : 0)) + (exterior ? 0 : ceilings * (ceilCoats * 0.012 + (p.b('primer') ? 0.008 : 0)));
    const takeoff = compact([
      core(exterior ? 'PAINT-EXT' : 'PAINT-INT', wallCans),
      core('PAINT-CEILING', ceilCans),
      core('PRIMER', primerCans),
      core('CAULK', caulk, { note: 'about 30 ft of bead per tube, trim and gaps' }),
      p.b('labour') && walls + ceilings > 0 ? free('Prepare and paint (labour only)', walls + (exterior ? 0 : ceilings), 'sqft', { labourHoursPerUnit: round(hours / Math.max(walls + (exterior ? 0 : ceilings), 1), 4), labourClass: 'painter', note: 'about 0.01 hours per sq ft per wall coat, 0.012 per ceiling coat, 0.008 primer' }) : null,
    ]);
    return {
      summary: [
        { label: 'Finish paint', value: `${ceil(wallCans + ceilCans)} cans of 3.78 L`, emphasis: true },
        { label: 'Primer', value: `${ceil(primerCans)} cans of 3.78 L` },
        { label: 'Wall paint', value: `${fmt(wallCans, 2)} cans for ${fmt(walls, 0)} sq ft x ${wallCoats} coats` },
        { label: 'Ceiling paint', value: `${fmt(ceilCans, 2)} cans for ${fmt(ceilings, 0)} sq ft x ${ceilCoats} coats` },
        { label: 'Total volume', value: `${fmt(litres, 0)} L` },
        { label: 'Caulking', value: `${ceil(caulk)} tubes` },
        { label: 'Labour estimate', value: `${fmt(hours, 0)} hours` },
      ],
      values: values({ wall_cans: round(wallCans, 2), ceiling_cans: round(ceilCans, 2), primer_cans: round(primerCans, 2), litres: round(litres, 1), caulk_tubes: round(caulk, 2), labour_hours: round(hours, 1) }),
      takeoff,
      warnings,
      references: [
        'Cans = area x coats / spreading rate per 3.78 L can (1 US gallon); whole cans round up per type',
        'Primer on new drywall and patches; caulk estimated from the wall perimeter (area / 8 ft) at 30 ft per tube',
        'Labour rates per sq ft are estimating assumptions',
      ],
    };
  },
};
