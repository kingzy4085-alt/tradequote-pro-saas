import { AHJ_CHECK_LINE, awgLabel, compact, core, coreOrFree, fmt, free, numField, readFields, round, selField, boolField, stdAtMost, terminationField, TERMINATION_WARNING, values } from '../common';
import { SIZES, STD_OCPD } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const HP_LABEL: [string, string][] = [[String(1 / 6), '1/6'], ['0.25', '1/4'], [String(1 / 3), '1/3'], ['0.5', '1/2'], ['0.75', '3/4'], ['1', '1'], ['1.5', '1-1/2'], ['2', '2'], ['3', '3'], ['5', '5'], ['7.5', '7-1/2'], ['10', '10'], ['15', '15'], ['20', '20'], ['25', '25'], ['30', '30'], ['40', '40'], ['50', '50'], ['60', '60'], ['75', '75'], ['100', '100'], ['125', '125'], ['150', '150'], ['200', '200']];
/** NEMA ICS 2 full-voltage starter horsepower ratings, [size, hp at 200 V, 230 V, 460/575 V] three-phase and [size, 115 V, 230 V] single-phase. */
const NEMA_3PH: [string, number, number, number][] = [['00', 1.5, 1.5, 2], ['0', 3, 3, 5], ['1', 7.5, 7.5, 10], ['2', 10, 15, 25], ['3', 25, 30, 50], ['4', 40, 50, 100], ['5', 75, 100, 200], ['6', 150, 200, 400]];
const NEMA_1PH: [string, number, number][] = [['00', 1 / 3, 1], ['0', 1, 2], ['1', 2, 3], ['2', 3, 7.5], ['3', 7.5, 15]];
const TECK_SIZES = new Set(['12', '10', '8', '6', '4', '2']);

const fields: CalcField[] = [
  selField('hp', 'Motor rating', '5', HP_LABEL.map(([v, l]) => [v, `${l} hp`] as [string, string]), 'Used for the NEMA starter size.'),
  selField('supply', 'Supply', '3ph-600', [['1ph-120', 'Single-phase 120 V'], ['1ph-240', 'Single-phase 240 V'], ['3ph-208', 'Three-phase 208 V'], ['3ph-240', 'Three-phase 240 V'], ['3ph-480', 'Three-phase 480 V'], ['3ph-600', 'Three-phase 600 V']]),
  numField('tableFla', 'Full-load current from the code book motor table', 'A', 0, 0, 2000, 0.1, 'Read it from the code book motor full-load current table for your motor type (Table 44 for three-phase, Table 45 for single-phase), at your motor rating and voltage. Not supplied by this calculator. 0 means not entered yet.'),
  numField('nameplate', 'Nameplate full-load current (optional)', 'A', 0, 0, 1000, 0.1, 'Leave at 0 to size the conductor from the code book value. Overload protection must be set from the nameplate, so no overload figure is shown without it.'),
  boolField('sf', 'Service factor 1.15 or more, or temperature rise 40 °C or less', true, 'Sets the overload at up to 125% of the nameplate current; otherwise up to 115% (Section 28). Applies only when the nameplate current is entered.'),
  selField('device', 'Branch-circuit protection device', 'breaker', [['breaker', 'Inverse-time breaker'], ['delay', 'Time-delay fuse'], ['fuse', 'Non-time-delay fuse']], 'Only labels the result. The percentage below is the one that counts.'),
  numField('maxPct', 'Maximum overcurrent percentage for that device', '%', 0, 0, 1000, 1, 'Read it from the code book table of maximum branch-circuit protection for motors (Table 29), for your device type and starter or motor type. Not supplied by this calculator. 0 means not entered yet.'),
  selField('conductorSize', 'Conductor size for pricing (optional)', 'none', [['none', 'No cable takeoff'], ...SIZES.map((s) => [s, awgLabel(s)] as [string, string])], 'Only used to price the Teck90 cable. It does not set any ampacity.'),
  numField('conductorAmpacity', 'Ampacity of your chosen conductor (optional)', 'A', 0, 0, 2000, 1, 'Read from the code book ampacity table for the conductor, in the column for the termination temperature chosen below. If you enter it, the result is checked against 125% of the full-load current. Leave at 0 to skip the check.'),
  terminationField(),
  numField('length', 'Run length to the motor', 'm', 20, 0, 1000, 0.5, 'Used for the Teck90 cable takeoff.'),
];

export const motorCircuit: Calculator = {
  id: 'motor-circuit',
  name: 'Motor circuit calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Conductor ampacity, overload setting, maximum breaker or fuse and starter size for a single motor under CEC Section 28, from the full-load current and percentage you read from your code book.',
  fields,
  keywords: ['motor', 'fla', 'starter', 'overload', 'nema', 'hp', 'disconnect', 'section 28'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const three = p.s('supply').startsWith('3ph');
    const volts = Number(p.s('supply').split('-')[1]);
    const hp = Number(p.s('hp'));
    const tableFla = p.n('tableFla');
    const plate = p.n('nameplate');
    const fla = plate > 0 ? plate : tableFla;
    const haveFla = fla > 0;
    if (!haveFla) warnings.push('Enter the full-load current from your code book motor table (or the nameplate current) to size the circuit.');
    if (plate > 0 && tableFla > 0) warnings.push(`Nameplate ${plate} A is used for the conductor and the overload; the code book value is ${tableFla} A. Overcurrent maximums use the code book current.`);
    else if (plate > 0) warnings.push('Only the nameplate current was entered, so the maximum breaker or fuse cannot be worked out. Enter the code book full-load current as well.');
    if (plate <= 0) warnings.push('No nameplate current entered, so no overload setting is shown. Overload protection is set from the motor nameplate current, not the code book value. Enter the nameplate current to see it.');
    const minAmp = fla * 1.25;
    const pct = p.n('maxPct');
    const maxDevice = tableFla > 0 && pct > 0 ? (tableFla * pct) / 100 : null;
    const std = maxDevice !== null ? stdAtMost(STD_OCPD, maxDevice) : null;
    if (maxDevice === null) warnings.push('Enter the code book full-load current and the maximum overcurrent percentage to see the largest breaker or fuse.');
    else warnings.push(`If ${std ?? 'the'} A will not carry the starting current, Section 28 allows a higher setting in some cases; check the notes to the protection table in your code book. Use the maximum that still starts the motor.`);
    const overload: number | null = plate > 0 ? plate * (p.b('sf') ? 1.25 : 1.15) : null;
    const nemaIdx = three ? NEMA_3PH.find((r) => (volts === 208 ? r[1] : volts === 240 ? r[2] : r[3]) >= hp - 1e-6) : null;
    const nema1 = !three ? NEMA_1PH.find((r) => (volts === 120 ? r[1] : r[2]) >= hp - 1e-6) : null;
    const starterSize = three ? nemaIdx?.[0] : nema1?.[0];
    if (!starterSize) warnings.push('The motor is above NEMA size 6 (or size 3 single-phase); use a reduced-voltage or special starter.');
    const cAmp = p.n('conductorAmpacity');
    const checked = haveFla && cAmp > 0;
    const condPass = checked ? cAmp >= minAmp - 1e-9 : null;
    if (checked && p.s('termination') === '60') warnings.push(TERMINATION_WARNING);
    if (checked && !condPass) warnings.push(`The conductor ampacity of ${fmt(cAmp, 0)} A is below the ${fmt(minAmp, 1)} A required (125% of full-load current). Choose a larger conductor.`);
    const discA = fla * 1.15;
    const disc = !haveFla ? undefined : three ? (discA <= 100 && volts <= 600 ? 'DISC-100A' : undefined) : discA <= 60 ? 'DISC-60A' : undefined;
    const len = p.n('length');
    const size = p.s('conductorSize');
    const hasSize = size !== 'none';
    const teckSize = !hasSize ? undefined : TECK_SIZES.has(size) ? size : size === '14' ? '12' : size;
    const teckCode = three && teckSize && TECK_SIZES.has(teckSize) ? `TECK90-${teckSize}-3` : undefined;
    const small = starterSize === '00' || starterSize === '0' || starterSize === '1';
    const takeoff = compact([
      len > 0 && teckSize ? coreOrFree(teckCode, `Teck90 copper armoured cable ${teckSize}/${three ? 3 : 2} with ground`, round(len, 1), 'm') : null,
      starterSize ? (small && three ? core('STARTER-NEMA1', 1, { note: starterSize === '1' ? 'NEMA size 1' : `NEMA size ${starterSize} fits; size 1 is the smallest catalog starter` }) : free(`Motor starter, NEMA size ${starterSize}, with overload`, 1, 'ea')) : null,
      haveFla ? (disc ? core(disc, 1) : free(`Safety switch rated at least ${fmt(discA, 0)} A`, 1, 'ea')) : null,
    ]);
    const deviceLabel = { breaker: 'inverse-time breaker', delay: 'time-delay fuse', fuse: 'non-time-delay fuse' }[p.s('device') as 'breaker'];
    return {
      summary: [
        { label: 'Full-load current', value: haveFla ? `${fmt(fla, 1)} A${plate > 0 ? ' (nameplate)' : ' (code book motor table)'}` : 'Enter the full-load current', emphasis: true },
        { label: 'Minimum conductor ampacity', value: haveFla ? `${fmt(minAmp, 1)} A (125% of full-load current)` : 'n/a' },
        { label: 'Your conductor', value: checked ? `${fmt(cAmp, 0)} A: ${condPass ? 'Pass' : 'Fail'}` : 'not checked' },
        { label: 'Overload setting', value: overload !== null ? `${fmt(overload, 1)} A (${p.b('sf') ? 125 : 115}% of ${fmt(plate, 1)} A nameplate)` : 'Enter the nameplate current' },
        { label: 'Maximum breaker or fuse', value: maxDevice !== null ? `${fmt(maxDevice, 0)} A calculated (${deviceLabel}, ${fmt(pct, 0)}%); ${std ?? 'below 15'} A standard` : 'Enter the code book percentage' },
        { label: 'NEMA starter size', value: starterSize ? `Size ${starterSize}` : 'special' },
        { label: 'Disconnect', value: haveFla ? `at least ${fmt(discA, 0)} A (115% of full-load current)` : 'n/a' },
      ],
      values: values({ hp, fla_a: haveFla ? round(fla, 2) : null, table_fla_a: tableFla > 0 ? tableFla : null, min_conductor_ampacity_a: haveFla ? round(minAmp, 2) : null, conductor_passes: condPass, conductor_size: hasSize ? size : null, overload_a: overload !== null ? round(overload, 2) : null, max_device_pct: pct > 0 ? pct : null, max_device_a: maxDevice !== null ? round(maxDevice, 1) : null, std_device_a: std, starter_size: starterSize ?? null, disconnect_a: haveFla ? round(discA, 1) : null }),
      takeoff,
      warnings,
      references: [
        'Full-load current and the maximum overcurrent percentage are typed by the user from their own code book (the motor full-load current tables and Table 29); this calculator does the arithmetic only',
        'CEC Section 28: motor conductors at 125% of full-load current, overload protection from the nameplate current, branch-circuit protection (summary)',
        'NEMA ICS 2 starter horsepower ratings for size selection; disconnect at 115% of full-load current (CEC Section 28 disconnecting means)',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
