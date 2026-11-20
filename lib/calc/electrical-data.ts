// Shared electrical facts for the calculators: physics constants, name lists and short rule summaries.
// There are deliberately NO code-book tables here. CSA C22.1 (CEC) and the other standards are copyrighted,
// so a contractor types any table value (ampacity, correction factor, box volume, motor current, overcurrent
// percentage) from their own code book, and the calculators do the arithmetic.
// tests/calc-no-tables.test.ts fails if a removed table name is added back anywhere in lib/calc.

/** Conductor sizes, AWG or kcmil, smallest to largest. A name list only. */
export const SIZES = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '300', '350', '400', '500'] as const;
export type Size = (typeof SIZES)[number];

/** Building-wire aluminum is not made below 12 AWG. */
export function sizesFor(material: 'cu' | 'al'): string[] {
  return material === 'cu' ? [...SIZES] : SIZES.filter((s) => s !== '14');
}

// ---- Physics: conductor resistance, computed, never looked up ----
/** Resistivity at 20 C in ohm.mm2/m, and the temperature coefficient per degree C. */
export const RESISTIVITY_20C = { cu: 0.017241, al: 0.028264 } as const;
export const TEMP_COEFF = { cu: 0.00393, al: 0.00403 } as const;
/** Conductor temperature the drop is worked at. */
export const OPERATING_TEMP_C = 75;
/** Stranded conductors are slightly longer and less dense than a solid rod of the same size. */
export const STRANDING_FACTOR = 1.02;
/** kcmil to mm2. */
export const MM2_PER_KCMIL = 0.5067;

/** AWG gauge number n of a size name: 14 to 1 are themselves, 1/0 is 0, 2/0 is -1, 3/0 is -2, 4/0 is -3. Null for kcmil sizes and unknown names. */
export function awgNumber(size: string): number | null {
  const aught = /^([1-4])\/0$/.exec(size);
  if (aught) return 1 - Number(aught[1]);
  if (/^\d{3}$/.test(size)) return null;
  const n = Number(size);
  return Number.isInteger(n) && n >= 1 && n <= 14 ? n : null;
}
/** Conductor cross-section in mm2: AWG diameter d = 0.127 mm x 92^((36-n)/39), or kcmil x 0.5067. Zero for an unknown size. */
export function conductorAreaMm2(size: string): number {
  const n = awgNumber(size);
  if (n !== null) {
    const d = 0.127 * 92 ** ((36 - n) / 39);
    return (Math.PI / 4) * d * d;
  }
  return /^\d{3}$/.test(size) ? Number(size) * MM2_PER_KCMIL : 0;
}
/** Resistivity in ohm.mm2/m at the operating temperature. */
export function resistivityAt(material: 'cu' | 'al', tempC: number = OPERATING_TEMP_C): number {
  return RESISTIVITY_20C[material] * (1 + TEMP_COEFF[material] * (tempC - 20));
}
/** DC resistance in ohm per metre at 75 C, including the stranding factor. Zero for an unknown size. */
export function resistanceOhmPerM(size: string, material: 'cu' | 'al'): number {
  const a = conductorAreaMm2(size);
  return a > 0 ? (resistivityAt(material) * STRANDING_FACTOR) / a : 0;
}
/**
 * Typical AC reactance in ohm per km, used only when the user does not enter one. A rough single figure for
 * conductors 2 AWG and larger; it matters little for small sizes where resistance dominates. Enter the maker's
 * figure for a precise result.
 */
export const TYPICAL_REACTANCE_OHM_PER_KM = { nonmag: 0.14, steel: 0.17 } as const;

// ---- Rule summaries ----
/** Standard ratings of fuses and breakers, amperes (a list of ratings, not a rule table). */
export const STD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1200, 1600, 2000] as const;

/** Maximum overcurrent rating for small copper and aluminum conductors (summary of CEC Rule 14-104). */
export const SMALL_CONDUCTOR_MAX: Record<'cu' | 'al', Record<string, number>> = { cu: { '14': 15, '12': 20, '10': 30 }, al: { '12': 15, '10': 25 } };

/** Conduit fill limits as a share of the conduit cross-section: 53% for one conductor, 31% for two, 40% for three or more. */
export function fillLimitPct(conductors: number): number {
  return conductors <= 1 ? 53 : conductors === 2 ? 31 : 40;
}

// ---- Catalog availability, from lib/costbook/codes.ts (pricing only) ----
export const CU_CODE_SIZES = new Set(['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '350', '500']);
export const AL_CODE_SIZES = new Set(['1/0', '2/0', '3/0', '4/0', '250', '350', '500']);
export function wireCode(material: 'cu' | 'al', size: string): string | undefined {
  return material === 'cu' ? (CU_CODE_SIZES.has(size) ? `CU-RW90-${size}` : undefined) : AL_CODE_SIZES.has(size) ? `AL-RW90-${size}` : undefined;
}

/** Conduit trade sizes with their metric designators (names, not dimensions). */
export const CONDUIT_SIZES = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2', '4'] as const;
export const CONDUIT_METRIC: Record<string, string> = { '1/2': '16', '3/4': '21', '1': '27', '1-1/4': '35', '1-1/2': '41', '2': '53', '2-1/2': '63', '3': '78', '3-1/2': '91', '4': '103' };
export const EMT_CODE_SIZES = new Set(['1/2', '3/4', '1', '1-1/4', '1-1/2', '2']);
export const PVC_CODE_SIZES = new Set(['1/2', '3/4', '1', '1-1/2', '2']);
