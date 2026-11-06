// Adversarial verification of the timecard engine, on PGlite. Written by the verifier, not
// the builder. Everything calls the database the way PostgREST would: as the signed-in user,
// with no help from the pages or the API routes. A failing test in this file is a reproduced
// bug and stays failing for the fixer. The tests are marked [BUG] in their names.
import { beforeAll, describe, expect, it } from 'vitest';
import { bootDb, migrationFiles, readMigration, type TestDb } from './helpers/db';
import { getModule } from '@/lib/modules';
import { csvCell, payrollCsv, type Timecard } from '@/lib/timecards';
import { parseRecord } from '@/lib/validation';

const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const USERS = {
  owner: { id: id(1), email: 'owner@alpha.ca' },
  pm: { id: id(2), email: 'pm@alpha.ca' },
  foreman: { id: id(3), email: 'foreman@alpha.ca' },
  foreman2: { id: id(4), email: 'foreman2@alpha.ca' },
  elec: { id: id(5), email: 'elec@alpha.ca' },
  elec2: { id: id(6), email: 'elec2@alpha.ca' },
  quitter: { id: id(7), email: 'quitter@alpha.ca' },
  sneaky: { id: id(8), email: 'sneaky@alpha.ca' },
  leaver: { id: id(9), email: 'leaver@alpha.ca' },
  rival: { id: id(10), email: 'owner@rival.ca' },
  rivalForeman: { id: id(11), email: 'foreman@rival.ca' },
};
type U = keyof typeof USERS;

let t: TestDb<U>;
let company: string;
let rivalCompany: string;
let tessa: string;
let bigEarner: string;
let frankRecord: string;
let rivalEmployee: string;
let rivalProject: string;

// One person can't have more than 24 hours on a date, so each card gets its own day unless the test picks one
let dayCount = 0;
const nextDay = () => new Date(Date.UTC(2025, 0, ++dayCount)).toISOString().slice(0, 10);
const card = async (who: U, extra: Record<string, unknown> = {}): Promise<string> => {
  const row: Record<string, unknown> = { title: 'Job 1', status: 'Submitted', employee_name: 'Crew Member', work_date: nextDay(), regular_hours: 8, overtime_hours: 0, ...extra };
  const keys = Object.keys(row);
  const [r] = await t.as<{ id: string }>(who, `insert into public.timecards (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, keys.map((k) => row[k]));
  return r.id;
};
const read = async (cardId: string) => (await t.asSystem<Record<string, unknown>>('select * from public.timecards where id = $1', [cardId]))[0];
const setStatus = (who: U, cardId: string, status: string) => t.as(who, 'update public.timecards set status = $1 where id = $2 returning id', [status, cardId]);
const decide = async (who: U, ids: string[], action: string, reason: string | null = null) =>
  (await t.as<{ out: { done: number; skipped: { id: string; reason: string }[] } }>(who, `select public.decide_timecards($1::uuid[], $2, $3) as out`, [ids, action, reason]))[0].out;
const exportRange = async (who: U, from: string, to: string, again = false) =>
  (await t.as<{ out: Timecard[] }>(who, `select public.export_timecards($1::date, $2::date, $3) as out`, [from, to, again]))[0].out;
const refused = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

beforeAll(async () => {
  t = await bootDb(USERS);
  company = await t.createCompany('owner', 'Alpha Electric');
  await t.join('owner', 'pm', 'project_manager', 'Pat PM');
  await t.join('owner', 'foreman', 'foreman', 'Frank Foreman');
  await t.join('owner', 'foreman2', 'foreman', 'Fay Foreman');
  await t.join('owner', 'elec', 'electrician', 'Sam Sparks');
  await t.join('owner', 'elec2', 'electrician', 'Tessa Volt');
  await t.join('owner', 'quitter', 'electrician', 'Quinn Quit');
  rivalCompany = await t.createCompany('rival', 'Rival Electric');
  await t.join('rival', 'rivalForeman', 'foreman', 'Rita Rival');
  await t.asSystem('update public.companies set default_labour_rate = 50, overtime_multiplier = 2 where id = $1', [company]);
  await t.asSystem('update public.companies set default_labour_rate = 999 where id = $1', [rivalCompany]);
  [{ id: tessa }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, email, hourly_cost) values ('Tessa Volt', 'Active', 'elec2@alpha.ca', 40) returning id`);
  [{ id: bigEarner }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, hourly_cost) values ('Big Earner', 'Active', 200) returning id`);
  // Frank's own employee record, filed under a shorter name than his login
  [{ id: frankRecord }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, email, hourly_cost) values ('F. Foreman', 'Active', 'foreman@alpha.ca', 75) returning id`);
  await t.as('owner', `insert into public.employees (title, status, email, hourly_cost) values ('Quinn Quit', 'Active', 'quitter@alpha.ca', 65)`);
  [{ id: rivalEmployee }] = await t.as<{ id: string }>('rival', `insert into public.employees (title, status, hourly_cost) values ('Rival Worker', 'Active', 777) returning id`);
  [{ id: rivalProject }] = await t.as<{ id: string }>('rival', `insert into public.projects (title, status) values ('Rival Job', 'Active') returning id`);
});

describe('self-approval below project manager', () => {
  it('[BUG] a foreman cannot approve hours on his own employee record by naming a crew member as the login', async () => {
    const cardId = await card('foreman', { employee_name: 'F. Foreman', employee_id: frankRecord, worker_user_id: USERS.elec.id, regular_hours: 10 });
    const error = await refused(setStatus('foreman', cardId, 'Approved'));
    const row = await read(cardId);
    expect({ error, status: row.status, rate: row.hourly_cost }).toMatchObject({ error: expect.stringMatching(/your own/), status: 'Submitted' });
  });

  it('[BUG] a foreman cannot approve a card he wrote under an alias by attaching a crew login', async () => {
    const cardId = await card('foreman', { employee_name: 'Frank F', worker_user_id: USERS.elec.id, regular_hours: 10 });
    const error = await refused(setStatus('foreman', cardId, 'Approved'));
    const row = await read(cardId);
    // Either refused outright, or the card is now truly Sam's and the file pays Sam
    if (!error) expect(row.employee_name).toBe('Sam Sparks');
  });

  it('[BUG] a foreman cannot strip his identity off a card a colleague entered for him and approve it in the same update', async () => {
    const cardId = await card('foreman2', { employee_name: 'Frank Foreman', worker_user_id: USERS.foreman.id, regular_hours: 10 });
    const error = await refused(t.as('foreman', `update public.timecards set worker_user_id = null, employee_name = 'Frankie', status = 'Approved' where id = $1 returning id`, [cardId]));
    expect(error ?? 'it was approved').toMatch(/your own/);
    expect((await read(cardId)).status).toBe('Submitted');
  });

  it('holds for the direct forms: worker login, typed name, card with no worker, insert-as-approved, batch', async () => {
    const byLogin = await card('foreman2', { employee_name: 'Whoever', worker_user_id: USERS.foreman.id });
    const byName = await card('foreman2', { employee_name: '  FRANK foreman ' });
    const noWorker = await card('foreman', { employee_name: 'Ghost' });
    for (const cardId of [byLogin, byName, noWorker]) {
      expect(await refused(setStatus('foreman', cardId, 'Approved'))).toMatch(/your own/);
      expect((await decide('foreman', [cardId], 'approve')).done).toBe(0);
    }
    expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours) values ('J', 'Approved', 'Ghost', 8)`)).toMatch(/your own/);
    // Resolving the login from his own employee record is caught too
    const viaEmployee = await card('foreman', { employee_name: 'F. Foreman', employee_id: frankRecord });
    expect((await read(viaEmployee)).worker_user_id).toBe(USERS.foreman.id);
    expect(await refused(setStatus('foreman', viaEmployee, 'Approved'))).toMatch(/your own/);
  });

  it('forged approver columns never stick', async () => {
    const cardId = await card('elec', { employee_name: 'Sam Sparks' });
    await t.as('foreman', `update public.timecards set status = 'Approved', approved_by = $1, approved_by_name = 'Owner', approved_at = '2001-01-01', exported_at = '2001-01-01', hourly_cost = 1, labour_cost = 1 where id = $2`, [USERS.owner.id, cardId]);
    const row = await read(cardId);
    expect(row.approved_by).toBe(USERS.foreman.id);
    expect(row.approved_by_name).toBe('Frank Foreman');
    expect(row.exported_at).toBeNull();
    expect(new Date(row.approved_at as string).getFullYear()).toBeGreaterThan(2001);
    expect(Number(row.hourly_cost)).toBe(50);
  });
});

describe('wrong role, bypassing the UI', () => {
  it('an electrician cannot reach any final status by update, batch, upsert or insert', async () => {
    const cardId = await card('elec', { employee_name: 'Sam Sparks' });
    for (const status of ['Approved', 'Rejected', 'Exported']) {
      expect(await t.fails('elec', 'update public.timecards set status = $1 where id = $2', [status, cardId])).toMatch(/foreman|project manager/i);
      expect(await t.fails('elec', `insert into public.timecards (title, status, employee_name, regular_hours) values ('J', $1, 'Sam Sparks', 8)`, [status])).toMatch(/foreman|project manager/i);
      expect(await t.fails('elec', `insert into public.timecards (id, title, status, employee_name, regular_hours) values ($1, 'J', $2, 'Sam Sparks', 8) on conflict (id) do update set status = excluded.status`, [cardId, status])).toMatch(/foreman|project manager/i);
    }
    // The insert half passes, the update half still goes through the guard
    expect(await t.fails('elec', `insert into public.timecards (id, title, status, employee_name, regular_hours) values ($1, 'J', 'Submitted', 'Sam Sparks', 8) on conflict (id) do update set status = 'Approved'`, [cardId])).toMatch(/foreman/i);
    for (const action of ['approve', 'reject', 'unapprove', 'reopen']) expect((await decide('elec', [cardId], action)).done).toBe(0);
    expect((await read(cardId)).status).toBe('Submitted');
  });

  it('an electrician cannot read or touch a crewmate\'s card, even by id', async () => {
    const other = await card('elec2', { employee_name: 'Tessa Volt' });
    expect(await t.as('elec', 'select id from public.timecards where id = $1', [other])).toEqual([]);
    expect(await t.as('elec', 'update public.timecards set regular_hours = 1 where id = $1 returning id', [other])).toEqual([]);
    expect(await t.as('elec', 'delete from public.timecards where id = $1 returning id', [other])).toEqual([]);
    expect(Number((await read(other)).regular_hours)).toBe(8);
  });

  it('[BUG] an electrician\'s card is always in their own name, not just on the API route', async () => {
    const cardId = await card('elec', { employee_name: 'Tessa Volt', regular_hours: 12, work_date: '2026-11-02' });
    await setStatus('pm', cardId, 'Approved');
    // The rate stays Sam's, but the payroll file's Worker column says Tessa
    const [line] = (await exportRange('pm', '2026-11-02', '2026-11-02')).filter((c) => c.id === cardId);
    expect(line.employee_name).toBe('Sam Sparks');
  });

  it('[BUG] an electrician stops seeing and editing a card once it has been moved to another worker', async () => {
    const cardId = await card('elec', { employee_name: 'Sam Sparks', regular_hours: 8 });
    await t.as('foreman', `update public.timecards set employee_id = $1, employee_name = 'Tessa Volt' where id = $2`, [tessa, cardId]);
    expect((await read(cardId)).worker_user_id).toBe(USERS.elec2.id);
    expect((await t.as('elec', 'select id from public.timecards where id = $1', [cardId])).length).toBe(0);
    expect((await t.as('elec', 'update public.timecards set regular_hours = 1 where id = $1 returning id', [cardId])).length).toBe(0);
    expect(Number((await read(cardId)).regular_hours)).toBe(8);
  });

  it('[BUG] a foreman cannot read crew pay rates straight from the table', async () => {
    const cardId = await card('elec2', { employee_name: 'Tessa Volt' });
    await setStatus('pm', cardId, 'Approved');
    // Either the column is refused, or it comes back empty. Not Tessa's 40.
    const rows = await t.as<{ hourly_cost: string | null }>('foreman', 'select hourly_cost from public.timecards where id = $1', [cardId]).catch(() => [{ hourly_cost: null }]);
    expect(rows[0].hourly_cost).toBeNull();
  });

  it('the generic module API lets the identity and date fields through to the database, so these holes are reachable from the app too', () => {
    const parsed = parseRecord(getModule('timecards')!, { employee_id: frankRecord, worker_user_id: USERS.elec.id, employee_name: 'F. Foreman', status: 'Approved', work_date: null }, 'update');
    expect(parsed).toEqual({ ok: true, data: { employee_id: frankRecord, worker_user_id: USERS.elec.id, employee_name: 'F. Foreman', status: 'Approved', work_date: null } });
  });

  it('a foreman cannot export or mark Exported, and cannot reopen an exported card', async () => {
    const cardId = await card('foreman2', { work_date: '2026-03-02' });
    await setStatus('pm', cardId, 'Approved');
    expect(await t.fails('foreman', `select public.export_timecards('2026-03-02', '2026-03-02')`)).toMatch(/project manager/);
    expect(await t.fails('foreman', `select public.export_timecards('2026-03-02', '2026-03-02', true)`)).toMatch(/project manager/);
    expect(await t.fails('foreman', `update public.timecards set status = 'Exported' where id = $1`, [cardId])).toMatch(/project manager/);
    await exportRange('pm', '2026-03-02', '2026-03-02');
    expect(await t.fails('foreman', `update public.timecards set status = 'Approved' where id = $1`, [cardId])).toMatch(/project manager/);
  });

  it('a signed-out visitor gets nothing', async () => {
    expect(await t.fails(null, 'update public.timecards set status = \'Approved\'')).toMatch(/permission denied/);
    expect(await t.fails(null, `insert into public.timecards (title, status, employee_name) values ('J', 'Approved', 'X')`)).toMatch(/permission denied/);
    expect(await t.fails(null, 'delete from public.timecards')).toMatch(/permission denied/);
  });
});

describe('the pay rate', () => {
  it('[BUG] a foreman cannot pay a crew member at another employee\'s rate by mismatching the login and the employee record', async () => {
    const cardId = await card('foreman', { employee_name: 'Sam Sparks', worker_user_id: USERS.elec.id, employee_id: bigEarner });
    const error = await refused(setStatus('foreman', cardId, 'Approved'));
    // Sam has no employee record of his own, so his rate is the company's 50, not Big Earner's 200
    if (!error) expect(Number((await read(cardId)).hourly_cost)).toBe(50);
  });

  it('[BUG] accepting an invitation under a colleague\'s name does not earn that colleague\'s rate', async () => {
    await t.join('owner', 'sneaky', 'electrician', 'Big Earner');
    const cardId = await card('sneaky', { employee_name: 'Big Earner' });
    await setStatus('pm', cardId, 'Approved');
    expect(Number((await read(cardId)).hourly_cost)).toBe(50);
  });

  it('[BUG] a card keeps its worker\'s rate when the worker\'s login is removed before approval', async () => {
    const cardId = await card('quitter', { employee_name: 'Quinn Quit', regular_hours: 8 });
    expect((await read(cardId)).worker_user_id).toBe(USERS.quitter.id);
    await t.as('owner', 'select public.remove_member($1)', [USERS.quitter.id]);
    await setStatus('pm', cardId, 'Approved');
    const row = await read(cardId);
    expect(Number(row.hourly_cost)).toBe(65);
    expect(Number(row.labour_cost)).toBe(520);
  });

  it('never reads another company\'s rate', async () => {
    expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours, employee_id) values ('J', 'Submitted', 'X', 8, $1)`, [rivalEmployee])).toMatch(/could not be found/);
    const cardId = await card('foreman', { employee_name: 'Rival Worker' });
    await setStatus('pm', cardId, 'Approved');
    expect(Number((await read(cardId)).hourly_cost)).toBe(50);
    const moved = await card('foreman');
    expect(await t.fails('pm', `update public.timecards set employee_id = $1, status = 'Approved' where id = $2`, [rivalEmployee, moved])).toMatch(/could not be found/);
    expect((await read(moved)).status).toBe('Submitted');
  });

  it('survives a rate change while Approved and Exported, and reopen keeps it', async () => {
    const [{ id: temp }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, hourly_cost) values ('Temp Rate', 'Active', 30) returning id`);
    const cardId = await card('foreman', { employee_id: temp, employee_name: 'Temp Rate', work_date: '2026-03-10', regular_hours: 10 });
    await setStatus('pm', cardId, 'Approved');
    await t.as('owner', 'update public.employees set hourly_cost = 99 where id = $1', [temp]);
    await exportRange('pm', '2026-03-10', '2026-03-10');
    await t.as('pm', `update public.timecards set hourly_cost = 1, labour_cost = 1 where id = $1`, [cardId]);
    expect(Number((await read(cardId)).labour_cost)).toBe(300);
    await decide('pm', [cardId], 'reopen');
    const row = await read(cardId);
    expect(row.status).toBe('Approved');
    expect(Number(row.hourly_cost)).toBe(30);
    expect(Number(row.labour_cost)).toBe(300);
  });

  it('an employee with a zero or negative rate falls back to the company rate', async () => {
    const [{ id: zero }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, hourly_cost) values ('Zero Rate', 'Active', 0) returning id`);
    const [{ id: minus }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, hourly_cost) values ('Minus Rate', 'Active', -40) returning id`);
    for (const e of [zero, minus]) {
      const cardId = await card('foreman', { employee_id: e, employee_name: 'Whoever' });
      await setStatus('pm', cardId, 'Approved');
      expect(Number((await read(cardId)).hourly_cost)).toBe(50);
      expect(Number((await read(cardId)).labour_cost)).toBe(400);
    }
  });

  it('the database refuses a nonsense overtime multiplier or labour rate', async () => {
    expect(await t.fails('owner', 'update public.companies set overtime_multiplier = 0.5 where id = public.user_company_id()')).toMatch(/check constraint/);
    expect(await t.fails('owner', 'update public.companies set default_labour_rate = -1 where id = public.user_company_id()')).toMatch(/check constraint/);
  });
});

describe('rounding and boundary values', () => {
  const insertHours = (regular: string, overtime: string) => t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours, overtime_hours) values ('J', 'Submitted', 'X', $1::numeric, $2::numeric)`, [regular, overtime]);

  it.each([
    ['NaN', '0'], ['0', 'NaN'], ['Infinity', '0'], ['0', 'Infinity'], ['Infinity', '-Infinity'], ['-Infinity', '0'],
    ['24.01', '0'], ['12.01', '12'], ['24.005', '0'], ['0.004', '0'], ['0.004', '0.004'], ['0', '0'], ['-0.01', '8'], ['8', '-0.01'],
  ])('refuses regular %s, overtime %s', async (regular, overtime) => {
    expect(await insertHours(regular, overtime)).toMatch(/hours|negative/i);
  });

  it.each([
    ['24', '0', 24], ['0', '24', 24], ['23.99', '0.01', 24], ['0.01', '0', 0.01], ['0.005', '0', 0.01], ['24.004', '0', 24],
  ])('takes regular %s, overtime %s', async (regular, overtime, total) => {
    const cardId = await card('foreman', { regular_hours: regular, overtime_hours: overtime });
    const row = await read(cardId);
    expect(Number(row.regular_hours) + Number(row.overtime_hours)).toBeCloseTo(total, 5);
  });

  it('null hours count as zero on insert and on edit', async () => {
    expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name) values ('J', 'Submitted', 'X')`)).toMatch(/hours worked/);
    const cardId = await card('foreman');
    expect(await t.fails('foreman', 'update public.timecards set regular_hours = null where id = $1', [cardId])).toMatch(/hours worked/);
  });

  it.each([
    // regular, overtime, rate, expected with the company multiplier of 2
    [8, 2, 33.33, 399.96],
    [7.125, 0, 33.33, 237.64], // hours round to 7.13 first
    [0.5, 0, 10.01, 5.01], // half a cent rounds up
    [0.01, 0, 0.01, 0],
    [1.5, 1.5, 33.33, 149.99], // 49.995 + 99.99 = 149.985
    [16, 8, 99999.99, 3199999.68],
  ])('%d regular + %d overtime at $%d costs $%d', async (regular, overtime, rate, expected) => {
    const [{ id: e }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, hourly_cost) values ('Round', 'Active', $1) returning id`, [rate]);
    const cardId = await card('foreman', { employee_id: e, employee_name: 'Round', regular_hours: regular, overtime_hours: overtime });
    await setStatus('pm', cardId, 'Approved');
    const row = await read(cardId);
    expect(Number(row.hourly_cost)).toBe(rate);
    expect(Number(row.labour_cost)).toBe(expected);
    await t.asSystem('delete from public.timecards where id = $1', [cardId]);
    await t.asSystem('delete from public.employees where id = $1', [e]);
  });

  it('takes a fractional company multiplier', async () => {
    await t.as('owner', 'update public.companies set overtime_multiplier = 1.333 where id = public.user_company_id()');
    const [{ id: e }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, hourly_cost) values ('Frac', 'Active', 33.33) returning id`);
    const cardId = await card('foreman', { employee_id: e, employee_name: 'Frac', regular_hours: 0, overtime_hours: 3 });
    await setStatus('pm', cardId, 'Approved');
    expect(Number((await read(cardId)).labour_cost)).toBe(133.29); // 133.28667
    await t.as('owner', 'update public.companies set overtime_multiplier = 2 where id = public.user_company_id()');
  });

  it('[BUG] a card cannot lose its date, which would hide it from the week and from every payroll file', async () => {
    const cardId = await card('foreman', { employee_name: 'Dateless', work_date: '2026-04-06' });
    const error = await refused(t.as('foreman', 'update public.timecards set work_date = null where id = $1', [cardId]));
    if (!error) {
      await setStatus('pm', cardId, 'Approved');
      const file = await exportRange('pm', '0001-01-01', '9999-12-31');
      expect(file.map((c) => c.id)).toContain(cardId);
    }
  });

  it('[BUG] one worker cannot be paid for more than 24 hours on one date, including a double-submitted crew entry', async () => {
    const day = '2026-04-13';
    const first = await card('foreman', { employee_name: 'Tessa Volt', employee_id: tessa, work_date: day, regular_hours: 16 });
    const second = await refused(card('foreman', { employee_name: 'Tessa Volt', employee_id: tessa, work_date: day, regular_hours: 16 }));
    if (second === null) {
      const both = await t.asSystem<{ hours: string }>(`select sum(regular_hours + overtime_hours) as hours from public.timecards where employee_id = $1 and work_date = $2`, [tessa, day]);
      expect(Number(both[0].hours)).toBeLessThanOrEqual(24);
    }
    expect((await read(first)).status).toBe('Submitted');
  });
});

describe('status changes out of order', () => {
  const statusOf = async (cardId: string) => (await read(cardId)).status;

  it('Exported is reachable only from Approved, even for the owner', async () => {
    const submitted = await card('foreman');
    const rejected = await card('foreman');
    await setStatus('pm', rejected, 'Rejected');
    for (const c of [submitted, rejected]) expect(await t.fails('owner', `update public.timecards set status = 'Exported' where id = $1`, [c])).toMatch(/approved/i);
    expect(await t.fails('owner', `insert into public.timecards (title, status, employee_name, regular_hours) values ('J', 'Exported', 'X', 8)`)).toMatch(/approved/i);
  });

  it('Exported goes back only to Approved', async () => {
    const cardId = await card('foreman', { work_date: '2026-05-04' });
    await setStatus('pm', cardId, 'Approved');
    await exportRange('pm', '2026-05-04', '2026-05-04');
    for (const status of ['Submitted', 'Rejected']) expect(await t.fails('owner', 'update public.timecards set status = $1 where id = $2', [status, cardId])).toMatch(/goes back to Approved/);
    expect((await decide('owner', [cardId], 'unapprove')).done).toBe(0);
    expect((await decide('owner', [cardId], 'reject')).done).toBe(0);
    expect((await decide('owner', [cardId], 'approve')).done).toBe(0);
    expect(await statusOf(cardId)).toBe('Exported');
  });

  it('refuses a null, misspelled or wrong-case status', async () => {
    const cardId = await card('foreman');
    expect(await t.fails('owner', 'update public.timecards set status = null where id = $1', [cardId])).toBeTruthy();
    for (const status of ['approved', 'APPROVED', 'Draft', '', 'Approved ']) expect(await t.fails('owner', 'update public.timecards set status = $1 where id = $2', [status, cardId])).toMatch(/not a timecard status/);
    expect(await statusOf(cardId)).toBe('Submitted');
  });

  it('un-approving and rejecting wipe every pay and approval stamp', async () => {
    const a = await card('foreman');
    const b = await card('foreman');
    for (const c of [a, b]) await setStatus('pm', c, 'Approved');
    await decide('pm', [a], 'unapprove');
    await decide('pm', [b], 'reject', 'Wrong job');
    for (const c of [a, b]) expect(await read(c)).toMatchObject({ hourly_cost: null, labour_cost: null, approved_by: null, approved_by_name: null, approved_at: null, exported_at: null });
    expect((await read(b)).reject_reason).toBe('Wrong job');
  });

  it('a rejected card can be approved straight off, clearing the reason', async () => {
    const cardId = await card('foreman');
    await decide('pm', [cardId], 'reject', 'x'.repeat(900));
    expect(((await read(cardId)).reject_reason as string).length).toBe(500);
    await decide('pm', [cardId], 'approve');
    expect(await read(cardId)).toMatchObject({ status: 'Approved', reject_reason: null });
  });

  it('every field outside the system list is locked on Approved and Exported cards, for every role', async () => {
    const approved = await card('elec', { employee_name: 'Sam Sparks' });
    await setStatus('pm', approved, 'Approved');
    const edits: [string, unknown][] = [['title', 'New'], ['notes', 'New'], ['work_date', '2020-01-01'], ['employee_name', 'New'], ['regular_hours', 1], ['overtime_hours', 1], ['employee_id', tessa], ['worker_user_id', USERS.elec2.id], ['project_id', null]];
    for (const [col, value] of edits) {
      if (value === null) continue;
      expect(await t.fails('owner', `update public.timecards set ${col} = $1 where id = $2`, [value, approved])).toMatch(/locked/);
    }
    // The owner editing and un-approving in one statement is not a way round it
    expect(await t.fails('owner', `update public.timecards set regular_hours = 1, status = 'Submitted' where id = $1`, [approved])).toMatch(/locked/);
    // An electrician's attempt doesn't change a thing
    const before = await read(approved);
    await t.as('elec', `update public.timecards set status = 'Approved', hourly_cost = 999, labour_cost = 999, approved_by = $1, approved_at = '2000-01-01', reject_reason = 'x' where id = $2`, [USERS.elec.id, approved]);
    const after = await read(approved);
    for (const col of ['status', 'hourly_cost', 'labour_cost', 'approved_by', 'approved_by_name', 'approved_at', 'reject_reason', 'exported_at']) expect(after[col]).toEqual(before[col]);
  });
});

describe('double submit', () => {
  it('approving twice stamps the first approver only', async () => {
    const cardId = await card('elec', { employee_name: 'Sam Sparks' });
    expect((await decide('foreman', [cardId], 'approve')).done).toBe(1);
    const first = await read(cardId);
    expect((await decide('pm', [cardId], 'approve')).done).toBe(0);
    await setStatus('pm', cardId, 'Approved'); // Direct, and a no-op
    const second = await read(cardId);
    expect(second.approved_by).toBe(USERS.foreman.id);
    expect(second.approved_at).toEqual(first.approved_at);
    expect(second.hourly_cost).toEqual(first.hourly_cost);
  });

  it('duplicate ids in a batch count once', async () => {
    const cardId = await card('foreman2');
    expect((await decide('pm', [cardId, cardId, cardId], 'approve')).done).toBe(1);
  });

  it('exporting twice gives the second call an empty file, and the first keeps its stamp', async () => {
    const day = '2026-05-11';
    const cardId = await card('foreman', { work_date: day });
    await setStatus('pm', cardId, 'Approved');
    expect((await exportRange('pm', day, day)).map((c) => c.id)).toEqual([cardId]);
    const stamped = (await read(cardId)).exported_at;
    expect(await exportRange('pm', day, day)).toEqual([]);
    expect((await read(cardId)).exported_at).toEqual(stamped);
    expect((await exportRange('pm', day, day, true)).map((c) => c.id)).toEqual([cardId]);
    expect((await read(cardId)).exported_at).toEqual(stamped);
  });

  it('a batch with a card it may not decide still does the rest, and an empty or null list is a no-op', async () => {
    const mine = await card('foreman', { employee_name: 'Frank Foreman' });
    const crew = await card('foreman2', { employee_name: 'Someone', worker_user_id: USERS.elec.id });
    const out = await decide('foreman', [mine, crew], 'approve');
    expect(out.done).toBe(1);
    expect(out.skipped.map((s) => s.id)).toEqual([mine]);
    expect(await decide('foreman', [], 'approve')).toEqual({ done: 0, skipped: [] });
    expect((await t.as<{ out: unknown }>('foreman', `select public.decide_timecards(null, 'approve') as out`))[0].out).toEqual({ done: 0, skipped: [] });
  });
});

describe('other tenant', () => {
  it('another company cannot read, change, delete, decide, export or overwrite by upsert', async () => {
    const day = '2026-05-18';
    const cardId = await card('foreman', { work_date: day });
    const approved = await card('foreman', { work_date: day });
    await setStatus('pm', approved, 'Approved');
    for (const who of ['rival', 'rivalForeman'] as const) {
      expect(await t.as(who, 'select id from public.timecards where id = $1', [cardId])).toEqual([]);
      expect(await t.as(who, `update public.timecards set status = 'Approved' where id = $1 returning id`, [cardId])).toEqual([]);
      expect(await t.as(who, 'delete from public.timecards where id = $1 returning id', [cardId])).toEqual([]);
      expect(await decide(who, [cardId, approved], 'reject')).toEqual({ done: 0, skipped: [] });
      expect(await t.fails(who, `insert into public.timecards (id, title, status, employee_name, regular_hours) values ($1, 'J', 'Submitted', 'X', 8) on conflict (id) do update set regular_hours = 1`, [cardId])).toMatch(/row-level security/);
    }
    expect(await exportRange('rival', day, day)).toEqual([]);
    expect(await exportRange('rival', day, day, true)).toEqual([]);
    expect((await read(approved)).status).toBe('Approved');
    expect(Number((await read(cardId)).regular_hours)).toBe(8);
  });

  it('a card cannot point at another company\'s project, employee or login, on insert or edit', async () => {
    expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours, project_id) values ('J', 'Submitted', 'X', 8, $1)`, [rivalProject])).toMatch(/could not be found/);
    expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours, worker_user_id) values ('J', 'Submitted', 'X', 8, $1)`, [USERS.rival.id])).toMatch(/Pick the worker/);
    const cardId = await card('foreman');
    expect(await t.fails('foreman', 'update public.timecards set project_id = $1 where id = $2', [rivalProject, cardId])).toMatch(/could not be found/);
    expect(await t.fails('foreman', 'update public.timecards set employee_id = $1 where id = $2', [rivalEmployee, cardId])).toMatch(/could not be found/);
    expect(await t.fails('foreman', 'update public.timecards set worker_user_id = $1 where id = $2', [USERS.rival.id, cardId])).toMatch(/Pick the worker/);
  });

  it('a card cannot change company or author, and cannot be inserted for another', async () => {
    const cardId = await card('foreman');
    await t.as('owner', 'update public.timecards set company_id = $1, created_by = $2 where id = $3', [rivalCompany, USERS.rival.id, cardId]);
    expect(await read(cardId)).toMatchObject({ company_id: company, created_by: USERS.foreman.id });
    expect(await t.fails('owner', `insert into public.timecards (company_id, title, status, employee_name, regular_hours) values ($1, 'J', 'Submitted', 'X', 8)`, [rivalCompany])).toMatch(/another company/);
    expect(await t.fails('elec', `insert into public.timecards (created_by, title, status, employee_name, regular_hours) values ($1, 'J', 'Submitted', 'X', 8)`, [USERS.elec2.id])).toMatch(/row-level security/);
  });

  it('the workers list stays inside the company', async () => {
    const names = (await t.as<{ name: string }>('foreman', 'select * from public.timecard_workers()')).map((r) => r.name);
    expect(names).not.toContain('Rival Worker');
    expect(names).not.toContain('Rita Rival');
  });
});

describe('a lapsed subscription', () => {
  it('blocks every write path and every role, and allows only a re-download', async () => {
    const open = await card('foreman', { work_date: '2026-06-01' });
    const elecOwn = await card('elec', { employee_name: 'Sam Sparks', work_date: '2026-06-01' });
    const approved = await card('foreman', { work_date: '2026-06-01' });
    await setStatus('pm', approved, 'Approved');
    const exported = await card('foreman', { work_date: '2026-06-02' });
    await setStatus('pm', exported, 'Approved');
    await exportRange('pm', '2026-06-02', '2026-06-02');
    await t.setLapsed(company, true);
    try {
      for (const who of ['owner', 'pm', 'foreman', 'elec'] as const) {
        expect(await t.fails(who, `insert into public.timecards (title, status, employee_name, regular_hours) values ('J', 'Submitted', 'X', 8)`)).toMatch(/row-level security/);
        for (const c of [open, elecOwn, approved, exported]) {
          expect(await t.as(who, 'update public.timecards set notes = $1 where id = $2 returning id', ['x', c])).toEqual([]);
          expect(await t.as(who, `update public.timecards set status = 'Submitted' where id = $1 returning id`, [c])).toEqual([]);
          expect(await t.as(who, 'delete from public.timecards where id = $1 returning id', [c])).toEqual([]);
        }
      }
      for (const action of ['approve', 'reject', 'unapprove', 'reopen']) {
        expect((await decide('owner', [open, approved, exported], action)).done).toBe(0);
      }
      expect(await t.fails('owner', `select public.export_timecards('2026-06-01', '2026-06-01')`)).toMatch(/subscription has ended/);
      expect((await exportRange('owner', '2026-06-02', '2026-06-02', true)).map((c) => c.id)).toEqual([exported]);
      // Reading still works
      expect((await t.as('elec', 'select id from public.timecards where id = $1', [elecOwn])).length).toBe(1);
      expect((await t.as('foreman', 'select * from public.timecard_workers()')).length).toBeGreaterThan(0);
    } finally {
      await t.setLapsed(company, false);
    }
    expect(await read(open)).toMatchObject({ status: 'Submitted', notes: null });
    expect((await read(approved)).status).toBe('Approved');
    expect((await read(exported)).status).toBe('Exported');
  });
});

describe('deleting referenced records', () => {
  it('approved and exported cards cannot be deleted by anyone signed in, one by one or in bulk', async () => {
    const approved = await card('foreman', { work_date: '2026-07-06' });
    const exported = await card('foreman', { work_date: '2026-07-07' });
    await setStatus('pm', approved, 'Approved');
    await setStatus('pm', exported, 'Approved');
    await exportRange('pm', '2026-07-07', '2026-07-07');
    for (const who of ['owner', 'pm', 'foreman'] as const) {
      expect(await t.fails(who, 'delete from public.timecards where id = any($1::uuid[])', [[approved, exported]])).toMatch(/approved/);
    }
    expect(await read(approved)).toBeTruthy();
    expect(await read(exported)).toBeTruthy();
  });

  it('a project with cards cannot be deleted, and the frozen pay stays', async () => {
    const [{ id: project }] = await t.as<{ id: string }>('owner', `insert into public.projects (title, status) values ('Referenced', 'Active') returning id`);
    const cardId = await card('foreman', { project_id: project });
    await setStatus('pm', cardId, 'Approved');
    expect(await t.fails('owner', 'delete from public.projects where id = $1', [project])).toMatch(/foreign key/);
    expect(await read(cardId)).toMatchObject({ project_id: project, status: 'Approved' });
  });

  it('an employee with cards cannot be deleted, and the frozen pay stays', async () => {
    const [{ id: e }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, hourly_cost) values ('Referenced', 'Active', 44) returning id`);
    const cardId = await card('foreman', { employee_id: e, employee_name: 'Referenced' });
    await setStatus('pm', cardId, 'Approved');
    expect(await t.fails('owner', 'delete from public.employees where id = $1', [e])).toMatch(/foreign key/);
    expect(Number((await read(cardId)).hourly_cost)).toBe(44);
  });

  it('removing the approver leaves the approval on the card', async () => {
    await t.join('owner', 'leaver', 'foreman', 'Leah Leaver');
    const cardId = await card('elec', { employee_name: 'Sam Sparks' });
    await setStatus('leaver', cardId, 'Approved');
    await t.as('owner', 'select public.remove_member($1)', [USERS.leaver.id]);
    expect(await read(cardId)).toMatchObject({ status: 'Approved', approved_by: USERS.leaver.id, approved_by_name: 'Leah Leaver' });
  });

  it('a company being deleted by the system takes its locked cards with it', async () => {
    const [{ id: gone }] = await t.asSystem<{ id: string }>(`insert into public.companies (name, province) values ('Gone', 'SK') returning id`);
    await t.asService(`insert into public.timecards (company_id, title, status, employee_name, regular_hours) values ($1, 'J', 'Approved', 'X', 8)`, [gone]);
    await t.asSystem('delete from public.companies where id = $1', [gone]);
    expect(await t.asSystem('select id from public.timecards where company_id = $1', [gone])).toEqual([]);
  });

  it('[BUG] deleting a login clears created_by on its cards, as the foreign key promises', async () => {
    const [{ id: uid }] = await t.asSystem<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), 'gone@alpha.ca') returning id`);
    await t.asSystem(`insert into public.company_users (user_id, company_id, role, full_name, email) values ($1, $2, 'electrician', 'Gone Worker', 'gone@alpha.ca')`, [uid, company]);
    const [{ id: cardId }] = await t.asSystem<{ id: string }>(`insert into public.timecards (company_id, created_by, title, status, employee_name, regular_hours) values ($1, $2, 'J', 'Submitted', 'Gone Worker', 8) returning id`, [company, uid]);
    await t.asSystem('delete from auth.users where id = $1', [uid]);
    const dangling = await t.asSystem(`select t.id from public.timecards t left join auth.users u on u.id = t.created_by where t.id = $1 and t.created_by is not null and u.id is null`, [cardId]);
    expect(dangling).toEqual([]);
  });
});

describe('the payroll file from real rows', () => {
  it('a hostile electrician cannot plant a formula that survives to the file', async () => {
    const day = '2026-08-03';
    const payloads = ['=HYPERLINK("http://evil")', '+1+1', '-1+1', '@SUM(A1)', '\t=1', '\r=1', '\n=1', ' =1', '﻿=1', '＝1', ' =1'];
    for (const p of payloads) {
      const cardId = await card('elec', { employee_name: p, title: p, notes: p, work_date: day, regular_hours: 1 });
      await setStatus('pm', cardId, 'Approved');
    }
    const rows = await exportRange('pm', day, day);
    expect(rows.length).toBe(payloads.length);
    for (const r of rows) for (const key of ['title', 'notes'] as const) expect(csvCell(r[key]).replace(/^"/, '').startsWith("'")).toBe(true);
    const lines = payrollCsv(rows).slice(1).split('\r\n');
    expect(lines[0].startsWith('Worker,')).toBe(true);
  });

  it('commas, quotes and line breaks cannot add a column or a row', () => {
    const csv = payrollCsv([{ employee_name: 'A,B"C\r\nD', title: 'J', work_date: '2026-08-03', regular_hours: 8, overtime_hours: 0, hourly_cost: 1, labour_cost: 8, approved_by_name: 'x', approved_at: 'y', notes: null } as unknown as Timecard]);
    expect(csv).toContain('"A,B""C\r\nD",2026-08-03,J,8.00,0.00,1.00,8.00,x,y,');
  });

  it('export covers the first and last day of the range and nothing outside', async () => {
    const [before, first, last, after] = await Promise.all(['2026-08-09', '2026-08-10', '2026-08-16', '2026-08-17'].map(async (work_date) => {
      const c = await card('foreman', { work_date });
      await setStatus('pm', c, 'Approved');
      return c;
    }));
    const ids = (await exportRange('pm', '2026-08-10', '2026-08-16')).map((c) => c.id).sort();
    expect(ids).toEqual([first, last].sort());
    for (const c of [before, after]) expect((await read(c)).status).toBe('Approved');
  });
});

describe('upgrading a database that already has cards', () => {
  it('backfills pay on old approved cards, then locks them, and a second run changes nothing', async () => {
    const before = (f: string) => f < '20261104000100_timecards.sql';
    const up = await bootDb({ owner: USERS.owner, elec: USERS.elec }, { include: before });
    const companyId = await up.createCompany('owner', 'Old Co');
    await up.join('owner', 'elec', 'electrician', 'Sam Sparks');
    await up.asSystem('update public.companies set default_labour_rate = 30, overtime_multiplier = 1.5 where id = $1', [companyId]);
    const [{ id: old }] = await up.asSystem<{ id: string }>(`insert into public.timecards (company_id, created_by, title, status, employee_name, regular_hours, overtime_hours, created_at) values ($1, $2, 'Old', 'Approved', 'Sam Sparks', 8, 2, '2026-01-15') returning id`, [companyId, USERS.elec.id]);
    for (const f of migrationFiles().filter((m) => !before(m))) await up.pg.exec(readMigration(f));
    const row = (await up.asSystem<Record<string, unknown>>('select * from public.timecards where id = $1', [old]))[0];
    expect(Number(row.labour_cost)).toBe(330);
    expect(Number(row.hourly_cost)).toBe(30);
    expect(row.worker_user_id).toBe(USERS.elec.id);
    expect(String(row.work_date)).toContain('2026');
    expect(await up.fails('owner', 'update public.timecards set regular_hours = 1 where id = $1', [old])).toMatch(/locked/);
    await up.asSystem('update public.companies set default_labour_rate = 99 where id = $1', [companyId]);
    await up.pg.exec(readMigration('20261104000100_timecards.sql'));
    expect(Number((await up.asSystem<{ labour_cost: string }>('select labour_cost from public.timecards where id = $1', [old]))[0].labour_cost)).toBe(330);
  });
});
