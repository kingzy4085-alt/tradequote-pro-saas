// Saved assemblies: the pure rules, and the database's own isolation, role and subscription gates.
import { beforeAll, describe, expect, it } from 'vitest';
import { STARTER_ASSEMBLIES, assemblySummary, expandAssembly, filterAssemblies, insertLines, parseAssembly, parseMultiplier, toAssembly } from '@/lib/assemblies';
import { bootDb, type TestDb } from './helpers/db';

const blank = { description: '', quantity: 1, unit: 'ea', material_unit_cost: 0, labour_hours_per_unit: 0 };
const wire = { description: '#12 wire', quantity: 30, unit: 'm', material_unit_cost: 1.25, labour_hours_per_unit: 0.02 };
const box = { description: 'Device box', quantity: 2, unit: 'ea', material_unit_cost: 4, labour_hours_per_unit: 0.25 };

describe('assembly rules', () => {
  it('scales quantities only, and treats a blank or silly multiplier as one', () => {
    expect(expandAssembly([wire, box], 3)).toEqual([{ ...wire, quantity: 90 }, { ...box, quantity: 6 }]);
    expect(expandAssembly([wire], '')).toEqual([wire]);
    expect(parseMultiplier(-2)).toBe(1);
    expect(parseMultiplier('abc')).toBe(1);
    expect(parseMultiplier(1e9)).toBe(10_000);
    expect(expandAssembly([{ ...wire, quantity: 0.1 }], 3)[0].quantity).toBe(0.3);
  });

  it('replaces an estimate that is only blank lines, and adds under real ones', () => {
    expect(insertLines([blank], [wire])).toEqual([wire]);
    expect(insertLines([box], [wire])).toEqual([box, wire]);
  });

  it('totals material and hours for one assembly in cents', () => {
    expect(assemblySummary([wire, box])).toEqual({ material: 45.5, hours: 1.1 });
  });

  it('finds assemblies by every word typed, across name, trade and lines', () => {
    const list = [
      { name: 'EV Charger', category: 'Residential', lines: [wire] },
      { name: 'Panel Upgrade', category: 'Service', lines: [box] },
    ];
    expect(filterAssemblies(list, '')).toHaveLength(2);
    expect(filterAssemblies(list, 'ev resid').map((a) => a.name)).toEqual(['EV Charger']);
    expect(filterAssemblies(list, 'device').map((a) => a.name)).toEqual(['Panel Upgrade']);
    expect(filterAssemblies(list, 'charger service')).toEqual([]);
  });

  it('refuses an assembly with no name or no lines, and says which line is wrong', () => {
    expect(parseAssembly({ name: ' ', lines: [wire] })).toMatchObject({ ok: false });
    expect(parseAssembly({ name: 'X', lines: [] })).toMatchObject({ ok: false });
    const bad = parseAssembly({ name: 'X', lines: [wire, { ...box, quantity: -1 }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/^Line 2: /);
    expect(parseAssembly({ name: '  EV Charger ', lines: [wire] })).toMatchObject({ ok: true, data: { name: 'EV Charger', category: '' } });
  });

  it('orders a row`s lines by sort and drops the sort column', () => {
    const a = toAssembly({ id: '1', name: 'A', category: null, lines: [{ ...box, sort: 1 }, { ...wire, sort: 0 }] });
    expect(a).toEqual({ id: '1', name: 'A', category: '', lines: [wire, box] });
  });

  it('every starter is valid and has a name of its own', () => {
    expect(STARTER_ASSEMBLIES.length).toBeGreaterThanOrEqual(8);
    for (const starter of STARTER_ASSEMBLIES) expect(parseAssembly(starter), starter.name).toMatchObject({ ok: true });
    expect(new Set(STARTER_ASSEMBLIES.map((s) => s.name.toLowerCase())).size).toBe(STARTER_ASSEMBLIES.length);
  });
});

const users = {
  ownerA: { id: '00000000-0000-4000-8000-0000000000a1', email: 'owner@alpha.ca' },
  pmA: { id: '00000000-0000-4000-8000-0000000000a3', email: 'pm@alpha.ca' },
  foremanA: { id: '00000000-0000-4000-8000-0000000000a4', email: 'foreman@alpha.ca' },
  ownerB: { id: '00000000-0000-4000-8000-0000000000b1', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

const SAVE = 'select public.save_assembly($1, $2, $3, $4::jsonb) as id';
const lines = JSON.stringify([wire, box]);

describe('assemblies in the database', () => {
  let t: TestDb<U>;
  let alpha: string;
  let id: string;

  beforeAll(async () => {
    t = await bootDb(users);
    alpha = await t.createCompany('ownerA', 'Alpha Electric');
    await t.createCompany('ownerB', 'Bravo Power');
    await t.join('ownerA', 'pmA', 'project_manager');
    await t.join('ownerA', 'foremanA', 'foreman');
    [{ id }] = await t.as<{ id: string }>('pmA', SAVE, [null, ' EV Charger ', 'Residential', lines]);
  });

  it('saves an assembly with its lines in order, under the caller`s company', async () => {
    const [row] = await t.as<{ name: string; company_id: string }>('ownerA', 'select name, company_id from public.assemblies where id = $1', [id]);
    expect(row).toEqual({ name: 'EV Charger', company_id: alpha });
    const saved = await t.as<{ description: string; sort: number }>('ownerA', 'select description, sort from public.assembly_lines where assembly_id = $1 order by sort', [id]);
    expect(saved).toEqual([{ description: '#12 wire', sort: 0 }, { description: 'Device box', sort: 1 }]);
  });

  it('another company can neither see, change, delete nor add lines to it', async () => {
    expect(await t.as('ownerB', 'select 1 from public.assemblies')).toEqual([]);
    expect(await t.as('ownerB', 'select 1 from public.assembly_lines')).toEqual([]);
    expect(await t.fails('ownerB', SAVE, [id, 'Stolen', '', lines])).toMatch(/not found/i);
    expect(await t.as('ownerB', 'delete from public.assemblies where id = $1 returning id', [id])).toEqual([]);
    expect(await t.fails('ownerB', `insert into public.assembly_lines (assembly_id, description) values ($1, 'planted')`, [id])).toMatch(/row-level security/);
    expect(await t.fails('ownerB', `insert into public.assemblies (company_id, name) values ($1, 'Forged')`, [alpha])).toMatch(/row-level security/);
    expect((await t.as('ownerA', 'select 1 from public.assembly_lines where assembly_id = $1', [id])).length).toBe(2);
  });

  it('a foreman, who cannot read estimates, cannot read or write assemblies', async () => {
    expect(await t.as('foremanA', 'select 1 from public.assemblies')).toEqual([]);
    expect(await t.fails('foremanA', SAVE, [null, 'Foreman special', '', lines])).toMatch(/row-level security/);
  });

  it('visitors who are not signed in are refused outright', async () => {
    expect(await t.fails(null, 'select 1 from public.assemblies')).toMatch(/permission denied/);
    expect(await t.fails(null, SAVE, [null, 'Anon', '', lines])).toMatch(/permission denied/);
  });

  it('one name per company, whatever the capitals, while another company may reuse it', async () => {
    expect(await t.fails('ownerA', SAVE, [null, 'ev charger', '', lines])).toMatch(/duplicate key|unique/i);
    expect((await t.as('ownerB', SAVE, [null, 'EV Charger', '', lines])).length).toBe(1);
  });

  it('refuses no lines, too many lines and negative amounts', async () => {
    expect(await t.fails('ownerA', SAVE, [null, 'Empty', '', '[]'])).toMatch(/between 1 and 200/);
    expect(await t.fails('ownerA', SAVE, [null, 'Huge', '', JSON.stringify(Array.from({ length: 201 }, () => wire))])).toMatch(/between 1 and 200/);
    expect(await t.fails('ownerA', SAVE, [null, 'Negative', '', JSON.stringify([{ ...wire, quantity: -1 }])])).toMatch(/check constraint/);
    expect(await t.as('ownerA', `select 1 from public.assemblies where name in ('Empty', 'Huge', 'Negative')`)).toEqual([]);
  });

  it('replacing an assembly swaps its lines rather than adding to them', async () => {
    await t.as('pmA', SAVE, [id, 'EV Charger 48A', 'Residential', JSON.stringify([box])]);
    expect(await t.as('ownerA', 'select description from public.assembly_lines where assembly_id = $1', [id])).toEqual([{ description: 'Device box' }]);
    expect((await t.as<{ name: string }>('ownerA', 'select name from public.assemblies where id = $1', [id]))[0].name).toBe('EV Charger 48A');
    // The update trigger pins the company, so an edit can't move it to another one
    const [{ id: bravo }] = await t.as<{ id: string }>('ownerB', 'select id from public.companies');
    await t.as('ownerA', 'update public.assemblies set company_id = $1 where id = $2', [bravo, id]);
    expect((await t.as<{ company_id: string }>('ownerA', 'select company_id from public.assemblies where id = $1', [id]))[0].company_id).toBe(alpha);
  });

  it('a lapsed company can still read its library but not change it', async () => {
    await t.setLapsed(alpha, true);
    expect((await t.as('ownerA', 'select 1 from public.assemblies where id = $1', [id])).length).toBe(1);
    expect(await t.fails('ownerA', SAVE, [null, 'After lapse', '', lines])).toMatch(/row-level security/);
    expect(await t.as('ownerA', 'delete from public.assemblies where id = $1 returning id', [id])).toEqual([]);
    await t.setLapsed(alpha, false);
  });

  it('deleting an assembly takes its lines with it', async () => {
    expect((await t.as('ownerA', 'delete from public.assemblies where id = $1 returning id', [id])).length).toBe(1);
    expect(await t.asSystem('select 1 from public.assembly_lines where assembly_id = $1', [id])).toEqual([]);
  });
});
