// Provincial wages for the labour model, from the researched sources (see lib/costbook/labour.ts for how they are used).
// Job Bank: hourly wage percentiles (low = 10th, median, high = 90th), Labour Force Survey / EI survey data, reference period
// 2023-2024, page revision 2025-11-19. Provinces Job Bank does not publish for a trade are left out and fall back to the national figure.
// Union: journeyperson base rates from collective agreements or, for Manitoba, the ICI minimum wage schedule (not a union rate).

export type NocTrade = 'electrician' | 'industrial_electrician' | 'plumber' | 'steamfitter_pipefitter' | 'carpenter' | 'hvac_refrigeration_mechanic' | 'sheet_metal_worker' | 'welder' | 'concrete_finisher' | 'drywall_installer_finisher' | 'painter' | 'roofer' | 'floor_covering_installer' | 'heavy_equipment_operator' | 'construction_labourer_helper';
/** [low, median, high] hourly wage. */
export type WageRange = [low: number | null, median: number, high: number | null];

/** Canada-wide Job Bank wages, used where a province has no published figure for the trade. */
export const NATIONAL_WAGE: Record<NocTrade, [number, number, number]> = {
  electrician: [20.0, 35.0, 48.0],
  industrial_electrician: [28.0, 42.0, 54.0],
  plumber: [21.0, 34.0, 46.0],
  steamfitter_pipefitter: [27.0, 43.89, 55.59],
  carpenter: [22.0, 32.12, 44.23],
  hvac_refrigeration_mechanic: [22.0, 37.5, 56.0],
  sheet_metal_worker: [22.7, 34.07, 45.95],
  welder: [22.0, 30.0, 47.0],
  concrete_finisher: [24.5, 34.0, 43.47],
  drywall_installer_finisher: [23.0, 33.0, 43.75],
  painter: [20.0, 28.0, 40.99],
  roofer: [22.0, 30.97, 44.24],
  floor_covering_installer: [17.0, 26.0, 43.0],
  heavy_equipment_operator: [24.0, 32.5, 45.0],
  construction_labourer_helper: [18.25, 25.0, 40.0],
};

export const JOB_BANK_WAGE: Record<NocTrade, Record<string, WageRange>> = {
  electrician: {
    AB: [21.5, 38.0, 46.0], BC: [20.0, 34.0, 47.49], SK: [19.0, 37.5, 48.0], MB: [17.15, 35.0, 46.0], ON: [20.0, 34.0, 50.5], QC: [22.4, 41.3, 44.79], NB: [18.0, 28.0, 35.0], NS: [19.0, 31.0, 42.0], PE: [19.84, 26.44, 40.0], NL: [18.7, 31.0, 45.4], NT: [30.14, 40.55, 50.56], NU: [21.45, 34.67, 47.7],
  },
  industrial_electrician: {
    AB: [25.0, 44.0, 68.0], BC: [35.9, 45.0, 54.95], SK: [38.0, 49.0, 57.78], MB: [27.0, 40.5, 48.0], ON: [29.0, 40.5, 48.0], QC: [24.8, 43.0, 48.0], NB: [28.75, 42.0, 59.62], NS: [30.0, 40.0, 50.0], PE: [29.0, 34.93, 42.5], NL: [26.0, 43.26, 58.1],
  },
  plumber: {
    AB: [20.0, 30.0, 43.0], BC: [23.0, 32.0, 48.0], SK: [22.0, 35.0, 43.0], MB: [21.0, 30.11, 43.0], ON: [20.0, 32.5, 50.38], QC: [24.5, 40.0, 45.0], NB: [16.5, 26.0, 34.0], NS: [18.0, 33.0, 38.38], PE: [20.0, 30.0, 38.0], NL: [18.5, 27.5, 36.03], YT: [20.44, 31.02, 41.25], NT: [25.27, 38.58, 49.54], NU: [25.28, 44.82, 53.12],
  },
  steamfitter_pipefitter: {
    AB: [26.94, 44.9, 56.77], BC: [26.0, 42.05, 59.98], SK: [25.0, 46.02, 54.29], MB: [23.2, 41.93, 53.0], ON: [28.0, 45.96, 56.88], QC: [26.87, 43.88, 47.4], NB: [29.84, 43.0, 53.17], NS: [27.5, 45.0, 60.0], NL: [28.26, 42.65, 53.0],
  },
  carpenter: {
    AB: [22.22, 34.0, 42.0], BC: [23.0, 32.0, 43.71], SK: [19.0, 30.0, 40.0], MB: [20.0, 27.0, 38.99], ON: [22.0, 32.0, 48.0], QC: [24.61, 36.84, 44.0], NB: [18.0, 24.0, 34.0], NS: [20.0, 25.0, 33.8], PE: [20.0, 25.0, 35.0], NL: [20.0, 27.0, 39.27], YT: [25.0, 35.0, 45.0], NT: [22.5, 33.33, 50.0], NU: [20.46, 34.35, 51.99],
  },
  hvac_refrigeration_mechanic: {
    AB: [25.0, 40.0, 54.0], BC: [24.23, 40.0, 62.0], SK: [28.5, 40.0, 59.0], MB: [18.0, 36.07, 45.0], ON: [21.0, 37.0, 58.0], QC: [22.4, 38.0, 46.08], NB: [20.5, 29.76, 45.63], NS: [20.7, 30.84, 53.85], PE: [21.02, 31.21, 34.02], NL: [20.0, 36.0, 46.0],
  },
  sheet_metal_worker: {
    AB: [20.0, 30.0, 42.0], BC: [23.14, 32.16, 45.6], SK: [19.74, 29.5, 44.66], MB: [20.0, 29.5, 42.0], ON: [22.94, 35.0, 48.17], QC: [25.5, 40.0, 44.79], NB: [20.0, 27.3, 35.73], NS: [19.5, 29.0, 38.32], NL: [24.5, 34.75, 45.25],
  },
  welder: {
    AB: [25.0, 38.0, 52.18], BC: [23.25, 35.0, 51.87], SK: [22.0, 32.0, 46.0], MB: [21.0, 27.0, 40.16], ON: [21.0, 28.0, 41.28], QC: [22.0, 28.0, 35.38], NB: [22.0, 28.0, 46.0], NS: [21.0, 29.0, 43.0], PE: [20.0, 25.0, 32.5], NL: [23.46, 38.41, 54.0], YT: [30.96, 37.47, 49.71], NT: [22.48, 48.29, 57.68],
  },
  concrete_finisher: {
    AB: [25.0, 32.0, 41.0], BC: [26.0, 35.0, 43.05], SK: [21.5, 27.3, 36.0], MB: [22.0, 30.0, 36.46], ON: [25.0, 35.7, 45.59], QC: [28.0, 38.0, 43.0], NB: [20.0, 25.0, 30.0], NS: [19.5, 25.0, 30.34], NL: [23.0, 32.9, 42.0],
  },
  drywall_installer_finisher: {
    AB: [20.0, 28.65, 37.0], BC: [22.0, 30.0, 39.84], SK: [20.0, 26.5, 35.0], MB: [19.0, 26.52, 34.0], ON: [24.0, 35.48, 48.73], QC: [25.0, 38.0, 43.34], NB: [21.0, 28.0, 34.28], NS: [18.88, 28.0, 35.13], NL: [20.0, 25.0, 33.0],
  },
  painter: {
    AB: [20.0, 26.0, 34.82], BC: [21.0, 28.0, 35.0], SK: [18.0, 23.0, 30.0], MB: [17.0, 24.0, 30.0], ON: [20.0, 25.0, 34.8], QC: [24.0, 34.98, 41.83], NB: [18.0, 22.0, 29.12], NS: [18.0, 23.0, 33.24], PE: [18.5, 22.0, 26.0], NL: [18.0, 25.0, 38.0],
  },
  roofer: {
    AB: [22.0, 28.0, 38.0], BC: [24.0, 30.0, 39.0], SK: [20.0, 26.0, 35.0], MB: [19.0, 25.67, 35.97], ON: [22.0, 29.14, 40.0], QC: [28.0, 37.6, 45.0], NB: [20.0, 25.0, 32.1], NS: [19.0, 25.0, 33.64], PE: [20.0, 25.0, 30.0], NL: [19.88, 25.0, 31.24],
  },
  floor_covering_installer: {
    AB: [17.0, 25.0, 42.31], BC: [22.0, 30.0, 39.2], SK: [20.0, 25.0, 31.25], MB: [16.0, 22.4, 31.0], ON: [17.6, 26.0, 35.0], QC: [24.42, 36.6, 43.27], NB: [20.25, 23.14, 28.34], NS: [20.0, 20.5, 26.44], NL: [16.64, 23.69, 33.69],
  },
  heavy_equipment_operator: {
    AB: [26.0, 34.3, 45.0], BC: [27.0, 35.75, 46.0], SK: [24.0, 30.0, 44.0], MB: [22.0, 28.92, 38.0], ON: [23.63, 32.0, 47.7], QC: [24.0, 36.0, 43.4], NB: [20.0, 25.0, 34.5], NS: [18.0, 25.0, 35.5], PE: [18.25, 24.0, 35.0], NL: [22.0, 30.0, 38.0], YT: [32.65, 39.0, 42.0], NT: [26.8, 43.73, 64.01], NU: [21.87, 38.08, 51.49],
  },
  construction_labourer_helper: {
    AB: [19.0, 25.0, 35.0], BC: [20.0, 25.0, 38.5], SK: [17.0, 23.0, 31.0], MB: [17.5, 22.0, 31.25], ON: [18.5, 27.0, 42.0], QC: [20.0, 29.85, 37.8], NB: [16.0, 20.0, 26.0], NS: [16.5, 21.0, 29.74], PE: [17.0, 21.5, 29.0], NL: [16.0, 22.0, 39.45], YT: [24.0, 28.5, 34.71], NT: [20.84, 25.0, 30.0], NU: [22.0, 29.0, 42.0],
  },
};

export type UnionKind = 'union' | 'mb-ici';
/** [journeyperson base rate $/h, kind, agreement]. mb-ici is the Manitoba ICI construction minimum wage schedule, not a union rate. */
export const UNION_WAGE: Partial<Record<NocTrade, Record<string, [rate: number, kind: UnionKind, agreement: string]>>> = {
  electrician: {
    AB: [58.59, 'union', "IBEW 424"],
    BC: [51.46, 'union', "IBEW 213"],
    SK: [49.61, 'union', "IBEW 529 & 2038"],
    MB: [44.61, 'mb-ici', "n/a"],
    ON: [56.08, 'union', "IBEW 353"],
    QC: [50.79, 'union', "CCQ"],
    NS: [41.17, 'union', "IBEW 625"],
  },
  plumber: {
    MB: [44.13, 'mb-ici', "n/a"],
    QC: [50.79, 'union', "CCQ"],
  },
  steamfitter_pipefitter: {
    MB: [44.13, 'mb-ici', "n/a"],
  },
  carpenter: {
    MB: [37.69, 'mb-ici', "n/a"],
  },
  hvac_refrigeration_mechanic: {
    MB: [42.55, 'mb-ici', "n/a"],
  },
  sheet_metal_worker: {
    MB: [45.44, 'mb-ici', "n/a"],
    QC: [50.79, 'union', "CCQ"],
  },
  concrete_finisher: {
    MB: [32.56, 'mb-ici', "n/a"],
  },
  drywall_installer_finisher: {
    MB: [36.32, 'mb-ici', "n/a"],
  },
  painter: {
    MB: [33.22, 'mb-ici', "n/a"],
  },
  roofer: {
    MB: [35.73, 'mb-ici', "n/a"],
    QC: [51.2, 'union', "CCQ"],
  },
  floor_covering_installer: {
    MB: [34.66, 'mb-ici', "n/a"],
  },
  construction_labourer_helper: {
    MB: [31.97, 'mb-ici', "n/a"],
  },
};

/** WCB assessment rate, percent of payroll, by province and industry class (2026 rates). */
export type WcbClass = 'electrical' | 'plumbing_hvac' | 'residential_framing' | 'residential_general';
export const WCB_RATE: Record<string, Partial<Record<WcbClass, number>>> = {
  AB: { electrical: 1.83, plumbing_hvac: 1.83, residential_framing: 5.37, residential_general: 1.41 },
  BC: { electrical: 2.12, plumbing_hvac: 2.26, residential_framing: 1.88, residential_general: 2.88 },
  SK: { electrical: 1.62, plumbing_hvac: 1.62, residential_framing: 2.46 },
  ON: { electrical: 1.54, plumbing_hvac: 1.54, residential_framing: 3.55, residential_general: 2.18 },
  QC: { electrical: 3.13, plumbing_hvac: 2.99, residential_framing: 6.04 },
  NB: { electrical: 0.82, plumbing_hvac: 0.82, residential_framing: 2.7, residential_general: 1.88 },
  NS: { electrical: 1.93 },
  PE: { electrical: 2.15, plumbing_hvac: 2.15, residential_general: 3.87 },
  NL: { electrical: 1.48, plumbing_hvac: 1.54, residential_general: 2.44 },
};
