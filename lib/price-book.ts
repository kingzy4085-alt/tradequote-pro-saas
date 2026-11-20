// The company price book: a company's own price and labour hours for catalog items and its own items.
// The pure rules live here (validation, CSV in and out, row shape) so the routes and the page share them.
import { z } from 'zod';
import type { CompanyPrice } from '@/lib/costbook/types';

export const PRICE_BOOK_MAX_ITEMS = 500;
export const PRICE_BOOK_LIST_LIMIT = 5000;
/** What a list of saved prices selects. */
export const PRICE_BOOK_COLUMNS = 'item_code, unit_cost, labour_hours, description, unit, category';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const PriceBookItemSchema = z.object({
  itemCode: z.string().trim().min(1, 'Every price needs an item code').max(60, 'Keep item codes under 60 characters'),
  unitCost: z.number({ error: 'Price must be a number' }).finite().min(0, 'A price cannot be below zero').max(1_000_000, 'That price is too large'),
  labourHours: z.number({ error: 'Labour hours must be a number' }).finite().min(0, 'Labour hours cannot be below zero').max(10_000, 'Those labour hours are too large').nullable().optional(),
  description: optionalText(500),
  unit: optionalText(20),
});
export type PriceBookItem = z.infer<typeof PriceBookItemSchema>;

/** A list of prices, or an object with `items`, up to the cap. Later rows for the same code win. */
export function parsePriceBookBody(body: unknown): { ok: true; items: PriceBookItem[] } | { ok: false; error: string } {
  const list = Array.isArray(body) ? body : body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items) ? (body as { items: unknown[] }).items : null;
  if (!list) return { ok: false, error: 'Send a list of prices' };
  if (list.length === 0) return { ok: false, error: 'Send at least one price' };
  if (list.length > PRICE_BOOK_MAX_ITEMS) return { ok: false, error: `Send up to ${PRICE_BOOK_MAX_ITEMS} prices at a time` };
  const items = new Map<string, PriceBookItem>();
  for (let n = 0; n < list.length; n++) {
    const parsed = PriceBookItemSchema.safeParse(list[n]);
    if (!parsed.success) return { ok: false, error: `Price ${n + 1}: ${parsed.error.issues[0]?.message ?? 'Some values were not valid'}` };
    items.set(parsed.data.itemCode, parsed.data);
  }
  return { ok: true, items: [...items.values()] };
}

interface Row {
  item_code: string;
  unit_cost: number | string;
  labour_hours?: number | string | null;
  description?: string | null;
  unit?: string | null;
}

export function toCompanyPrice(row: Row): CompanyPrice {
  const hours = row.labour_hours === null || row.labour_hours === undefined ? null : Number(row.labour_hours);
  return {
    itemCode: row.item_code,
    unitCost: Number(row.unit_cost),
    labourHours: hours !== null && Number.isFinite(hours) ? hours : null,
    description: row.description || null,
    unit: row.unit || null,
  };
}

// ---- CSV: code,unit_cost[,labour_hours] -------------------------------------------------------

/** Splits one CSV line, honouring "quoted, commas" and "" inside quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let n = 0; n < line.length; n++) {
    const ch = line[n];
    if (quoted) {
      if (ch === '"' && line[n + 1] === '"') {
        cur += '"';
        n++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const HEADER = /^(item_?code|code)$/i;

/** Reads pasted or uploaded CSV. A header row is optional; the first problem line is named. */
export function parsePriceCsv(text: string): { items: PriceBookItem[]; errors: string[] } {
  const items = new Map<string, PriceBookItem>();
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    const cells = splitCsvLine(raw);
    if (index === 0 && HEADER.test(cells[0] ?? '')) return;
    const where = `Line ${index + 1}`;
    if (cells.length < 2 || cells.length > 3) return void errors.push(`${where}: use code,unit_cost or code,unit_cost,labour_hours`);
    const cost = Number(cells[1].replace(/^\$/, '').replace(/,/g, ''));
    const hours = cells[2] === undefined || cells[2] === '' ? null : Number(cells[2]);
    const parsed = PriceBookItemSchema.safeParse({ itemCode: cells[0], unitCost: cells[1] === '' ? NaN : cost, labourHours: hours });
    if (!parsed.success) return void errors.push(`${where}: ${parsed.error.issues[0]?.message ?? 'not valid'}`);
    items.set(parsed.data.itemCode, parsed.data);
  });
  if (items.size > PRICE_BOOK_MAX_ITEMS * 20) errors.push('That file is too large. Import it in smaller files.');
  return { items: [...items.values()], errors };
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  // A cell that starts like a formula would run in a spreadsheet: prefix it
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The price book as CSV, in the same shape the importer reads. */
export function priceBookCsv(prices: readonly CompanyPrice[]): string {
  const rows = [...prices].sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  return ['code,unit_cost,labour_hours', ...rows.map((p) => [csvCell(p.itemCode), csvCell(p.unitCost), csvCell(p.labourHours)].join(','))].join('\n') + '\n';
}
