import { awgLabel, compact, core, coreOrFree, fmt, free, numField, readFields, round, selField, boolField, stdAtMost, values } from '../common';
import { MOTOR_1PH, MOTOR_1PH_HP, MOTOR_3PH, MOTOR_3PH_HP, STD_OCPD, T2_CU, sizesFor } from '../electrical-data';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const HP_LABEL: [string, string][] = [[String(1 / 6), '1/6'], ['0.25', '1/4'], [String(1 / 3), '1/3'], ['0.5', '1/2'], ['0.75', '3/4'], ['1', '1'], ['1.5', '1-1/2'], ['2', '2'], ['3', '3'], ['5', '5'], ['7.5', '7-1/2'], ['10', '10'], ['15', '15'], ['20', '20'], ['25', '25'], ['30', '30'], ['40', '40'], ['50', '50'], ['60', '60'], ['75', '75'], ['100', '100'], ['125', '125'], ['150', '150'], ['200', '200']];
/** NEMA ICS 2 full-voltage starter horsepower ratings, [size, hp at 200 V, 230 V, 460/575 V] three-phase and [size, 115 V, 230 V] single-phase. */
const NEMA_3PH: [string, number, number, number][] = [['00', 1.5, 1.5, 2], ['0', 3, 3, 5], ['1', 7.5, 7.5, 10], ['2', 10, 15, 25], ['3', 25, 30, 50], ['4', 40, 50, 100], ['5', 75, 100, 200], ['6', 150, 200, 400]];
const NEMA_1PH: [string, number, number][] = [['00', 1 / 3, 1], ['0', 1, 2], ['1', 2, 3], ['2', 3, 7.5], ['3', 7.5, 15]];
const TECK_SIZES = new Set(['12', '10', '8', '6', '4', '2']);

const fields: CalcField[] = [
  selField('hp', 'Motor rating', '5', HP_LABEL.map(([v, l]) => [v, `${l} hp`] as [string, string])),
  selField('supply', 'Supply', '3ph-600', [['1ph-120', 'Single-phase 120 V'], ['1ph-240', 'Single-phase 240 V'], ['3ph-208', 'Three-phase 208 V'], ['3ph-240', 'Three-phase 240 V'], ['3ph-480', 'Three-phase 480 V'], ['3ph-600', 'Three-phase 600 V']]),
  numField('nameplate', 'Nameplate full-load current (optional)', 'A', 0, 0, 1000, 0.1, 'Leave at 0 to use the table value. The overload uses the nameplate when given.'),
  boolField('sf', 'Service factor 1.15 or more, or temperature rise 40 °C or less', true, 'Sets the overload at 125% of nameplate current; otherwise 115% (Rule 28-306).'),
  selField('device', 'Branch-circuit protection', 'breaker', [['breaker', 'Inverse-time breaker (250%)'], ['delay', 'Time-delay fuse (175%)'], ['fuse', 'Non-time-delay fuse (300%)']]),
  numField('length', 'Run length to the motor', 'm', 20, 0, 1000, 0.5, 'Used for the Teck90 cable takeoff.'),
];

export const motorCircuit: Calculator = {
  id: 'motor-circuit',
  name: 'Motor circuit calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Full-load current, conductor size, overload setting, maximum breaker or fuse and starter size for a single motor under CEC Section 28.',
  fields,
  keywords: ['motor', 'fla', 'starter', 'overload', 'nema', 'table 44', 'table 29', 'hp', 'disconnect'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const three = p.s('supply').startsWith('3ph');
    const volts = Number(p.s('supply').split('-')[1]);
    const hpWanted = Number(p.s('hp'));
    const hpList = three ? MOTOR_3PH_HP : MOTOR_1PH_HP;
    let idx = hpList.findIndex((h) => h >= hpWanted - 1e-6);
    if (idx < 0) { idx = hpList.length - 1; warnings.push(`${hpWanted} hp is above the largest ${three ? 'three' : 'single'}-phase motor in the CEC table (${hpList[idx]} hp). Use the nameplate current.`); }
    else if (Math.abs(hpList[idx] - hpWanted) > 1e-6) warnings.push(`${hpWanted} hp is not in Table ${three ? 44 : 45}; the next listed rating, ${hpList[idx]} hp, was used.`);
    const hp = hpList[idx];
    const col = three ? ({ 208: '208', 240: '230', 480: '460', 600: '575' } as Record<number, '208' | '230' | '460' | '575'>)[volts] : ({ 120: '115', 240: '230' } as Record<number, '115' | '230'>)[volts];
    const tableFla = three ? MOTOR_3PH[col as '208'][idx] : MOTOR_1PH[col as '115'][idx];
    const plate = p.n('nameplate');
    const fla = plate > 0 ? plate : tableFla;
    if (plate > 0) warnings.push(`Nameplate ${plate} A is used for the conductor and overload; the table value is ${tableFla} A. Overcurrent maximums use the table current.`);
    const minAmp = fla * 1.25;
    const size = sizesFor('cu').find((s) => T2_CU[s][1] >= minAmp - 1e-9);
    if (!size) warnings.push('The motor current is above what a single 500 kcmil copper conductor carries at 75 °C; use parallel conductors.');
    const pct = { breaker: 250, delay: 175, fuse: 300 }[p.s('device') as 'breaker'];
    const maxDevice = (tableFla * pct) / 100;
    const std = stdAtMost(STD_OCPD, maxDevice);
    warnings.push(`If ${std ?? 'the'} A will not carry the starting current, Rule 28-200 allows a higher setting; check the Table 29 notes. Use the maximum that still starts the motor.`);
    const overload = fla * (p.b('sf') ? 1.25 : 1.15);
    const nemaIdx = three
      ? NEMA_3PH.find((r) => (volts === 208 ? r[1] : volts === 240 ? r[2] : r[3]) >= hp - 1e-6)
      : null;
    const nema1 = !three ? NEMA_1PH.find((r) => (volts === 120 ? r[1] : r[2]) >= hp - 1e-6) : null;
    const starterSize = three ? nemaIdx?.[0] : nema1?.[0];
    if (!starterSize) warnings.push('The motor is above NEMA size 6 (or size 3 single-phase); use a reduced-voltage or special starter.');
    const discA = fla * 1.15;
    const disc = three ? (discA <= 100 && volts <= 600 ? 'DISC-100A' : undefined) : discA <= 60 ? 'DISC-60A' : undefined;
    const len = p.n('length');
    const teckSize = size && TECK_SIZES.has(size) ? size : size === '14' ? '12' : size;
    const teckCode = three && teckSize && TECK_SIZES.has(teckSize) ? `TECK90-${teckSize}-3` : undefined;
    const small = starterSize === '00' || starterSize === '0' || starterSize === '1';
    const takeoff = compact([
      len > 0 && teckSize ? coreOrFree(teckCode, `Teck90 copper armoured cable ${teckSize}/${three ? 3 : 2} with ground`, round(len, 1), 'm') : null,
      starterSize ? (small && three ? core('STARTER-NEMA1', 1, { note: starterSize === '1' ? 'NEMA size 1' : `NEMA size ${starterSize} fits; size 1 is the smallest catalog starter` }) : free(`Motor starter, NEMA size ${starterSize}, with overload`, 1, 'ea')) : null,
      disc ? core(disc, 1) : free(`Safety switch rated at least ${fmt(discA, 0)} A`, 1, 'ea'),
    ]);
    return {
      summary: [
        { label: 'Full-load current', value: `${fmt(fla, 1)} A${plate > 0 ? ' (nameplate)' : ` (Table ${three ? 44 : 45})`}`, emphasis: true },
        { label: 'Minimum conductor', value: size ? `${awgLabel(size)} copper (75 °C, at least ${fmt(minAmp, 1)} A)` : 'parallel conductors' },
        { label: 'Overload setting', value: `${fmt(overload, 1)} A (${p.b('sf') ? 125 : 115}% of ${fmt(fla, 1)} A)` },
        { label: 'Maximum breaker or fuse', value: `${fmt(maxDevice, 0)} A calculated; ${std ?? 'below 15'} A standard` },
        { label: 'NEMA starter size', value: starterSize ? `Size ${starterSize}` : 'special' },
        { label: 'Disconnect', value: `at least ${fmt(discA, 0)} A (115% of full-load current)` },
      ],
      values: values({ hp, fla_a: round(fla, 2), table_fla_a: tableFla, min_conductor_ampacity_a: round(minAmp, 2), conductor_size: size ?? null, overload_a: round(overload, 2), max_device_pct: pct, max_device_a: round(maxDevice, 1), std_device_a: std, starter_size: starterSize ?? null, disconnect_a: round(discA, 1) }),
      takeoff,
      warnings,
      references: [
        'CEC 2024 Table 44 (three-phase) and Table 45 (single-phase) full-load currents',
        'CEC Rule 28-106 (conductors at 125% of full-load current) and Rule 28-104 (75 °C basis), Table 2',
        'CEC Rule 28-306 (overload), Rule 28-200 and Table 29 (branch-circuit protection)',
        'NEMA ICS 2 starter horsepower ratings for size selection; disconnect at 115% of full-load current (CEC Section 28 disconnecting means)',
      ],
    };
  },
};
