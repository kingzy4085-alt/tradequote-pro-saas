import { AHJ_CHECK_LINE, compact, core, fmt, free, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

/** CEC Table 22: usable space per insulated conductor, mL (cm3). */
export const T22_ML: Record<string, number> = { '14': 24.6, '12': 28.7, '10': 36.9, '8': 45.1, '6': 73.7 };
/** CEC Table 23 box capacities in mL. Plastic boxes are not in Table 23: the figures are conservative typical volumes, use the box marking. */
export const BOXES: { id: string; label: string; ml: number; code?: string; noDevices?: boolean }[] = [
  { id: 'dev-3x2x1.5', label: 'Steel device box 3 x 2 x 1-1/2 in', ml: 131 },
  { id: 'dev-3x2x2', label: 'Steel device box 3 x 2 x 2 in', ml: 163 },
  { id: 'dev-3x2x2.5', label: 'Steel device box 3 x 2 x 2-1/2 in', ml: 204, code: 'BOX-DEVICE' },
  { id: 'dev-3x2x3', label: 'Steel device box 3 x 2 x 3 in', ml: 245 },
  { id: 'plastic-1g', label: 'Plastic single-gang box (typical 229 mL, check marking)', ml: 229, code: 'BOX-PLASTIC-1G' },
  { id: 'oct-1.5', label: 'Octagon 4 x 1-1/2 in', ml: 245, code: 'BOX-OCTAGON', noDevices: true },
  { id: 'oct-2.125', label: 'Octagon 4 x 2-1/8 in', ml: 344, noDevices: true },
  { id: 'sq-1.5', label: 'Square 4 x 1-1/2 in', ml: 344 },
  { id: 'plastic-2g', label: 'Plastic two-gang box (typical 459 mL, check marking)', ml: 459, code: 'BOX-PLASTIC-2G' },
  { id: 'sq-2.125', label: 'Square 4 x 2-1/8 in', ml: 491, code: 'BOX-4SQ' },
];

const fields: CalcField[] = [
  numField('n14', '14 AWG conductors', undefined, 4, 0, 40, 1, 'Each conductor that enters and ends in the box counts once; a through-wire counts once; a pigtail that starts and ends in the box counts zero.'),
  numField('n12', '12 AWG conductors', undefined, 0, 0, 40, 1),
  numField('n10', '10 AWG conductors', undefined, 0, 0, 40, 1),
  numField('n8', '8 AWG conductors', undefined, 0, 0, 40, 1),
  numField('n6', '6 AWG conductors', undefined, 0, 0, 40, 1),
  boolField('bonding', 'Bonding (ground) conductors present', true, 'Conservative estimate: all bonding conductors together count as one conductor of the largest size. Confirm against Rule 12-3034.'),
  numField('devices', 'Switches and receptacles (one strap each)', undefined, 1, 0, 12, 1, 'Conservative estimate: each counts as two conductors of the largest size. Confirm against Rule 12-3034.'),
  numField('studs', 'Fixture studs or hickeys', undefined, 0, 0, 6, 1, 'Conservative estimate: each counts as one conductor of the largest size. Confirm against Rule 12-3034.'),
  numField('connectors', 'Wire connectors (wire nuts)', undefined, 0, 0, 40, 1, 'Conservative estimate: each pair counts as one conductor of the largest size. Confirm against Rule 12-3034.'),
  numField('clamps', 'Internal cable clamps', undefined, 0, 0, 10, 1, 'Not counted here. Use a box whose marked volume allows for them, and confirm with Rule 12-3034.'),
  numField('deepDevices', 'Devices deeper than 25.4 mm behind the strap', undefined, 0, 0, 12, 1, 'GFCI and smart devices: conservative estimate: reduce usable space by 32 mL per cm of depth. Confirm against Rule 12-3034.'),
  numField('deepDepth', 'Depth of those devices behind the strap', 'cm', 4, 2.54, 10, 0.1),
  selField('box', 'Box to check', 'auto', [['auto', 'Find the smallest box that fits'], ...BOXES.map((b) => [b.id, b.label] as [string, string])]),
  numField('customMl', 'Marked box volume (overrides the list)', 'mL', 0, 0, 5000, 1, 'Enter the volume marked on the box, or leave at 0.'),
  numField('qty', 'Number of these boxes', undefined, 1, 1, 500, 1),
];

export const boxFill: Calculator = {
  id: 'box-fill',
  name: 'Box fill calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Required box volume for conductors, devices and fittings under CEC Rule 12-3034, with pass or fail and the smallest standard box that fits.',
  fields,
  keywords: ['box fill', 'outlet box', 'junction box', 'device box', 'rule 12-3034', 'octagon', 'table 22', 'table 23'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const counts: [string, number][] = (['14', '12', '10', '8', '6'] as const).map((s) => [s, Math.round(p.n(`n${s}`))]);
    const present = counts.filter(([, n]) => n > 0);
    const largest = present.length ? present[present.length - 1][0] : '14';
    const big = T22_ML[largest];
    let ml = 0;
    for (const [s, n] of counts) ml += n * T22_ML[s];
    const conductorMl = ml;
    const bonding = p.b('bonding') ? big : 0;
    const devices = Math.round(p.n('devices')) * 2 * big;
    const studs = Math.round(p.n('studs')) * big;
    const connectors = Math.floor(Math.round(p.n('connectors')) / 2) * big;
    const deep = Math.round(p.n('deepDevices')) * 32 * p.n('deepDepth');
    const required = conductorMl + bonding + devices + studs + connectors + deep;
    if (!present.length) warnings.push('No conductors entered; only fittings and devices were counted.');
    if (p.n('clamps') > 0) warnings.push('Internal clamps are not counted here; make sure the box volume you use allows for the space they take, and confirm against Rule 12-3034.');
    const custom = p.n('customMl');
    const chosen = p.s('box');
    const list = [...BOXES].sort((a, c) => a.ml - c.ml).filter((b) => b.ml >= required - 1e-9 && !(b.noDevices && Math.round(p.n('devices')) > 0));
    const auto = list[0];
    const sel = custom > 0 ? { id: 'custom', label: `Marked ${custom} mL box`, ml: custom, code: undefined as string | undefined } : chosen === 'auto' ? auto : BOXES.find((b) => b.id === chosen);
    if (sel && sel.id !== 'custom' && 'noDevices' in sel && (sel as { noDevices?: boolean }).noDevices && Math.round(p.n('devices')) > 0) warnings.push('Octagon boxes do not take switches or receptacles without a device ring; pick a device box or square box.');
    const pass = !!sel && sel.ml >= required - 1e-9;
    if (!sel) warnings.push('No standard box in the list is large enough; use a larger junction box and confirm its size with the authority having jurisdiction.');
    else if (!pass) warnings.push(`${sel.label} holds ${sel.ml} mL but ${fmt(required, 1)} mL is required.${auto ? ` Use at least: ${auto.label}.` : ''}`);
    if (big && required > 0 && Object.keys(T22_ML).length) warnings.push('Table 22 is used for mixed sizes and boxes; where all conductors are one size Table 23 gives the same answer in conductor counts.');
    warnings.push('The allowances for devices, studs, connectors, bonding conductors and deep devices are a conservative estimate, not a confirmed Rule 12-3034 calculation. Confirm the box volume against Rule 12-3034 before you rely on it.');
    const qty = Math.round(p.n('qty'));
    const takeoff = sel && pass ? compact([sel.code ? core(sel.code, qty) : free(sel.label, qty, 'ea')]) : [];
    return {
      summary: [
        { label: 'Result', value: pass ? 'Pass' : 'Fail', emphasis: true },
        { label: 'Volume required', value: `${fmt(required, 1)} mL` },
        { label: 'Box checked', value: sel ? `${sel.label}, ${sel.ml} mL` : 'none fits' },
        { label: 'Smallest standard box that fits', value: auto ? `${auto.label} (${auto.ml} mL)` : 'none in list' },
        { label: 'Space remaining', value: sel ? `${fmt(sel.ml - required, 1)} mL` : 'n/a' },
      ],
      values: values({ required_ml: round(required, 1), conductors_ml: round(conductorMl, 1), box_ml: sel ? sel.ml : null, passes: pass, box_id: sel ? sel.id : null, remaining_ml: sel ? round(sel.ml - required, 1) : null }),
      takeoff,
      warnings,
      references: [
        'CEC 2024 Rule 12-3034 (maximum number of insulated conductors in a box), Table 22 (space per conductor) and Table 23 (box capacities)',
        'Allowances (conservative estimate, confirm against Rule 12-3034): devices 2 x largest conductor, fixture studs 1, each pair of connectors 1, all bonding conductors together 1',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
