// Worked examples for the heat loss and water heater calculators, plus a check on the registry as a whole.
import { describe, expect, it } from 'vitest';
import { CALCULATORS, defaultInput, getCalculator, inputSchema, numberInput, runCalculator } from '@/lib/calc/registry';
import { CITIES, ENVELOPES } from '@/lib/calc/calculators/heat-loss';
import { INCOMING_C } from '@/lib/calc/calculators/water-heater-sizing';
import { CORE_ITEMS } from '@/lib/costbook/codes';

const run = (id: string, input: Record<string, number | string | boolean> = {}) => {
  const r = runCalculator(id, input);
  if (!r) throw new Error(`no calculator ${id}`);
  return r;
};
const qty = (r: ReturnType<typeof run>, code: string) => r.takeoff.find((t) => t.code === code)?.quantity;

describe('registry', () => {
  it('lists 21 calculators with unique ids, mechanical last', () => {
    const ids = CALCULATORS.map((c) => c.id);
    expect(ids.length).toBe(21);
    expect(new Set(ids).size).toBe(21);
    expect(ids.slice(19)).toEqual(['heat-loss', 'water-heater-sizing']);
    expect(getCalculator('nope')).toBeUndefined();
    expect(runCalculator('nope', {})).toBeNull();
  });

  it('gives every calculator a card sentence, keywords and an input schema matching its fields', () => {
    for (const c of CALCULATORS) {
      expect(c.name.length).toBeGreaterThan(5);
      expect(c.summary.endsWith('.'), c.id).toBe(true);
      expect(c.keywords?.length, c.id).toBeGreaterThan(2);
      expect(Object.keys(inputSchema(c).properties).sort()).toEqual(c.fields.map((f) => f.key).sort());
      expect(Object.keys(defaultInput(c)).length).toBe(c.fields.length);
    }
  });

  it('keeps numberInput behaviour: defaults, clamps and warns', () => {
    const field = { key: 'x', label: 'Load', type: 'number' as const, default: 5, min: 1, max: 10 };
    const w: string[] = [];
    expect(numberInput({ x: 50 }, field, w)).toBe(10);
    expect(numberInput({ x: 0 }, field, w)).toBe(1);
    expect(numberInput({ x: 'abc' }, field, w)).toBe(5);
    expect(numberInput({}, field, w)).toBe(5);
    expect(w.length).toBe(3);
  });

  it('ignores unknown input keys and merges defaults for missing ones', () => {
    const r = runCalculator('voltage-drop', { bogus: 1 });
    expect(r?.values.voltage_drop_v).toBeCloseTo(5.847, 2);
  });
});

describe('heat-loss', () => {
  it('lists the 22 required cities with their NBC January 2.5% temperatures', () => {
    const expected: Record<string, number> = {
      vancouver: -7, victoria: -4, kelowna: -17, calgary: -30, edmonton: -30, saskatoon: -35, regina: -34, winnipeg: -33, toronto: -18, ottawa: -25, hamilton: -17,
      london: -18, montreal: -23, quebec: -26, halifax: -16, moncton: -23, saintjohn: -22, stjohns: -15, charlottetown: -20, whitehorse: -41, yellowknife: -41, iqaluit: -40,
    };
    expect(Object.keys(CITIES).sort()).toEqual(Object.keys(expected).sort());
    for (const [k, t] of Object.entries(expected)) expect(CITIES[k].t, k).toBe(t);
  });

  // Toronto (-18 C, indoor 22 C = 40 C = 72 F), 1,800 sq ft, 2 storeys, average envelope, heated basement:
  // footprint 900; perimeter 2 x (sqrt(1350) + sqrt(600)) = 122.47 ft; gross wall 122.47 x 8 x 2 = 1,959.5; less 250 windows and 40 doors = 1,669.5
  // walls 1,669.5 x 0.05 x 72 = 6,010; ceiling 900 x 0.025 x 72 = 1,620; windows 250 x 0.35 x 72 = 6,300; doors 40 x 0.35 x 72 = 1,008
  // air: 14,400 cu ft x 0.35 / 60 = 84 CFM x 1.08 x 72 = 6,532; basement (ground 18 C x 1.8 = 32.4 F): 122.47 x 8 x 0.07 x 32.4 + 900 x 0.025 x 32.4 = 2,951
  // total 24,422 BTU/h
  it('adds up the envelope, air leakage and foundation losses', () => {
    const r = run('heat-loss');
    expect(r.values.delta_t_c).toBe(40);
    expect(r.values.walls_btuh).toBeCloseTo(6010, -1);
    expect(r.values.ceiling_btuh).toBe(1620);
    expect(r.values.windows_btuh).toBe(7308);
    expect(r.values.infiltration_btuh).toBeCloseTo(6532, -1);
    expect(r.values.foundation_btuh).toBeCloseTo(2951, -1);
    expect(r.values.total_btuh).toBeCloseTo(24422, -2);
    expect(r.values.total_kw).toBeCloseTo(24422 / 3412, 1);
  });

  // 24,422 BTU/h / 12,000 = 2.04 tons (within 5% of 2 tons); a 60,000 BTU/h furnace at 96% gives 57,600 BTU/h output
  it('selects a furnace and a heat pump from the catalog', () => {
    const r = run('heat-loss');
    expect(r.values.tons).toBeCloseTo(2.04, 2);
    expect(r.takeoff.map((t) => t.code)).toEqual(['FURNACE-60K', 'HP-2T']);
    expect(r.values.furnace_input_btuh).toBe(60000);
  });

  it('gives a bigger load in colder cities and worse envelopes', () => {
    const toronto = Number(run('heat-loss').values.total_btuh);
    expect(Number(run('heat-loss', { city: 'yellowknife' }).values.total_btuh)).toBeGreaterThan(toronto * 1.5);
    expect(Number(run('heat-loss', { city: 'victoria' }).values.total_btuh)).toBeLessThan(toronto);
    expect(Number(run('heat-loss', { envelope: 'older' }).values.total_btuh)).toBeGreaterThan(toronto);
    expect(Number(run('heat-loss', { envelope: 'high' }).values.total_btuh)).toBeLessThan(toronto);
    expect(Object.keys(ENVELOPES).length).toBe(4);
  });

  it('warns for very cold design temperatures and large loads, and always says it is an estimate', () => {
    const cold = run('heat-loss', { city: 'iqaluit', area: 5000, envelope: 'older' });
    expect(cold.warnings.some((w) => w.includes('lose capacity'))).toBe(true);
    expect(cold.warnings.some((w) => w.includes('100,000'))).toBe(true);
    expect(cold.takeoff.some((t) => t.code === 'FURNACE-100K')).toBe(false);
    expect(run('heat-loss').warnings.some((w) => w.includes('not a CSA F280'))).toBe(true);
    expect(run('heat-loss').references.some((x) => x.includes('not CSA F280'))).toBe(true);
  });

  it('works for every city, slab and crawl space foundations included', () => {
    for (const city of Object.keys(CITIES)) expect(Number(run('heat-loss', { city }).values.total_btuh), city).toBeGreaterThan(5000);
    for (const foundation of ['slab', 'crawl']) expect(Number(run('heat-loss', { foundation }).values.foundation_btuh)).toBeGreaterThan(0);
  });
});

describe('water-heater-sizing', () => {
  // 4 occupants x 11 = 44 + dishwasher 6 = 50 gal peak hour. Toronto 5 C incoming, 49 C delivered = 44 C rise = 79.2 F.
  // Gas 40,000 BTU/h x 0.62 / (8.34 x 79.2) = 37.5 gal/h recovery; FHR = 0.7 x 30 + 37.5 = 58.5 gal, enough
  it('finds the smallest tank from the peak hour and recovery', () => {
    const r = run('water-heater-sizing');
    expect(r.values.peak_hour_gal).toBe(50);
    expect(r.values.rise_c).toBe(44);
    expect(r.values.recovery_gph).toBeCloseTo(37.5, 1);
    expect(r.values.tank_gal).toBe(30);
    expect(r.values.first_hour_rating_gal).toBeCloseTo(58.5, 1);
    expect(qty(r, 'WH-GAS-40')).toBe(1);
  });

  it('needs a bigger tank for a bigger household, and slower recovery when electric', () => {
    // 5 x 11 + tub 12 + dishwasher 6 + washer 7 = 80 gal; a 60 gal tank gives 0.7 x 60 + 37.5 = 79.5 (short), 75 gal gives 90
    const big = run('water-heater-sizing', { occupants: 5, bathrooms: 3, tub: true, washer: true });
    expect(Number(big.values.peak_hour_gal)).toBe(80);
    expect(big.values.tank_gal).toBe(75);
    const elec = run('water-heater-sizing', { fuel: 'electric' });
    expect(Number(elec.values.recovery_gph)).toBeLessThan(Number(run('water-heater-sizing').values.recovery_gph));
    expect(qty(elec, 'WH-ELEC-50')).toBe(1);
  });

  // 199,000 BTU/h x 0.95 / (500 x 79.2 F) = 4.77 GPM available; 2 showers x 2 + kitchen 1.5 = 5.5 GPM needed -> 2 units
  it('sizes a tankless unit by flow at the local temperature rise', () => {
    const r = run('water-heater-sizing', { type: 'tankless' });
    expect(r.values.tankless_gpm_available).toBeCloseTo(4.77, 2);
    expect(r.values.tankless_gpm_needed).toBe(5.5);
    expect(r.values.tankless_units).toBe(2);
    expect(r.takeoff.map((t) => t.code)).toEqual(['WH-TANKLESS']);
    expect(qty(r, 'WH-TANKLESS')).toBe(2);
    // colder water cuts the flow a unit can deliver
    const cold = run('water-heater-sizing', { type: 'tankless', city: 'iqaluit' });
    expect(Number(cold.values.tankless_gpm_available)).toBeLessThan(4.77);
    expect(Number(run('water-heater-sizing', { type: 'tankless', showers: 1, kitchen: false }).values.tankless_units)).toBe(1);
  });

  it('uses a measured incoming temperature and has a temperature for every city', () => {
    expect(run('water-heater-sizing', { incoming: 10 }).values.rise_c).toBe(39);
    expect(Object.keys(INCOMING_C).length).toBe(22);
    for (const [k, v] of Object.entries(INCOMING_C)) expect(Number(run('water-heater-sizing', { city: k }).values.incoming_c), k).toBe(v.c);
  });

  it('returns a code-less line for tank sizes outside the catalog and warns when nothing fits', () => {
    const r = run('water-heater-sizing', { occupants: 20, bathrooms: 10, tub: true, washer: true });
    expect(r.warnings.some((w) => w.includes('No single tank'))).toBe(true);
    expect(r.takeoff[0].code).toBeUndefined();
  });
});

describe('every calculator takes only catalog codes in the catalog unit', () => {
  it('on defaults, and on a spread of edited inputs', () => {
    for (const c of CALCULATORS) {
      const variants = [defaultInput(c), ...c.fields.filter((f) => f.type === 'select').flatMap((f) => (f.options ?? []).map((o) => ({ ...defaultInput(c), [f.key]: o.value })))];
      for (const input of variants) {
        const r = c.run(input);
        for (const t of r.takeoff) {
          expect(Number.isFinite(t.quantity) && t.quantity > 0, `${c.id} ${t.description}`).toBe(true);
          if (t.code) {
            expect(CORE_ITEMS[t.code], `${c.id} ${t.code}`).toBeDefined();
            expect(t.unit, `${c.id} ${t.code}`).toBe(CORE_ITEMS[t.code].unit);
          }
        }
        for (const v of Object.values(r.values)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
