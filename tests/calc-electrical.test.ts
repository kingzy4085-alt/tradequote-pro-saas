// Worked examples for the electrical calculators. Each expected figure is hand-worked in a comment from the
// formula or the typed input it comes from; none of these tests touch the network or the cost engine.
import { describe, expect, it } from 'vitest';
import { CALCULATORS, getCalculator, runCalculator } from '@/lib/calc/registry';
import { CORE_ITEMS } from '@/lib/costbook/codes';
import { SIZES, awgNumber, conductorAreaMm2, resistanceOhmPerM, resistivityAt } from '@/lib/calc/electrical-data';

const run = (id: string, input: Record<string, number | string | boolean> = {}) => {
  const r = runCalculator(id, input);
  if (!r) throw new Error(`no calculator ${id}`);
  return r;
};
const ELECTRICAL = ['voltage-drop', 'conductor-size', 'conduit-fill', 'box-fill', 'motor-circuit', 'dwelling-load', 'residential-wiring-takeoff', 'ev-charger-circuit', 'transformer-sizing', 'lighting-layout'];

describe('electrical calculators: shape', () => {
  it('are registered in order with fully described fields', () => {
    expect(CALCULATORS.map((c) => c.id).slice(0, 10)).toEqual(ELECTRICAL);
    for (const id of ELECTRICAL) {
      const calc = getCalculator(id)!;
      expect(calc.trade).toBe('electrical');
      for (const f of calc.fields) {
        expect(f.label.length, `${id}.${f.key}`).toBeGreaterThan(2);
        if (f.type === 'number') {
          expect(f.min !== undefined && f.max !== undefined && f.step !== undefined, `${id}.${f.key} limits`).toBe(true);
          expect(Number(f.default)).toBeGreaterThanOrEqual(f.min!);
          expect(Number(f.default)).toBeLessThanOrEqual(f.max!);
        }
        if (f.type === 'select') expect(f.options!.map((o) => o.value)).toContain(String(f.default));
      }
    }
  });

  it('gives one emphasised summary line, first, with machine-readable values and references', () => {
    for (const id of ELECTRICAL) {
      const r = run(id);
      expect(r.summary.filter((s) => s.emphasis).length, id).toBe(1);
      expect(r.summary[0].emphasis, id).toBe(true);
      expect(r.references.length, id).toBeGreaterThan(0);
      for (const [k, v] of Object.entries(r.values)) {
        expect(['number', 'string', 'boolean'], `${id}.${k}`).toContain(typeof v);
        if (typeof v === 'number') expect(Number.isFinite(v), `${id}.${k}`).toBe(true);
      }
      for (const t of r.takeoff) if (t.code) expect(t.unit).toBe(CORE_ITEMS[t.code].unit);
    }
  });

  it('survive extreme and nonsense input, reporting what they changed', () => {
    for (const id of ELECTRICAL) {
      const calc = getCalculator(id)!;
      const huge = Object.fromEntries(calc.fields.map((f) => [f.key, f.type === 'number' ? 1e12 : f.type === 'boolean' ? 'maybe' : 'zzz']));
      const r = calc.run(huge);
      expect(r.warnings.length, id).toBeGreaterThan(0);
      const tiny = calc.run(Object.fromEntries(calc.fields.map((f) => [f.key, f.type === 'number' ? -5 : f.default])));
      expect(tiny.summary.length, id).toBeGreaterThan(0);
    }
  });
});


// Every figure typed into these tests below as a "code book" value is an arbitrary illustration chosen to make the
// arithmetic easy to follow. The calculators ship no code-book tables, so none of these numbers is a table row.
describe('conductor physics (no tables)', () => {
  // AWG diameter d = 0.127 mm x 92^((36-n)/39). 4/0 is n = -3, so d = 0.127 x 92 = 11.684 mm and the area is pi/4 x d2 = 107.2 mm2.
  it('computes conductor areas from the AWG formula and the kcmil factor', () => {
    expect(awgNumber('4/0')).toBe(-3);
    expect(awgNumber('1/0')).toBe(0);
    expect(awgNumber('250')).toBeNull();
    expect(conductorAreaMm2('4/0')).toBeCloseTo(107.22, 1);
    expect(conductorAreaMm2('12')).toBeCloseTo(3.309, 2); // d = 2.053 mm
    expect(conductorAreaMm2('250')).toBeCloseTo(126.675, 3); // 250 x 0.5067
    expect(conductorAreaMm2('nonsense')).toBe(0);
  });

  // Copper at 75 C: 0.017241 x (1 + 0.00393 x 55) = 0.020968 ohm.mm2/m; x 1.02 stranding / 3.309 mm2 = 0.006464 ohm/m for 12 AWG
  it('computes resistance from resistivity, temperature, stranding and area', () => {
    expect(resistivityAt('cu')).toBeCloseTo(0.020968, 5);
    expect(resistivityAt('al')).toBeCloseTo(0.034529, 5); // 0.028264 x (1 + 0.00403 x 55)
    expect(resistanceOhmPerM('12', 'cu')).toBeCloseTo(0.006464, 5);
    expect(resistanceOhmPerM('12', 'al')).toBeCloseTo(0.010644, 5);
    expect(resistanceOhmPerM('bogus', 'cu')).toBe(0);
    const r = SIZES.map((s) => resistanceOhmPerM(s, 'cu'));
    for (let i = 1; i < r.length; i++) expect(r[i], SIZES[i]).toBeLessThan(r[i - 1]);
  });
});

describe('voltage-drop', () => {
  // 30 m, 12 AWG copper (0.006464 ohm/m), 15 A, 120 V, pf 1: drop = 2 x 15 x 30 x 0.006464 = 5.817 V = 4.85%, over the 3% limit
  it('computes the 120 V single-phase default', () => {
    const r = run('voltage-drop');
    expect(r.values.voltage_drop_v).toBeCloseTo(5.817, 2);
    expect(r.values.voltage_drop_pct).toBeCloseTo(4.848, 2);
    expect(r.values.passes).toBe(false);
    expect(r.warnings.some((w) => w.includes('8-102'))).toBe(true);
  });

  // Worked examples hand-calculated before this rework, from a 12 AWG 1.98 ohm/1000 ft style figure. The physics lands within 3% of each.
  it('lands within 3% of the previously worked examples', () => {
    const cases: [string, Record<string, number | string>, number][] = [
      ['120 V default', {}, 5.847],
      ['480 V three-phase 3/0', { system: 'ac3-480', size: '3/0', length: 150, lengthUnit: 'ft', load: 100, pf: 1 }, 1.99],
      ['480 V 250 kcmil steel, pf 0.85', { system: 'ac3-480', size: '250', length: 100, lengthUnit: 'ft', load: 200, pf: 0.85, raceway: 'steel' }, 2.465],
      ['24 V DC', { system: 'dc', dcVolts: 24, load: 10, length: 20 }, 2.598],
      ['8 AWG default run', { size: '8' }, 2.297],
    ];
    for (const [label, input, old] of cases) {
      const v = Number(run('voltage-drop', input).values.voltage_drop_v);
      expect(Math.abs(v / old - 1), `${label}: ${v} vs ${old}`).toBeLessThan(0.03);
    }
  });

  it('keeps the summary Pass/Fail in step with values.passes, including the 5% total', () => {
    const verdict = (r: ReturnType<typeof run>) => r.summary.find((l) => l.value === 'Pass' || l.value === 'Fail')!.value;
    // 8 AWG passes on its own (1.92%), but 4% already used upstream makes the total 5.92%: over 5%
    const total = run('voltage-drop', { size: '8', upstream: 4 });
    expect(total.values.passes).toBe(false);
    expect(verdict(total)).toBe('Fail');
    const ok = run('voltage-drop', { size: '8' });
    expect(ok.values.passes).toBe(true);
    expect(verdict(ok)).toBe('Pass');
    expect(verdict(run('voltage-drop'))).toBe('Fail');
  });

  // 10 AWG (0.004065 ohm/m): 2 x 15 x 30 x 0.004065 = 3.659 V = 3.05%, still over; 8 AWG (0.002557): 2.301 V = 1.92%, passes
  it('finds the smallest size within 3% using the computed resistance', () => {
    expect(run('voltage-drop').values.smallest_size).toBe('8');
    expect(run('voltage-drop', { size: '10' }).values.voltage_drop_pct).toBeCloseTo(3.049, 2);
    expect(run('voltage-drop', { size: '8' }).values.voltage_drop_pct).toBeCloseTo(1.917, 2);
  });

  // 150 ft = 45.72 m, 3/0 copper (85.03 mm2, 0.0002515 ohm/m), 100 A: 1.732 x 100 x 45.72 x 0.0002515 = 1.992 V = 0.415% of 480 V
  it('uses 1.732 for three-phase', () => {
    const r = run('voltage-drop', { system: 'ac3-480', size: '3/0', length: 150, lengthUnit: 'ft', load: 100, pf: 1 });
    expect(r.values.voltage_drop_v).toBeCloseTo(1.992, 2);
    expect(r.values.voltage_drop_pct).toBeCloseTo(0.415, 2);
  });

  // 480 V, 200 A, 100 ft = 30.48 m, 250 kcmil (R = 0.020968 x 1.02 / 126.675 = 0.0001688 ohm/m), pf 0.85, sin = 0.5268, X = 0.17 ohm/km:
  // Z = 0.0001688 x 0.85 + 0.00017 x 0.5268 = 0.0002331 ohm/m; drop = 1.732 x 200 x 30.48 x 0.0002331 = 2.461 V
  it('adds reactance for a lagging power factor and says which reactance it used', () => {
    const base = { system: 'ac3-480', size: '250', length: 100, lengthUnit: 'ft', load: 200, pf: 0.85, raceway: 'steel' };
    const typical = run('voltage-drop', base);
    expect(typical.values.voltage_drop_v).toBeCloseTo(2.461, 2);
    expect(typical.values.reactance_entered).toBe(false);
    expect(typical.values.reactance_ohm_per_km).toBe(0.17);
    expect(typical.warnings.some((w) => w.includes('typical estimate'))).toBe(true);
    expect(typical.references.some((l) => l.includes('typical reactance estimate'))).toBe(true);
    // Entered reactance 0.25 ohm/km: Z = 0.0001435 + 0.00025 x 0.5268 = 0.0002752; drop = 1.732 x 200 x 30.48 x 0.0002752 = 2.906 V
    const entered = run('voltage-drop', { ...base, reactance: 0.25 });
    expect(entered.values.voltage_drop_v).toBeCloseTo(2.906, 2);
    expect(entered.values.reactance_entered).toBe(true);
    expect(entered.warnings.some((w) => w.includes('typical estimate'))).toBe(false);
    expect(entered.references.some((l) => l.includes('entered reactance'))).toBe(true);
    // Non-metallic wiring uses the lower typical figure, so a slightly smaller drop
    expect(Number(run('voltage-drop', { ...base, raceway: 'nonmag' }).values.voltage_drop_v)).toBeLessThan(2.461);
    // At pf 1 reactance drops out
    expect(run('voltage-drop', { ...base, pf: 1, reactance: 0.9 }).values.voltage_drop_v).toBeCloseTo(1.732 * 200 * 30.48 * 0.0001688, 2);
  });

  // DC 24 V, 10 A, 20 m, 12 AWG: 2 x 10 x 20 x 0.006464 = 2.585 V = 10.77%
  it('handles DC with resistance only', () => {
    const r = run('voltage-drop', { system: 'dc', dcVolts: 24, load: 10, length: 20 });
    expect(r.values.voltage_drop_v).toBeCloseTo(2.585, 2);
    expect(r.values.voltage_drop_pct).toBeCloseTo(10.773, 2);
  });

  it('flags the 5% total including upstream drop', () => {
    const r = run('voltage-drop', { size: '8', upstream: 4 }); // 1.92% + 4% = 5.92%
    expect(r.values.total_pct).toBeCloseTo(5.917, 2);
    expect(r.warnings.some((w) => w.includes('5% limit'))).toBe(true);
  });

  // Aluminum 12 AWG: 0.034529 x 1.02 / 3.309 = 0.010644 ohm/m; 2 x 15 x 30 x 0.010644 = 9.58 V
  it('corrects aluminum below 12 AWG and computes aluminum resistance', () => {
    const r = run('voltage-drop', { material: 'al', size: '14' });
    expect(r.values.size).toBe('12');
    expect(r.warnings.some((w) => w.includes('aluminum'))).toBe(true);
    expect(r.values.voltage_drop_v).toBeCloseTo(9.58, 2);
  });

  it('takes off conductors x length only when a length is given, using catalog codes', () => {
    const r = run('voltage-drop'); // 2 conductors x 30 m
    expect(r.takeoff).toEqual([expect.objectContaining({ code: 'CU-RW90-12', quantity: 60, unit: 'm' })]);
    const three = run('voltage-drop', { system: 'ac3-600', size: '300', length: 50 }); // no catalog code for 300 kcmil
    expect(three.takeoff[0]).toMatchObject({ quantity: 150, unit: 'm' });
    expect(three.takeoff[0].code).toBeUndefined();
  });

  it('says so when no size can meet the limit', () => {
    const r = run('voltage-drop', { system: 'ac1-120', load: 400, length: 2000, size: '500' });
    expect(r.values.smallest_size).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('parallel'))).toBe(true);
  });
});

describe('conductor-size (conductor check)', () => {
  // 12 AWG copper, 18 A continuous: needs 22.5 A. A typed 75 C ampacity of 25 A would pass, but Rule 14-104 caps 12 AWG copper at 20 A
  it('judges against the small-conductor limit and caps the overcurrent device at it', () => {
    const r = run('conductor-size', { load: 18, continuous: true, method: 'raceway', size: '12', material: 'cu', termination: '75', tableAmpacity: 25 });
    expect(r.values).toMatchObject({ passes: false, required_ampacity_a: 22.5, usable_ampacity_a: 20, small_conductor_limit_a: 20, ocpd_a: 20 });
    expect(r.summary[0].value).toBe('Fail');
    expect(r.values.ocpd_a).not.toBe(25);
    // The capped device is never shown as if it suited the load
    expect(r.summary.find((s) => s.label === 'Smallest standard overcurrent device')?.value).toContain('the load needs 25 A, so use a larger conductor');
    // A load that fits under the limit still passes, and the device stays within it
    const ok = run('conductor-size', { load: 12, continuous: true, size: '12', material: 'cu', termination: '75', tableAmpacity: 25 });
    expect(ok.values).toMatchObject({ passes: true, usable_ampacity_a: 20, ocpd_a: 15 });
    // With no size chosen there is no limit to apply
    expect(run('conductor-size', { load: 18, tableAmpacity: 25 }).values.small_conductor_limit_a).toBeUndefined();
  });

  it('asks for the code book ampacity on the defaults instead of guessing one', () => {
    const r = run('conductor-size');
    expect(r.summary[0].value).toBe('Enter the code book ampacity');
    expect(r.values.passes).toBeUndefined();
    expect(r.values.required_ampacity_a).toBe(50); // 40 A continuous / 0.8
    expect(r.values.continuous_factor).toBe(0.8);
    expect(r.warnings.some((w) => w.includes('Enter the conductor ampacity'))).toBe(true);
    expect(r.takeoff).toEqual([]);
  });

  // 40 A continuous in a raceway at 80% needs 40 / 0.8 = 50 A. A typed 55 A passes with 5 A to spare; 45 A fails.
  it('applies the continuous-load factor to the typed ampacity', () => {
    const ok = run('conductor-size', { tableAmpacity: 55 });
    expect(ok.values).toMatchObject({ passes: true, required_ampacity_a: 50, corrected_ampacity_a: 55, usable_ampacity_a: 55, margin_a: 5, ocpd_a: 50 });
    expect(ok.summary[0].value).toBe('Pass');
    const bad = run('conductor-size', { tableAmpacity: 45 });
    expect(bad.values.passes).toBe(false);
    expect(bad.summary[0].value).toBe('Fail');
    expect(bad.warnings.some((w) => w.includes('below the 50 A required'))).toBe(true);
    expect(run('conductor-size', { tableAmpacity: 50 }).values.passes).toBe(true); // exactly equal passes
  });

  it('uses 100% for equipment marked for it, and no factor for a non-continuous load', () => {
    expect(run('conductor-size', { rating: '100' }).values.required_ampacity_a).toBe(40);
    const non = run('conductor-size', { continuous: false });
    expect(non.values.continuous_factor).toBe(1);
    expect(non.values.required_ampacity_a).toBe(40);
  });

  // Free air: 35 A / 0.7 = 50 A; marked for 100%: 35 / 0.85 = 41.18 A
  it('applies 70% / 85% continuous factors in free air and 80% / 100% in a raceway', () => {
    expect(run('conductor-size', { load: 35, method: 'air' }).values).toMatchObject({ continuous_factor: 0.7, required_ampacity_a: 50 });
    expect(run('conductor-size', { load: 35, method: 'air', rating: '100' }).values).toMatchObject({ continuous_factor: 0.85 });
    expect(run('conductor-size', { load: 35, method: 'air', rating: '100' }).values.required_ampacity_a).toBeCloseTo(41.18, 2);
    expect(run('conductor-size', { load: 40, method: 'raceway', rating: '100' }).values.continuous_factor).toBe(1);
  });

  // 100 A typed x 0.88 ambient x 0.8 derating = 70.4 A. 56 A continuous needs 70 A: passes. 0.79 derating gives 69.5 A: fails.
  it('multiplies the typed ambient and derating factors', () => {
    const r = run('conductor-size', { load: 56, tableAmpacity: 100, ambientFactor: 0.88, derating: 0.8 });
    expect(r.values.corrected_ampacity_a).toBe(70.4);
    expect(r.values.passes).toBe(true);
    const low = run('conductor-size', { load: 56, tableAmpacity: 100, ambientFactor: 0.88, derating: 0.79 });
    expect(low.values.corrected_ampacity_a).toBe(69.5);
    expect(low.values.passes).toBe(false);
  });

  // Typed 100 A with a 75 A limit at the termination column: the 75 A governs. 50 A non-continuous passes; 80 A fails.
  it('limits the result to the ampacity at the termination temperature', () => {
    const r = run('conductor-size', { continuous: false, load: 50, tableAmpacity: 100, terminationAmpacity: 75, termination: '75' });
    expect(r.values).toMatchObject({ usable_ampacity_a: 75, termination_ampacity_a: 75, passes: true });
    expect(r.warnings.some((w) => w.includes('governs'))).toBe(true);
    expect(run('conductor-size', { continuous: false, load: 80, tableAmpacity: 100, terminationAmpacity: 75 }).values.passes).toBe(false);
    // Termination ampacity above the corrected one does not raise it
    expect(run('conductor-size', { continuous: false, load: 10, tableAmpacity: 40, terminationAmpacity: 90 }).values.usable_ampacity_a).toBe(40);
  });

  it('warns about the small-conductor overcurrent limit and impossible ambient', () => {
    const small = run('conductor-size', { size: '12', tableAmpacity: 30 });
    expect(small.warnings.some((w) => w.includes('20 A') && w.includes('14-104'))).toBe(true);
    expect(run('conductor-size', { size: '10', material: 'al', tableAmpacity: 30 }).warnings.some((w) => w.includes('25 A'))).toBe(true);
    expect(run('conductor-size', { tableAmpacity: 30, ambientFactor: 0 }).warnings.some((w) => w.includes('no ampacity'))).toBe(true);
  });

  it('takes off wire only when the user also chooses a size, and the size never changes the ampacity', () => {
    expect(run('conductor-size', { tableAmpacity: 55, length: 10 }).takeoff).toEqual([]); // no size chosen
    expect(run('conductor-size', { tableAmpacity: 55, size: '8' }).takeoff).toEqual([]); // no length
    const r = run('conductor-size', { tableAmpacity: 55, size: '8', length: 10, conductors: 3 });
    expect(r.takeoff).toEqual([expect.objectContaining({ code: 'CU-RW90-8', quantity: 30, unit: 'm' })]);
    expect(r.values.size).toBe('8');
    const other = run('conductor-size', { tableAmpacity: 55, size: '500', length: 10, material: 'al' });
    expect(other.takeoff[0]).toMatchObject({ code: 'AL-RW90-500', quantity: 20 });
    expect(other.values.usable_ampacity_a).toBe(r.values.usable_ampacity_a);
    expect(run('conductor-size', { tableAmpacity: 55, size: '300', length: 5 }).takeoff[0].code).toBeUndefined();
  });
});

describe('conduit-fill', () => {
  // The shipped defaults are blank; these are the datasheet diameters a user would type
  const typed = { conductorOd: 4.5, conduitId: 16 };
  // 4.5 mm conductors: 4 x pi/4 x 4.5^2 = 4 x 15.904 = 63.62 mm2. 16 mm conduit: 201.06 mm2, so 31.6% against the 40% limit
  it('checks fill from the diameters you enter', () => {
    const r = run('conduit-fill', typed);
    expect(r.values).toMatchObject({ passes: true, limit_pct: 40, conductors: 4 });
    expect(r.values.conductor_area_mm2).toBeCloseTo(63.62, 2);
    expect(r.values.conduit_area_mm2).toBeCloseTo(201.1, 1);
    expect(r.values.fill_pct).toBeCloseTo(31.64, 2);
    expect(r.values.allowed_area_mm2).toBeCloseTo(80.4, 1);
    expect(r.summary[0].value).toBe('Pass');
  });

  // One 12 mm conductor: 113.1 / 201.06 = 56.2% fails 53%; a 10 mm one is 78.54 / 201.06 = 39.1% and passes
  it('uses 53% for one conductor', () => {
    const fail = run('conduit-fill', { ...typed, count: 1, conductorOd: 12 });
    expect(fail.values.limit_pct).toBe(53);
    expect(fail.values.fill_pct).toBeCloseTo(56.25, 1);
    expect(fail.values.passes).toBe(false);
    expect(fail.warnings.some((w) => w.includes('over the 53% limit'))).toBe(true);
    expect(run('conduit-fill', { ...typed, count: 1, conductorOd: 10 }).values).toMatchObject({ passes: true });
  });

  // Two 6 mm: 56.55 / 201.06 = 28.1% passes 31%; two 8 mm: 100.5 / 201.06 = 50% fails.
  // Three 5.8 mm: 79.27 / 201.06 = 39.4% passes 40%; three 6 mm: 84.82 / 201.06 = 42.2% fails.
  it('uses 31% for two conductors and 40% beyond', () => {
    expect(run('conduit-fill', { ...typed, count: 2, conductorOd: 6 }).values).toMatchObject({ limit_pct: 31, passes: true });
    expect(run('conduit-fill', { ...typed, count: 2, conductorOd: 8 }).values).toMatchObject({ limit_pct: 31, passes: false });
    expect(run('conduit-fill', { ...typed, count: 3, conductorOd: 5.8 }).values).toMatchObject({ limit_pct: 40, passes: true });
    expect(run('conduit-fill', { ...typed, count: 3, conductorOd: 6 }).values).toMatchObject({ limit_pct: 40, passes: false });
  });

  // Smallest internal diameter: OD x sqrt(n / limit) = 4.5 x sqrt(4 / 0.4) = 14.23 mm. A conduit of that diameter is exactly full to the limit.
  // Most conductors of 4.5 mm in 16 mm: 5 x 15.904 = 79.5 <= 80.4, but 6 x 15.904 = 95.4 is over
  it('reports the smallest internal diameter and the most conductors that fit', () => {
    const r = run('conduit-fill', typed);
    expect(r.values.min_conduit_id_mm).toBeCloseTo(14.23, 2);
    expect(r.values.max_conductors).toBe(5);
    const exact = run('conduit-fill', { ...typed, conduitId: Number(r.values.min_conduit_id_mm) });
    expect(exact.values.fill_pct).toBeCloseTo(40, 0);
  });

  it('takes off conduit, couplings, connectors and wire, from the trade size chosen for pricing', () => {
    const r = run('conduit-fill', typed); // 15 m of 1/2 in EMT: 4 couplings (every 3 m, less one), 2 connectors, 4 x 15 m of 12 AWG
    expect(r.takeoff.map((t) => t.code)).toEqual(['EMT-1/2', 'EMT-COUP-1/2', 'EMT-CONN-1/2', 'CU-RW90-12']);
    expect(r.takeoff.map((t) => t.quantity)).toEqual([15, 4, 2, 60]);
    const runs = run('conduit-fill', { ...typed, runs: 2, length: 10, tradeSize: '1', conduit: 'pvc', count: 3 });
    expect(runs.takeoff[0]).toMatchObject({ code: 'PVC-1', quantity: 20 });
    expect(runs.takeoff.find((t) => t.code === 'CU-RW90-12')!.quantity).toBe(60);
  });

  it('falls back to code-less lines for trade sizes the catalog does not carry, and the trade size does not change the fill', () => {
    const r = run('conduit-fill', { ...typed, tradeSize: '3', conduit: 'pvc' });
    expect(r.takeoff[0].code).toBeUndefined();
    expect(r.takeoff[0].description).toContain('3 in');
    expect(r.values.fill_pct).toBe(run('conduit-fill', typed).values.fill_pct);
  });

  it('says so when there are no conductors, and when they do not fit', () => {
    const none = run('conduit-fill', { ...typed, count: 0 });
    expect(none.warnings.some((w) => w.includes('at least one conductor'))).toBe(true);
    expect(none.values.passes).toBeUndefined();
    const big = run('conduit-fill', { ...typed, count: 30, conductorOd: 10 });
    expect(big.values.passes).toBe(false);
    expect(big.warnings.some((w) => w.includes('internal diameter of at least'))).toBe(true);
  });

  it('shows no verdict on load: both diameters default to 0 until entered', () => {
    const r = run('conduit-fill');
    expect(r.values.passes).toBeUndefined();
    expect(r.values.fill_pct).toBeUndefined();
    expect(r.summary[0].value).toBe('Enter the diameters');
    expect(r.summary[0].value).not.toBe('Pass');
    expect(r.warnings.some((w) => w.includes('conductor outside diameter') && w.includes('conduit internal diameter'))).toBe(true);
    const odOnly = run('conduit-fill', { conductorOd: 4.5 });
    expect(odOnly.values.passes).toBeUndefined();
    expect(odOnly.warnings.some((w) => w.includes('conduit internal diameter'))).toBe(true);
    const idOnly = run('conduit-fill', { conduitId: 16 });
    expect(idOnly.values.passes).toBeUndefined();
  });
});

describe('box-fill', () => {
  // Illustrative allowances: 4 x 14 AWG at 24 mL = 96, one device at 48 = 48, box marked 200 mL: required 144, 56 mL left
  it('adds the allowances you enter and compares them with the marked volume', () => {
    const r = run('box-fill', { boxMl: 200, ml14: 24, deviceMl: 48 });
    expect(r.values).toMatchObject({ required_ml: 144, conductors_ml: 96, devices_ml: 48, box_ml: 200, remaining_ml: 56, passes: true });
    expect(r.summary[0].value).toBe('Pass');
  });

  // 3 x 14 AWG at 24 = 72; 2 x 12 AWG at 28 = 56; 1 device at 56; 2 clamp sets at 12 = 24; other 10: total 218 mL
  it('handles mixed sizes, devices, clamps and other allowances', () => {
    const r = run('box-fill', { boxMl: 218, n14: 3, ml14: 24, n12: 2, ml12: 28, devices: 1, deviceMl: 56, clamps: 2, clampMl: 12, otherMl: 10 });
    expect(r.values).toMatchObject({ required_ml: 218, clamps_ml: 24, remaining_ml: 0, passes: true });
    expect(run('box-fill', { boxMl: 217.9, n14: 3, ml14: 24, n12: 2, ml12: 28, devices: 1, deviceMl: 56, clamps: 2, clampMl: 12, otherMl: 10 }).values.passes).toBe(false);
  });

  it('fails a box that is too small and says so', () => {
    const r = run('box-fill', { boxMl: 100, ml14: 24, deviceMl: 48 });
    expect(r.values.passes).toBe(false);
    expect(r.summary[0].value).toBe('Fail');
    expect(r.values.remaining_ml).toBe(-44);
    expect(r.warnings.some((w) => w.includes('Use a larger box'))).toBe(true);
  });

  it('ships no volumes: defaults need the box volume and the allowances typed in', () => {
    const r = run('box-fill');
    expect(r.values.required_ml).toBe(0);
    expect(r.values.passes).toBeUndefined();
    expect(r.summary[0].value).toBe('Enter the box volume');
    expect(r.warnings.some((w) => w.includes('no allowance was entered for 14 AWG'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('no allowance per device'))).toBe(true);
    expect(r.takeoff).toEqual([]);
  });

  it('gives no verdict while any counted item has no allowance, and says which to enter', () => {
    // Box volume entered, but the 14 AWG conductors (4 by default) and the device have no allowance
    const r = run('box-fill', { boxMl: 500 });
    expect(r.values.passes).toBeUndefined();
    expect(r.values.remaining_ml).toBeUndefined();
    expect(r.summary[0].value).toBe('Enter the allowances');
    expect(r.warnings.some((w) => w.includes('No pass or fail') && w.includes('14 AWG allowance') && w.includes('allowance per device'))).toBe(true);
    // Conductors covered but the device is not
    const noDevice = run('box-fill', { boxMl: 500, ml14: 24 });
    expect(noDevice.values.passes).toBeUndefined();
    expect(noDevice.warnings.some((w) => w.includes('allowance per device'))).toBe(true);
    // A second conductor size counted without its allowance
    const mixed = run('box-fill', { boxMl: 500, ml14: 24, deviceMl: 48, n12: 2 });
    expect(mixed.values.passes).toBeUndefined();
    expect(mixed.warnings.some((w) => w.includes('12 AWG allowance'))).toBe(true);
    // Clamps counted without an allowance
    expect(run('box-fill', { boxMl: 500, ml14: 24, deviceMl: 48, clamps: 1 }).values.passes).toBeUndefined();
    // Never prices a box without a verdict
    expect(run('box-fill', { boxMl: 500, boxType: 'BOX-4SQ' }).takeoff).toEqual([]);
    // Once every counted item has an allowance the verdict returns
    expect(run('box-fill', { boxMl: 500, ml14: 24, deviceMl: 48, n12: 2, ml12: 28 }).values.passes).toBe(true);
  });

  it('warns about counted clamps without an allowance', () => {
    expect(run('box-fill', { boxMl: 100, clamps: 1 }).warnings.some((w) => w.includes('no allowance per clamp set'))).toBe(true);
  });

  it('prices only a box the user chose, and only when it passes', () => {
    const ok = run('box-fill', { boxMl: 500, ml14: 24, deviceMl: 48, boxType: 'BOX-4SQ', qty: 3 });
    expect(ok.takeoff).toEqual([expect.objectContaining({ code: 'BOX-4SQ', quantity: 3, unit: 'ea' })]);
    expect(run('box-fill', { boxMl: 100, ml14: 24, deviceMl: 48, boxType: 'BOX-4SQ' }).takeoff).toEqual([]);
    expect(run('box-fill', { boxMl: 500, ml14: 24, deviceMl: 48 }).takeoff).toEqual([]);
  });
});

describe('motor-circuit', () => {
  it('asks for the code book full-load current and percentage on the defaults', () => {
    const r = run('motor-circuit');
    expect(r.summary[0].value).toBe('Enter the full-load current');
    expect(r.values.max_device_a).toBeUndefined();
    expect(r.values.starter_size).toBe('0'); // NEMA sizing needs no code book table: 5 hp at 600 V
    expect(r.takeoff.map((t) => t.code)).toEqual(['STARTER-NEMA1']);
    expect(r.warnings.some((w) => w.includes('Enter the full-load current'))).toBe(true);
  });

  // Typed 32 A: x 125% = 40 A minimum conductor ampacity; typed 250% device: 32 x 2.5 = 80 A; 30 hp at 600 V is NEMA size 3
  it('applies 125% to the full-load current, the typed percentage to the device, and sizes the starter', () => {
    const r = run('motor-circuit', { hp: '30', supply: '3ph-600', tableFla: 32, maxPct: 250 });
    expect(r.values).toMatchObject({ fla_a: 32, min_conductor_ampacity_a: 40, max_device_pct: 250, max_device_a: 80, std_device_a: 80, starter_size: '3' });
    expect(r.values.overload_a).toBeUndefined();
    expect(r.takeoff.some((t) => t.code === 'STARTER-NEMA1')).toBe(false);
    expect(run('motor-circuit', { hp: '30', supply: '3ph-600', tableFla: 32, nameplate: 32 }).values.overload_a).toBe(40);
  });

  // Typed 99 A x 125% = 123.75 A. A typed conductor ampacity of 130 A passes; 120 A fails
  it('checks a conductor ampacity you enter against 125%', () => {
    const base = { hp: '100', supply: '3ph-600', tableFla: 99 };
    const ok = run('motor-circuit', { ...base, conductorAmpacity: 130 });
    expect(ok.values).toMatchObject({ min_conductor_ampacity_a: 123.75, conductor_passes: true });
    const bad = run('motor-circuit', { ...base, conductorAmpacity: 120 });
    expect(bad.values.conductor_passes).toBe(false);
    expect(bad.warnings.some((w) => w.includes('below the 123.8 A required'))).toBe(true);
    expect(run('motor-circuit', base).values.conductor_passes).toBeUndefined();
  });

  // Typed 6.1 A, 250%: 15.25 A so the 15 A standard rating; NEMA size 0 starter takes the size 1 catalog item; priced Teck90 12/3 for 20 m
  it('takes off Teck90 only for the size the user chose, plus starter and disconnect', () => {
    const r = run('motor-circuit', { tableFla: 6.1, maxPct: 250, conductorSize: '12' });
    expect(r.values.std_device_a).toBe(15);
    expect(r.values.starter_size).toBe('0');
    expect(r.takeoff.map((t) => t.code)).toEqual(['TECK90-12-3', 'STARTER-NEMA1', 'DISC-100A']);
    expect(r.takeoff[0].quantity).toBe(20);
    expect(run('motor-circuit', { tableFla: 6.1, conductorSize: '1/0' }).takeoff[0].code).toBeUndefined(); // no catalog Teck90 1/0
    expect(run('motor-circuit', { tableFla: 6.1 }).takeoff.some((t) => t.description.includes('Teck90'))).toBe(false);
  });

  it('sizes single-phase starters and disconnects from the typed current', () => {
    const r = run('motor-circuit', { hp: '2', supply: '1ph-240', tableFla: 12 });
    expect(r.values.starter_size).toBe('0'); // NEMA size 0 is rated for 2 hp at 230 V single-phase
    expect(r.takeoff.some((t) => t.code === 'DISC-60A')).toBe(true); // 12 x 1.15 = 13.8 A
  });

  it('shows no overload figure without a nameplate and warns', () => {
    const r = run('motor-circuit', { tableFla: 6.1 });
    expect(r.values.overload_a).toBeUndefined();
    expect(r.summary.find((l) => l.label === 'Overload setting')!.value).toContain('nameplate');
    expect(r.warnings.some((w) => w.includes('No nameplate current entered'))).toBe(true);
    expect(r.values.fla_a).toBe(r.values.table_fla_a); // conductor still sized from the code book current
    expect(r.values.min_conductor_ampacity_a).toBeCloseTo(6.1 * 1.25, 2);
  });

  it('sets the overload at 125% of nameplate with a service factor of 1.15 or more', () => {
    expect(run('motor-circuit', { nameplate: 10, sf: true }).values.overload_a).toBeCloseTo(12.5, 2);
  });

  it('uses the nameplate for the overload, 115% without the service factor', () => {
    const r = run('motor-circuit', { nameplate: 10, sf: false, tableFla: 6.1 });
    expect(r.values.overload_a).toBeCloseTo(11.5, 2);
    expect(r.values.fla_a).toBe(10);
    expect(r.values.table_fla_a).toBe(6.1);
  });

  it('needs the code book current as well as the nameplate for the maximum device', () => {
    const r = run('motor-circuit', { nameplate: 10, maxPct: 250 });
    expect(r.values.max_device_a).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('Only the nameplate current was entered'))).toBe(true);
  });

  // Typed 11 A: 175% = 19.25 A (15 A standard), 300% = 33 A (30 A standard)
  it('uses whatever percentage is typed, whatever the device type', () => {
    expect(run('motor-circuit', { tableFla: 11, device: 'delay', maxPct: 175 }).values).toMatchObject({ max_device_pct: 175, std_device_a: 15 });
    const f = run('motor-circuit', { tableFla: 11, device: 'fuse', maxPct: 300 });
    expect(f.values.max_device_a).toBeCloseTo(33, 1);
    expect(f.values.std_device_a).toBe(30);
    expect(f.summary.find((l) => l.label === 'Maximum breaker or fuse')!.value).toContain('non-time-delay fuse');
  });
});

describe('dwelling-load', () => {
  it('bills the main breaker once: the catalog loadcentre already includes it', () => {
    const inputs: Record<string, number>[] = [{}, { ground: 70, basement: 0, range: 0, waterHeater: 0, dryer: 0 }, { heat: 20, evse: 11.5 }];
    for (const input of inputs) {
      const takeoff = run('dwelling-load', input).takeoff;
      expect(takeoff.filter((t) => t.code?.startsWith('PANEL-'))).toHaveLength(1);
      expect(takeoff.some((t) => t.code?.startsWith('BKR-'))).toBe(false);
    }
  });

  // 150 m2 ground + 75% of 100 m2 basement = 225 m2: basic 5000 + 1000 x ceil(135/90 = 1.5 -> 2) = 7000 W
  // heat 15 kW: 10,000 + 75% x 5,000 = 13,750; range 12 kW = 6,000; EV 7,200 at 100%;
  // dryer 5,000 + storage water heater 3,000, both over 1,500 W, at 25% with a range = 2,000. Total 35,950 W = 149.8 A
  it('matches a hand-worked Rule 8-200 example', () => {
    const r = run('dwelling-load', { ground: 150, upper: 0, basement: 100, heat: 15, ac: 0, range: 12, waterHeater: 3, dryer: 5, evse: 7.2, other: 0 });
    expect(r.values.living_area_m2).toBe(225);
    expect(r.values.basic_load_w).toBe(7000);
    expect(r.values.heating_cooling_w).toBe(13750);
    expect(r.values.calculated_w).toBe(35950);
    expect(r.values.calculated_a).toBeCloseTo(149.8, 1);
    expect(r.values.service_a).toBe(150);
    expect(r.takeoff.map((t) => t.code)).toEqual(['PANEL-200A', 'METER-200A']);
  });

  // Same dwelling with a 7 kW hot tub at 100%: +7,000 W -> 42,950 W = 178.96 A, which moves the 150 A service up to 200 A
  it('counts a hot tub, spa or pool heater at 100% in its own field', () => {
    const base = { ground: 150, upper: 0, basement: 100, heat: 15, ac: 0, range: 12, waterHeater: 3, dryer: 5, evse: 7.2, other: 0 };
    const a = run('dwelling-load', base);
    const b = run('dwelling-load', { ...base, spa: 7 });
    expect(Number(b.values.calculated_w) - Number(a.values.calculated_w)).toBe(7000);
    expect(b.values.calculated_w).toBe(42950);
    expect(a.values.service_a).toBe(150);
    expect(b.values.service_a).toBe(200);
    // the old "other loads" route only counted 25% of it
    const viaOther = run('dwelling-load', { ...base, other: 7 });
    expect(Number(viaOther.values.calculated_w) - Number(a.values.calculated_w)).toBe(1750);
  });

  it('applies the 100 A minimum for 80 m2 or more and 60 A below', () => {
    const big = run('dwelling-load');
    expect(big.values.item_a_w).toBeLessThan(24000);
    expect(big.values.calculated_w).toBe(24000);
    expect(big.values.service_a).toBe(100);
    const small = run('dwelling-load', { ground: 70, basement: 0, range: 0, waterHeater: 0, dryer: 0 });
    expect(small.values.calculated_w).toBe(14400);
    expect(small.values.service_a).toBe(60);
  });

  it('adds 40% of a range over 12 kW and treats no range differently', () => {
    expect(run('dwelling-load', { range: 14 }).values.range_w).toBe(6800); // 6000 + 40% x 2000
    // no range: dryer 5 + water heater 3 = 8,000 W; 100% of the first 6,000 + 25% of the other 2,000 = 6,500
    expect(run('dwelling-load', { range: 0 }).values.other_demand_w).toBe(6500);
  });

  it('counts heating and cooling together unless interlocked', () => {
    expect(run('dwelling-load', { heat: 10, ac: 4 }).values.heating_cooling_w).toBe(14000);
    expect(run('dwelling-load', { heat: 10, ac: 4, interlock: true }).values.heating_cooling_w).toBe(10000);
  });

  it('counts a tankless heater at 100% and leaves out basements under 1.8 m', () => {
    expect(run('dwelling-load', { tankless: true, waterHeater: 6 }).values.tankless_w).toBe(6000);
    expect(run('dwelling-load', { basement: 90, basementHigh: false }).values.living_area_m2).toBe(90);
  });

  it('sizes up large loads and warns beyond 600 A', () => {
    expect(run('dwelling-load', { heat: 60, ground: 300, upper: 200 }).values.service_a).toBeGreaterThanOrEqual(200);
  });
});

describe('residential-wiring-takeoff', () => {
  // 150 m2, 2 baths, 3 bedrooms + 3 other rooms: room area = (150 - 14 - 10) x 0.88 / 6 = 18.5 m2;
  // usable wall = 4 x sqrt(18.5) - 2 = 15.2 m; 15.2 / 3.6 = 4.2 -> 5 receptacles per room
  it('derives receptacles per room from the 1.8 m rule', () => {
    const r = run('residential-wiring-takeoff');
    expect(r.values.receptacles_per_room).toBe(5);
    expect(r.values.gfci).toBe(8); // 2 baths + 2 counter + 2 garage + 2 exterior
  });

  // Smoke alarms: 2 storeys + 3 bedrooms = 5, one of them combined with CO for the fuel-fired appliance
  it('counts smoke and CO alarms', () => {
    const r = run('residential-wiring-takeoff');
    expect(r.values.smoke_alarms).toBe(5);
    expect(r.values.co_alarms).toBe(1);
    expect(r.takeoff.find((t) => t.code === 'SMOKE-AC')?.quantity).toBe(4);
    expect(r.takeoff.find((t) => t.code === 'SMOKE-CO-AC')?.quantity).toBe(1);
    expect(run('residential-wiring-takeoff', { fuel: false }).values.co_alarms).toBe(0);
  });

  it('counts more devices, circuits and cable for a bigger house', () => {
    const small = run('residential-wiring-takeoff', { area: 80, bedrooms: 2, bathrooms: 1, rooms: 2, storeys: 1, pots: 0 });
    const big = run('residential-wiring-takeoff', { area: 400, bedrooms: 5, bathrooms: 4, rooms: 6, storeys: 3 });
    for (const k of ['circuits', 'receptacles', 'cable_14_2_m', 'lighting_outlets']) expect(Number(big.values[k]), k).toBeGreaterThan(Number(small.values[k]));
    expect(small.values.dimmers).toBe(0);
    expect(big.values.dimmers).toBe(2); // 12 pot lights / 8 per dimmer
  });

  it('widens AFCI protection with the chosen scope and adds an EV breaker', () => {
    const bedrooms = Number(run('residential-wiring-takeoff', { afci: 'bedrooms' }).values.afci_breakers);
    const living = Number(run('residential-wiring-takeoff', { afci: 'living' }).values.afci_breakers);
    const all = Number(run('residential-wiring-takeoff', { afci: 'all' }).values.afci_breakers);
    expect(living).toBeGreaterThan(bedrooms);
    expect(all).toBeGreaterThanOrEqual(living);
    expect(run('residential-wiring-takeoff', { ev: true }).takeoff.some((t) => t.code === 'BKR-2P-60A')).toBe(true);
  });

  it('uses only catalog codes and whole numbers for counted items', () => {
    const r = run('residential-wiring-takeoff');
    for (const t of r.takeoff) {
      expect(t.code, t.description).toBeDefined();
      if (t.unit === 'ea') expect(Number.isInteger(t.quantity), t.code).toBe(true);
    }
  });
});


describe('ev-charger-circuit', () => {
  // 40 A x 125% = 50 A: 50 A breaker. No size is chosen by default, so no wire and no ampacity claim.
  // 12 AWG over 15 m: 2 x 40 x 15 x 0.006464 = 7.76 V = 3.23% of 240 V (over 3%); 10 AWG (0.004065): 4.88 V = 2.03%, the smallest within 3%
  it('sizes the breaker at 125% and takes the conductor from the user, never from a table', () => {
    const r = run('ev-charger-circuit');
    expect(r.values).toMatchObject({ breaker_a: 50, required_ampacity_a: 50, min_size_for_drop: '10' });
    expect(r.values.conductor_size).toBeUndefined();
    expect(r.takeoff.map((t) => t.code)).toEqual(['EVSE-L2-48A', 'BKR-2P-50A']);
    expect(r.warnings.some((w) => w.includes('Choose a conductor size'))).toBe(true);
  });

  // 8 AWG (0.002557 ohm/m): 2 x 40 x 15 x 0.002557 = 3.07 V = 1.28%. Priced 3 x 15 m = 45 m
  it('computes the drop and prices the size the user chose', () => {
    const r = run('ev-charger-circuit', { size: '8' });
    expect(r.values.conductor_size).toBe('8');
    expect(r.values.voltage_drop_pct).toBeCloseTo(1.28, 2);
    expect(r.takeoff.map((t) => t.code)).toEqual(['EVSE-L2-48A', 'BKR-2P-50A', 'CU-RW90-8']);
    expect(r.takeoff[2].quantity).toBe(45);
  });

  // Typed conductor ampacity 55 A covers 50 A; 45 A does not, and is also below the 50 A breaker
  it('checks a conductor ampacity the user typed against 125%', () => {
    expect(run('ev-charger-circuit', { size: '8', conductorAmpacity: 55 }).values.conductor_passes).toBe(true);
    const bad = run('ev-charger-circuit', { size: '8', conductorAmpacity: 45 });
    expect(bad.values.conductor_passes).toBe(false);
    expect(bad.warnings.some((w) => w.includes('below the 50 A required'))).toBe(true);
    expect(bad.warnings.some((w) => w.includes('50 A breaker is above'))).toBe(true);
    expect(run('ev-charger-circuit').values.conductor_passes).toBeUndefined();
  });

  // 48 A x 125% = 60 A. 6 AWG over 60 m (0.001608 ohm/m): 2 x 48 x 60 x 0.001608 = 9.26 V = 3.86%, over 3%; 4 AWG (0.001011 ohm/m): 5.83 V = 2.43%, the smallest within 3%.
  // Service 100 A with 80 A used leaves 20 A, 28 A short
  it('flags a drop over 3% and a service shortfall with the EVEMS option', () => {
    const r = run('ev-charger-circuit', { charger: 48, distance: 60, existing: 80, size: '6' });
    expect(r.values.breaker_a).toBe(60);
    expect(r.values.voltage_drop_pct).toBeCloseTo(3.86, 2);
    expect(r.values.min_size_for_drop).toBe('4');
    expect(r.warnings.some((w) => w.includes('over 3%'))).toBe(true);
    expect(r.values.short_a).toBe(28);
    expect(r.values.evems_needed).toBe(true);
    expect(r.warnings.some((w) => w.includes('energy management'))).toBe(true);
    const managed = run('ev-charger-circuit', { charger: 48, distance: 60, existing: 80, evems: true });
    expect(managed.values.evems_needed).toBe(false);
  });

  it('uses a code-less breaker for ratings not in the catalog and handles aluminum', () => {
    const r = run('ev-charger-circuit', { charger: 56 }); // 70 A breaker
    expect(r.values.breaker_a).toBe(70);
    expect(r.takeoff.find((t) => t.description.includes('70 A'))?.code).toBeUndefined();
    const al = run('ev-charger-circuit', { material: 'al', size: '6' });
    expect(al.takeoff.find((t) => t.unit === 'm')?.code).toBeUndefined(); // 6 AWG aluminum has no catalog code
    expect(run('ev-charger-circuit', { material: 'al', size: '1/0' }).takeoff.find((t) => t.unit === 'm')?.code).toBe('AL-RW90-1/0');
    expect(run('ev-charger-circuit', { material: 'al', size: '14' }).values.conductor_size).toBeUndefined();
  });
});


describe('transformer-sizing', () => {
  // 30 kVA + 20% = 36 kVA -> 45 kVA. Primary 45,000 / (1.732 x 600) = 43.3 A; secondary 45,000 / (1.732 x 208) = 124.9 A
  it('picks 45 kVA and computes full-load currents', () => {
    const r = run('transformer-sizing');
    expect(r.values.kva).toBe(45);
    expect(r.values.primary_a).toBeCloseTo(43.30, 1);
    expect(r.values.secondary_a).toBeCloseTo(124.9, 1);
    expect(r.values.primary_ocpd_a).toBe(60); // 125% = 54.1 A, next standard 60 A
    expect(r.takeoff[0]).toMatchObject({ code: 'XFMR-45KVA' });
  });

  // 100 A at 208 V three-phase = 1.732 x 208 x 100 / 1000 = 36.0 kVA; x 1.2 = 43.2 -> 45 kVA
  it('converts amperes to kVA', () => {
    const r = run('transformer-sizing', { mode: 'amps', loadAmps: 100 });
    expect(r.values.load_kva).toBeCloseTo(36.02, 1);
    expect(r.values.kva).toBe(45);
  });

  it('matches the 15 kVA catalog unit and falls back to a code-less line otherwise', () => {
    expect(run('transformer-sizing', { load: 10 }).takeoff[0].code).toBe('XFMR-15KVA'); // 12 kVA -> 15
    const single = run('transformer-sizing', { phase: '1', load: 8, primary: '240', secondary: '120' }); // 9.6 -> 10 kVA
    expect(single.values.kva).toBe(10);
    expect(single.values.primary_a).toBeCloseTo(41.67, 1);
    expect(single.takeoff[0].code).toBeUndefined();
  });

  it('warns above the largest standard size', () => {
    expect(run('transformer-sizing', { load: 3000 }).warnings.some((w) => w.includes('largest standard'))).toBe(true);
  });
});

describe('lighting-layout', () => {
  // 12 x 8 m office at 500 lux with 4,500 lm panels, CU 0.7, LLF 0.8: 500 x 96 / (4500 x 0.56) = 19.05 -> 20 as a 5 x 4 grid;
  // delivered 20 x 4500 x 0.56 / 96 = 525 lux
  it('applies the lumen method and lays out a grid', () => {
    const r = run('lighting-layout');
    expect(r.values.raw_count).toBeCloseTo(19.05, 2);
    expect(r.values.fixtures).toBe(20);
    expect(r.values.columns).toBe(5);
    expect(r.values.rows).toBe(4);
    expect(r.values.achieved_lux).toBe(525);
    expect(r.takeoff).toEqual([expect.objectContaining({ code: 'LED-PANEL-2X4', quantity: 20 })]);
  });

  it('uses the space type, the high bay and a custom lumen figure', () => {
    const wh = run('lighting-layout', { space: 'warehouse', fixture: 'highbay', length: 30, width: 20, height: 8, plane: 0 });
    expect(wh.values.target_lux).toBe(150);
    expect(wh.takeoff[0].code).toBe('LED-HIGHBAY');
    const custom = run('lighting-layout', { fixture: 'custom', lumens: 3000 });
    expect(custom.takeoff[0].code).toBeUndefined();
    expect(run('lighting-layout', { target: 300 }).values.target_lux).toBe(300);
  });

  it('warns about tall narrow rooms and wide spacing', () => {
    const r = run('lighting-layout', { length: 40, width: 3, height: 12, plane: 0.8 });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.values.rcr).toBeGreaterThan(5);
  });
});

describe('second audit round: honest values and wording', () => {
  it('warns that DC resistance understates AC drop at 250 kcmil and above, not below, and not for DC', () => {
    const has = (r: ReturnType<typeof run>) => r.warnings.some((w) => w.includes('DC value'));
    expect(has(run('voltage-drop', { system: 'ac3-480', size: '250', load: 200 }))).toBe(true);
    expect(has(run('voltage-drop', { system: 'ac3-480', size: '500', load: 200 }))).toBe(true);
    expect(has(run('voltage-drop', { system: 'ac3-480', size: '4/0', load: 200 }))).toBe(false);
    expect(has(run('voltage-drop', { system: 'dc', size: '250', load: 200 }))).toBe(false);
  });

  it('asks about terminations in the EV charger and motor calculators, and omits uncomputed values', () => {
    const ev = CALCULATORS.find((c) => c.id === 'ev-charger-circuit')!;
    const motor = CALCULATORS.find((c) => c.id === 'motor-circuit')!;
    for (const c of [ev, motor]) {
      const f = c.fields.find((x) => x.key === 'termination')!;
      expect(f.default).toBe('60');
      expect(f.help).toContain('75 °C only when the equipment is marked');
    }
    const evWarn = run('ev-charger-circuit', { conductorAmpacity: 60 });
    expect(evWarn.warnings.some((w) => w.includes('60 °C column unless the equipment is marked'))).toBe(true);
    expect(run('ev-charger-circuit', { conductorAmpacity: 60, termination: '75' }).warnings.some((w) => w.includes('60 °C column'))).toBe(false);
    const evNone = run('ev-charger-circuit');
    expect('voltage_drop_pct' in evNone.values).toBe(false);
    expect('voltage_drop_pct' in run('ev-charger-circuit', { size: '6' }).values).toBe(true);
    expect(run('motor-circuit', { tableFla: 15, conductorAmpacity: 30 }).warnings.some((w) => w.includes('60 °C column unless the equipment is marked'))).toBe(true);
    const mNone = run('motor-circuit');
    for (const k of ['fla_a', 'min_conductor_ampacity_a', 'disconnect_a']) expect(k in mNone.values, k).toBe(false);
    expect(run('motor-circuit', { tableFla: 15 }).values).toMatchObject({ fla_a: 15, min_conductor_ampacity_a: 18.75 });
  });

  it('describes transformer protection and CO alarms in words, without unconfirmed rule numbers', () => {
    const xf = run('transformer-sizing');
    const text = JSON.stringify([xf.warnings, xf.references]);
    expect(text).toContain('transformer overcurrent-protection requirements');
    expect(text).not.toMatch(/14-104|Table 13/);
    const res = run('residential-wiring-takeoff');
    expect(JSON.stringify([res.warnings, res.references])).not.toMatch(/9\.33\.4|9\.10\.19/);
  });
});
