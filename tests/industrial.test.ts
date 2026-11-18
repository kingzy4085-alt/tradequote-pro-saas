// The non-productive time allowance, the permit line and the industrial starter assemblies.
import { describe, expect, it } from 'vitest';
import { STARTER_ASSEMBLIES, parseAssembly } from '@/lib/assemblies';
import { estimateTotals } from '@/lib/estimate-math';
import { DEFAULT_NPT_PERCENT, isNptLine, isPermitLine, nptLine, parseNptPercent, permitDescription, productiveHours, withNptAllowance, withPermitLine } from '@/lib/industrial';

const mcc = { description: 'MCC', quantity: 1, unit: 'ea', material_unit_cost: 50000, labour_hours_per_unit: 100 };
const cable = { description: 'Cable', quantity: 100, unit: 'm', material_unit_cost: 20, labour_hours_per_unit: 0.5 };
const blank = { description: '', quantity: 1, unit: 'ea', material_unit_cost: 0, labour_hours_per_unit: 0 };

describe('non-productive time allowance', () => {
  it('is that percent of the labour hours on the other lines, as a labour-only line', () => {
    expect(productiveHours([mcc, cable, blank])).toBe(150);
    const line = nptLine([mcc, cable], 10);
    expect(line).toMatchObject({ quantity: 1, unit: 'lot', material_unit_cost: 0, labour_hours_per_unit: 15 });
    expect(line.description).toBe('Non-productive time allowance: lockout/tagout, orientation and permits (10% of labour)');
    expect(nptLine([{ ...cable, quantity: 3, labour_hours_per_unit: 0.333 }], 12.5).labour_hours_per_unit).toBe(0.13);
  });

  it('raises the price by its hours at the labour rate, through the same totals as any line', () => {
    const before = estimateTotals([mcc, cable], 100, 10, 5);
    const after = estimateTotals(withNptAllowance([mcc, cable], 10), 100, 10, 5);
    // 15 hours x $100 = $1,500 of cost, then 10% markup
    expect(Math.round((after.beforeTax - before.beforeTax) * 100) / 100).toBe(1650);
  });

  it('updates the allowance in place instead of adding a second, and never counts itself', () => {
    const once = withNptAllowance([mcc, cable], 10);
    const twice = withNptAllowance(once, 20);
    expect(twice.filter(isNptLine)).toHaveLength(1);
    expect(twice).toHaveLength(3);
    expect(twice[2].labour_hours_per_unit).toBe(30);
    // More work added afterwards: pressing again follows it, and the line keeps its place
    const more = withNptAllowance([twice[0], twice[2], cable, cable], 10);
    expect(more.map(isNptLine)).toEqual([false, true, false, false]);
    expect(more[1].labour_hours_per_unit).toBe(20);
  });

  it('falls back to the default for a blank or silly percent, and caps it', () => {
    expect(parseNptPercent('')).toBe(DEFAULT_NPT_PERCENT);
    expect(parseNptPercent('abc')).toBe(DEFAULT_NPT_PERCENT);
    expect(parseNptPercent(-5)).toBe(DEFAULT_NPT_PERCENT);
    expect(parseNptPercent('0')).toBe(0);
    expect(parseNptPercent('15')).toBe(15);
    expect(parseNptPercent(900)).toBe(100);
    expect(nptLine([blank], 10).labour_hours_per_unit).toBe(0);
  });
});

describe('permit and inspection line', () => {
  it('names the authority for the province where there is one, and stays general elsewhere', () => {
    expect(permitDescription('SK')).toBe('Permit: TSASK electrical permit and inspection');
    expect(permitDescription('on')).toBe('Permit: ESA notification and inspection');
    expect(permitDescription('BC')).toContain('Technical Safety BC');
    expect(permitDescription('NU')).toBe('Permit: Electrical permit and inspection');
    expect(permitDescription(null)).toBe('Permit: Electrical permit and inspection');
  });

  it('adds one line with the fee left blank, never a guessed amount, and never a second', () => {
    const once = withPermitLine([mcc], 'SK');
    expect(once).toHaveLength(2);
    expect(once[1]).toEqual({ description: 'Permit: TSASK electrical permit and inspection', quantity: 1, unit: 'ea', material_unit_cost: 0, labour_hours_per_unit: 0 });
    expect(isPermitLine(once[1])).toBe(true);
    expect(withPermitLine(once, 'SK')).toHaveLength(2);
    // The typed fee is ordinary material cost: it reaches the total, and adds no labour to the allowance
    const priced = [once[0], { ...once[1], material_unit_cost: 400 }];
    expect(productiveHours(priced)).toBe(100);
    expect(estimateTotals(priced, 100, 0, 0).beforeTax - estimateTotals([mcc], 100, 0, 0).beforeTax).toBe(400);
  });
});

describe('industrial starter assemblies', () => {
  const industrial = STARTER_ASSEMBLIES.filter((a) => a.category === 'Industrial');

  it('cover 9-lead and 12-lead motor terminations and Teck90 power and control runs', () => {
    expect(industrial.map((a) => a.name)).toEqual(['Motor Termination, 9-Lead', 'Motor Termination, 12-Lead', 'Teck90 Power Cable Run, 30 m', 'Teck90 Control Cable Run, 30 m']);
    for (const a of industrial) expect(parseAssembly(a), a.name).toMatchObject({ ok: true });
  });

  it('each includes its testing, not just the parts', () => {
    for (const a of industrial) expect(a.lines.some((l) => /megger|continuity/i.test(l.description)), a.name).toBe(true);
    for (const a of industrial.filter((x) => x.name.startsWith('Teck90'))) {
      expect(a.lines.find((l) => l.unit === 'm')?.quantity, a.name).toBe(30);
      expect(a.lines.some((l) => /Teck connector/.test(l.description)), a.name).toBe(true);
    }
  });
});
