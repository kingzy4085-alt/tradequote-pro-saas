// One place that turns a job template into a priced quote, used by the landing builder, the demo and
// the tests. It adds nothing to the engine: lines come from a calculator or the template, prices from
// priceTakeoff, and every figure from estimateTotals, so it always agrees with a real estimate.
import { CORE_ITEMS, billingRate, getRegion, priceTakeoff, salesTax, toEstimateLines, type PricedLine, type TakeoffLine } from '@/lib/costbook';
import { getCalculator, runCalculator } from '@/lib/calc/registry';
import type { CalcInput } from '@/lib/calc/types';
import { estimateTotals, type EstimateLine } from '@/lib/estimate-math';
import { getTemplate, type JobTemplate } from './job-templates';

export interface TakeoffPart {
  label: string;
  lines: TakeoffLine[];
  /** The calculator that sized this part, or null when the template's typical scope did. */
  calcName: string | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** The takeoff for a template at a job size: a real calculator where one exists, the typical scope otherwise. */
export function templateTakeoff(template: JobTemplate, size: number): TakeoffPart[] {
  const s = clamp(Number.isFinite(size) ? size : template.scale.default, template.scale.min, template.scale.max);
  return template.parts.map((part) => {
    const calc = part.calc ? getCalculator(part.calc.id) : undefined;
    if (part.calc && calc && calc.fields.some((f) => f.key === part.calc!.scaleKey)) {
      const input: CalcInput = { ...part.calc.input, [part.calc.scaleKey]: s };
      const result = runCalculator(calc.id, input);
      if (result && result.takeoff.length > 0) return { label: part.label, lines: result.takeoff, calcName: calc.name };
    }
    const lines: TakeoffLine[] = part.lines.flatMap((l) => {
      const item = CORE_ITEMS[l.code];
      const quantity = Math.ceil((l.fixed ?? 0) + (l.per ?? 0) * s - 1e-9);
      return item && quantity > 0 ? [{ code: l.code, description: item.description, quantity, unit: item.unit }] : [];
    });
    return { label: part.label, lines, calcName: null };
  });
}

export interface QuoteOptions {
  templateId: string;
  region: string;
  markupPct: number;
  /** Job size in the template's own unit. */
  size?: number;
  /** Hourly rate; the engine's billing rate for the trade when left out. */
  labourRate?: number;
  /** Quantity overrides by line position. */
  qty?: Record<number, number>;
}

export interface Quote {
  template: JobTemplate;
  parts: TakeoffPart[];
  /** Every takeoff line with its price, in takeoff order, including lines edited down to zero. */
  rows: { line: PricedLine; sell: number }[];
  /** Priced lines with a quantity; `estimateLines` is the same list in estimate shape. */
  priced: PricedLine[];
  estimateLines: EstimateLine[];
  totals: ReturnType<typeof estimateTotals>;
  province: string;
  regionName: string;
  materialFactor: number;
  taxPct: number;
  taxNote: string | undefined;
  labourRate: number;
  suggestedRate: number;
  markupPct: number;
  size: number;
  /** True when no line carries a price or labour hours yet. */
  unpriced: boolean;
}

export function buildQuote(opts: QuoteOptions): Quote {
  const template = getTemplate(opts.templateId);
  const size = clamp(opts.size ?? template.scale.default, template.scale.min, template.scale.max);
  const region = getRegion(opts.region);
  const parts = templateTakeoff(template, size);
  const takeoff = parts.flatMap((p) => p.lines).map((l, i) => (opts.qty && opts.qty[i] !== undefined ? { ...l, quantity: Math.max(0, opts.qty[i]) } : l));
  const all = priceTakeoff(takeoff, { region: region.code });
  const priced = all.filter((l) => l.quantity > 0);
  const estimateLines = toEstimateLines(priced);
  const tax = salesTax(region.province);
  const suggestedRate = billingRate(template.labourClass, region.province);
  const labourRate = opts.labourRate !== undefined && Number.isFinite(opts.labourRate) ? Math.max(0, opts.labourRate) : suggestedRate;
  const markupPct = clamp(Number.isFinite(opts.markupPct) ? opts.markupPct : template.defaultMarkup, 0, 100);
  const totals = estimateTotals(estimateLines, labourRate, markupPct, tax.total);
  let n = 0;
  const rows = all.map((line) => ({ line, sell: line.quantity > 0 ? totals.sell[n++] ?? 0 : 0 }));
  return {
    template,
    parts,
    rows,
    priced,
    estimateLines,
    totals,
    province: region.province,
    regionName: region.name,
    materialFactor: region.materialFactor,
    taxPct: tax.total,
    taxNote: tax.pstOnInstalledMaterials ? 'PST on installed materials is your cost here, so the client is charged GST only. Put it in your material prices.' : undefined,
    labourRate,
    suggestedRate,
    markupPct,
    size,
    unpriced: totals.material === 0 && totals.labourHours === 0,
  };
}
