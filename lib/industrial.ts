// Two things an industrial bid needs that a parts list does not: an allowance for time that
// installs nothing (lockout/tagout, orientation, permits), and the permit and inspection fee.
// Both become ordinary estimate lines, so the database still works out the totals.
import type { EstimateLine } from './estimate-math';

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** How the allowance line starts. That is how it is found again, so there is never a second one. */
export const NPT_PREFIX = 'Non-productive time allowance';
export const DEFAULT_NPT_PERCENT = 10;
export const MAX_NPT_PERCENT = 100;

export const isNptLine = (l: Pick<EstimateLine, 'description'>) => String(l.description ?? '').startsWith(NPT_PREFIX);

/** A percent from what was typed: 0 to 100, or the default when the box is blank or nonsense. */
export function parseNptPercent(value: unknown): number {
  if (value === '' || value === null || value === undefined) return DEFAULT_NPT_PERCENT;
  const x = Number(value);
  if (!Number.isFinite(x) || x < 0) return DEFAULT_NPT_PERCENT;
  return Math.min(x, MAX_NPT_PERCENT);
}

/** Labour hours on every line except the allowance itself, so updating it never compounds. */
export function productiveHours(lines: readonly EstimateLine[]): number {
  return Math.round(lines.filter((l) => !isNptLine(l)).reduce((sum, l) => sum + num(l.quantity) * num(l.labour_hours_per_unit), 0) * 100) / 100;
}

/** The allowance as a labour-only line: that percent of the hours on the other lines. */
export function nptLine(lines: readonly EstimateLine[], percent: unknown): EstimateLine {
  const pct = parseNptPercent(percent);
  return {
    description: `${NPT_PREFIX}: lockout/tagout, orientation and permits (${pct}% of labour)`,
    quantity: 1,
    unit: 'lot',
    material_unit_cost: 0,
    labour_hours_per_unit: Math.round(productiveHours(lines) * pct) / 100,
  };
}

/** Adds the allowance, or brings the one already there up to date in place. */
export function withNptAllowance(lines: readonly EstimateLine[], percent: unknown): EstimateLine[] {
  const line = nptLine(lines, percent);
  return lines.some(isNptLine) ? lines.map((l) => (isNptLine(l) ? line : l)) : [...lines, line];
}

// Who issues the electrical permit. Only where it is one well-known body; elsewhere the line is
// generic and the estimator names it. Fees are never guessed: they depend on the job.
const PERMIT_AUTHORITY: Record<string, string> = {
  SK: 'TSASK electrical permit and inspection',
  AB: 'Electrical permit and inspection (Safety Codes Act)',
  BC: 'Technical Safety BC electrical permit and inspection',
  MB: 'Electrical permit and inspection (Manitoba Hydro or City of Winnipeg)',
  ON: 'ESA notification and inspection',
  NS: 'Nova Scotia Power wiring permit and inspection',
};

export const PERMIT_PREFIX = 'Permit: ';

export const isPermitLine = (l: Pick<EstimateLine, 'description'>) => String(l.description ?? '').startsWith(PERMIT_PREFIX);

export function permitDescription(province: string | null | undefined): string {
  return `${PERMIT_PREFIX}${PERMIT_AUTHORITY[String(province ?? '').toUpperCase()] ?? 'Electrical permit and inspection'}`;
}

/** Adds the permit line for the company's province, with the fee left for the estimator to type. One per estimate. */
export function withPermitLine(lines: readonly EstimateLine[], province: string | null | undefined): EstimateLine[] {
  if (lines.some(isPermitLine)) return [...lines];
  return [...lines, { description: permitDescription(province), quantity: 1, unit: 'ea', material_unit_cost: 0, labour_hours_per_unit: 0 }];
}
