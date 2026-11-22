// The calculators do the arithmetic; the contractor types any table value from their own code book.
// CSA C22.1 (CEC) and the other standards are copyrighted, so no table may be embedded in lib/calc.
// This fails if a removed table, or a helper that read one, comes back under the same name.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
});
