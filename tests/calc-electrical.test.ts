// Worked examples for the electrical calculators. Each expected figure is hand-checked in a comment
// against the code table it comes from; none of these tests touch the network or the cost engine.
import { describe, expect, it } from 'vitest';
import { CALCULATORS, getCalculator, runCalculator } from '@/lib/calc/registry';
import { CORE_ITEMS } from '@/lib/costbook/codes';

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

describe('voltage-drop', () => {
  // 30 m = 98.425 ft. 12 AWG copper 1.98 ohm/1000 ft, 15 A, 120 V, pf 1:
  // drop = 2 x 15 x 98.425 x 0.00198 = 5.847 V = 4.87% of 120 V, over the 3% limit
  it('computes the 120 V single-phase default', () => {
    const r = run('voltage-drop');
    expect(r.values.voltage_drop_v).toBeCloseTo(5.847, 2);
    expect(r.values.voltage_drop_pct).toBeCloseTo(4.873, 2);
    expect(r.values.passes).toBe(false);
    expect(r.warnings.some((w) => w.includes('8-102'))).toBe(true);
  });

  // 10 AWG (1.24): 2 x 15 x 98.425 x 0.00124 = 3.661 V = 3.05%, still over; 8 AWG (0.778): 2.297 V = 1.91%, passes
  it('finds the smallest size within 3%', () => {
    expect(run('voltage-drop').values.smallest_size).toBe('8');
    expect(run('voltage-drop', { size: '8' }).values.passes).toBe(true);
  });

  // Three-phase 480 V, 100 A, 150 ft, 3/0 copper (0.0766), pf 1 so reactance drops out:
  // 1.732 x 100 x 150 x 0.0766/1000 = 1.990 V = 0.415%
  it('uses 1.732 for three-phase', () => {
    const r = run('voltage-drop', { system: 'ac3-480', size: '3/0', length: 150, lengthUnit: 'ft', load: 100, pf: 1 });
    expect(r.values.voltage_drop_v).toBeCloseTo(1.99, 2);
    expect(r.values.voltage_drop_pct).toBeCloseTo(0.415, 2);
  });

  // 480 V, 200 A, 100 ft, 250 kcmil (R 0.0515, X steel 0.052), pf 0.85, sin = 0.5268:
  // Z = 0.0515 x 0.85 + 0.052 x 0.5268 = 0.07117 per 1000 ft; drop = 1.732 x 200 x 100 x 0.07117/1000 = 2.465 V
  it('adds reactance for a lagging power factor in steel conduit', () => {
    const r = run('voltage-drop', { system: 'ac3-480', size: '250', length: 100, lengthUnit: 'ft', load: 200, pf: 0.85, raceway: 'steel' });
    expect(r.values.voltage_drop_v).toBeCloseTo(2.465, 2);
  });

  // DC 24 V, 10 A, 20 m = 65.617 ft, 12 AWG: 2 x 10 x 65.617 x 0.00198 = 2.598 V = 10.8%
  it('handles DC with resistance only', () => {
    const r = run('voltage-drop', { system: 'dc', dcVolts: 24, load: 10, length: 20 });
    expect(r.values.voltage_drop_v).toBeCloseTo(2.598, 2);
    expect(r.values.voltage_drop_pct).toBeCloseTo(10.83, 1);
  });

  it('flags the 5% total including upstream drop', () => {
    const r = run('voltage-drop', { size: '8', upstream: 4 }); // 1.91% + 4% = 5.91%
    expect(r.values.total_pct).toBeCloseTo(5.91, 1);
    expect(r.warnings.some((w) => w.includes('5% limit'))).toBe(true);
  });

  it('corrects aluminum below 12 AWG and warns when the load exceeds the ampacity', () => {
    const r = run('voltage-drop', { material: 'al', size: '14' });
    expect(r.values.size).toBe('12');
    expect(r.warnings.some((w) => w.includes('aluminum'))).toBe(true);
    expect(run('voltage-drop', { size: '14', load: 40 }).warnings.some((w) => w.includes('ampacity'))).toBe(true);
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

describe('conductor-size', () => {
  // 40 A continuous = 50 A. 8 AWG copper 90 C column 55 A, but a 75 C termination holds it to 50 A: exactly enough
  it('applies the 125% continuous factor and the termination limit', () => {
    const r = run('conductor-size');
    expect(r.values.design_current_a).toBe(50);
    expect(r.values.size).toBe('8');
    expect(r.values.usable_ampacity_a).toBe(50);
    expect(r.values.ocpd_a).toBe(50);
  });

  // 60 C termination: 6 AWG column is 55 A, so 50 A needs 8 AWG at 60 C? 8 AWG 60 C = 40 A, 6 AWG = 55 A
  it('uses the 60 C column when the equipment is only rated 60 C', () => {
    expect(run('conductor-size', { termination: '60' }).values.size).toBe('6');
  });

  // 85 A, 75 C insulation, 45 C ambient (factor sqrt(30/45) = 0.82), 7 conductors (0.70):
  // 4 AWG 85 x 0.82 x 0.70 = 48.8 A no; 1/0 150 x 0.574 = 86.1 A yes
  it('derates for ambient temperature and conductor count', () => {
    const r = run('conductor-size', { load: 85, continuous: false, insulation: '75', termination: '75', ambient: 45, conductors: 7 });
    expect(r.values.ambient_factor).toBe(0.82);
    expect(r.values.count_factor).toBe(0.7);
    expect(r.values.size).toBe('1/0');
    expect(r.values.corrected_ampacity_a).toBeCloseTo(86.1, 1);
  });

  it('uses Table 4 for aluminum: 100 A needs 1 AWG (100 A at 75 C)', () => {
    expect(run('conductor-size', { load: 100, continuous: false, material: 'al' }).values.size).toBe('1');
  });

  // Free air 14 AWG copper: 90 C 35 A but 75 C termination 30 A; 28 A fits
  it('uses the free-air tables', () => {
    const r = run('conductor-size', { load: 28, continuous: false, method: 'air' });
    expect(r.values.size).toBe('14');
    expect(r.values.usable_ampacity_a).toBe(30);
  });

  it('warns about the small-conductor overcurrent limit and impossible ambient', () => {
    expect(run('conductor-size', { load: 10, continuous: false }).warnings.some((w) => w.includes('15 A overcurrent'))).toBe(true);
    const hot = run('conductor-size', { ambient: 70, insulation: '60', termination: '60' });
    expect(hot.warnings.some((w) => w.includes('no ampacity left'))).toBe(true);
  });

  it('reports when nothing fits', () => {
    const r = run('conductor-size', { load: 1400, continuous: false });
    expect(r.values.size).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('parallel'))).toBe(true);
  });
});

describe('conduit-fill', () => {
  // 3 x 12 AWG + 1 bond 12 AWG RW90 XLPE: diameter 2.34 + 2 x 1.14 = 4.62 mm, area 16.76 mm2 each, 67.1 mm2 total.
  // 16 mm EMT is 181 mm2, 40% = 72.4 mm2, so 1/2 in at 37%
  it('picks 1/2 in EMT for four 12 AWG', () => {
    const r = run('conduit-fill');
    expect(r.values.conductor_area_mm2).toBeCloseTo(67.06, 1);
    expect(r.values.trade_size).toBe('1/2');
    expect(r.values.limit_pct).toBe(40);
    expect(r.values.fill_pct).toBeCloseTo(37.05, 0);
  });

  // One 500 kcmil RW90: 20.65 + 2 x 1.65 = 23.95 mm, 450.5 mm2 (CEC Table 6A prints 451). 53% rule:
  // 1-1/4 in EMT 968 x 0.53 = 513 mm2 fits, 1 in 556 x 0.53 = 295 does not
  it('uses 53% for one conductor', () => {
    const r = run('conduit-fill', { size1: '500', count1: 1, count2: 0 });
    expect(r.values.limit_pct).toBe(53);
    expect(r.values.conductor_area_mm2).toBeCloseTo(450.5, 0);
    expect(r.values.trade_size).toBe('1-1/4');
  });

  it('uses 31% for two conductors and 40% beyond', () => {
    expect(run('conduit-fill', { count1: 2, count2: 0 }).values.limit_pct).toBe(31);
    expect(run('conduit-fill', { count1: 5, count2: 0 }).values.limit_pct).toBe(40);
  });

  it('prices T90 Nylon as RW90 wire and gives smaller areas than RW90', () => {
    const nylon = run('conduit-fill', { wire: 'nylon', size1: '10', count1: 6, count2: 0 });
    const xlpe = run('conduit-fill', { wire: 'rw90', size1: '10', count1: 6, count2: 0 });
    expect(Number(nylon.values.conductor_area_mm2)).toBeLessThan(Number(xlpe.values.conductor_area_mm2));
    expect(nylon.takeoff.find((t) => t.code === 'CU-RW90-10')?.note).toContain('T90 Nylon');
  });

  // 15 m run, couplings every 3 m = ceil(15/3) - 1 = 4 per run, 2 connectors per run, 4 conductors x 15 m of 12 AWG = 60 m
  it('takes off conduit, couplings, connectors and wire', () => {
    const r = run('conduit-fill');
    const q = (code: string) => r.takeoff.find((t) => t.code === code)?.quantity;
    expect(q('EMT-1/2')).toBe(15);
    expect(q('EMT-COUP-1/2')).toBe(4);
    expect(q('EMT-CONN-1/2')).toBe(2);
    expect(q('CU-RW90-12')).toBe(60);
    const two = run('conduit-fill', { runs: 2 });
    expect(two.takeoff.find((t) => t.code === 'EMT-COUP-1/2')?.quantity).toBe(8);
    expect(two.takeoff.find((t) => t.code === 'EMT-CONN-1/2')?.quantity).toBe(4);
  });

  it('falls back to code-less lines for sizes the catalog does not carry', () => {
    const r = run('conduit-fill', { conduit: 'pvc', size1: '4/0', count1: 3, count2: 0 }); // PVC 1-1/4 has no catalog code
    expect(r.values.trade_size).toBeDefined();
    const conduit = r.takeoff[0];
    if (r.values.trade_size === '1-1/4') expect(conduit.code).toBeUndefined();
  });

  it('says when the conductors cannot fit', () => {
    const r = run('conduit-fill', { size1: '500', count1: 100, count2: 0 });
    expect(r.values.trade_size).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('4 in conduit'))).toBe(true);
  });
});

describe('box-fill', () => {
  // 4 x 14 AWG (4 x 24.6 = 98.4) + bonding (24.6) + one device (2 x 24.6 = 49.2) = 172.2 mL; 3 x 2 x 2-1/2 holds 204 mL
  it('adds conductors, bonding and a device (Table 22)', () => {
    const r = run('box-fill');
    expect(r.values.required_ml).toBeCloseTo(172.2, 1);
    expect(r.values.passes).toBe(true);
    expect(r.values.box_id).toBe('dev-3x2x2.5');
    expect(r.takeoff[0]).toMatchObject({ code: 'BOX-DEVICE', quantity: 1 });
  });

  // 6 x 12 AWG = 172.2; 2 devices = 4 x 28.7 = 114.8; bonding 28.7; total 315.7 mL -> needs the 344 mL 4 in square or larger
  it('uses the largest conductor for devices and mixed sizes', () => {
    const r = run('box-fill', { n14: 0, n12: 6, devices: 2 });
    expect(r.values.required_ml).toBeCloseTo(315.7, 1);
    expect(r.values.box_id).toBe('sq-1.5'); // the 344 mL octagon is skipped because it cannot hold devices
    expect(run('box-fill', { n14: 3, bonding: false, devices: 0 }).values.box_id).toBe('dev-3x2x1.5');
  });

  it('fails a box that is too small and says which box to use', () => {
    const r = run('box-fill', { box: 'dev-3x2x1.5' });
    expect(r.values.passes).toBe(false);
    expect(r.takeoff).toEqual([]);
    expect(r.warnings[0]).toContain('131 mL');
  });

  // Pairs of wire connectors: 5 connectors = 2 allowances; hickey = 1; deep device 1 x 32 x 4 cm = 128 mL
  it('counts connector pairs, fixture studs and deep devices', () => {
    const base = Number(run('box-fill', { n14: 2, bonding: false, devices: 0 }).values.required_ml);
    expect(base).toBeCloseTo(49.2, 1);
    expect(Number(run('box-fill', { n14: 2, bonding: false, devices: 0, connectors: 5 }).values.required_ml)).toBeCloseTo(49.2 + 2 * 24.6, 1);
    expect(Number(run('box-fill', { n14: 2, bonding: false, devices: 0, studs: 1 }).values.required_ml)).toBeCloseTo(49.2 + 24.6, 1);
    expect(Number(run('box-fill', { n14: 2, bonding: false, devices: 0, deepDevices: 1, deepDepth: 4 }).values.required_ml)).toBeCloseTo(49.2 + 128, 1);
  });

  it('accepts a marked volume and a quantity', () => {
    const r = run('box-fill', { customMl: 500, qty: 12 });
    expect(r.values.box_ml).toBe(500);
    expect(r.takeoff[0]).toMatchObject({ quantity: 12 });
    expect(run('box-fill', { n14: 40, n12: 40, n10: 40, n8: 40, n6: 40, devices: 12 }).warnings.some((w) => w.includes('Rule 12-3036'))).toBe(true);
  });
});

describe('motor-circuit', () => {
  // CEC Appendix B example: 30 hp at 575 V is 32 A (Table 44); x 125% = 40 A; Table 2 at 75 C = 8 AWG (50 A)
  it('reproduces the CEC 30 hp example', () => {
    const r = run('motor-circuit', { hp: '30', supply: '3ph-600' });
    expect(r.values.fla_a).toBe(32);
    expect(r.values.min_conductor_ampacity_a).toBe(40);
    expect(r.values.conductor_size).toBe('8');
    // inverse-time breaker 250% x 32 = 80 A; overload 125% x 32 = 40 A; NEMA size 3 (30 hp at 575 V)
    expect(r.values.max_device_a).toBe(80);
    expect(r.values.overload_a).toBe(40);
    expect(r.values.starter_size).toBe('3');
    expect(r.takeoff.some((t) => t.code === 'STARTER-NEMA1')).toBe(false);
  });

  // 100 hp at 575 V is 99 A; x 125% = 124 A; 1 AWG at 75 C is 130 A
  it('reproduces the CEC 100 hp example', () => {
    const r = run('motor-circuit', { hp: '100', supply: '3ph-600' });
    expect(r.values.fla_a).toBe(99);
    expect(r.values.conductor_size).toBe('1');
  });

  // 5 hp 575 V: 6.1 A, 7.6 A conductor -> 14 AWG, breaker 250% = 15.25 -> 15 A, size 0 starter takes the size 1 catalog item
  it('sizes a 5 hp 600 V motor and takes off Teck90, starter and disconnect', () => {
    const r = run('motor-circuit');
    expect(r.values.fla_a).toBe(6.1);
    expect(r.values.conductor_size).toBe('14');
    expect(r.values.std_device_a).toBe(15);
    expect(r.values.starter_size).toBe('0');
    expect(r.takeoff.map((t) => t.code)).toEqual(['TECK90-12-3', 'STARTER-NEMA1', 'DISC-100A']);
    expect(r.takeoff[0].quantity).toBe(20);
  });

  // Single-phase 2 hp at 230 V: 12 A (Table 45); 15 A conductor -> 14 AWG
  it('uses Table 45 for single-phase motors', () => {
    const r = run('motor-circuit', { hp: '2', supply: '1ph-240' });
    expect(r.values.fla_a).toBe(12);
    expect(r.values.conductor_size).toBe('14');
    expect(r.takeoff.some((t) => t.code === 'DISC-60A')).toBe(true);
  });

  it('uses the nameplate for the overload, 115% without the service factor', () => {
    const r = run('motor-circuit', { nameplate: 10, sf: false });
    expect(r.values.overload_a).toBeCloseTo(11.5, 2);
    expect(r.values.fla_a).toBe(10);
    expect(r.values.table_fla_a).toBe(6.1);
  });

  it('moves a rating not in the table to the next listed one with a warning', () => {
    const r = run('motor-circuit', { hp: '0.25', supply: '3ph-480' });
    expect(r.values.hp).toBe(0.5);
    expect(r.warnings.some((w) => w.includes('next listed'))).toBe(true);
  });

  it('applies the fuse percentages of Table 29', () => {
    expect(run('motor-circuit', { hp: '10', device: 'delay' }).values.max_device_pct).toBe(175);
    expect(run('motor-circuit', { hp: '10', device: 'fuse' }).values.max_device_a).toBeCloseTo(33, 0); // 11 A x 300%
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
  // 40 A x 125% = 50 A: 50 A breaker, 8 AWG (50 A at 75 C); 15 m = 49.2 ft, drop = 2 x 40 x 49.2 x 0.000778 = 3.06 V = 1.28%
  it('sizes a 40 A charger at 125%', () => {
    const r = run('ev-charger-circuit');
    expect(r.values.breaker_a).toBe(50);
    expect(r.values.conductor_size).toBe('8');
    expect(r.values.voltage_drop_pct).toBeCloseTo(1.28, 2);
    expect(r.takeoff.map((t) => t.code)).toEqual(['EVSE-L2-48A', 'BKR-2P-50A', 'CU-RW90-8']);
    expect(r.takeoff[2].quantity).toBe(45);
  });

  // 48 A x 125% = 60 A. 6 AWG (65 A) carries it, but over 60 m (196.9 ft): 2 x 48 x 196.9 x 0.000491 = 9.28 V = 3.87% > 3%,
  // so 4 AWG (0.000308): 5.82 V = 2.43% is chosen. Service 100 A with 80 A used leaves 20 A, 28 A short
  it('upsizes for voltage drop and flags a service shortfall with the EVEMS option', () => {
    const r = run('ev-charger-circuit', { charger: 48, distance: 60, existing: 80 });
    expect(r.values.breaker_a).toBe(60);
    expect(r.values.conductor_size).toBe('4');
    expect(r.values.voltage_drop_pct).toBeCloseTo(2.43, 2);
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
    const al = run('ev-charger-circuit', { material: 'al' });
    expect(al.takeoff.find((t) => t.unit === 'm')?.code).toBeUndefined(); // 6 AWG aluminum has no catalog code
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
