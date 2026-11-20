// The cost engine's public surface. Everything outside lib/costbook imports from here, so these
// exports are a contract: keep every name and signature, add freely.
//
// The data lives next to this file: catalog-*.ts (researched prices), regions.ts (regional factors),
// labour.ts and labour-data.ts (wages and burden), tax.ts (sales tax). This file holds the functions
// that put them together.
import type { EstimateLine } from '@/lib/estimate-math';
import { BUILDING_ITEMS } from './catalog-building';
import { ELECTRICAL_ITEMS } from './catalog-electrical';
import { MECHANICAL_ITEMS } from './catalog-mechanical';
import { REGIONS } from './regions';
import { salesTax } from './tax';
import type { CatalogItem, CompanyPrice, PricedLine, Region, TakeoffLine, Trade } from './types';

export type * from './types';
export { CORE_ITEMS, CORE_CODES } from './codes';
export { REGIONS } from './regions';
export { salesTax } from './tax';
export { billingRate, labourCost, BILLING_DEFAULTS, annualContributions, STATUTORY_2026, APPRENTICE_PCT } from './labour';

/** Month the reference prices were last checked. */
export const COSTBOOK_AS_OF = '2026-11';

export const CATALOG: readonly CatalogItem[] = [...ELECTRICAL_ITEMS, ...MECHANICAL_ITEMS, ...BUILDING_ITEMS];

const BY_CODE = new Map(CATALOG.map((i) => [i.code, i]));

export function getItem(code: string): CatalogItem | undefined {
  return BY_CODE.get(code);
}

/** Catalog items whose description, code, category or keywords contain every word of the query. */
export function searchCatalog(query: string, opts: { trade?: Trade; limit?: number } = {}): CatalogItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const limit = opts.limit ?? 25;
  const out: CatalogItem[] = [];
  for (const item of CATALOG) {
    if (opts.trade && item.trade !== opts.trade) continue;
    const hay = [item.code, item.description, item.category, ...(item.keywords ?? [])].join(' ').toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** The region for a code; an unknown metro falls back to its province, and anything else to Ontario. */
export function getRegion(code: string | null | undefined): Region {
  const c = String(code ?? '').toUpperCase();
  return REGIONS.find((r) => r.code === c) ?? REGIONS.find((r) => r.code === c.slice(0, 2)) ?? REGIONS.find((r) => r.code === 'ON')!;
}

export function regionsForProvince(province: string): Region[] {
  return REGIONS.filter((r) => r.province === String(province).toUpperCase());
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The provincial sales tax a contractor pays and cannot recover on materials it installs: BC, and
 * Manitoba general trades. GST, HST and QST are recoverable and are never added to a cost.
 */
function nonRecoverablePst(province: string, trade: Trade | undefined): { pct: number; note: string } {
  const tax = salesTax(province, { trade: trade ?? 'general' });
  if (!tax.pstOnInstalledMaterials || tax.pst <= 0) return { pct: 0, note: '' };
  const name = tax.province === 'MB' ? 'RST' : 'PST';
  return { pct: tax.pst, note: `Includes ${tax.pst}% ${tax.province} ${name} on materials (not recoverable).` };
}

const joinNotes = (...notes: (string | undefined)[]) => notes.filter(Boolean).join(' ') || undefined;

/**
 * Items whose delivered price swings by city far more than the general material factor allows:
 * ready-mix is batched and trucked locally, and Toronto runs about a third above Edmonton. Researched
 * delivered prices per m³ (2026: Dufferin's Toronto list, Calgary and Lower Mainland supplier guides,
 * an estimator guide's city figures). 32 MPa adds about $32 per m³ except where a list price was found.
 * Province-wide regions keep the national figure times the regional factor.
 */
const CITY_PRICES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'CONC-25MPA': { 'ON-TORONTO': 266, 'ON-OTTAWA': 200, 'QC-MONTREAL': 195, 'NS-HALIFAX': 205, 'MB-WINNIPEG': 200, 'SK-SASKATOON': 198, 'AB-EDMONTON': 190, 'AB-CALGARY': 200, 'BC-VANCOUVER': 240 },
  'CONC-32MPA': { 'ON-TORONTO': 295, 'ON-OTTAWA': 232, 'QC-MONTREAL': 227, 'NS-HALIFAX': 237, 'MB-WINNIPEG': 232, 'SK-SASKATOON': 230, 'AB-EDMONTON': 222, 'AB-CALGARY': 232, 'BC-VANCOUVER': 272 },
};

/** The reference unit cost for a region: a researched city price where one exists, else national x factor. */
function referenceUnitCost(item: CatalogItem, region: Region): { cost: number; note?: string } {
  const city = CITY_PRICES[item.code]?.[region.code];
  return city !== undefined ? { cost: city, note: `Delivered price for ${region.name}.` } : { cost: item.unitCost * region.materialFactor };
}

const companyPriceFor = (code: string, prices: readonly CompanyPrice[] | undefined) => prices?.find((p) => p.itemCode === code);

/**
 * Prices takeoff lines: the company's saved price first, then the reference catalog adjusted for
 * the region, then the line's own figure. Labour hours follow the same order unless the line sets them.
 * Where the contractor pays PST it cannot recover on installed materials (BC, and Manitoba general
 * trades), that PST is added to the material cost of catalog and company prices and the note says so.
 */
export function priceTakeoff(lines: readonly TakeoffLine[], opts: { region: string; companyPrices?: readonly CompanyPrice[] }): PricedLine[] {
  const region = getRegion(opts.region);
  return lines.map((line) => {
    const quantity = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0;
    const own = line.code ? companyPriceFor(line.code, opts.companyPrices) : undefined;
    const item = line.code ? getItem(line.code) : undefined;
    if (own) {
      const pst = nonRecoverablePst(region.province, item?.trade);
      return {
        code: line.code!,
        description: line.description || own.description || item?.description || line.code!,
        quantity,
        unit: line.unit || own.unit || item?.unit || 'ea',
        materialUnitCost: round2(own.unitCost * (1 + pst.pct / 100)),
        labourHoursPerUnit: line.labourHoursPerUnit ?? own.labourHours ?? item?.labourHours ?? 0,
        labourClass: line.labourClass ?? item?.labourClass ?? null,
        priceSource: 'company',
        confidence: null,
        note: joinNotes(line.note, pst.note),
      };
    }
    if (item) {
      const pst = nonRecoverablePst(region.province, item.trade);
      const ref = referenceUnitCost(item, region);
      return {
        code: item.code,
        description: line.description || item.description,
        quantity,
        unit: line.unit || item.unit,
        materialUnitCost: round2(ref.cost * (1 + pst.pct / 100)),
        labourHoursPerUnit: line.labourHoursPerUnit ?? item.labourHours,
        labourClass: line.labourClass ?? item.labourClass,
        priceSource: 'reference',
        confidence: item.confidence,
        note: joinNotes(line.note, ref.note, pst.note),
      };
    }
    const hasOwnCost = typeof line.materialUnitCost === 'number' && Number.isFinite(line.materialUnitCost);
    return {
      code: line.code ?? null,
      description: line.description,
      quantity,
      unit: line.unit || 'ea',
      materialUnitCost: hasOwnCost ? round2(Math.max(line.materialUnitCost!, 0)) : 0,
      labourHoursPerUnit: line.labourHoursPerUnit ?? 0,
      labourClass: line.labourClass ?? null,
      priceSource: hasOwnCost ? 'line' : 'none',
      confidence: null,
      note: line.note,
    };
  });
}

/** One catalog item priced for the region (quantity 1), or null for an unknown code. */
export function priceItem(code: string, opts: { region: string; companyPrices?: readonly CompanyPrice[] }): PricedLine | null {
  const item = getItem(code);
  const own = companyPriceFor(code, opts.companyPrices);
  if (!item && !own) return null;
  return priceTakeoff([{ code, description: '', quantity: 1, unit: '' }], opts)[0];
}

/** Priced lines as estimate lines, the shape the estimate editor and the estimate_items table use. */
export function toEstimateLines(lines: readonly PricedLine[]): EstimateLine[] {
  return lines
    .filter((l) => l.quantity > 0)
    .map((l) => ({
      description: l.description.slice(0, 500),
      quantity: Math.round(l.quantity * 1000) / 1000,
      unit: l.unit.slice(0, 20),
      material_unit_cost: round2(l.materialUnitCost),
      labour_hours_per_unit: Math.round(l.labourHoursPerUnit * 1000) / 1000,
    }));
}
