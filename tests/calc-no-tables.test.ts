// The calculators do the arithmetic; the contractor types any table value from their own code book.
// CSA C22.1 (CEC) and the other standards are copyrighted, so no table may be embedded in lib/calc.
// This fails if a removed table, or a helper that read one, comes back under the same name.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AHJ_CHECK_LINE } from '@/lib/calc/common';
import { CALCULATORS } from '@/lib/calc/registry';

const ROOT = join(process.cwd(), 'lib', 'calc');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const REMOVED = [
  'T1_CU', 'T2_CU', 'T3_AL', 'T4_AL', 'R_CU', 'R_AL', 'XL', 'COND_OD_MM', 'THHN_IN2', 'T22_ML', 'BOXES', 'T5C', 'TABLE_5C',
  'EMT_AREA_MM2', 'PVC_AREA_MM2', 'MOTOR_3PH', 'MOTOR_1PH', 'MOTOR_3PH_HP', 'MOTOR_1PH_HP', 'T44', 'T45', 'T29',
  'ampTable', 'usableAmpacity', 'ambientFactor', 'countFactor', 'rw90AreaMm2', 'rw90InsulationMm', 'nylonAreaMm2',
];

describe('lib/calc embeds no code-book tables', () => {
  const files = sources(ROOT);
  it('finds the calculator sources', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('contains none of the removed table names', () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const name of REMOVED) {
        // ambientFactor is also the label of a typed input field, so a quoted key is not the removed helper
        const re = name === 'ambientFactor' ? /\bambientFactor\s*\(/ : new RegExp(`\\b${name}\\b`);
        if (re.test(text)) hits.push(`${file.slice(ROOT.length + 1)}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('keeps the electrical data file to constants, name lists and short rule summaries', () => {
    // The three-row small-conductor overcurrent limit is the one short rule summary the owner allowed to stay
    const text = readFileSync(join(ROOT, 'electrical-data.ts'), 'utf8').replace(/export const SMALL_CONDUCTOR_MAX[^\n]*\n/, '');
    // A table is a record or array of per-size numeric rows; none may exist
    expect(text).not.toMatch(/'(14|12|10|8|6|4|3|2|1|1\/0|2\/0|3\/0|4\/0|250|300|350|400|500)':\s*[\[\d]/);
    expect(text).not.toMatch(/Record<string, \[number/);
  });

  it('keeps the shared AHJ line in every electrical calculator', () => {
    for (const calc of CALCULATORS.filter((c) => c.trade === 'electrical')) {
      expect(calc.run({}).references, calc.id).toContain(AHJ_CHECK_LINE);
    }
  });

  it('cites only the rule numbers the last audit kept in the reworked calculators', () => {
    const kept = new Set(['8-102', '8-104', '8-200', '14-104', '26-712', '12-3034']);
    for (const id of ['voltage-drop', 'conductor-size', 'conduit-fill', 'box-fill', 'motor-circuit', 'ev-charger-circuit']) {
      const text = readFileSync(join(ROOT, 'calculators', `${id}.ts`), 'utf8');
      for (const m of text.matchAll(/\b[Rr]ules? (\d{1,2}-\d{3,4})/g)) expect(kept.has(m[1]), `${id}: Rule ${m[1]}`).toBe(true);
    }
  });

  it('names no rule numbers beyond the audited set in the transformer and takeoff calculators', () => {
    for (const id of ['transformer-sizing', 'residential-wiring-takeoff']) {
      const text = readFileSync(join(ROOT, 'calculators', `${id}.ts`), 'utf8');
      expect(text, id).not.toMatch(/Table 13|NBC 9\.33\.4|9\.33\.4/);
    }
  });
});

// A table is an object or array that maps three or more conductor size names to numbers. Size-name lists
// and physics constants do not map names to numbers, so they never match.
const SIZE = String.raw`(?:14|12|10|8|6|4|3|2|1|1\/0|2\/0|3\/0|4\/0|250|300|350|400|500|600|700|750|900|1000)`;
const AWG_ONLY = String.raw`(?:14|12|10|8|1\/0|2\/0|3\/0|4\/0|250|300|350|400|500|600|700|750|900|1000)`;
// A key at the start of a line or after a brace or comma, so a ternary such as `x ? 2 : 0` is not a table entry
const KEY_THEN_NUMBER = new RegExp(String.raw`(?:^|[{,\n])[ \t]*['"]?${SIZE}['"]?\s*:\s*-?\d`, 'g');
// ['14', 15] pairs for any size name; longer rows only when they start with a name that is not also a NEMA starter size
const TUPLE_WITH_NUMBER = new RegExp(String.raw`\[\s*['"]${SIZE}['"]\s*,\s*-?\d[\d.]*\s*\]|\[\s*['"]${AWG_ONLY}['"](?:\s*,\s*-?\d[\d.]*){1,}\s*\]`, 'g');
const AWG_LABELLED = new RegExp(String.raw`\b${SIZE}\s*(?:awg|kcmil)\b[^\n]{0,12}[:=]\s*-?\d`, 'gi');
const WINDOW = 800;

/** Offsets where three or more size-to-number entries sit within one window, which is what a table looks like. */
export function findSizeTables(text: string): number[] {
  const hits: number[] = [];
  for (const re of [KEY_THEN_NUMBER, TUPLE_WITH_NUMBER, AWG_LABELLED]) {
    const at = [...text.matchAll(re)].map((m) => m.index ?? 0);
    for (let i = 0; i + 2 < at.length; i++) if (at[i + 2] - at[i] <= WINDOW) hits.push(at[i]);
  }
  return hits;
}

describe('no shipped path carries table-shaped size data', () => {
  const SHIPPED = ['lib/calc', 'components/calc', 'app/tools', 'app/demo', 'components/marketing', 'lib/assistant.ts', 'lib/ai-estimate.ts'];
  const all = SHIPPED.flatMap((rel) => {
    const abs = join(process.cwd(), rel);
    return statSync(abs).isDirectory() ? sources(abs) : [abs];
  });

  it('scans every shipped path', () => {
    expect(all.length).toBeGreaterThan(25);
    for (const rel of SHIPPED) expect(all.some((f) => f.startsWith(join(process.cwd(), rel))), rel).toBe(true);
  });

  it('finds no object or array mapping three or more AWG or kcmil names to numbers', () => {
    const hits: string[] = [];
    for (const file of all) {
      // The three-row small-conductor limit is the one short rule summary the owner allowed to stay
      const text = readFileSync(file, 'utf8').replace(/export const SMALL_CONDUCTOR_MAX[^\n]*\n/, '');
      for (const at of findSizeTables(text)) hits.push(`${relative(process.cwd(), file)}:${text.slice(0, at).split('\n').length}`);
    }
    expect(hits).toEqual([]);
  });

  it('would catch a table in each common shape, and ignores name lists and constants', () => {
    expect(findSizeTables("const T = { '14': 15, '12': 20, '10': 30 };").length).toBeGreaterThan(0);
    expect(findSizeTables('const T = { 14: 15,\n 12: 20,\n 10: 30 };').length).toBeGreaterThan(0);
    expect(findSizeTables("const T = [['14', 15], ['12', 20], ['10', 30]];").length).toBeGreaterThan(0);
    expect(findSizeTables("const T: Record<string, number> = { '1/0': 150, '2/0': 175, '250': 215 };").length).toBeGreaterThan(0);
    expect(findSizeTables("const SIZES = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0'];")).toEqual([]);
    expect(findSizeTables('const RHO = 0.017241; const ALPHA = 0.00393; const K = 0.5067; const D = 0.127 * 92 ** 2;')).toEqual([]);
    expect(findSizeTables("const small = { cu: { '14': 15, '12': 20 } };")).toEqual([]);
  });
});
describe('retired edition-sensitive citations stay out of shipped calculator guidance', () => {
  const SHIPPED = [
    'lib/calc',
    'components/calc',
    'app/tools',
    'app/demo',
    'components/marketing',
    'lib/assistant.ts',
    'lib/ai-estimate.ts',
  ];

  const all = SHIPPED.flatMap((rel) => {
    const abs = join(process.cwd(), rel);
    return statSync(abs).isDirectory() ? sources(abs) : [abs];
  });

  const retired = [
    /Rule 12-3034/i,
    /Rule 26-712/i,
    /Rule 26-700/i,
    /\bTable 29\b/i,
    /\bTable 44\b/i,
    /\bTable 45\b/i,
    /NBC(?: 2020)?(?: Part 9)? Section 9\.15/i,
    /NBC(?: 2020)? Section 9\.36/i,
    /\bNBC 9\.25\b/i,
    /NBC(?: 2020)? Section 9\.26/i,
    /\b9\.19\.1\.2\b/,
    /NBC 2020 Appendix C Table C-2/i,
    /NECB 2020 Part 4/i,
  ];

  it('does not restore retired specific citations', () => {
    const hits: string[] = [];
    for (const file of all) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of retired) {
        if (pattern.test(text)) hits.push(`${relative(process.cwd(), file)}: ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
