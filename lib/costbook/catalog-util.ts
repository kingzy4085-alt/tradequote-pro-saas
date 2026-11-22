// Shared by the catalog-*.ts files: a compact row, turned into the CatalogItem the engine uses.
import type { CatalogItem, Confidence, LabourClass, Trade } from './types';

export type ItemRow = [
  code: string,
  trade: Trade,
  category: string,
  description: string,
  unit: string,
  unitCost: number,
  labourHours: number,
  labourClass: LabourClass,
  pack: string,
  source: string,
  asOf: string,
  confidence: Confidence,
  keywords: string[],
];

export function defineItems(rows: readonly ItemRow[]): CatalogItem[] {
  return rows.map(([code, trade, category, description, unit, unitCost, labourHours, labourClass, pack, source, asOf, confidence, keywords]) => ({
    code,
    trade,
    category,
    description,
    unit,
    unitCost,
    labourHours,
    labourClass,
    pack,
    source,
    asOf,
    confidence,
    keywords,
  }));
}
