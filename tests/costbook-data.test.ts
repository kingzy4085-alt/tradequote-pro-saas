// The researched data behind the cost engine: catalog prices and units, regional factors, wages,
// payroll burden caps, sales tax and the PST that lands in material cost.
import { describe, expect, it } from 'vitest';
import {
  CATALOG, COSTBOOK_AS_OF, REGIONS, STATUTORY_2026, annualContributions, billingRate, getItem, getRegion, labourCost, priceItem, priceTakeoff, regionsForProvince, salesTax, searchCatalog,
} from '@/lib/costbook';
import { CORE_CODES, CORE_ITEMS } from '@/lib/costbook/codes';
import { JOB_BANK_WAGE, NATIONAL_WAGE, UNION_WAGE } from '@/lib/costbook/labour-data';
import { APPRENTICE_PCT } from '@/lib/costbook/labour';
import { TRADES, type LabourClass } from '@/lib/costbook/types';
import { PROVINCES } from '@/lib/provinces';

/** Core items that carry no installer time of their own: consumables used with another line, rentals and bins. */
const NO_OWN_LABOUR = new Set([
  'NAILS-FRAMING', 'SCREWS-DRYWALL', 'ROOF-NAILS', 'THINSET-23KG', 'GROUT-10KG', 'BIN-20YD', 'TOILET-RENTAL', 'SCAFFOLD-WEEK',
  'SCISSOR-LIFT-DAY', 'SCISSOR-LIFT-WEEK', 'BOOM-LIFT-DAY', 'MINI-EX-DAY',
]);

describe('reference catalog', () => {
  it('is a real catalog: 250+ items, every trade, unique codes', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(250);
    expect(new Set(CATALOG.map((i) => i.code)).size).toBe(CATALOG.length);
    for (const trade of TRADES) expect(CATALOG.some((i) => i.trade === trade), trade).toBe(true);
  });

  it('prices every item above zero, in a counted unit, with a dated source', () => {
    for (const i of CATALOG) {
      expect(i.unitCost, `${i.code} price`).toBeGreaterThan(0);
      expect(Number.isFinite(i.labourHours) && i.labourHours >= 0, `${i.code} hours`).toBe(true);
      expect(i.unit, `${i.code} unit`).toMatch(/^[a-z0-9]{1,8}$/);
      expect(i.asOf >= '2026-01' && i.asOf <= COSTBOOK_AS_OF, `${i.code} asOf ${i.asOf}`).toBe(true);
      expect(['high', 'medium', 'low']).toContain(i.confidence);
      expect(i.description.length, i.code).toBeGreaterThan(5);
    }
  });

  it('gives every core item installer time, except consumables and rentals', () => {
    for (const code of CORE_CODES) {
      const hours = getItem(code)!.labourHours;
      if (NO_OWN_LABOUR.has(code)) expect(hours, code).toBe(0);
      else expect(hours, code).toBeGreaterThan(0);
      expect(getItem(code)!.labourClass, code).toBe(CORE_ITEMS[code].labourClass);
    }
  });

  it('counts packs in the unit calculators use, with sane unit prices', () => {
    // 75 m coils and 3 m lengths are priced per metre, 12 ft pipe per foot, bags of batts per sq ft
    expect(getItem('NMD90-14-2')!.unitCost).toBeCloseTo(2.12, 2); // $159 / 75 m
    expect(getItem('EMT-1/2')!.unitCost).toBeCloseTo(3.14, 2); // $9.57 / 3.05 m
    expect(getItem('PEX-1/2')!.unitCost).toBeCloseTo(0.3795, 3); // $37.95 / 100 ft
    expect(getItem('ABS-2')!.unitCost).toBeCloseTo(27.98 / 12, 2);
    expect(getItem('INSUL-BATT-R20')!.unitCost).toBeCloseTo(58.88 / 78.3, 2);
    expect(getItem('POLY-6MIL')!.unitCost).toBeCloseTo(0.093, 3);
    expect(getItem('FLOOR-LVP')!.unitCost).toBeLessThan(10);
    for (const code of ['NMD90-14-2', 'EMT-3/4', 'CU-RW90-12', 'TECK90-12-3']) expect(getItem(code)!.unitCost, code).toBeLessThan(100);
  });

  it('prices bigger conductors higher and takes longer to pull them', () => {
    const sizes = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '350', '500'];
    for (const prefix of ['CU-RW90-', 'AL-RW90-']) {
      const list = sizes.map((s) => getItem(prefix + s)).filter((i) => i);
      for (let n = 1; n < list.length; n++) {
        expect(list[n]!.unitCost, list[n]!.code).toBeGreaterThan(list[n - 1]!.unitCost);
        expect(list[n]!.labourHours, list[n]!.code).toBeGreaterThan(list[n - 1]!.labourHours);
      }
    }
    // Aluminum costs well under copper of the same size
    for (const s of ['4/0', '250', '500']) expect(getItem('AL-RW90-' + s)!.unitCost).toBeLessThan(getItem('CU-RW90-' + s)!.unitCost);
    const emt = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2'].map((s) => getItem('EMT-' + s)!);
    for (let n = 1; n < emt.length; n++) {
      expect(emt[n].unitCost).toBeGreaterThan(emt[n - 1].unitCost);
      expect(emt[n].labourHours).toBeGreaterThan(emt[n - 1].labourHours);
    }
  });

  it('marks derived prices low confidence and says what they were derived from', () => {
    for (const code of ['CU-RW90-4/0', 'CU-RW90-500', 'AL-RW90-500']) {
      const i = getItem(code)!;
      expect(i.confidence, code).toBe('low');
      expect(i.source, code).toMatch(/derived/);
    }
  });

  it('finds items by trade and words', () => {
    expect(searchCatalog('nmd90 14/2')[0]?.code).toBe('NMD90-14-2');
    expect(searchCatalog('romex').length).toBeGreaterThan(3);
    expect(searchCatalog('', { trade: 'plumbing', limit: 500 }).every((i) => i.trade === 'plumbing')).toBe(true);
    expect(searchCatalog('zzzz')).toEqual([]);
  });
});

describe('regions', () => {
  it('covers every province and territory and the researched metros', () => {
    for (const p of PROVINCES) expect(REGIONS.find((r) => r.code === p.code), p.code).toBeDefined();
    expect(REGIONS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(REGIONS.map((r) => r.code)).size).toBe(REGIONS.length);
    for (const code of ['AB-CALGARY', 'BC-VANCOUVER', 'ON-TORONTO', 'QC-MONTREAL', 'NS-HALIFAX', 'NU-IQALUIT']) expect(getRegion(code).code).toBe(code);
    expect(regionsForProvince('ON').length).toBeGreaterThan(3);
    expect(getRegion('ON-NOWHERE').code).toBe('ON');
    expect(getRegion('nonsense').code).toBe('ON');
  });

  it('keeps material factors in a believable band', () => {
    const north = new Set(['YT', 'NT', 'NU']);
    for (const r of REGIONS) {
      expect(PROVINCES.map((p) => p.code), r.code).toContain(r.province);
      expect(r.materialFactor, r.code).toBeGreaterThanOrEqual(0.9);
      // Provinces and southern metros stay at or under 1.8; the territories carry the researched freight premium (Nunavut 2.0)
      expect(r.materialFactor, r.code).toBeLessThanOrEqual(north.has(r.province) ? 2.0 : 1.8);
    }
    expect(getRegion('NU').materialFactor).toBeGreaterThan(getRegion('ON').materialFactor);
    expect(getRegion('BC-VANCOUVER').materialFactor).toBeGreaterThan(getRegion('QC-MONTREAL').materialFactor);
  });

  it('prices a catalog item for the region', () => {
    const base = getItem('LUMBER-2X4-8')!.unitCost;
    expect(priceItem('LUMBER-2X4-8', { region: 'ON' })!.materialUnitCost).toBeCloseTo(base * 1.01, 2);
    expect(priceItem('LUMBER-2X4-8', { region: 'QC' })!.materialUnitCost).toBeCloseTo(base * 0.96, 2);
    expect(priceItem('NOT-A-CODE', { region: 'ON' })).toBeNull();
  });
});

describe('wages and payroll burden', () => {
  const classes = Object.keys(
    Object.fromEntries(
      ['electrician', 'industrial_electrician', 'apprentice_electrician', 'plumber', 'pipefitter', 'hvac_mechanic', 'sheet_metal', 'carpenter', 'drywaller', 'insulator', 'concrete_finisher', 'roofer', 'painter', 'floor_installer', 'welder', 'equipment_operator', 'labourer'].map((c) => [c, 1])
    )
  ) as LabourClass[];
  const noc: Record<string, keyof typeof NATIONAL_WAGE> = {
    electrician: 'electrician', industrial_electrician: 'industrial_electrician', plumber: 'plumber', pipefitter: 'steamfitter_pipefitter', hvac_mechanic: 'hvac_refrigeration_mechanic',
    sheet_metal: 'sheet_metal_worker', carpenter: 'carpenter', drywaller: 'drywall_installer_finisher', insulator: 'drywall_installer_finisher', concrete_finisher: 'concrete_finisher',
    roofer: 'roofer', painter: 'painter', floor_installer: 'floor_covering_installer', welder: 'welder', equipment_operator: 'heavy_equipment_operator', labourer: 'construction_labourer_helper',
  };

  it('puts every open-shop wage inside the researched Job Bank range for its province', () => {
    for (const p of PROVINCES) {
      for (const c of classes) {
        if (c === 'apprentice_electrician') continue;
        const key = noc[c];
        const row = JOB_BANK_WAGE[key][p.code];
        const [low, median, high] = row ?? NATIONAL_WAGE[key];
        const w = labourCost(c, p.code).wage;
        expect(w, `${c} ${p.code}`).toBe(median);
        expect(w >= (low ?? 0) && w <= (high ?? Infinity), `${c} ${p.code}`).toBe(true);
      }
    }
  });

  it('pays an apprentice electrician a stated share of the journeyperson', () => {
    for (const p of PROVINCES) {
      const j = labourCost('electrician', p.code).wage;
      expect(labourCost('apprentice_electrician', p.code).wage).toBeCloseTo((j * APPRENTICE_PCT) / 100, 1);
      const u = labourCost('electrician', p.code, { shop: 'union' }).wage;
      expect(labourCost('apprentice_electrician', p.code, { shop: 'union' }).wage).toBeCloseTo((u * APPRENTICE_PCT) / 100, 1);
    }
  });

  it('uses the researched union rates, and says where it fell back', () => {
    expect(labourCost('electrician', 'BC', { shop: 'union' }).wage).toBe(51.46);
    expect(labourCost('electrician', 'AB', { shop: 'union' }).wage).toBe(58.59);
    expect(labourCost('electrician', 'ON', { shop: 'union' }).wage).toBe(56.08);
    expect(labourCost('electrician', 'QC', { shop: 'union' }).wage).toBe(50.79);
    expect(labourCost('industrial_electrician', 'BC', { shop: 'union' }).wage).toBe(51.46);
    expect(UNION_WAGE.electrician!.SK![0]).toBe(49.61);
    const noAgreement = labourCost('welder', 'ON', { shop: 'union' });
    expect(noAgreement.source).toMatch(/union uplift/);
    expect(noAgreement.wage).toBeGreaterThan(labourCost('welder', 'ON').wage);
    for (const p of PROVINCES) {
      for (const c of classes) {
        const u = labourCost(c, p.code, { shop: 'union' });
        expect(u.wage, `${c} ${p.code}`).toBeGreaterThan(labourCost(c, p.code).wage);
        expect(u.benefits, `${c} ${p.code}`).toBeGreaterThan(5);
      }
    }
    expect(labourCost('electrician', 'MB', { shop: 'union' }).source).toMatch(/not a union rate/);
    expect(labourCost('electrician', 'BC').benefits).toBe(0);
  });

  it('honours the CPP, CPP2 and EI earnings caps', () => {
    const cap = annualContributions(1_000_000, 'ON');
    expect(cap.cpp).toBeCloseTo(4230.45, 2); // 5.95% of (74,600 - 3,500)
    expect(cap.cpp2).toBeCloseTo(416, 2); // 4% of (85,000 - 74,600)
    expect(cap.ei).toBeCloseTo(1572.3, 1); // 2.282% of 68,900
    expect(cap.qpip).toBe(0);
    expect(STATUTORY_2026.cpp.ympe).toBe(74_600);
    // below the basic exemption nothing is due; between the caps CPP is proportional
    expect(annualContributions(3_000, 'ON').cpp).toBe(0);
    expect(annualContributions(40_000, 'ON').cpp).toBeCloseTo(0.0595 * 36_500, 2);
    expect(annualContributions(80_000, 'ON')).toMatchObject({ cpp: expect.closeTo(4230.45, 2), cpp2: expect.closeTo(0.04 * 5400, 2) });
    expect(annualContributions(70_000, 'ON').cpp2).toBe(0);
    expect(annualContributions(70_000, 'ON').ei).toBeCloseTo(1572.3, 1);
    // Quebec: QPP, QPP2, QPIP and the reduced EI rate
    const qc = annualContributions(1_000_000, 'QC');
    expect(qc.cpp).toBeCloseTo(0.063 * 71_100, 2);
    expect(qc.cpp2).toBeCloseTo(416, 2);
    expect(qc.ei).toBeCloseTo(0.0182 * 68_900, 2);
    expect(qc.qpip).toBeCloseTo(0.00602 * 103_000, 2);
  });

  it('turns the caps into dollars per hour: a high earner pays less per hour than a low one', () => {
    const low = labourCost('labourer', 'AB');
    const high = labourCost('electrician', 'ON', { shop: 'union' });
    const perHour = (c: ReturnType<typeof labourCost>) => (c.cpp + c.ei) / (c.wage + c.vacation + c.statHoliday);
    expect(perHour(high)).toBeLessThan(perHour(low));
    // a union electrician in Ontario is over every cap: CPP + CPP2 + EI over 2,000 h is the maximum
    expect(Math.abs((high.cpp + high.ei) * 2000 - (4230.45 + 416 + 1572.3))).toBeLessThan(15);
    // a low-wage open shop hand is under them: 5.95% over the exemption, 2.282% EI
    const gross = low.wage + low.vacation + low.statHoliday;
    // hourly figures are rounded to the cent, so allow a few dollars over a 2,000 hour year
    expect(Math.abs(low.cpp * 2000 - 0.0595 * (gross * 2000 - 3500))).toBeLessThan(15);
    expect(Math.abs(low.ei * 2000 - 0.02282 * gross * 2000)).toBeLessThan(15);
    // Quebec uses the reduced EI rate, plus QPIP
    const qc = labourCost('electrician', 'QC');
    expect(qc.source).toMatch(/QPP/);
  });

  it('builds up every labour cost from its parts, with vacation, holidays and WCB by province', () => {
    for (const p of PROVINCES) {
      for (const shop of ['open', 'union'] as const) {
        for (const c of classes) {
          const l = labourCost(c, p.code, { shop });
          expect(l.total, `${c} ${p.code}`).toBeCloseTo(l.wage + l.vacation + l.statHoliday + l.cpp + l.ei + l.wcb + l.benefits, 1);
          expect(l.wcb, `${c} ${p.code}`).toBeGreaterThan(0);
          expect(l.burdenPct).toBeGreaterThan(10);
          expect(l.burdenPct).toBeLessThan(shop === 'union' ? 90 : 40);
          expect(l.source.length).toBeGreaterThan(20);
        }
      }
    }
    expect(labourCost('electrician', 'ON').vacation).toBeCloseTo(34 * 0.04, 2);
    expect(labourCost('electrician', 'BC').statHoliday).toBeCloseTo(34 * 0.044, 2);
    expect(labourCost('electrician', 'QC').statHoliday).toBeCloseTo(41.3 * 0.032, 2);
    // WCB follows the province and the trade class
    expect(labourCost('electrician', 'ON').wcb).toBeLessThan(labourCost('carpenter', 'ON').wcb / 34 * 32.12 * 1.01);
    expect(labourCost('carpenter', 'AB').wcb / labourCost('carpenter', 'AB').wage).toBeGreaterThan(0.05);
    expect(labourCost('electrician', 'on-toronto').province).toBe('ON-TORONTO');
  });

  it('suggests charge-out rates inside the researched ranges', () => {
    // [labour class, low, high] for Ontario, from the charge-out research (sitekiln, RenoQuotes, HomeStars and others)
    const ranges: [LabourClass, number, number][] = [
      ['electrician', 95, 150], ['plumber', 80, 140], ['hvac_mechanic', 85, 135], ['carpenter', 70, 110], ['roofer', 65, 100], ['painter', 55, 90], ['welder', 75, 150], ['labourer', 55, 85],
    ];
    for (const [c, low, high] of ranges) {
      const rate = billingRate(c, 'ON');
      expect(rate, c).toBeGreaterThanOrEqual(low);
      expect(rate, c).toBeLessThanOrEqual(high);
    }
    // province bands from the plumber research
    for (const [p, low, high] of [['BC', 85, 130], ['AB', 75, 120], ['QC', 79, 129], ['MB', 70, 115], ['SK', 70, 115]] as const) {
      expect(billingRate('plumber', p), p).toBeGreaterThanOrEqual(low);
      expect(billingRate('plumber', p), p).toBeLessThanOrEqual(high);
    }
    // the knobs still work, and union costs more
    expect(billingRate('electrician', 'ON', { overheadPct: 0, profitPct: 0, utilizationPct: 100 })).toBeCloseTo(labourCost('electrician', 'ON').total, 0);
    expect(billingRate('electrician', 'ON', { shop: 'union' })).toBeGreaterThan(billingRate('electrician', 'ON'));
  });
});

describe('sales tax', () => {
  it('charges GST only in BC, where the contractor pays 7% PST on materials', () => {
    expect(salesTax('BC')).toMatchObject({ gst: 5, pst: 7, total: 5, pstOnInstalledMaterials: true });
    expect(salesTax('BC', { trade: 'electrical' })).toMatchObject({ total: 5, pstOnInstalledMaterials: true });
  });

  it('charges Saskatchewan PST on the total contract price, with materials bought exempt', () => {
    expect(salesTax('SK')).toMatchObject({ gst: 5, pst: 6, total: 11, pstOnInstalledMaterials: false });
    expect(salesTax('SK', { trade: 'electrical' }).total).toBe(11);
  });

  it('treats Manitoba general trades like BC and its mechanical and electrical trades as taxable', () => {
    expect(salesTax('MB')).toMatchObject({ total: 5, pstOnInstalledMaterials: true });
    expect(salesTax('MB', { trade: 'general' })).toMatchObject({ total: 5, pstOnInstalledMaterials: true });
    expect(salesTax('MB', { trade: 'carpentry' })).toMatchObject({ total: 5, pstOnInstalledMaterials: true });
    for (const trade of ['electrical', 'plumbing', 'hvac'] as const) expect(salesTax('MB', { trade }), trade).toMatchObject({ total: 12, pstOnInstalledMaterials: false });
  });

  it('charges Quebec GST and QST on the full price, and Ontario HST', () => {
    expect(salesTax('QC')).toMatchObject({ gst: 5, qst: 9.975, total: 14.975, pstOnInstalledMaterials: false });
    expect(salesTax('ON')).toMatchObject({ hst: 13, total: 13, pstOnInstalledMaterials: false });
    expect(salesTax('NS').total).toBe(14);
    for (const p of ['NB', 'PE', 'NL']) expect(salesTax(p).total, p).toBe(15);
    for (const p of ['AB', 'YT', 'NT', 'NU']) expect(salesTax(p).total, p).toBe(5);
  });

  it('keeps the one-argument behaviour and falls back to Ontario', () => {
    expect(salesTax('bc')).toEqual(salesTax('BC', {}));
    expect(salesTax(null).province).toBe('ON');
    expect(salesTax('XX').total).toBe(13);
    for (const p of PROVINCES) expect(salesTax(p.code).note, p.code).toBeTruthy();
  });
});

describe('PST in material cost', () => {
  const line = (code: string) => [{ code, description: '', quantity: 1, unit: CORE_ITEMS[code].unit }];

  it('adds the 7% PST a BC contractor cannot recover, and says so', () => {
    const base = getItem('LUMBER-2X4-8')!.unitCost;
    const [bc] = priceTakeoff(line('LUMBER-2X4-8'), { region: 'BC' });
    expect(bc.materialUnitCost).toBeCloseTo(base * getRegion('BC').materialFactor * 1.07, 2);
    expect(bc.note).toMatch(/7% BC PST/);
    const [van] = priceTakeoff(line('LUMBER-2X4-8'), { region: 'BC-VANCOUVER' });
    expect(van.materialUnitCost).toBeCloseTo(base * 1.07 * 1.07, 2);
  });

  it('does not add anything in Ontario, Quebec, Alberta or Saskatchewan', () => {
    const base = getItem('NMD90-14-2')!.unitCost;
    for (const region of ['ON', 'QC', 'AB', 'SK', 'NS']) {
      const [l] = priceTakeoff(line('NMD90-14-2'), { region });
      expect(l.materialUnitCost, region).toBeCloseTo(base * getRegion(region).materialFactor, 2);
      expect(l.note, region).toBeUndefined();
    }
  });

  it('adds Manitoba RST to general trade materials only', () => {
    const lumber = getItem('LUMBER-2X4-8')!.unitCost;
    const [mbLumber] = priceTakeoff(line('LUMBER-2X4-8'), { region: 'MB' });
    expect(mbLumber.materialUnitCost).toBeCloseTo(lumber * 1.01 * 1.07, 2);
    expect(mbLumber.note).toMatch(/7% MB RST/);
    const cable = getItem('NMD90-14-2')!.unitCost;
    const [mbCable] = priceTakeoff(line('NMD90-14-2'), { region: 'MB' });
    expect(mbCable.materialUnitCost).toBeCloseTo(cable * 1.01, 2);
    expect(mbCable.note).toBeUndefined();
  });

  it('adds it to the company price too, keeps the line note, and never to the line own cost', () => {
    const [own] = priceTakeoff([{ code: 'LUMBER-2X4-8', description: '', quantity: 1, unit: 'ea', note: 'Supplier quote' }], {
      region: 'BC',
      companyPrices: [{ itemCode: 'LUMBER-2X4-8', unitCost: 10 }],
    });
    expect(own).toMatchObject({ priceSource: 'company', materialUnitCost: 10.7 });
    expect(own.note).toBe('Supplier quote Includes 7% BC PST on materials (not recoverable).');
    const [on] = priceTakeoff(line('LUMBER-2X4-8'), { region: 'ON', companyPrices: [{ itemCode: 'LUMBER-2X4-8', unitCost: 10 }] });
    expect(on.materialUnitCost).toBe(10);
    const [custom] = priceTakeoff([{ description: 'Custom', quantity: 1, unit: 'ea', materialUnitCost: 10 }], { region: 'BC' });
    expect(custom.materialUnitCost).toBe(10);
    // a company's own item in Manitoba with no catalog entry is treated as general trade
    const [mbOwn] = priceTakeoff([{ code: 'MY-ITEM', description: 'Mine', quantity: 1, unit: 'ea' }], { region: 'MB', companyPrices: [{ itemCode: 'MY-ITEM', unitCost: 10 }] });
    expect(mbOwn.materialUnitCost).toBe(10.7);
  });
});
