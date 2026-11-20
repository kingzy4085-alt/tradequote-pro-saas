// Pure rules behind the estimate editor's price book, calculators, labour rate and tax helpers.
// No React and no network, so every rule here is tested on its own.
import {
  COSTBOOK_AS_OF,
  billingRate,
  getRegion,
  labourCost,
  priceTakeoff,
  regionsForProvince,
  salesTax,
  toEstimateLines,
  type CatalogItem,
  type CompanyPrice,
  type Confidence,
  type LabourClass,
  type PricedLine,
  type ShopType,
  type TakeoffLine,
  type Trade,
} from '@/lib/costbook';
import type { EstimateLine } from '@/lib/estimate-math';

export const REGION_STORAGE_KEY = 'tq-estimate-region';

export const TRADE_LABEL: Record<Trade, string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  carpentry: 'Carpentry',
  drywall: 'Drywall',
  insulation: 'Insulation',
  concrete: 'Concrete',
  roofing: 'Roofing',
  painting: 'Painting',
  flooring: 'Flooring',
  general: 'General',
};

export const LABOUR_CLASS_LABEL: Record<LabourClass, string> = {
  electrician: 'Electrician',
  industrial_electrician: 'Industrial electrician',
  apprentice_electrician: 'Apprentice electrician',
  plumber: 'Plumber',
  pipefitter: 'Pipefitter',
  hvac_mechanic: 'HVAC mechanic',
  sheet_metal: 'Sheet metal worker',
  carpenter: 'Carpenter',
  drywaller: 'Drywaller',
  insulator: 'Insulator',
  concrete_finisher: 'Concrete finisher',
  roofer: 'Roofer',
  painter: 'Painter',
  floor_installer: 'Floor installer',
  welder: 'Welder',
  equipment_operator: 'Equipment operator',
  labourer: 'Labourer',
};

const DEFAULT_CLASS: Record<Trade, LabourClass> = {
  electrical: 'electrician',
  plumbing: 'plumber',
  hvac: 'hvac_mechanic',
  carpentry: 'carpenter',
  drywall: 'drywaller',
  insulation: 'insulator',
  concrete: 'concrete_finisher',
  roofing: 'roofer',
  painting: 'painter',
  flooring: 'floor_installer',
  general: 'carpenter',
};

export const defaultLabourClass = (trade: Trade): LabourClass => DEFAULT_CLASS[trade] ?? 'carpenter';

/** The saved region if it still belongs to the company's province, otherwise the province's own region. */
export function resolveRegion(stored: string | null | undefined, province: string | null | undefined): string {
  const own = getRegion(province).code;
  if (!stored) return own;
  const wanted = String(stored).toUpperCase();
  const allowed = regionsForProvince(getRegion(province).province);
  return allowed.some((r) => r.code === wanted) ? wanted : own;
}

/** Metros only make a selector worthwhile when the province has more than itself. */
export const hasMetros = (province: string | null | undefined) => regionsForProvince(getRegion(province).province).length > 1;

/** Reads the price-book route's answer. Anything unexpected means reference prices only. */
export function parseCompanyPrices(json: unknown): CompanyPrice[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((p): CompanyPrice[] => {
    const row = p as Partial<CompanyPrice> | null;
    if (!row || typeof row.itemCode !== 'string' || !row.itemCode) return [];
    const unitCost = Number(row.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) return [];
    const hours = row.labourHours === null || row.labourHours === undefined ? row.labourHours : Number(row.labourHours);
    return [{ itemCode: row.itemCode, unitCost, labourHours: hours === undefined || hours === null || Number.isFinite(hours) ? hours : null, description: row.description ?? null, unit: row.unit ?? null }];
  });
}

export interface PriceBookRow {
  item: CatalogItem;
  priced: PricedLine;
}

/** Catalog items priced for the region, with the company's own prices merged over the reference. */
export function priceCatalogRows(items: readonly CatalogItem[], region: string, companyPrices: readonly CompanyPrice[]): PriceBookRow[] {
  const priced = priceTakeoff(
    items.map((item) => ({ code: item.code, description: item.description, quantity: 1, unit: item.unit })),
    { region, companyPrices }
  );
  return items.map((item, i) => ({ item, priced: priced[i] }));
}

/** A quantity from a text box: blank or silly means none. */
export function parseQuantity(text: string): number {
  const x = Number(String(text).trim());
  return Number.isFinite(x) && x > 0 ? Math.min(x, 1_000_000) : 0;
}

export interface BuiltLines {
  lines: EstimateLine[];
  priced: PricedLine[];
  /** Lines the cost engine had no price for: they come in at $0 for the person to fill. */
  unpriced: number;
  fromCompany: number;
}

/** Takeoff lines priced for the region and turned into estimate lines. */
export function buildEstimateLines(takeoff: readonly TakeoffLine[], region: string, companyPrices: readonly CompanyPrice[]): BuiltLines {
  const priced = priceTakeoff(takeoff, { region, companyPrices }).filter((l) => l.quantity > 0);
  return {
    lines: toEstimateLines(priced),
    priced,
    unpriced: priced.filter((l) => l.priceSource === 'none').length,
    fromCompany: priced.filter((l) => l.priceSource === 'company').length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What to tell the person after lines were added. */
export function addedNote(built: BuiltLines, regionName: string, from: string): string {
  const parts = [`Added ${plural(built.lines.length, 'line', 'lines')} from ${from}, priced for ${regionName}.`];
  if (built.fromCompany > 0) parts.push(`${plural(built.fromCompany, 'line uses', 'lines use')} your own price.`);
  if (built.unpriced > 0) parts.push(`${plural(built.unpriced, 'line has', 'lines have')} no price yet: type the cost in.`);
  parts.push('Save the estimate to keep them.');
  return parts.join(' ');
}

export const priceSourceLabel = (source: PricedLine['priceSource']) =>
  source === 'company' ? 'Your price' : source === 'reference' ? 'Reference' : source === 'line' ? 'Calculated' : 'No price';

/** How much to trust a reference figure, with the month the book was last checked. */
export function confidenceHint(source: PricedLine['priceSource'], confidence: Confidence | null, asOf: string = COSTBOOK_AS_OF): string {
  if (source === 'company') return 'Your saved price. Check it is still current.';
  if (source !== 'reference') return 'No price on file. Enter your own cost.';
  const how = confidence === 'high' ? 'Seen on a supplier page' : confidence === 'medium' ? 'From a dated price guide' : 'A rough estimate';
  return `${how}, checked ${asOf}. Confirm with your supplier before you send the quote.`;
}

export interface LabourSuggestion {
  /** Fully burdened cost per paid hour. */
  cost: number;
  wage: number;
  burdenPct: number;
  /** Suggested charge-out per hour. */
  charge: number;
}

export function labourSuggestion(labourClass: LabourClass, province: string, shop: ShopType): LabourSuggestion {
  const c = labourCost(labourClass, province, { shop });
  return { cost: c.total, wage: c.wage, burdenPct: c.burdenPct, charge: billingRate(labourClass, province, { shop }) };
}

export const LABOUR_RATE_NOTE = 'This estimate uses one blended labour rate for every hour, so pick the class that does most of the work.';

/** salesTax with the trade where the cost engine accepts it, and without where it does not yet. */
export function salesTaxFor(province: string, trade: Trade) {
  const loose = salesTax as unknown as (p: string, o?: { trade: Trade }) => ReturnType<typeof salesTax>;
  return loose(province, { trade });
}

const HST = new Set(['ON', 'NB', 'NS', 'NL', 'PE']);

/** The tax rule for the province in one sentence a contractor can repeat to a client. */
export function taxSentence(province: string | null | undefined, trade: Trade): string {
  const tax = salesTaxFor(String(province ?? ''), trade);
  const p = tax.province;
  const rate = `${tax.total}%`;
  if (p === 'BC') return `British Columbia: the PST you pay on materials is already in your material cost, so the client is charged GST only (${rate}).`;
  if (p === 'MB') {
    return ['electrical', 'plumbing', 'hvac'].includes(trade)
      ? `Manitoba: electrical, plumbing and HVAC contracts carry 7% RST on the whole contract plus GST, ${rate} in all.`
      : `Manitoba: the PST you pay on materials is already in your material cost, so the client is charged GST only (${rate}).`;
  }
  if (p === 'SK') return `Saskatchewan: 6% PST is charged on the whole contract plus 5% GST, ${rate} in all.`;
  if (p === 'QC') return `Quebec: GST plus QST on the contract, ${rate} in all.`;
  if (HST.has(p)) return `${p === 'ON' ? 'Ontario' : 'Your province'}: HST of ${rate} on the contract.`;
  return `GST of ${rate} on the contract.`;
}

/** Terms with an Exclusions list added. Existing terms are kept; the same list is never added twice. */
export function appendExclusions(terms: string, exclusions: readonly string[]): string {
  const list = exclusions.map((e) => e.trim()).filter(Boolean);
  if (!list.length) return terms;
  const block = `Exclusions:\n${list.map((e) => `- ${e}`).join('\n')}`;
  if (terms.includes(block)) return terms;
  return terms.trim() ? `${terms.replace(/\s+$/, '')}\n\n${block}` : block;
}
