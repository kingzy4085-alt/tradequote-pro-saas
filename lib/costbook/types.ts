// The shared shapes of the cost engine. Calculators, the estimate editor, the AI assistant and the
// public site all speak these types, so they are a contract: add fields, never rename or remove one.

/** What a line of work belongs to. */
export type Trade =
  | 'electrical'
  | 'plumbing'
  | 'hvac'
  | 'carpentry'
  | 'drywall'
  | 'insulation'
  | 'concrete'
  | 'roofing'
  | 'painting'
  | 'flooring'
  | 'general';

export const TRADES: readonly Trade[] = ['electrical', 'plumbing', 'hvac', 'carpentry', 'drywall', 'insulation', 'concrete', 'roofing', 'painting', 'flooring', 'general'];

/** Who does the installing: the labour classification an hourly cost is looked up for. */
export type LabourClass =
  | 'electrician'
  | 'industrial_electrician'
  | 'apprentice_electrician'
  | 'plumber'
  | 'pipefitter'
  | 'hvac_mechanic'
  | 'sheet_metal'
  | 'carpenter'
  | 'drywaller'
  | 'insulator'
  | 'concrete_finisher'
  | 'roofer'
  | 'painter'
  | 'floor_installer'
  | 'welder'
  | 'equipment_operator'
  | 'labourer';

export type ShopType = 'open' | 'union';

/** How sure the reference figure is: seen on a retailer page, from a dated guide, or derived. */
export type Confidence = 'high' | 'medium' | 'low';

/** One priced item in the reference catalog. Prices are national baselines; regions adjust them. */
export interface CatalogItem {
  /** Stable key, e.g. 'NMD90-14-2'. Calculators and saved prices refer to items by it. */
  code: string;
  trade: Trade;
  category: string;
  /** Plain Canadian trade wording, as it should print on an estimate line. */
  description: string;
  /** The unit it is counted and priced in on an estimate: m, ft, ea, sheet, bag, m3, sqft... */
  unit: string;
  /** National baseline contractor cost per unit, CAD before tax. */
  unitCost: number;
  /** Installed labour per unit for a journeyperson, in hours. */
  labourHours: number;
  labourClass: LabourClass;
  /** How it is sold, when that differs from the unit, e.g. '75 m coil'. */
  pack?: string;
  /** Where the price came from, short, e.g. 'homedepot.ca 2026-11'. */
  source: string;
  /** Month the price was last checked, 'YYYY-MM'. */
  asOf: string;
  confidence: Confidence;
  keywords?: string[];
}

/** A pricing area: a province as a whole, or a metro inside it. */
export interface Region {
  /** 'ON' for the province as a whole, 'ON-TORONTO' for a metro. */
  code: string;
  name: string;
  province: string;
  /** Material cost relative to the national baseline (1.00). Freight and market, not labour. */
  materialFactor: number;
  note?: string;
}

export interface SalesTax {
  province: string;
  gst: number;
  pst: number;
  qst: number;
  hst: number;
  /** Percent a client is charged on the contract price. */
  total: number;
  /** True where the contractor pays provincial sales tax on materials it installs into real property (BC, SK, MB). */
  pstOnInstalledMaterials: boolean;
  note?: string;
}

/** What one hour of a trade costs the employer, built up from the wage. */
export interface LabourCost {
  labourClass: LabourClass;
  province: string;
  shop: ShopType;
  /** Base hourly wage the burden is built on. */
  wage: number;
  vacation: number;
  statHoliday: number;
  cpp: number;
  ei: number;
  wcb: number;
  /** Union benefits and pension per hour, or 0 for open shop. */
  benefits: number;
  /** Fully burdened cost per paid hour. */
  total: number;
  /** (total - wage) / wage, as a percent. */
  burdenPct: number;
  source: string;
  asOf: string;
}

/** A company's own price for a catalog item (or its own item), saved in material_price_book. */
export interface CompanyPrice {
  itemCode: string;
  unitCost: number;
  labourHours?: number | null;
  description?: string | null;
  unit?: string | null;
}

/**
 * What a calculator hands over: a quantity of something. When `code` names a catalog item the
 * cost engine prices it; otherwise the line carries its own cost, or none.
 */
export interface TakeoffLine {
  code?: string;
  description: string;
  quantity: number;
  unit: string;
  /** Only for lines without a catalog code. */
  materialUnitCost?: number;
  /** Overrides the catalog's labour hours per unit. */
  labourHoursPerUnit?: number;
  labourClass?: LabourClass;
  note?: string;
}

/** A takeoff line with its price worked out, ready to become an estimate line. */
export interface PricedLine {
  code: string | null;
  description: string;
  quantity: number;
  unit: string;
  materialUnitCost: number;
  labourHoursPerUnit: number;
  labourClass: LabourClass | null;
  /** company: the company's saved price; reference: catalog x region; line: the takeoff's own figure; none: no price known. */
  priceSource: 'company' | 'reference' | 'line' | 'none';
  confidence: Confidence | null;
  note?: string;
}
