// Tabulated electrical facts used by the electrical calculators. Values are published table figures
// (CSA C22.1:24 Canadian Electrical Code and the NEC Chapter 9 tables the CEC Appendix D mirrors), stored
// as data so a reviewer can check each row against its table. Confidence notes sit beside each table.

/** Conductor sizes, AWG or kcmil, smallest to largest. */
export const SIZES = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '300', '350', '400', '500'] as const;
export type Size = (typeof SIZES)[number];

/** Ampacity at [60, 75, 90] degrees C. */
type Amp = Record<string, [number, number, number]>;

/** CEC Table 2: copper, not more than three conductors in a raceway or cable, 30 C ambient. Checked against the 2024 edition for 14 to 6 AWG. */
export const T2_CU: Amp = {
  '14': [15, 20, 25], '12': [20, 25, 30], '10': [30, 35, 40], '8': [40, 50, 55], '6': [55, 65, 75], '4': [70, 85, 95], '3': [85, 100, 115], '2': [95, 115, 130],
  '1': [110, 130, 145], '1/0': [125, 150, 170], '2/0': [145, 175, 195], '3/0': [165, 200, 225], '4/0': [195, 230, 260], '250': [215, 255, 290], '300': [240, 285, 320],
  '350': [260, 310, 350], '400': [280, 335, 380], '500': [320, 380, 430],
};
/** CEC Table 4: aluminum, raceway or cable. Checked against the 2024 edition through 300 kcmil; 350 to 500 from the matching standard figures. */
export const T4_AL: Amp = {
  '12': [15, 20, 25], '10': [25, 30, 35], '8': [35, 40, 45], '6': [40, 50, 55], '4': [55, 65, 75], '3': [65, 75, 85], '2': [75, 90, 100], '1': [85, 100, 115],
  '1/0': [100, 120, 135], '2/0': [115, 135, 150], '3/0': [130, 155, 175], '4/0': [150, 180, 205], '250': [170, 205, 230], '300': [195, 230, 260],
  '350': [210, 250, 280], '400': [225, 270, 305], '500': [260, 310, 350],
};
/** CEC Table 1: copper, single conductor in free air. Checked for 14 to 4 AWG; larger sizes from the standard free-air figures. */
export const T1_CU: Amp = {
  '14': [25, 30, 35], '12': [30, 35, 40], '10': [40, 50, 55], '8': [60, 70, 80], '6': [80, 95, 105], '4': [105, 125, 140], '3': [120, 145, 165], '2': [140, 170, 190],
  '1': [165, 195, 220], '1/0': [195, 230, 260], '2/0': [225, 265, 300], '3/0': [260, 310, 350], '4/0': [300, 360, 405], '250': [340, 405, 455], '300': [375, 445, 505],
  '350': [420, 505, 570], '400': [455, 545, 615], '500': [515, 620, 700],
};
/** CEC Table 3: aluminum, single conductor in free air. Checked for 12 to 8 AWG; larger sizes from the standard free-air figures. */
export const T3_AL: Amp = {
  '12': [25, 30, 35], '10': [35, 40, 45], '8': [45, 55, 60], '6': [60, 75, 85], '4': [80, 100, 115], '3': [95, 115, 130], '2': [110, 135, 150], '1': [130, 155, 175],
  '1/0': [150, 180, 205], '2/0': [175, 210, 235], '3/0': [200, 240, 270], '4/0': [230, 275, 310], '250': [265, 315, 355], '300': [290, 345, 390],
  '350': [330, 390, 440], '400': [355, 420, 475], '500': [405, 485, 545],
};

export function sizesFor(material: 'cu' | 'al'): string[] {
  return SIZES.filter((s) => (material === 'cu' ? T2_CU[s] : T4_AL[s]));
}
export function ampTable(material: 'cu' | 'al', freeAir: boolean): Amp {
  return material === 'cu' ? (freeAir ? T1_CU : T2_CU) : freeAir ? T3_AL : T4_AL;
}

/** DC resistance at 75 C, ohms per 1000 ft (NEC Chapter 9 Table 8, uncoated stranded copper; CEC Appendix D Table D3 is derived from the same values). */
export const R_CU: Record<string, number> = {
  '14': 3.14, '12': 1.98, '10': 1.24, '8': 0.778, '6': 0.491, '4': 0.308, '3': 0.245, '2': 0.194, '1': 0.154, '1/0': 0.122, '2/0': 0.0967, '3/0': 0.0766, '4/0': 0.0608,
  '250': 0.0515, '300': 0.0429, '350': 0.0367, '400': 0.0321, '500': 0.0258,
};
/** As above for aluminum (stranded). */
export const R_AL: Record<string, number> = {
  '12': 3.25, '10': 2.04, '8': 1.28, '6': 0.808, '4': 0.508, '3': 0.403, '2': 0.319, '1': 0.253, '1/0': 0.201, '2/0': 0.159, '3/0': 0.126, '4/0': 0.1, '250': 0.0847,
  '300': 0.0707, '350': 0.0605, '400': 0.0529, '500': 0.0424,
};
/** AC reactance, ohms per 1000 ft (NEC Chapter 9 Table 9): [PVC, aluminum conduit or cable, steel conduit or armour]. */
export const XL: Record<string, [number, number]> = {
  '14': [0.058, 0.073], '12': [0.054, 0.068], '10': [0.05, 0.063], '8': [0.052, 0.065], '6': [0.051, 0.064], '4': [0.048, 0.06], '3': [0.047, 0.059], '2': [0.045, 0.057],
  '1': [0.046, 0.057], '1/0': [0.044, 0.055], '2/0': [0.043, 0.054], '3/0': [0.042, 0.052], '4/0': [0.041, 0.051], '250': [0.041, 0.052], '300': [0.041, 0.051],
  '350': [0.04, 0.05], '400': [0.04, 0.049], '500': [0.039, 0.048],
};

/** Standard ratings of fuses and breakers (CEC Rule 14-104 and Table 13), amperes. */
export const STD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1200, 1600, 2000] as const;

/** Maximum overcurrent rating for small copper and aluminum conductors (CEC Rule 14-104 2). */
export const SMALL_CONDUCTOR_MAX: Record<'cu' | 'al', Record<string, number>> = { cu: { '14': 15, '12': 20, '10': 30 }, al: { '12': 15, '10': 25 } };

/** Ambient correction, CEC Table 5A, from the same square-root relationship the table is built on (matches the table to its printed 2 decimals). */
export function ambientFactor(insulationC: number, ambientC: number): number {
  if (ambientC <= 30) return 1;
  if (ambientC >= insulationC) return 0;
  return Math.round(Math.sqrt((insulationC - ambientC) / (insulationC - 30)) * 100) / 100;
}
/** CEC Table 5C: more than three conductors in a raceway or cable. */
export function countFactor(n: number): number {
  if (n <= 3) return 1;
  if (n <= 6) return 0.8;
  if (n <= 24) return 0.7;
  if (n <= 42) return 0.6;
  return 0.5;
}

/** Table 2/4 and 5A/5C based usable ampacity, with the termination limit of CEC Rule 4-006. */
export function usableAmpacity(size: string, material: 'cu' | 'al', insulationC: 60 | 75 | 90, terminationC: 60 | 75 | 90, ambientC: number, conductors: number, freeAir: boolean) {
  const col = (c: number) => (c === 60 ? 0 : c === 75 ? 1 : 2);
  const t = ampTable(material, freeAir)[size];
  if (!t) return null;
  const base = t[col(insulationC)];
  const corrected = base * ambientFactor(insulationC, ambientC) * (freeAir ? 1 : countFactor(conductors));
  const termination = t[col(Math.min(terminationC, insulationC))];
  return { base, corrected, termination, usable: Math.min(corrected, termination), ambient: ambientFactor(insulationC, ambientC), count: freeAir ? 1 : countFactor(conductors) };
}

// Catalog availability, from lib/costbook/codes.ts (copper RW90 and aluminum RW90 per metre).
export const CU_CODE_SIZES = new Set(['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '350', '500']);
export const AL_CODE_SIZES = new Set(['1/0', '2/0', '3/0', '4/0', '250', '350', '500']);
export function wireCode(material: 'cu' | 'al', size: string): string | undefined {
  return material === 'cu' ? (CU_CODE_SIZES.has(size) ? `CU-RW90-${size}` : undefined) : AL_CODE_SIZES.has(size) ? `AL-RW90-${size}` : undefined;
}

/** Conductor diameters over the strands, mm (NEC Chapter 9 Table 8; they match the CEC Appendix D strand tables, e.g. 4/0 = 13.4 mm, 500 kcmil = 20.7 mm). */
export const COND_OD_MM: Record<string, number> = {
  '14': 1.85, '12': 2.34, '10': 2.95, '8': 3.71, '6': 4.67, '4': 5.89, '3': 6.6, '2': 7.42, '1': 8.43, '1/0': 9.45, '2/0': 10.62, '3/0': 11.94, '4/0': 13.41,
  '250': 14.6, '300': 16.0, '350': 17.3, '400': 18.5, '500': 20.65,
};
/** RW90 XLPE 600 V insulation thickness, mm. 1.14 mm reproduces CEC Table 6A at 14, 12 and 6 AWG; 1.65 mm reproduces 500 kcmil. 1 to 4/0 is interpolated (see references). */
export function rw90InsulationMm(size: string): number {
  if (['1', '1/0', '2/0', '3/0', '4/0'].includes(size)) return 1.4;
  if (['250', '300', '350', '400', '500'].includes(size)) return 1.65;
  return 1.14;
}
/** Area of one RW90 XLPE 600 V conductor over its insulation, mm2 (CEC Table 6A basis). */
export function rw90AreaMm2(size: string): number {
  const d = (COND_OD_MM[size] ?? 0) + 2 * rw90InsulationMm(size);
  return (Math.PI / 4) * d * d;
}
/** T90 Nylon / THHN area, mm2, from the NEC Chapter 9 Table 5 figures in in2 (CEC Table 6K gives 6.16, 8.45 and 13.7 mm2 for 14, 12 and 10 AWG, within 2 per cent). */
const THHN_IN2: Record<string, number> = {
  '14': 0.0097, '12': 0.0133, '10': 0.0211, '8': 0.0366, '6': 0.0507, '4': 0.0824, '3': 0.0973, '2': 0.1158, '1': 0.1562, '1/0': 0.1855, '2/0': 0.2223, '3/0': 0.2679,
  '4/0': 0.3237, '250': 0.397, '300': 0.4608, '350': 0.5242, '400': 0.5863, '500': 0.7073,
};
export const nylonAreaMm2 = (size: string): number => (THHN_IN2[size] ?? 0) * 645.16;

/** Conduit trade sizes with metric designators and internal areas, mm2 (100% of the cross-section). */
export const CONDUIT_SIZES = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2', '4'] as const;
export const CONDUIT_METRIC: Record<string, string> = { '1/2': '16', '3/4': '21', '1': '27', '1-1/4': '35', '1-1/2': '41', '2': '53', '2-1/2': '63', '3': '78', '3-1/2': '91', '4': '103' };
/** EMT: NEC Chapter 9 Table 4 areas, except 16 mm where the CEC 40 per cent figure (72.51 mm2) gives 181 mm2. */
export const EMT_AREA_MM2: Record<string, number> = { '1/2': 181, '3/4': 343, '1': 556, '1-1/4': 968, '1-1/2': 1314, '2': 2165, '2-1/2': 3779, '3': 5707, '3-1/2': 7448, '4': 9880 };
/** Rigid PVC: CEC Table 9 rigid PVC internal diameters (14.57, 19.77, 25.4, 31.75, 38.1, 50.8, 61.3, 76.2, 88.4, 100.1 mm). */
export const PVC_AREA_MM2: Record<string, number> = { '1/2': 167, '3/4': 307, '1': 507, '1-1/4': 792, '1-1/2': 1140, '2': 2027, '2-1/2': 2951, '3': 4560, '3-1/2': 6138, '4': 7870 };
export const EMT_CODE_SIZES = new Set(['1/2', '3/4', '1', '1-1/4', '1-1/2', '2']);
export const PVC_CODE_SIZES = new Set(['1/2', '3/4', '1', '1-1/2', '2']);

/** Three-phase motor full-load current, amperes (CEC Table 44, checked against the 2024 edition). Columns 208, 230, 460, 575 V. */
export const MOTOR_3PH_HP = [0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200];
export const MOTOR_3PH: Record<'208' | '230' | '460' | '575', number[]> = {
  '208': [2.4, 3.5, 4.6, 6.6, 7.5, 10.6, 16.7, 24.2, 30.8, 46.2, 59.4, 74.8, 88, 114, 143, 169, 211, 273, 343, 396, 528],
  '230': [2.2, 3.2, 4.2, 6, 6.8, 9.6, 15.2, 22, 28, 42, 54, 68, 80, 104, 130, 154, 192, 248, 312, 360, 480],
  '460': [1.1, 1.6, 2.1, 3, 3.4, 4.8, 7.6, 11, 14, 21, 27, 34, 40, 52, 65, 77, 96, 124, 156, 180, 240],
  '575': [0.9, 1.3, 1.7, 2.4, 2.7, 3.9, 6.1, 9, 11, 17, 22, 27, 32, 41, 52, 62, 77, 99, 125, 144, 192],
};
/** Single-phase motor full-load current, amperes (CEC Table 45, checked against the 2024 edition). */
export const MOTOR_1PH_HP = [1 / 6, 0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10];
export const MOTOR_1PH: Record<'115' | '230', number[]> = {
  '115': [4.4, 5.8, 7.2, 9.8, 13.8, 16, 20, 24, 34, 56, 80, 100],
  '230': [2.2, 2.9, 3.6, 4.9, 6.9, 8, 10, 12, 17, 28, 40, 50],
};
