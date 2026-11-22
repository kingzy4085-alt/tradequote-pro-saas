// What one paid hour of a trade costs the employer, and a suggested charge-out rate built from it.
//
// Wage: Job Bank median hourly wage for the trade's NOC in the province (open shop), or the union
// journeyperson base rate from the researched agreements. Where a province or trade has no published
// figure the national figure or a stated uplift is used and the line's `source` says so.
//
// Burden is computed, not guessed: CPP/CPP2, EI (or QPP, QPIP and the reduced EI in Quebec) are worked out
// as annual amounts on an assumed 2,000 paid hours so the earnings caps are honoured, then converted back
// to dollars per hour. Vacation, statutory holidays, WCB and union benefits are added on top.
import { JOB_BANK_WAGE, NATIONAL_WAGE, UNION_WAGE, WCB_RATE, type NocTrade, type WcbClass } from './labour-data';
import type { LabourClass, LabourCost, ShopType } from './types';

export const COSTBOOK_LABOUR_AS_OF = '2026-11';

/** Paid hours in a year that annual earnings caps are measured against (50 weeks x 40 h). */
export const PAID_HOURS_PER_YEAR = 2000;

/** Apprentice electrician pay as a percent of the journeyperson wage (a four-year average of the usual 45-85% steps). */
export const APPRENTICE_PCT = 65;

/** Open-shop vacation pay: the 4% statutory minimum for a new hire. */
export const OPEN_SHOP_VACATION_PCT = 4;

/** Paid statutory holidays as a percent of straight-time wages: holidays / (260 - holidays). */
const STAT_HOLIDAY_PCT: Record<string, number> = { BC: 4.4, QC: 3.2 };
const STAT_HOLIDAY_DEFAULT = 3.6;

/** 2026 statutory employer contributions, from the CRA and Revenu Quebec. */
export const STATUTORY_2026 = {
  cpp: { rate: 5.95, ympe: 74_600, basicExemption: 3_500 },
  cpp2: { rate: 4, yampe: 85_000 },
  ei: { rate: 2.282, maxInsurable: 68_900 },
  quebec: {
    qpp: { rate: 6.3, mpe: 74_600, basicExemption: 3_500 },
    qpp2: { rate: 4, ceiling: 85_000 },
    qpip: { rate: 0.602, maxInsurable: 103_000 },
    ei: { rate: 1.82, maxInsurable: 68_900 },
  },
} as const;

export interface Contributions {
  /** CPP (QPP in Quebec) on earnings between the basic exemption and the YMPE. */
  cpp: number;
  /** CPP2 (QPP2 in Quebec) on earnings between the YMPE and the YAMPE. */
  cpp2: number;
  /** EI premium on earnings up to the maximum insurable. */
  ei: number;
  /** Quebec parental insurance premium; 0 elsewhere. */
  qpip: number;
}

const clamp0 = (x: number) => Math.max(x, 0);

/** The employer's annual CPP, CPP2, EI (and QPIP) on a year of earnings. Amounts stop at the yearly maximums. */
export function annualContributions(annualEarnings: number, province: string): Contributions {
  const e = clamp0(annualEarnings);
  const s = STATUTORY_2026;
  if (province === 'QC') {
    const q = s.quebec;
    return {
      cpp: (q.qpp.rate / 100) * clamp0(Math.min(e, q.qpp.mpe) - q.qpp.basicExemption),
      cpp2: (q.qpp2.rate / 100) * clamp0(Math.min(e, q.qpp2.ceiling) - q.qpp.mpe),
      ei: (q.ei.rate / 100) * Math.min(e, q.ei.maxInsurable),
      qpip: (q.qpip.rate / 100) * Math.min(e, q.qpip.maxInsurable),
    };
  }
  return {
    cpp: (s.cpp.rate / 100) * clamp0(Math.min(e, s.cpp.ympe) - s.cpp.basicExemption),
    cpp2: (s.cpp2.rate / 100) * clamp0(Math.min(e, s.cpp2.yampe) - s.cpp.ympe),
    ei: (s.ei.rate / 100) * Math.min(e, s.ei.maxInsurable),
    qpip: 0,
  };
}

const NOC: Record<Exclude<LabourClass, 'apprentice_electrician'>, { trade: NocTrade; noc: string }> = {
  electrician: { trade: 'electrician', noc: '72200' },
  industrial_electrician: { trade: 'industrial_electrician', noc: '72201' },
  plumber: { trade: 'plumber', noc: '72300' },
  pipefitter: { trade: 'steamfitter_pipefitter', noc: '72301' },
  hvac_mechanic: { trade: 'hvac_refrigeration_mechanic', noc: '72402' },
  sheet_metal: { trade: 'sheet_metal_worker', noc: '72102' },
  carpenter: { trade: 'carpenter', noc: '72310' },
  drywaller: { trade: 'drywall_installer_finisher', noc: '73102' },
  // No Job Bank wage for insulators in the research: the closest interior-finishing trade is used
  insulator: { trade: 'drywall_installer_finisher', noc: '73102 (closest to insulator)' },
  concrete_finisher: { trade: 'concrete_finisher', noc: '73100' },
  roofer: { trade: 'roofer', noc: '73110' },
  painter: { trade: 'painter', noc: '73112' },
  floor_installer: { trade: 'floor_covering_installer', noc: '73113' },
  welder: { trade: 'welder', noc: '72106' },
  equipment_operator: { trade: 'heavy_equipment_operator', noc: '73400' },
  labourer: { trade: 'construction_labourer_helper', noc: '75110' },
};

/** Median of the researched union / open-shop ratio for electricians (AB, BC, NS, ON, QC, SK): 1.23 to 1.65. */
export const UNION_UPLIFT = 1.42;

/** Union vacation plus statutory holiday allowance, percent of wage, from the agreements. */
const UNION_VACATION_STAT_PCT: Record<string, number> = { BC: 12, SK: 10.5, ON: 12, NS: 8, QC: 13 };
const UNION_VACATION_STAT_DEFAULT = 12;

/** Union health, welfare, pension and training contributions, $ per hour, from the electrician agreements. */
const UNION_BENEFITS: Record<string, number> = { BC: 9.61, AB: 9.15, SK: 11.48, ON: 20.03, NS: 15.18, QC: 8.875 };
/** Median of the six researched packages, used where a province has none. */
export const UNION_BENEFITS_DEFAULT = 10.55;

/** WCB percent of payroll where the province publishes no class rate in the research: Manitoba average, territorial average. */
const WCB_PROVINCE_AVERAGE: Record<string, number> = { MB: 0.95, YT: 2.4, NT: 2.4, NU: 2.4 };

const WCB_CLASS: Record<LabourClass, WcbClass> = {
  electrician: 'electrical',
  industrial_electrician: 'electrical',
  apprentice_electrician: 'electrical',
  plumber: 'plumbing_hvac',
  pipefitter: 'plumbing_hvac',
  hvac_mechanic: 'plumbing_hvac',
  sheet_metal: 'plumbing_hvac',
  carpenter: 'residential_framing',
  drywaller: 'residential_general',
  insulator: 'residential_general',
  concrete_finisher: 'residential_general',
  roofer: 'residential_general',
  painter: 'residential_general',
  floor_installer: 'residential_general',
  welder: 'residential_general',
  equipment_operator: 'residential_general',
  labourer: 'residential_general',
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 'ON-TORONTO' and 'on' both mean ON; anything not a province or territory is treated as Ontario. */
function provinceOf(code: string): string {
  const c = String(code ?? '').toUpperCase().slice(0, 2);
  return c in WCB_RATE || c in WCB_PROVINCE_AVERAGE ? c : 'ON';
}

function wcbPercent(labourClass: LabourClass, province: string): { pct: number; note: string } {
  const want = WCB_CLASS[labourClass];
  const row = WCB_RATE[province] ?? {};
  if (row[want] !== undefined) return { pct: row[want]!, note: `WCB ${province} ${want.replace('_', ' ')} ${row[want]}%` };
  const alt = row.residential_general !== undefined ? 'residential_general' : row.electrical !== undefined ? 'electrical' : undefined;
  if (alt) return { pct: row[alt]!, note: `WCB ${province} ${alt.replace('_', ' ')} ${row[alt]}% (no ${want.replace('_', ' ')} class rate found)` };
  const avg = WCB_PROVINCE_AVERAGE[province];
  if (avg !== undefined) return { pct: avg, note: `WCB ${province} average ${avg}% (no class rates found)` };
  return { pct: WCB_RATE.ON.electrical!, note: 'WCB Ontario electrical rate (province not found)' };
}

interface Wage {
  wage: number;
  note: string;
  union?: { vacationPct: number; statPct: number; benefits: number; note: string };
}

function openWage(trade: NocTrade, noc: string, province: string): { wage: number; note: string } {
  const row = JOB_BANK_WAGE[trade][province];
  if (row) return { wage: row[1], note: `Job Bank median NOC ${noc} ${province} (2025-11)` };
  return { wage: NATIONAL_WAGE[trade][1], note: `Job Bank national median NOC ${noc}; no ${province} figure published (2025-11)` };
}

function wageFor(labourClass: LabourClass, province: string, shop: ShopType): Wage {
  if (labourClass === 'apprentice_electrician') {
    const j = wageFor('electrician', province, shop);
    return { ...j, wage: round2((j.wage * APPRENTICE_PCT) / 100), note: `apprentice electrician ${APPRENTICE_PCT}% of journeyperson (${j.note})` };
  }
  const { trade, noc } = NOC[labourClass];
  const open = openWage(trade, noc, province);
  if (shop === 'open') return open;

  const statPct = STAT_HOLIDAY_PCT[province] ?? STAT_HOLIDAY_DEFAULT;
  const allowance = UNION_VACATION_STAT_PCT[province] ?? UNION_VACATION_STAT_DEFAULT;
  const vacationPct = Math.max(allowance - statPct, 0);
  const benefits = UNION_BENEFITS[province] ?? UNION_BENEFITS_DEFAULT;
  const packageNote = UNION_BENEFITS[province] !== undefined ? 'electrician agreement package' : 'median electrician package (no agreement found)';
  // Industrial electricians are covered by the same IBEW agreements as inside electricians
  const unionTrade: NocTrade = trade === 'industrial_electrician' ? 'electrician' : trade;
  const found = UNION_WAGE[unionTrade]?.[province];
  const union = { vacationPct, statPct, benefits, note: `${packageNote}, vacation and holidays ${allowance}%` };
  if (found) {
    const [rate, kind, agreement] = found;
    const label = kind === 'mb-ici' ? 'Manitoba ICI minimum wage schedule (not a union rate)' : agreement;
    return { wage: rate, note: `${label} base rate`, union };
  }
  return { wage: round2(open.wage * UNION_UPLIFT), note: `${open.note} x ${UNION_UPLIFT} union uplift (no agreement rate found)`, union };
}

/** What one paid hour costs the employer: wage plus vacation, statutory holidays, CPP, EI, WCB and benefits. */
export function labourCost(labourClass: LabourClass, province: string, opts: { shop?: ShopType } = {}): LabourCost {
  const shop = opts.shop ?? 'open';
  const prov = provinceOf(province);
  const cls: LabourClass = labourClass in WCB_CLASS ? labourClass : 'labourer';
  const w = wageFor(cls, prov, shop);

  const vacationPct = w.union ? w.union.vacationPct : OPEN_SHOP_VACATION_PCT;
  const statPct = w.union ? w.union.statPct : (STAT_HOLIDAY_PCT[prov] ?? STAT_HOLIDAY_DEFAULT);
  const wage = round2(w.wage);
  const vacation = round2((wage * vacationPct) / 100);
  const statHoliday = round2((wage * statPct) / 100);
  const gross = wage + vacation + statHoliday;

  const c = annualContributions(gross * PAID_HOURS_PER_YEAR, prov);
  const cpp = round2((c.cpp + c.cpp2) / PAID_HOURS_PER_YEAR);
  const ei = round2((c.ei + c.qpip) / PAID_HOURS_PER_YEAR);
  const wcbRate = wcbPercent(cls, prov);
  const wcb = round2((gross * wcbRate.pct) / 100);
  const benefits = w.union ? round2(w.union.benefits) : 0;
  const total = round2(wage + vacation + statHoliday + cpp + ei + wcb + benefits);

  return {
    labourClass: cls,
    province: String(province ?? '').toUpperCase(),
    shop,
    wage,
    vacation,
    statHoliday,
    cpp,
    ei,
    wcb,
    benefits,
    total,
    burdenPct: round2(((total - wage) / wage) * 100),
    source: `${w.note}; ${wcbRate.note}; ${prov === 'QC' ? 'QPP/QPIP/EI' : 'CPP/CPP2/EI'} 2026 on ${PAID_HOURS_PER_YEAR} paid h${w.union ? `; ${w.union.note}` : ''}`,
    asOf: COSTBOOK_LABOUR_AS_OF,
  };
}

/**
 * Billing defaults. A shop bills about 70% of the hours it pays (the rest is travel, shop time, training and
 * weather), carries about 45% on top of burdened labour for truck, tools, insurance, office and supervision,
 * and earns 20% profit. These put the suggested rate for an open-shop journeyperson inside the researched
 * charge-out ranges for electricians, plumbers, HVAC technicians, carpenters, roofers, painters and welders
 * (tests/costbook-data.test.ts checks this). Drywall is the exception: its published range ($35-55) is a
 * labour-only crew rate and sits well below a full shop rate.
 */
export const BILLING_DEFAULTS = { utilizationPct: 70, overheadPct: 45, profitPct: 20 } as const;

/**
 * Union (ICI) crews bill most paid hours on large jobs, and the package already carries benefits and
 * pension, so the open-shop gross-up would overstate the rate: the open-shop defaults put an Alberta
 * IBEW 424 journeyperson near $197/h, where ICI time-and-material rates run roughly $120-160/h. No
 * union charge-out survey was found, so these are estimating assumptions; callers can override them.
 */
export const UNION_BILLING_DEFAULTS = { utilizationPct: 85, overheadPct: 25, profitPct: 10 } as const;

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
  const defaults = opts.shop === 'union' ? UNION_BILLING_DEFAULTS : BILLING_DEFAULTS;
  const utilization = Math.min(Math.max(opts.utilizationPct ?? defaults.utilizationPct, 30), 100) / 100;
  const overhead = 1 + Math.max(opts.overheadPct ?? defaults.overheadPct, 0) / 100;
  const profit = 1 + Math.max(opts.profitPct ?? defaults.profitPct, 0) / 100;
  return Math.round((total / utilization) * overhead * profit);
}
