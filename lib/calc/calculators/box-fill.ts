import { AHJ_CHECK_LINE, compact, core, fmt, numField, readFields, round, selField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

/** Boxes the takeoff can price. Names and catalog codes only: no volumes, which come from the box marking. */
export const BOX_PRICING: { id: string; label: string; code: string }[] = [
  { id: 'BOX-DEVICE', label: 'Steel device box 3 x 2 in', code: 'BOX-DEVICE' },
  { id: 'BOX-PLASTIC-1G', label: 'Plastic single-gang box', code: 'BOX-PLASTIC-1G' },
  { id: 'BOX-PLASTIC-2G', label: 'Plastic two-gang box', code: 'BOX-PLASTIC-2G' },
  { id: 'BOX-OCTAGON', label: 'Octagon box 4 in', code: 'BOX-OCTAGON' },
  { id: 'BOX-4SQ', label: 'Square box 4 in', code: 'BOX-4SQ' },
];

const SIZES_USED = ['14', '12', '10', '8', '6'] as const;
const ALLOWANCE_HELP = 'Volume allowance per conductor of this size, in mL, from the table in Rule 12-3034 of your code book. Leave at 0 until you have read it.';

const fields: CalcField[] = [
  numField('boxMl', 'Box volume as marked on the box', 'mL', 0, 0, 5000, 1, 'Read the volume marked on the box (or its spec sheet). 0 means not entered yet.'),
  ...SIZES_USED.flatMap((s) => [
    numField(`n${s}`, `${s} AWG conductors`, undefined, s === '14' ? 4 : 0, 0, 40, 1, s === '14' ? 'Count the conductors the rule says to count, including any bonding conductors your code book counts. Each conductor that enters and ends in the box counts once; a through-wire counts once.' : undefined),
    numField(`ml${s}`, `${s} AWG allowance per conductor`, 'mL', 0, 0, 200, 0.1, ALLOWANCE_HELP),
  ]),
  numField('devices', 'Switches and receptacles', undefined, 1, 0, 12, 1, 'How many devices are in the box.'),
  numField('deviceMl', 'Allowance per device', 'mL', 0, 0, 500, 0.1, 'Volume allowance for one device, in mL, from Rule 12-3034 in your code book. It is usually tied to the largest conductor connected to the device.'),
  numField('clamps', 'Internal cable clamps', undefined, 0, 0, 10, 1, 'Count of clamp sets inside the box, if any.'),
  numField('clampMl', 'Allowance per clamp set', 'mL', 0, 0, 500, 0.1, 'Volume allowance for internal clamps, in mL, from Rule 12-3034 in your code book. Leave at 0 for clamps that are not inside the box.'),
  numField('otherMl', 'Other allowances, total', 'mL', 0, 0, 2000, 0.1, 'Fixture studs, hickeys, wire connectors, deep devices and anything else Rule 12-3034 adds, worked out from your code book and added together.'),
  selField('boxType', 'Box for pricing (optional)', 'none', [['none', 'No takeoff'], ...BOX_PRICING.map((b) => [b.id, b.label] as [string, string])], 'Only used to price the box. The volume that counts is the one you typed from the marking.'),
  numField('qty', 'Number of these boxes', undefined, 1, 1, 500, 1),
];

export const boxFill: Calculator = {
  id: 'box-fill',
  name: 'Box fill calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Adds up the volume allowances you read from Rule 12-3034 for conductors, devices and clamps, and compares the total with the volume marked on the box.',
  fields,
  keywords: ['box fill', 'outlet box', 'junction box', 'device box', 'rule 12-3034', 'box volume'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    let conductorMl = 0;
    let conductorCount = 0;
    for (const s of SIZES_USED) {
      const n = Math.round(p.n(`n${s}`));
      conductorCount += n;
      conductorMl += n * p.n(`ml${s}`);
      if (n > 0 && p.n(`ml${s}`) <= 0) warnings.push(`${n} x ${s} AWG counted but no allowance was entered for ${s} AWG, so they add 0 mL. Enter the Rule 12-3034 figure.`);
    }
    const devices = Math.round(p.n('devices'));
    const clamps = Math.round(p.n('clamps'));
    const deviceMl = devices * p.n('deviceMl');
    const clampMl = clamps * p.n('clampMl');
    if (devices > 0 && p.n('deviceMl') <= 0) warnings.push('Devices are counted but no allowance per device was entered, so they add 0 mL. Look it up in Rule 12-3034.');
    if (clamps > 0 && p.n('clampMl') <= 0) warnings.push('Clamps are counted but no allowance per clamp set was entered, so they add 0 mL. Look it up in Rule 12-3034.');
    const required = conductorMl + deviceMl + clampMl + p.n('otherMl');
    const boxMl = p.n('boxMl');
    const entered = boxMl > 0;
    const pass = entered && boxMl >= required - 1e-9;
    if (!entered) warnings.push('Enter the box volume marked on the box to get a pass or fail.');
    else if (!pass) warnings.push(`The box holds ${fmt(boxMl, 1)} mL but ${fmt(required, 1)} mL is required. Use a larger box.`);
    if (conductorCount === 0 && devices === 0 && clamps === 0 && p.n('otherMl') <= 0) warnings.push('No conductors, devices or allowances entered.');
    if (entered && required <= 0) warnings.push('The required volume is 0 mL, so check that the allowances were entered.');
    const qty = Math.round(p.n('qty'));
    const pick = BOX_PRICING.find((b) => b.id === p.s('boxType'));
    const takeoff = pick && pass ? compact([core(pick.code, qty)]) : [];
    return {
      summary: [
        { label: 'Result', value: !entered ? 'Enter the box volume' : pass ? 'Pass' : 'Fail', emphasis: true },
        { label: 'Volume required', value: `${fmt(required, 1)} mL` },
        { label: 'Box volume as marked', value: entered ? `${fmt(boxMl, 1)} mL` : 'not entered' },
        { label: 'Space remaining', value: entered ? `${fmt(boxMl - required, 1)} mL` : 'n/a' },
        { label: 'Breakdown', value: `conductors ${fmt(conductorMl, 1)} mL, devices ${fmt(deviceMl, 1)} mL, clamps ${fmt(clampMl, 1)} mL, other ${fmt(p.n('otherMl'), 1)} mL` },
      ],
      values: values({ required_ml: round(required, 1), conductors_ml: round(conductorMl, 1), devices_ml: round(deviceMl, 1), clamps_ml: round(clampMl, 1), box_ml: entered ? boxMl : null, passes: entered ? pass : null, remaining_ml: entered ? round(boxMl - required, 1) : null }),
      takeoff,
      warnings,
      references: [
        'CEC Rule 12-3034 (maximum number of insulated conductors in a box): the volume allowances are typed by the user from their own code book',
        'This calculator adds the volumes and compares them with the box marking; no box or conductor volume table is built in',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
