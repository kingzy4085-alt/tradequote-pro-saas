// Pins the contract between the cost engine, the calculators and everything that reads them:
// the estimate editor, the public tools pages and the AI assistant.
import { describe, expect, it } from 'vitest';
import * as costbook from '@/lib/costbook';
import { CORE_CODES, CORE_ITEMS } from '@/lib/costbook/codes';
import { TRADES } from '@/lib/costbook/types';
import * as registry from '@/lib/calc/registry';
import { EstimateLineSchema } from '@/lib/estimate-math';
import { PROVINCES } from '@/lib/provinces';

describe('cost engine contract', () => {
  it('exports every function the rest of the app uses', () => {
    for (const name of ['getItem', 'searchCatalog', 'getRegion', 'regionsForProvince', 'salesTax', 'labourCost', 'billingRate', 'priceTakeoff', 'priceItem', 'toEstimateLines']) {
      expect(typeof (costbook as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(Array.isArray(costbook.CATALOG)).toBe(true);
    expect(Array.isArray(costbook.REGIONS)).toBe(true);
    expect(costbook.COSTBOOK_AS_OF).toMatch(/^\d{4}-\d{2}$/);
  });

  it('prices every core item, in the unit calculators count in', () => {
    expect(new Set(CORE_CODES).size).toBe(CORE_CODES.length);
    for (const code of CORE_CODES) {
      const item = costbook.getItem(code);
      expect(item, code).toBeDefined();
      expect(item!.unit, code).toBe(CORE_ITEMS[code].unit);
      expect(item!.trade, code).toBe(CORE_ITEMS[code].trade);
      expect(Number.isFinite(item!.unitCost) && item!.unitCost >= 0, code).toBe(true);
      expect(Number.isFinite(item!.labourHours) && item!.labourHours >= 0, code).toBe(true);
    }
  });

  it('has catalog codes that are unique, with known trades and dated sources', () => {
    const codes = costbook.CATALOG.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const i of costbook.CATALOG) {
      expect(TRADES, i.code).toContain(i.trade);
      expect(i.asOf, i.code).toMatch(/^\d{4}-\d{2}$/);
      expect(i.source.length, i.code).toBeGreaterThan(0);
    }
  });

  it('has a region and a sales tax for every province and territory', () => {
    for (const p of PROVINCES) {
      expect(costbook.getRegion(p.code).province).toBe(p.code);
      const tax = costbook.salesTax(p.code);
      expect(tax.province).toBe(p.code);
      expect(tax.total).toBeGreaterThanOrEqual(5);
      expect(tax.total).toBeLessThanOrEqual(15);
    }
    // BC: the contractor pays 7% PST on installed materials and charges the client GST only.
    expect(costbook.salesTax('BC')).toMatchObject({ pstOnInstalledMaterials: true, total: 5 });
    // SK: since April 2017 materials are bought PST-exempt and 6% PST is charged on the whole contract
    // price, on top of 5% GST (Saskatchewan Bulletin PST-12).
    expect(costbook.salesTax('SK')).toMatchObject({ pstOnInstalledMaterials: false, total: 11 });
    // MB: general trades are like BC (RST on materials, client pays GST only), but mechanical and electrical
    // systems are taxable on the supply-and-install charge: 7% RST + 5% GST (Manitoba Bulletins 005, 008, 031).
    expect(costbook.salesTax('MB')).toMatchObject({ pstOnInstalledMaterials: true, total: 5 });
    expect(costbook.salesTax('MB', { trade: 'electrical' })).toMatchObject({ pstOnInstalledMaterials: false, total: 12 });
    expect(costbook.salesTax('ON').total).toBe(13);
  });

  it('builds labour cost up from the wage and never below it', () => {
    for (const p of PROVINCES) {
      const c = costbook.labourCost('electrician', p.code);
      expect(c.total).toBeGreaterThan(c.wage);
      expect(c.total).toBeCloseTo(c.wage + c.vacation + c.statHoliday + c.cpp + c.ei + c.wcb + c.benefits, 1);
      expect(costbook.billingRate('electrician', p.code)).toBeGreaterThan(c.total);
    }
  });

  it('prices takeoffs company first, then reference, then the line itself', () => {
    const code = CORE_CODES[0];
    const [company] = costbook.priceTakeoff([{ code, description: 'x', quantity: 2, unit: CORE_ITEMS[code].unit }], {
      region: 'ON',
      companyPrices: [{ itemCode: code, unitCost: 9.99, labourHours: 0.5 }],
    });
    expect(company).toMatchObject({ priceSource: 'company', materialUnitCost: 9.99, labourHoursPerUnit: 0.5, quantity: 2 });
    const [reference] = costbook.priceTakeoff([{ code, description: '', quantity: 1, unit: CORE_ITEMS[code].unit }], { region: 'ON' });
    expect(reference.priceSource).toBe('reference');
    const [own] = costbook.priceTakeoff([{ description: 'Custom part', quantity: 3, unit: 'ea', materialUnitCost: 12.5 }], { region: 'ON' });
    expect(own).toMatchObject({ priceSource: 'line', materialUnitCost: 12.5, code: null });
    const [none] = costbook.priceTakeoff([{ description: 'Unknown', quantity: 1, unit: 'ea' }], { region: 'ON' });
    expect(none.priceSource).toBe('none');
  });

  it('turns priced lines into estimate lines the estimate API accepts', () => {
    const priced = costbook.priceTakeoff(
      CORE_CODES.slice(0, 20).map((code) => ({ code, description: '', quantity: 3, unit: CORE_ITEMS[code].unit })),
      { region: 'BC' }
    );
    for (const line of costbook.toEstimateLines(priced)) expect(EstimateLineSchema.safeParse(line).success, line.description).toBe(true);
  });
});

describe('calculator contract', () => {
  it('exports the registry functions', () => {
    for (const name of ['getCalculator', 'defaultInput', 'runCalculator', 'inputSchema', 'numberInput']) {
      expect(typeof (registry as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(registry.CALCULATORS.length).toBeGreaterThan(0);
  });

  it('every calculator runs on its defaults, on nonsense and on nothing, without throwing', () => {
    const ids = registry.CALCULATORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const calc of registry.CALCULATORS) {
      expect(calc.id, calc.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(TRADES).toContain(calc.trade);
      expect(calc.summary.length, calc.id).toBeGreaterThan(10);
      const nonsense = Object.fromEntries(calc.fields.map((f) => [f.key, 'not a value']));
      for (const input of [registry.defaultInput(calc), nonsense, {}]) {
        const out = calc.run(input);
        expect(out.summary.length, calc.id).toBeGreaterThan(0);
        expect(Array.isArray(out.takeoff) && Array.isArray(out.warnings) && Array.isArray(out.references), calc.id).toBe(true);
        for (const t of out.takeoff) {
          expect(Number.isFinite(t.quantity), `${calc.id} ${t.description}`).toBe(true);
          // A calculator may only name catalog items calculators are allowed to name, in their unit
          if (t.code) {
            expect(CORE_ITEMS[t.code], `${calc.id} names ${t.code}`).toBeDefined();
            expect(t.unit, `${calc.id} ${t.code}`).toBe(CORE_ITEMS[t.code].unit);
          }
        }
      }
      const schema = registry.inputSchema(calc);
      expect(Object.keys(schema.properties).sort()).toEqual(calc.fields.map((f) => f.key).sort());
    }
  });

  it('every calculator output prices into valid estimate lines', () => {
    for (const calc of registry.CALCULATORS) {
      const out = calc.run(registry.defaultInput(calc));
      const lines = costbook.toEstimateLines(costbook.priceTakeoff(out.takeoff, { region: 'AB' }));
      for (const line of lines) expect(EstimateLineSchema.safeParse(line).success, `${calc.id}: ${line.description}`).toBe(true);
    }
  });
});
