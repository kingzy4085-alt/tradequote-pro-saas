// The pure rules behind the estimate editor's price book, calculators, labour rate and tax helpers.
import { describe, expect, it } from 'vitest';
import { CATALOG, regionsForProvince } from '@/lib/costbook';
import {
  addedNote,
  appendExclusions,
  buildEstimateLines,
  confidenceHint,
  defaultLabourClass,
  hasMetros,
  labourSuggestion,
  parseCompanyPrices,
  parseQuantity,
  priceCatalogRows,
  resolveRegion,
  salesTaxFor,
  taxSentence,
} from '@/lib/estimate-helpers';

const first = CATALOG[0];

describe('region choice', () => {
  it('defaults to the province and drops a saved region from another province', () => {
    expect(resolveRegion(null, 'ON')).toBe('ON');
    expect(resolveRegion('BC', 'ON')).toBe('ON');
    expect(resolveRegion('nonsense', 'AB')).toBe('AB');
    const metro = regionsForProvince('ON').find((r) => r.code !== 'ON');
    if (metro) expect(resolveRegion(metro.code, 'ON')).toBe(metro.code);
    expect(hasMetros('ON')).toBe(regionsForProvince('ON').length > 1);
  });
});

describe('company prices', () => {
  it('accepts good rows and ignores junk, and a bad answer means reference prices only', () => {
    expect(parseCompanyPrices(null)).toEqual([]);
    expect(parseCompanyPrices({ error: 'x' })).toEqual([]);
    const rows = parseCompanyPrices({ data: [{ itemCode: 'A', unitCost: 2.5, labourHours: 0.1 }, { itemCode: '', unitCost: 1 }, { itemCode: 'B', unitCost: -3 }, { itemCode: 'C', unitCost: 'x' }, null] });
    expect(rows.map((r) => r.itemCode)).toEqual(['A']);
    expect(rows[0].unitCost).toBe(2.5);
  });

  it('puts the company price over the reference one and labels the source', () => {
    const own = [{ itemCode: first.code, unitCost: 99.5, labourHours: 0.5 }];
    const [row] = priceCatalogRows([first], 'ON', own);
    expect(row.priced.priceSource).toBe('company');
    expect(row.priced.materialUnitCost).toBe(99.5);
    expect(row.priced.labourHoursPerUnit).toBe(0.5);
    expect(priceCatalogRows([first], 'ON', [])[0].priced.priceSource).toBe('reference');
  });
});

describe('building lines', () => {
  it('prices a takeoff into estimate lines, skipping zero quantities, and reports what it could not price', () => {
    const built = buildEstimateLines(
      [
        { code: first.code, description: first.description, quantity: 3, unit: first.unit },
        { description: 'Mystery', quantity: 1, unit: 'ea' },
        { code: first.code, description: 'none', quantity: 0, unit: 'ea' },
      ],
      'ON',
      [{ itemCode: first.code, unitCost: 10 }]
    );
    expect(built.lines).toHaveLength(2);
    expect(built.lines[0]).toMatchObject({ quantity: 3, material_unit_cost: 10 });
    expect(built.fromCompany).toBe(1);
    expect(built.unpriced).toBe(1);
    expect(addedNote(built, 'Ontario', 'the price book')).toMatch(/Added 2 lines.*your own price.*no price yet.*Save/);
  });

  it('reads quantities safely', () => {
    expect(parseQuantity('2.5')).toBe(2.5);
    expect(parseQuantity('')).toBe(0);
    expect(parseQuantity('-4')).toBe(0);
    expect(parseQuantity('abc')).toBe(0);
  });

  it('gives a confidence hint with the month checked', () => {
    expect(confidenceHint('reference', 'high', '2026-11')).toContain('2026-11');
    expect(confidenceHint('company', null)).toMatch(/Your saved price/);
    expect(confidenceHint('none', null)).toMatch(/No price/);
  });
});

describe('labour and tax helpers', () => {
  it('suggests a charge-out above the burdened cost, which is above the wage', () => {
    const s = labourSuggestion('electrician', 'ON', 'open');
    expect(s.cost).toBeGreaterThan(s.wage);
    expect(s.charge).toBeGreaterThan(s.cost);
    expect(defaultLabourClass('electrical')).toBe('electrician');
  });

  it('works whether or not salesTax takes a trade', () => {
    expect(salesTaxFor('ON', 'general').province).toBe('ON');
    expect(typeof salesTaxFor('MB', 'electrical').total).toBe('number');
  });

  it('states each province rule in one sentence', () => {
    expect(taxSentence('BC', 'general')).toMatch(/PST.*material cost.*GST only/);
    expect(taxSentence('MB', 'general')).toMatch(/material cost.*GST only/);
    expect(taxSentence('MB', 'electrical')).toMatch(/7% RST/);
    expect(taxSentence('SK', 'general')).toMatch(/6% PST.*whole contract/);
    expect(taxSentence('QC', 'general')).toMatch(/GST plus QST/);
    expect(taxSentence('ON', 'general')).toMatch(/HST/);
    expect(taxSentence('NS', 'general')).toMatch(/HST/);
    expect(taxSentence('AB', 'general')).toMatch(/^GST/);
  });
});

describe('exclusions', () => {
  it('appends an Exclusions list, keeps the terms, and never adds it twice', () => {
    expect(appendExclusions('Net 30', ['Painting', ' Permits '])).toBe('Net 30\n\nExclusions:\n- Painting\n- Permits');
    expect(appendExclusions('', ['Painting'])).toBe('Exclusions:\n- Painting');
    const once = appendExclusions('Net 30', ['Painting']);
    expect(appendExclusions(once, ['Painting'])).toBe(once);
    expect(appendExclusions('Net 30', [' '])).toBe('Net 30');
  });
});
