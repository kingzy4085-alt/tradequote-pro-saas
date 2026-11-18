// The cost engine's public surface. Everything outside lib/costbook imports from here, so these
// exports are a contract: keep every name and signature, add freely.
//
// CONTRACT STAGE: the catalog below prices every core item at 0 and the wage table is a national
// placeholder. The researched catalog, regional factors and provincial labour data replace them;
// the functions and their behaviour stay.
import type { EstimateLine } from '@/lib/estimate-math';
import { CORE_ITEMS } from './codes';
import type { CatalogItem, CompanyPrice, LabourClass, LabourCost, PricedLine, Region, SalesTax, ShopType, TakeoffLine, Trade } from './types';

export type * from './types';
export { CORE_ITEMS, CORE_CODES } from './codes';

/** Month the reference prices were last checked. */
export const COSTBOOK_AS_OF = '2026-11';

export const CATALOG: readonly CatalogItem[] = Object.values(CORE_ITEMS).map((c) => ({
  code: c.code,
  trade: c.trade,
  category: c.trade,
  description: c.description,
  unit: c.unit,
  unitCost: 0,
  labourHours: 0,
  labourClass: c.labourClass,
  pack: c.pack,
  source: 'pending research',
  asOf: COSTBOOK_AS_OF,
  confidence: 'low' as const,
}));

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

export const REGIONS: readonly Region[] = [
  ['AB', 'Alberta', 1.0],
  ['BC', 'British Columbia', 1.0],
  ['SK', 'Saskatchewan', 1.0],
  ['MB', 'Manitoba', 1.0],
  ['ON', 'Ontario', 1.0],
  ['QC', 'Quebec', 1.0],
  ['NB', 'New Brunswick', 1.0],
  ['NS', 'Nova Scotia', 1.0],
  ['PE', 'Prince Edward Island', 1.0],
  ['NL', 'Newfoundland and Labrador', 1.0],
  ['YT', 'Yukon', 1.0],
  ['NT', 'Northwest Territories', 1.0],
  ['NU', 'Nunavut', 1.0],
].map(([code, name, materialFactor]) => ({ code: code as string, name: name as string, province: code as string, materialFactor: materialFactor as number }));

/** The region for a code; an unknown metro falls back to its province, and anything else to Ontario. */
export function getRegion(code: string | null | undefined): Region {
  const c = String(code ?? '').toUpperCase();
  return REGIONS.find((r) => r.code === c) ?? REGIONS.find((r) => r.code === c.slice(0, 2)) ?? REGIONS.find((r) => r.code === 'ON')!;
}

export function regionsForProvince(province: string): Region[] {
  return REGIONS.filter((r) => r.province === String(province).toUpperCase());
}

const TAX: Record<string, Omit<SalesTax, 'province' | 'total'>> = {
  AB: { gst: 5, pst: 0, qst: 0, hst: 0, pstOnInstalledMaterials: false },
  BC: { gst: 5, pst: 7, qst: 0, hst: 0, pstOnInstalledMaterials: true },
  SK: { gst: 5, pst: 6, qst: 0, hst: 0, pstOnInstalledMaterials: true },
  MB: { gst: 5, pst: 7, qst: 0, hst: 0, pstOnInstalledMaterials: true },
  ON: { gst: 0, pst: 0, qst: 0, hst: 13, pstOnInstalledMaterials: false },
  QC: { gst: 5, pst: 0, qst: 9.975, hst: 0, pstOnInstalledMaterials: false },
  NB: { gst: 0, pst: 0, qst: 0, hst: 15, pstOnInstalledMaterials: false },
  NS: { gst: 0, pst: 0, qst: 0, hst: 14, pstOnInstalledMaterials: false },
  PE: { gst: 0, pst: 0, qst: 0, hst: 15, pstOnInstalledMaterials: false },
  NL: { gst: 0, pst: 0, qst: 0, hst: 15, pstOnInstalledMaterials: false },
  YT: { gst: 5, pst: 0, qst: 0, hst: 0, pstOnInstalledMaterials: false },
  NT: { gst: 5, pst: 0, qst: 0, hst: 0, pstOnInstalledMaterials: false },
  NU: { gst: 5, pst: 0, qst: 0, hst: 0, pstOnInstalledMaterials: false },
};

/**
 * Sales tax on a contract in the province. Where the contractor pays PST on installed materials
 * (BC, SK, MB), the client is charged GST only and the PST belongs in the material cost.
 */
export function salesTax(province: string | null | undefined): SalesTax {
  const p = String(province ?? '').toUpperCase();
  const t = TAX[p] ?? TAX.ON;
  const total = t.pstOnInstalledMaterials ? t.gst : Math.round((t.gst + t.pst + t.qst + t.hst) * 1000) / 1000;
  return { province: TAX[p] ? p : 'ON', ...t, total };
}

// Placeholder national journeyperson wages until the provincial table lands
const PLACEHOLDER_WAGE: Record<LabourClass, number> = {
  electrician: 40,
  industrial_electrician: 44,
  apprentice_electrician: 26,
  plumber: 40,
  pipefitter: 44,
  hvac_mechanic: 40,
  sheet_metal: 38,
  carpenter: 34,
  drywaller: 32,
  insulator: 30,
  concrete_finisher: 32,
  roofer: 30,
  painter: 28,
  floor_installer: 30,
  welder: 36,
  equipment_operator: 36,
  labourer: 26,
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/** What one paid hour costs the employer: wage plus vacation, statutory holidays, CPP, EI, WCB and benefits. */
export function labourCost(labourClass: LabourClass, province: string, opts: { shop?: ShopType } = {}): LabourCost {
  const shop = opts.shop ?? 'open';
  const wage = PLACEHOLDER_WAGE[labourClass] ?? PLACEHOLDER_WAGE.labourer;
  const vacation = wage * 0.04;
  const statHoliday = wage * 0.036;
  const gross = wage + vacation + statHoliday;
  const cpp = gross * 0.0595;
  const ei = gross * 0.0228;
  const wcb = gross * 0.025;
  const benefits = 0;
  const total = gross + cpp + ei + wcb + benefits;
  return {
    labourClass,
    province: String(province).toUpperCase(),
    shop,
    wage: round2(wage),
    vacation: round2(vacation),
    statHoliday: round2(statHoliday),
    cpp: round2(cpp),
    ei: round2(ei),
    wcb: round2(wcb),
    benefits: round2(benefits),
    total: round2(total),
    burdenPct: round2(((total - wage) / wage) * 100),
    source: 'placeholder',
    asOf: COSTBOOK_AS_OF,
  };
}

/**
 * A suggested hourly charge-out rate: burdened cost, grossed up for the share of paid hours that
 * are not billable, then overhead and profit. Rounded to the dollar.
 */
export function billingRate(
  labourClass: LabourClass,
  province: string,
  opts: { shop?: ShopType; utilizationPct?: number; overheadPct?: number; profitPct?: number } = {}
): number {
  const { total } = labourCost(labourClass, province, { shop: opts.shop });
  const utilization = Math.min(Math.max(opts.utilizationPct ?? 80, 30), 100) / 100;
  const overhead = 1 + Math.max(opts.overheadPct ?? 20, 0) / 100;
  const profit = 1 + Math.max(opts.profitPct ?? 15, 0) / 100;
  return Math.round((total / utilization) * overhead * profit);
}

const companyPriceFor = (code: string, prices: readonly CompanyPrice[] | undefined) => prices?.find((p) => p.itemCode === code);

/**
 * Prices takeoff lines: the company's saved price first, then the reference catalog adjusted for
 * the region, then the line's own figure. Labour hours follow the same order unless the line sets them.
 */
export function priceTakeoff(lines: readonly TakeoffLine[], opts: { region: string; companyPrices?: readonly CompanyPrice[] }): PricedLine[] {
  const region = getRegion(opts.region);
  return lines.map((line) => {
    const quantity = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0;
    const own = line.code ? companyPriceFor(line.code, opts.companyPrices) : undefined;
    const item = line.code ? getItem(line.code) : undefined;
    if (own) {
      return {
        code: line.code!,
        description: line.description || own.description || item?.description || line.code!,
        quantity,
        unit: line.unit || own.unit || item?.unit || 'ea',
        materialUnitCost: round2(own.unitCost),
        labourHoursPerUnit: line.labourHoursPerUnit ?? own.labourHours ?? item?.labourHours ?? 0,
        labourClass: line.labourClass ?? item?.labourClass ?? null,
        priceSource: 'company',
        confidence: null,
        note: line.note,
      };
    }
    if (item) {
      return {
        code: item.code,
        description: line.description || item.description,
        quantity,
        unit: line.unit || item.unit,
        materialUnitCost: round2(item.unitCost * region.materialFactor),
        labourHoursPerUnit: line.labourHoursPerUnit ?? item.labourHours,
        labourClass: line.labourClass ?? item.labourClass,
        priceSource: 'reference',
        confidence: item.confidence,
        note: line.note,
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
