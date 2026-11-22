// Worked examples for the building takeoff calculators, with the arithmetic shown beside each expected figure.
import { describe, expect, it } from 'vitest';
import { CALCULATORS, getCalculator, runCalculator } from '@/lib/calc/registry';
import { CORE_ITEMS } from '@/lib/costbook/codes';
import { pitchFactor } from '@/lib/calc/calculators/roofing';

const run = (id: string, input: Record<string, number | string | boolean> = {}) => {
  const r = runCalculator(id, input);
  if (!r) throw new Error(`no calculator ${id}`);
  return r;
};
const BUILDING = ['concrete-slab', 'concrete-footing-wall', 'concrete-piles', 'drywall', 'paint', 'wall-framing', 'roofing', 'flooring', 'insulation'];
const qty = (r: ReturnType<typeof run>, code: string) => r.takeoff.find((t) => t.code === code)?.quantity;

describe('building calculators: shape', () => {
  it('are registered after the electrical set, in order', () => {
    expect(CALCULATORS.map((c) => c.id).slice(10, 19)).toEqual(BUILDING);
  });

  it('describe every field, give one emphasised summary line and use catalog units', () => {
    for (const id of BUILDING) {
      const calc = getCalculator(id)!;
      for (const f of calc.fields) {
        expect(f.label.length, `${id}.${f.key}`).toBeGreaterThan(2);
        if (f.type === 'number') {
          expect(f.min !== undefined && f.max !== undefined && f.step !== undefined, `${id}.${f.key}`).toBe(true);
          expect(Number(f.default)).toBeGreaterThanOrEqual(f.min!);
          expect(Number(f.default)).toBeLessThanOrEqual(f.max!);
        }
        if (f.type === 'select') expect(f.options!.map((o) => o.value)).toContain(String(f.default));
      }
      const r = run(id);
      expect(r.summary.filter((s) => s.emphasis).length, id).toBe(1);
      expect(r.summary[0].emphasis).toBe(true);
      expect(r.references.length).toBeGreaterThan(0);
      expect(r.takeoff.length, id).toBeGreaterThan(0);
      for (const t of r.takeoff) {
        expect(t.quantity, `${id} ${t.description}`).toBeGreaterThan(0);
        if (t.code) expect(t.unit).toBe(CORE_ITEMS[t.code].unit);
        else expect(t.description.length).toBeGreaterThan(3);
      }
    }
  });

  it('clamp wild input, report it and never throw', () => {
    for (const id of BUILDING) {
      const calc = getCalculator(id)!;
      const wild = calc.run(Object.fromEntries(calc.fields.map((f) => [f.key, f.type === 'number' ? 1e12 : 'x'])));
      expect(wild.warnings.length, id).toBeGreaterThan(0);
      const zero = calc.run(Object.fromEntries(calc.fields.map((f) => [f.key, f.type === 'number' ? 0 : f.default])));
      expect(zero.summary.length, id).toBeGreaterThan(0);
    }
  });
});

describe('concrete-slab', () => {
  // 20 x 20 ft x 4 in = 133.33 cu ft x 0.0283168 = 3.776 m3; +8% = 4.078 m3; ordered in quarters = 4.25 m3
  it('keeps the original volume answer', () => {
    const r = run('concrete-slab');
    expect(r.values.order_m3).toBe(4.25);
    expect(r.values.volume_m3).toBeCloseTo(4.078, 2);
    expect(qty(r, 'CONC-25MPA')).toBe(4.25);
  });

  // 6.096 m square, 300 mm grid: floor(6.096 / 0.3) + 1 = 21 bars each way, each 6.096 - 0.15 = 5.946 m;
  // 2 x 21 x 5.946 = 249.7 m, + 10% laps = 274.7 m
  it('lays out a rebar grid', () => {
    const r = run('concrete-slab', { rebar: '300' });
    expect(r.values.rebar_m).toBeCloseTo(274.7, 0);
    expect(r.values.rebar_kg).toBeCloseTo(274.7 * 0.785, 0);
    expect(qty(r, 'REBAR-10M')).toBeCloseTo(274.7, 0);
    expect(Number(run('concrete-slab', { rebar: '200' }).values.rebar_m)).toBeGreaterThan(Number(r.values.rebar_m));
    expect(run('concrete-slab').values.rebar_m).toBe(0);
  });

  // 400 sq ft = 37.16 m2 x 0.1016 m (4 in) = 3.776 m3 x 1.1 = 4.153 m3; vapour barrier 400 x 1.1 = 440 sq ft
  it('adds gravel, vapour barrier and finishing labour, each optional', () => {
    const r = run('concrete-slab');
    expect(r.values.gravel_m3).toBeCloseTo(4.15, 2);
    expect(qty(r, 'POLY-6MIL')).toBe(440);
    expect(r.takeoff.find((t) => !t.code)).toMatchObject({ unit: 'sqft', quantity: 400, labourHoursPerUnit: 0.025, labourClass: 'concrete_finisher' });
    const bare = run('concrete-slab', { gravel: 0, vapour: false, labour: false });
    expect(bare.takeoff.map((t) => t.code)).toEqual(['CONC-25MPA']);
  });

  it('warns on thin slabs and small orders, and yields an empty takeoff for zero area', () => {
    expect(run('concrete-slab', { thickness: 2 }).warnings.some((w) => w.includes('thinner than 4 in'))).toBe(true);
    expect(run('concrete-slab', { length: 5, width: 5 }).warnings.some((w) => w.includes('short-load'))).toBe(true);
    expect(run('concrete-slab', { length: 0, width: 0 }).takeoff).toEqual([]);
  });
});

describe('concrete-footing-wall', () => {
  // 40 m: footing 40 x 0.6 x 0.25 = 6.0 m3; wall 40 x 0.2 x 2.4 = 19.2 m3; +5% = 26.46 -> 26.5 m3
  // forms: footing 2 x 40 x 0.25 = 20 m2, wall 2 x 40 x 2.4 = 192 m2
  it('computes footing, wall and forms', () => {
    const r = run('concrete-footing-wall');
    expect(r.values.footing_m3).toBe(6);
    expect(r.values.wall_m3).toBe(19.2);
    expect(r.values.order_m3).toBe(26.5);
    expect(r.values.form_area_m2).toBe(212);
    expect(qty(r, 'CONC-25MPA')).toBe(26.5);
  });

  // 2 x 15M x 40 m x 1.1 = 88 m; vertical 10M at 600: 40 / 0.6 + 1 = 67.7 bars x 2.8 m = 189.5 m; horizontal 3 x 40 x 1.1 = 132 m; (189.5 + 132) x 1.05 = 337.5 m
  it('takes off rebar and switches strength', () => {
    const r = run('concrete-footing-wall');
    expect(qty(r, 'REBAR-15M')).toBe(88);
    expect(qty(r, 'REBAR-10M')).toBeCloseTo(337.5, 0);
    expect(qty(run('concrete-footing-wall', { strength: '32' }), 'CONC-32MPA')).toBe(26.5);
  });

  it('warns about thin walls and narrow footings', () => {
    const r = run('concrete-footing-wall', { wallT: 150, footW: 250 });
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('concrete-piles', () => {
  // 300 mm tube, 1.8 m + 0.2 m = 2.0 m: pi/4 x 0.09 x 2 = 0.1414 m3 each; x 6 x 1.1 = 0.933 m3 -> 1 m3 ordered, or ceil(0.933 / 0.014) = 67 bags
  it('computes volume, ready-mix and bags', () => {
    const r = run('concrete-piles');
    expect(r.values.volume_each_m3).toBeCloseTo(0.1414, 3);
    expect(r.values.total_m3).toBeCloseTo(0.933, 2);
    expect(r.values.bags).toBe(67);
    expect(qty(r, 'CONC-25MPA')).toBe(1);
    const bags = run('concrete-piles', { supply: 'bags' });
    expect(qty(bags, 'CONC-BAG-30KG')).toBe(67);
    expect(qty(bags, 'CONC-25MPA')).toBeUndefined();
  });

  it('lists the form tubes and scales with diameter', () => {
    const r = run('concrete-piles');
    expect(r.takeoff.find((t) => !t.code)).toMatchObject({ quantity: 6, unit: 'ea' });
    expect(Number(run('concrete-piles', { diameter: '600' }).values.total_m3)).toBeCloseTo(Number(r.values.total_m3) * 4, 2);
    expect(run('concrete-piles', { supply: 'bags', count: 200, diameter: '600' }).warnings.some((w) => w.includes('hand mixing'))).toBe(true);
  });
});

describe('drywall', () => {
  // walls 120 x 8 - 60 = 900 sq ft + 400 ceiling = 1,300; x 1.10 waste / 32 = 44.7 -> 45 sheets
  // level 4: 1,300 x 2.3 / 1000 = 2.99 -> 3 pails; tape 1,300 x 0.37 / 250 = 1.9 -> 2 rolls; screws 1,300 x 1.1 / 1000 = 1.4 -> 2 boxes;
  // corner bead 6 corners x 8 ft / 8 ft = 6 pieces
  it('computes the default room', () => {
    const r = run('drywall');
    expect(qty(r, 'DRYWALL-1/2-4X8')).toBe(45);
    expect(qty(r, 'MUD-17L')).toBe(3);
    expect(qty(r, 'TAPE-PAPER')).toBe(2);
    expect(qty(r, 'SCREWS-DRYWALL')).toBe(2);
    expect(qty(r, 'CORNER-BEAD')).toBe(6);
    expect(r.values.board_area_sqft).toBe(1300);
  });

  it('uses 4 x 12 sheets, falls back where the catalog has none, and doubles layers', () => {
    expect(qty(run('drywall', { size: '4x12' }), 'DRYWALL-1/2-4X12')).toBe(30); // 1,300 x 1.1 / 48 = 29.8
    const x = run('drywall', { board: 'fiveEighths', size: '4x12' });
    expect(qty(x, 'DRYWALL-5/8X-4X8')).toBe(45);
    expect(x.warnings.some((w) => w.includes('4 x 8'))).toBe(true);
    expect(qty(run('drywall', { layers: 2 }), 'DRYWALL-1/2-4X8')).toBe(90);
  });

  it('prices labour by finish level, and drops it when switched off', () => {
    const r = run('drywall');
    const labour = r.takeoff.filter((t) => !t.code);
    expect(labour.map((l) => l.labourHoursPerUnit)).toEqual([0.012, 0.028]);
    expect(Number(run('drywall', { level: '5' }).values.labour_hours)).toBeGreaterThan(Number(r.values.labour_hours));
    expect(run('drywall', { labour: false }).takeoff.every((t) => t.code)).toBe(true);
    expect(Number(run('drywall', { level: '5' }).values.pails_17l)).toBeGreaterThan(Number(run('drywall', { level: '1' }).values.pails_17l));
  });

  it('subtracts openings and handles an empty job', () => {
    expect(run('drywall', { openings: 0 }).values.wall_area_sqft).toBe(960);
    expect(run('drywall', { wallLength: 0, ceiling: 0 }).warnings.some((w) => w.includes('Enter'))).toBe(true);
  });
});

describe('paint', () => {
  // walls 800 x 2 coats / 350 = 4.57 -> 5 cans; ceilings 300 x 2 / 350 = 1.71 -> 2 cans; primer (800 + 300) / 300 = 3.67 -> 4 cans
  it('computes cans from area, coats and coverage', () => {
    const r = run('paint');
    expect(qty(r, 'PAINT-INT')).toBe(5);
    expect(qty(r, 'PAINT-CEILING')).toBe(2);
    expect(qty(r, 'PRIMER')).toBe(4);
    expect(r.values.wall_cans).toBeCloseTo(4.57, 2);
    expect(r.values.litres).toBeCloseTo(11 * 3.78, 1);
  });

  it('switches to exterior paint without ceilings, and removes primer or labour', () => {
    const ext = run('paint', { surface: 'ext' });
    expect(qty(ext, 'PAINT-EXT')).toBe(5);
    expect(qty(ext, 'PAINT-CEILING')).toBeUndefined();
    expect(ext.warnings.some((w) => w.includes('Ceiling area is ignored'))).toBe(true);
    expect(qty(run('paint', { primer: false }), 'PRIMER')).toBeUndefined();
    expect(run('paint', { labour: false }).takeoff.every((t) => t.code)).toBe(true);
  });

  it('uses more paint with more coats and less coverage', () => {
    expect(Number(run('paint', { coats: 3 }).values.wall_cans)).toBeGreaterThan(Number(run('paint').values.wall_cans));
    expect(Number(run('paint', { coverage: 250 }).values.wall_cans)).toBeGreaterThan(Number(run('paint').values.wall_cans));
    expect(run('paint', { coats: 1, primer: false }).warnings.some((w) => w.includes('One coat'))).toBe(true);
  });
});

describe('wall-framing', () => {
  // 40 ft at 16 in: 480 / 16 = 30 + 1 = 31; corners 4 x 2 = 8; openings 4 x 4 = 16; 55 x 1.07 = 58.9 -> 59 studs
  // plates 40 x 3 = 120 lin ft x 1.07 / 10 = 12.8 -> 13; headers 4 x 2 x 3.25 = 26 ft x 1.07 / 12 = 2.3 -> 3;
  // OSB: 320 - 4 openings x 3 x 4.5 = 266 sq ft x 1.1 / 32 = 9.1 -> 10 sheets
  it('computes the default wall', () => {
    const r = run('wall-framing');
    expect(qty(r, 'LUMBER-2X4-8')).toBe(59);
    expect(qty(r, 'LUMBER-2X4-10')).toBe(13);
    expect(qty(r, 'LUMBER-2X10-12')).toBe(3);
    expect(qty(r, 'OSB-7/16')).toBe(10);
    expect(qty(r, 'NAILS-FRAMING')).toBe(1);
  });

  it('uses 24 in spacing, 10 ft studs, 2 x 6 and a single top plate', () => {
    expect(Number(run('wall-framing', { spacing: '24' }).values.studs)).toBeLessThan(59);
    const tall = run('wall-framing', { height: 9 });
    expect(qty(tall, 'LUMBER-2X4-10')).toBeGreaterThan(13);
    expect(qty(tall, 'LUMBER-2X4-8')).toBeUndefined();
    const six = run('wall-framing', { studSize: '2x6' });
    expect(qty(six, 'LUMBER-2X6-8')).toBe(59);
    expect(qty(six, 'LUMBER-2X6-12')).toBe(11); // 120 x 1.07 / 12 = 10.7
    expect(run('wall-framing', { studSize: '2x6', height: 10 }).takeoff.find((t) => t.description.includes('2 x 6'))?.code).toBeUndefined();
    expect(run('wall-framing', { doublePlate: false }).values.plate_lin_ft).toBe(80);
    expect(qty(run('wall-framing', { sheathing: false }), 'OSB-7/16')).toBeUndefined();
  });
});

describe('roofing', () => {
  it('computes the pitch factor from the rise', () => {
    expect(pitchFactor(12)).toBeCloseTo(1.4142, 4);
    expect(pitchFactor(6)).toBeCloseTo(1.118, 4);
    expect(pitchFactor(0)).toBe(1);
  });

  // 1,500 sq ft footprint at 6/12: 1,677 sq ft = 16.77 squares; +10% = 18.45 squares x 3 = 55.4 -> 56 bundles
  // ice and water: 80 ft x 3 ft = 240 sq ft x 1.1 / 200 = 1.3 -> 2 rolls; underlay (1,677 - 240) x 1.05 / 1,000 = 1.5 -> 2 rolls
  // drip edge (80 + 60) x 1.05 / 10 = 14.7 -> 15; starter 140 / 100 -> 2; ridge 40 / 25 -> 2
  // vents 1/300: 1,500 x 144 / 300 = 720 sq in / 60 = 12
  it('computes the default roof', () => {
    const r = run('roofing');
    expect(r.values.roof_area_sqft).toBeCloseTo(1677.05, 1);
    expect(qty(r, 'SHINGLE-ARCH')).toBe(56);
    expect(qty(r, 'ICE-WATER')).toBe(2);
    expect(qty(r, 'UNDERLAY-SYN')).toBe(2);
    expect(qty(r, 'DRIP-EDGE')).toBe(15);
    expect(qty(r, 'STARTER-STRIP')).toBe(2);
    expect(qty(r, 'RIDGE-CAP')).toBe(2);
    expect(qty(r, 'ROOF-VENT')).toBe(12);
    expect(qty(r, 'ROOF-NAILS')).toBe(1);
  });

  it('takes a roof area directly and adds tear-off labour and disposal', () => {
    const direct = run('roofing', { mode: 'roof', area: 1677.05 });
    expect(qty(direct, 'SHINGLE-ARCH')).toBe(56);
    const tear = run('roofing', { tearOff: true });
    expect(tear.takeoff.find((t) => !t.code)).toMatchObject({ unit: 'square', labourClass: 'roofer' });
    expect(qty(tear, 'BIN-20YD')).toBe(1); // 16.8 squares / 25
    expect(qty(run('roofing', { tearOff: true, layers: 3, area: 4000 }), 'BIN-20YD')).toBe(Math.ceil((4000 * 1.118034 * 3) / 100 / 25));
  });

  it('warns for low and steep slopes and missing eaves', () => {
    expect(run('roofing', { pitch: '3' }).warnings.some((w) => w.includes('low-slope'))).toBe(true);
    expect(run('roofing', { pitch: '12' }).warnings.some((w) => w.includes('Steep'))).toBe(true);
    expect(run('roofing', { eave: 0 }).takeoff.some((t) => t.code === 'ICE-WATER')).toBe(false);
  });
});

describe('flooring', () => {
  // 400 sq ft LVP straight: 7% waste = 428 sq ft; underlayment 400 x 1.05 = 420
  it('adds waste by type and layout', () => {
    const r = run('flooring');
    expect(qty(r, 'FLOOR-LVP')).toBe(428);
    expect(qty(r, 'UNDERLAY-FOAM')).toBe(420);
    expect(qty(run('flooring', { layout: 'diagonal' }), 'FLOOR-LVP')).toBe(448); // 12%
    expect(qty(run('flooring', { type: 'engineered', layout: 'diagonal' }), 'FLOOR-ENG-HW')).toBe(460); // 15%
    expect(qty(run('flooring', { waste: 20 }), 'FLOOR-LVP')).toBe(480);
  });

  // 200 sq ft of 600 x 300 mm tile, 3 mm joints, 9 mm thick: (900 / 180,000) x 3 x 9 = 0.135 L/m2 x 1.6 kg/L x 1.25 = 0.27 kg/m2;
  // 200 sq ft = 18.58 m2 -> 5.02 kg = 1 bag of 10 kg; 200 x 1.10 = 220 sq ft of tile; thinset 200 / 60 = 3.3 -> 4 bags
  it('adds thinset and grout for tile and no underlayment', () => {
    const r = run('flooring', { type: 'tile', area: 200 });
    expect(qty(r, 'FLOOR-TILE')).toBe(220);
    expect(r.values.grout_kg).toBeCloseTo(5.02, 1);
    expect(qty(r, 'GROUT-10KG')).toBe(1);
    expect(qty(r, 'THINSET-23KG')).toBe(4);
    expect(qty(r, 'UNDERLAY-FOAM')).toBeUndefined();
    expect(run('flooring', { type: 'tile' }).warnings.some((w) => w.includes('Large-format'))).toBe(true);
  });
});

describe('insulation', () => {
  it('picks a batt that meets the target and adds the vapour barrier', () => {
    const r = run('insulation'); // 2 x 6 wall, R-24, 1,000 sq ft
    expect(qty(r, 'INSUL-BATT-R24')).toBe(1000);
    expect(qty(r, 'POLY-6MIL')).toBe(1100);
    expect(r.values.achieved_r).toBe(24);
    expect(r.values.achieved_rsi).toBeCloseTo(4.23, 2); // 24 / 5.678
    expect(qty(run('insulation', { vapour: false }), 'POLY-6MIL')).toBeUndefined();
  });

  // A 2 x 4 wall holds R-14 batts. R-24 needs 10 more: one layer of 2 in XPS (about R-10); 1,000 x 1.1 / 32 = 34.4 -> 35 sheets
  it('adds continuous insulation when the cavity falls short', () => {
    const r = run('insulation', { assembly: 'wall-2x4' });
    expect(qty(r, 'INSUL-BATT-R14')).toBe(1000);
    expect(qty(r, 'XPS-2IN')).toBe(35);
    expect(r.values.achieved_r).toBe(24);
    expect(r.warnings.some((w) => w.includes('continuous exterior insulation'))).toBe(true);
  });

  // Blown attic at R-40 is 40 / 50 of the per-sq-ft R-50 price; two layers of R-31 batts reach R-62
  it('prices blown insulation by R-value and layers batts in an attic', () => {
    expect(qty(run('insulation', { assembly: 'attic', material: 'blown', target: 40 }), 'INSUL-BLOWN-R50')).toBe(800);
    const batts = run('insulation', { assembly: 'attic', target: 50 });
    expect(qty(batts, 'INSUL-BATT-R31')).toBe(2000);
    expect(batts.values.achieved_r).toBe(62);
    const wall = run('insulation', { assembly: 'wall-2x6', material: 'blown' });
    expect(wall.warnings.some((w) => w.includes('attics only'))).toBe(true);
    expect(qty(wall, 'INSUL-BATT-R24')).toBe(1000);
  });
});
