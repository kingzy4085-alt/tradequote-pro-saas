import { compact, core, fmt, numField, readFields, round, selField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

/** Typical maintained illuminance targets, lux, at the work plane. IES-based recommendations; confirm with the project specification. */
export const SPACES: Record<string, { label: string; lux: number }> = {
  'office': { label: 'Office, general (typical IES 300 to 500 lux)', lux: 500 },
  'conference': { label: 'Conference room', lux: 300 },
  'corridor': { label: 'Corridor', lux: 100 },
  'stairs': { label: 'Stairs', lux: 150 },
  'washroom': { label: 'Washroom', lux: 200 },
  'lobby': { label: 'Lobby or reception', lux: 200 },
  'classroom': { label: 'Classroom', lux: 500 },
  'retail': { label: 'Retail sales floor', lux: 500 },
  'warehouse': { label: 'Warehouse, bulk storage', lux: 150 },
  'picking': { label: 'Warehouse, picking and packing', lux: 300 },
  'workshop': { label: 'Workshop, general', lux: 300 },
  'fine': { label: 'Workshop, fine assembly', lux: 750 },
  'garage': { label: 'Parking garage', lux: 50 },
  'mechanical': { label: 'Mechanical or electrical room', lux: 200 },
};
const FIXTURES: Record<string, { label: string; lumens: number; watts: number; code: string }> = {
  panel: { label: 'LED panel 2 x 4 ft (about 4,500 lm, 40 W)', lumens: 4500, watts: 40, code: 'LED-PANEL-2X4' },
  highbay: { label: 'LED high bay (about 20,000 lm, 150 W)', lumens: 20000, watts: 150, code: 'LED-HIGHBAY' },
};

const fields: CalcField[] = [
  numField('length', 'Room length', 'm', 12, 1, 200, 0.1),
  numField('width', 'Room width', 'm', 8, 1, 200, 0.1),
  numField('height', 'Mounting height above the floor', 'm', 2.7, 2, 20, 0.1),
  numField('plane', 'Work plane height', 'm', 0.8, 0, 1.5, 0.05, 'Desk height is 0.8 m; use 0 for floor-level tasks.'),
  selField('space', 'Space type', 'office', Object.entries(SPACES).map(([k, v]) => [k, v.label] as [string, string])),
  numField('target', 'Target illuminance (0 = use the space type)', 'lux', 0, 0, 2000, 10),
  selField('fixture', 'Fixture', 'panel', [...Object.entries(FIXTURES).map(([k, v]) => [k, v.label] as [string, string]), ['custom', 'Custom lumens']]),
  numField('lumens', 'Custom fixture lumens', 'lm', 5000, 500, 60000, 100, 'Used only for the custom fixture.'),
  numField('cu', 'Coefficient of utilization', undefined, 0.7, 0.3, 0.95, 0.01, 'Typically 0.55 to 0.75; lower in tall, narrow rooms.'),
  numField('llf', 'Light loss factor', undefined, 0.8, 0.5, 1, 0.01, 'LED in a clean space: 0.8 to 0.9.'),
];

export const lightingLayout: Calculator = {
  id: 'lighting-layout',
  name: 'Lighting layout calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Number of fixtures and a grid layout for a room by the lumen method, from the target lux for the space type, fixture lumens, utilization and light loss.',
  fields,
  keywords: ['lighting', 'lumen method', 'lux', 'fixtures', 'led panel', 'high bay', 'layout', 'footcandle'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const L = p.n('length'), W = p.n('width');
    const area = L * W;
    const hrc = p.n('height') - p.n('plane');
    if (hrc < 0.5) warnings.push('The fixtures are within 0.5 m of the work plane; raise the mounting height or lower the work plane.');
    const hh = Math.max(hrc, 0.5);
    const rcr = (5 * hh * (L + W)) / area;
    if (rcr > 5) warnings.push(`The room cavity ratio is ${fmt(rcr, 1)}. Utilization is likely below 0.55; lower the coefficient of utilization.`);
    const fx = FIXTURES[p.s('fixture')];
    const lumens = fx ? fx.lumens : p.n('lumens');
    const watts = fx ? fx.watts : (lumens / 110);
    const target = p.n('target') > 0 ? p.n('target') : SPACES[p.s('space')].lux;
    const raw = (target * area) / (lumens * p.n('cu') * p.n('llf'));
    const n0 = Math.max(1, Math.ceil(raw - 1e-9));
    const cols = Math.max(1, Math.round(Math.sqrt((n0 * L) / W)));
    const rows = Math.max(1, Math.ceil(n0 / cols));
    const n = cols * rows;
    const sx = L / cols, sy = W / rows;
    const achieved = (n * lumens * p.n('cu') * p.n('llf')) / area;
    const sc = Math.max(sx, sy) / hh;
    if (sc > 1.5) warnings.push(`Fixture spacing of ${fmt(Math.max(sx, sy), 1)} m is ${fmt(sc, 1)} times the height above the work plane; light may be uneven. Add fixtures or choose a wider distribution.`);
    if (p.s('fixture') === 'highbay' && p.n('height') < 5) warnings.push('High bays are normally mounted at 5 m or higher; a panel or low bay may suit this ceiling.');
    if (p.s('fixture') === 'panel' && p.n('height') > 4.5) warnings.push('Panels above 4.5 m give poor uniformity; consider high bays.');
    const lpd = (n * watts) / area;
    const takeoff = compact([fx ? core(fx.code, n) : null, !fx ? { description: `LED fixture, ${lumens} lm`, quantity: n, unit: 'ea', materialUnitCost: 0 } : null]);
    return {
      summary: [
        { label: 'Fixtures', value: `${n} (${cols} x ${rows} grid)`, emphasis: true },
        { label: 'Spacing', value: `${fmt(sx, 2)} m x ${fmt(sy, 2)} m, ${fmt(sx / 2, 2)} m / ${fmt(sy / 2, 2)} m to the walls` },
        { label: 'Target and achieved', value: `${target} lux target, ${fmt(achieved, 0)} lux maintained` },
        { label: 'Fixtures from the formula', value: `${fmt(raw, 2)} before rounding to a grid` },
        { label: 'Connected load', value: `${fmt(n * watts, 0)} W (${fmt(lpd, 1)} W/m²)` },
        { label: 'Room cavity ratio', value: fmt(rcr, 1) },
      ],
      values: values({ fixtures: n, columns: cols, rows, spacing_x_m: round(sx, 2), spacing_y_m: round(sy, 2), target_lux: target, achieved_lux: round(achieved, 0), raw_count: round(raw, 3), watts: round(n * watts, 0), lpd_w_m2: round(lpd, 2), rcr: round(rcr, 2) }),
      takeoff,
      warnings,
      references: [
        'Lumen method: N = (E x A) / (lumens x CU x LLF)',
        'Target illuminance: IES Lighting Handbook recommended maintained illuminance by task (typical values; the NBC and NECB do not set lux)',
        'Compare the connected load with the NECB 2020 Part 4 lighting power allowance for the building type',
      ],
    };
  },
};
