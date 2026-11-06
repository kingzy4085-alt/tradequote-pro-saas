// The timecard engine: what the database enforces (PGlite), what the API does (mocks),
// the payroll file and the weekly page.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootDb, readMigration, type TestDb } from './helpers/db';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ server: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mocks.server, createSupabaseServerClient: () => mocks.server }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import TimecardBoard from '@/app/(app)/timecards/timecard-board';
import { POST as enterTime } from '@/app/api/timecards/route';
import { PUT as saveCard } from '@/app/api/timecards/[id]/route';
import { POST as decideCards } from '@/app/api/timecards/decide/route';
import { POST as exportPayroll } from '@/app/api/timecards/export/route';
import { DETAIL_PAGES } from '@/lib/detail-pages';
import { getModule } from '@/lib/modules';
import { TIMECARD_COLUMNS, addDays, cardsWithPay, companyDate, csvCell, formatWeek, groupCards, hidePay, hoursProblem, loadWeek, payrollCsv, resolveWeek, totals, weekDays, weekStart, type Timecard } from '@/lib/timecards';
import { parseRecord } from '@/lib/validation';

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const USERS = {
  owner: { id: id(1), email: 'owner@alpha.ca' },
  pm: { id: id(2), email: 'pm@alpha.ca' },
  foreman: { id: id(3), email: 'foreman@alpha.ca' },
  foreman2: { id: id(4), email: 'foreman2@alpha.ca' },
  elec: { id: id(5), email: 'elec@alpha.ca' },
  elec2: { id: id(6), email: 'elec2@alpha.ca' },
  rival: { id: id(7), email: 'owner@rival.ca' },
};
type U = keyof typeof USERS;

describe('database rules', () => {
  let t: TestDb<U>;
  let company: string;
  let rivalCompany: string;
  let tessa: string; // employee with her own rate and login
  let rate0: string; // employee with no rate of her own
  let rivalEmployee: string;

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

  beforeAll(async () => {
    t = await bootDb(USERS);
    company = await t.createCompany('owner', 'Alpha Electric');
    await t.join('owner', 'pm', 'project_manager', 'Pat PM');
    await t.join('owner', 'foreman', 'foreman', 'Frank Foreman');
    await t.join('owner', 'foreman2', 'foreman', 'Fay Foreman');
    await t.join('owner', 'elec', 'electrician', 'Sam Sparks');
    await t.join('owner', 'elec2', 'electrician', 'Tessa Volt');
    rivalCompany = await t.createCompany('rival', 'Rival Electric');
    await t.asSystem(`update public.companies set default_labour_rate = 50, overtime_multiplier = 2 where id = $1`, [company]);
    await t.asSystem(`update public.companies set default_labour_rate = 999 where id = $1`, [rivalCompany]);
    [{ id: tessa }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, email, hourly_cost) values ('Tessa Volt', 'Active', 'elec2@alpha.ca', 40) returning id`);
    [{ id: rate0 }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status) values ('No Rate', 'Active') returning id`);
    await t.as('owner', `insert into public.employees (title, status, hourly_cost) values ('Big Earner', 'Active', 200)`);
    [{ id: rivalEmployee }] = await t.as<{ id: string }>('rival', `insert into public.employees (title, status, hourly_cost) values ('Rival Worker', 'Active', 777) returning id`);
  });

  describe('who sees what', () => {
    it('an electrician sees only their own cards, including ones written for them', async () => {
      const mine = await card('elec', { employee_name: 'Sam Sparks' });
      const forMe = await card('foreman', { employee_name: 'Sam Sparks', worker_user_id: USERS.elec.id });
      const other = await card('foreman', { employee_name: 'Someone Else' });
      const ids = (await t.as<{ id: string }>('elec', 'select id from public.timecards')).map((r) => r.id);
      expect(ids).toContain(mine);
      expect(ids).toContain(forMe);
      expect(ids).not.toContain(other);
    });

    it('a foreman sees and edits the whole crew', async () => {
      const cardId = await card('elec', { employee_name: 'Sam Sparks' });
      expect((await t.as('foreman', 'select id from public.timecards where id = $1', [cardId])).length).toBe(1);
      expect((await t.as('foreman', 'update public.timecards set regular_hours = 7 where id = $1 returning id', [cardId])).length).toBe(1);
    });

    it('a foreman can enter time for someone else, and it belongs to that worker', async () => {
      const cardId = await card('foreman', { employee_id: tessa, employee_name: 'Tessa Volt' });
      expect((await read(cardId)).worker_user_id).toBe(USERS.elec2.id);
    });

    it('other companies see nothing', async () => {
      const cardId = await card('foreman');
      expect((await t.as('rival', 'select id from public.timecards where id = $1', [cardId])).length).toBe(0);
      expect(await t.as('rival', 'select public.decide_timecards($1::uuid[], $2)', [[cardId], 'approve'])).toEqual([{ decide_timecards: { done: 0, skipped: [] } }]);
      expect((await read(cardId)).status).toBe('Submitted');
    });

    it('anon can do nothing', async () => {
      expect(await t.fails(null, 'select * from public.timecards')).toMatch(/permission denied/);
      expect(await t.fails(null, 'select public.timecard_workers()')).toMatch(/permission denied/);
      expect(await t.fails(null, `select public.decide_timecards('{}'::uuid[], 'approve')`)).toMatch(/permission denied/);
      expect(await t.fails(null, `select public.export_timecards('2026-01-01', '2026-01-02')`)).toMatch(/permission denied/);
    });

    it('nobody signed in can call the rate lookup directly', async () => {
      expect(await t.fails('owner', `select public.timecard_rate($1, $2, null, 'x')`, [rivalCompany, rivalEmployee])).toMatch(/permission denied/);
    });
  });

  describe('approving', () => {
    it('an electrician cannot approve, reject or export, even their own card', async () => {
      const cardId = await card('elec', { employee_name: 'Sam Sparks' });
      for (const status of ['Approved', 'Rejected', 'Exported']) {
        expect(await t.fails('elec', 'update public.timecards set status = $1 where id = $2', [status, cardId])).toMatch(/foreman|project manager/i);
      }
      expect((await read(cardId)).status).toBe('Submitted');
    });

    it('an electrician cannot create a card that is already approved', async () => {
      expect(await t.fails('elec', `insert into public.timecards (title, status, employee_name, regular_hours) values ('J', 'Approved', 'Sam Sparks', 8)`)).toMatch(/foreman/i);
    });

    it('a foreman approves crew time and the approver is stamped by the server', async () => {
      const cardId = await card('elec2', { employee_name: 'Tessa Volt' });
      await t.as('foreman', `update public.timecards set status = 'Approved', approved_by = $1, approved_by_name = 'Forged', approved_at = '2000-01-01', hourly_cost = 1, labour_cost = 1 where id = $2`, [USERS.owner.id, cardId]);
      const row = await read(cardId);
      expect(row.status).toBe('Approved');
      expect(row.approved_by).toBe(USERS.foreman.id);
      expect(row.approved_by_name).toBe('Frank Foreman');
      expect(new Date(row.approved_at as string).getFullYear()).toBeGreaterThan(2000);
      expect(Number(row.hourly_cost)).toBe(40);
      expect(Number(row.labour_cost)).toBe(320);
    });

    it('a foreman cannot approve their own card, however it is written', async () => {
      const asWorker = await card('foreman2', { employee_name: 'Anyone', worker_user_id: USERS.foreman.id });
      const unnamed = await card('foreman', { employee_name: 'Nickname' });
      const byName = await card('foreman2', { employee_name: ' frank FOREMAN ' });
      const [{ id: self }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status) values ('Frank Foreman', 'Active') returning id`);
      const byEmployee = await card('foreman2', { employee_name: 'Nickname', employee_id: self });
      for (const cardId of [asWorker, unnamed, byName, byEmployee]) {
        expect(await setStatus('foreman', cardId, 'Approved').catch((e) => e.message)).toMatch(/your own/);
        expect(await setStatus('foreman', cardId, 'Rejected').catch((e) => e.message)).toMatch(/your own/);
      }
      expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours) values ('J', 'Approved', 'Frank Foreman', 8)`)).toMatch(/your own/);
      // Another foreman can
      expect((await setStatus('foreman2', asWorker, 'Approved')).length).toBe(1);
      await t.as('owner', 'delete from public.timecards where employee_id = $1', [self]);
      await t.as('owner', 'delete from public.employees where id = $1', [self]);
    });

    it('moving a card to another employee does not leave it looking like the old worker\'s', async () => {
      const [{ id: self }] = await t.as<{ id: string }>('owner', `insert into public.employees (title, status, email) values ('Frank F', 'Active', 'foreman@alpha.ca') returning id`);
      const cardId = await card('foreman', { employee_name: 'Tessa Volt', employee_id: tessa });
      await t.as('foreman', 'update public.timecards set employee_id = $1 where id = $2', [self, cardId]);
      expect((await read(cardId)).worker_user_id).toBe(USERS.foreman.id);
      expect(await setStatus('foreman', cardId, 'Approved').catch((e) => e.message)).toMatch(/your own/);
      await t.as('owner', 'delete from public.timecards where id = $1', [cardId]);
      await t.as('owner', 'delete from public.employees where id = $1', [self]);
    });

    it('a project manager can approve their own card', async () => {
      const cardId = await card('pm', { employee_name: 'Pat PM', worker_user_id: USERS.pm.id });
      expect((await setStatus('pm', cardId, 'Approved')).length).toBe(1);
    });

    it('rejecting keeps the reason, and fixing the card sends it back', async () => {
      const cardId = await card('elec', { employee_name: 'Sam Sparks' });
      await t.as('foreman', `select public.decide_timecards($1::uuid[], 'reject', 'Wrong job')`, [[cardId]]);
      expect(await read(cardId)).toMatchObject({ status: 'Rejected', reject_reason: 'Wrong job', approved_by: null });
      await t.as('elec', `update public.timecards set regular_hours = 6, status = 'Submitted' where id = $1`, [cardId]);
      expect(await read(cardId)).toMatchObject({ status: 'Submitted', reject_reason: null });
    });
  });

  describe('pay', () => {
    it('falls back to the company rate and applies the company overtime multiplier', async () => {
      const cardId = await card('foreman', { employee_id: rate0, employee_name: 'No Rate', regular_hours: 8, overtime_hours: 2 });
      await setStatus('pm', cardId, 'Approved');
      const row = await read(cardId);
      expect(Number(row.hourly_cost)).toBe(50);
      expect(Number(row.labour_cost)).toBe(8 * 50 + 2 * 50 * 2);
    });

    it('rounds labour cost to cents', async () => {
      const cardId = await card('foreman', { employee_id: rate0, employee_name: 'No Rate', regular_hours: 0.33, overtime_hours: 0 });
      await setStatus('pm', cardId, 'Approved');
      expect(Number((await read(cardId)).labour_cost)).toBe(16.5);
    });

    it('freezes the rate at approval, whatever happens to the rates later', async () => {
      const cardId = await card('foreman', { employee_id: tessa, employee_name: 'Tessa Volt' });
      await setStatus('pm', cardId, 'Approved');
      await t.as('owner', 'update public.employees set hourly_cost = 90 where id = $1', [tessa]);
      await t.as('owner', 'update public.companies set overtime_multiplier = 3 where id = public.user_company_id()');
      expect(Number((await read(cardId)).hourly_cost)).toBe(40);
      expect(Number((await read(cardId)).labour_cost)).toBe(320);
      await t.as('owner', 'update public.employees set hourly_cost = 40 where id = $1', [tessa]);
      await t.as('owner', 'update public.companies set overtime_multiplier = 2 where id = public.user_company_id()');
    });

    it('a client cannot set pay on a card that is not approved', async () => {
      const cardId = await card('elec', { employee_name: 'Sam Sparks', hourly_cost: 500, labour_cost: 5000 });
      expect(await read(cardId)).toMatchObject({ hourly_cost: null, labour_cost: null });
      await t.as('elec', 'update public.timecards set labour_cost = 5000 where id = $1', [cardId]);
      expect((await read(cardId)).labour_cost).toBeNull();
    });

    it('an electrician cannot claim a higher-paid worker\'s rate by typing their name', async () => {
      const cardId = await card('elec', { employee_name: 'Big Earner' });
      await setStatus('pm', cardId, 'Approved');
      expect(Number((await read(cardId)).hourly_cost)).toBe(50);
    });

    it('a card for a named worker with no login still finds that worker\'s rate', async () => {
      const cardId = await card('foreman', { employee_name: 'big earner' });
      await setStatus('pm', cardId, 'Approved');
      expect(Number((await read(cardId)).hourly_cost)).toBe(200);
    });

    it('a worker can\'t be linked to another company\'s employee', async () => {
      expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours, employee_id) values ('J', 'Submitted', 'X', 8, $1)`, [rivalEmployee])).toBeTruthy();
    });

    it('changing a card\'s company cannot read another company\'s rates', async () => {
      const cardId = await card('foreman', { employee_name: 'Nobody Here' });
      await t.as('pm', `update public.timecards set company_id = $1, status = 'Approved' where id = $2`, [rivalCompany, cardId]);
      const row = await read(cardId);
      expect(row.company_id).toBe(company);
      expect(Number(row.hourly_cost)).toBe(50);
    });

    it('a card cannot be inserted into another company', async () => {
      expect(await t.fails('pm', `insert into public.timecards (company_id, title, status, employee_name, regular_hours) values ($1, 'J', 'Approved', 'X', 8)`, [rivalCompany])).toMatch(/another company/);
    });

    it('cannot point a card at someone outside the company', async () => {
      expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours, worker_user_id) values ('J', 'Submitted', 'X', 8, $1)`, [USERS.rival.id])).toMatch(/Pick the worker/);
    });

    it('an electrician cannot put a card on someone else', async () => {
      const cardId = await card('elec', { employee_name: 'Sam Sparks', worker_user_id: USERS.elec2.id, employee_id: tessa });
      expect(await read(cardId)).toMatchObject({ worker_user_id: USERS.elec.id, employee_id: null });
      await t.as('elec', `update public.timecards set worker_user_id = $1, employee_name = 'Tessa Volt' where id = $2`, [USERS.elec2.id, cardId]);
      expect(await read(cardId)).toMatchObject({ worker_user_id: USERS.elec.id, employee_name: 'Sam Sparks' });
    });
  });

  describe('reading pay', () => {
    const payOf = (who: U, ids: string[]) => t.as<{ out: { id: string; hourly_cost: string; labour_cost: string }[] }>(who, 'select public.timecard_pay($1::uuid[]) as out', [ids]);

    it.each(['elec2', 'foreman', 'pm', 'owner'] as const)('the columns the pages ask for can be read by %s, with no pay among them', async (who) => {
      const cardId = await card('elec2', { employee_name: 'Tessa Volt' });
      await setStatus('pm', cardId, 'Approved');
      const [row] = await t.as<Record<string, unknown>>(who, `select ${TIMECARD_COLUMNS} from public.timecards where id = $1`, [cardId]);
      expect(row.id).toBe(cardId);
      expect(row).not.toHaveProperty('hourly_cost');
      expect(row).not.toHaveProperty('labour_cost');
    });

    it('nobody signed in reads pay from the table, by column, star, filter or sort', async () => {
      const cardId = await card('elec2', { employee_name: 'Tessa Volt' });
      await setStatus('pm', cardId, 'Approved');
      for (const who of ['foreman', 'elec2', 'pm', 'owner'] as const) {
        for (const sql of [
          'select hourly_cost from public.timecards where id = $1',
          'select labour_cost from public.timecards where id = $1',
          'select * from public.timecards where id = $1',
          'select to_jsonb(t) from public.timecards t where t.id = $1',
          'select id from public.timecards where id = $1 and hourly_cost > 0',
          'select id from public.timecards where id = $1 order by labour_cost',
          `update public.timecards set notes = notes where id = $1 returning *`,
        ]) {
          expect(await t.fails(who, sql, [cardId])).toMatch(/permission denied/);
        }
      }
    });

    it('a project manager gets frozen pay from timecard_pay, and nobody below does', async () => {
      const cardId = await card('elec2', { employee_name: 'Tessa Volt' });
      await setStatus('pm', cardId, 'Approved');
      const [{ out }] = await payOf('pm', [cardId]);
      expect(out).toHaveLength(1);
      expect(Number(out[0].hourly_cost)).toBe(40);
      expect(Number(out[0].labour_cost)).toBe(320);
      for (const who of ['foreman', 'elec2'] as const) expect(await t.fails(who, 'select public.timecard_pay($1::uuid[])', [[cardId]])).toMatch(/project manager/);
      expect((await payOf('rival', [cardId]))[0].out).toEqual([]);
    });
  });

  describe('hours across one person\'s day', () => {
    const DAY = '2026-09-07';

    it('counts every open card, and a card for the login and a card for its employee record are one person', async () => {
      await card('foreman', { employee_id: tessa, employee_name: 'Tessa Volt', work_date: DAY, regular_hours: 12 });
      expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, worker_user_id, work_date, regular_hours) values ('J', 'Submitted', 'x', $1, $2, 12.5)`, [USERS.elec2.id, DAY])).toMatch(/already has 12 hours/);
      const fits = await card('foreman', { worker_user_id: USERS.elec2.id, work_date: DAY, regular_hours: 12 });
      expect(await t.fails('foreman', 'update public.timecards set regular_hours = 12.5 where id = $1', [fits])).toMatch(/24 hours in one day/);
    });

    it('catches two entries for one person in a single save', async () => {
      const d = '2026-09-08';
      expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, worker_user_id, work_date, regular_hours) values ('J', 'Submitted', 'x', $1, $2, 16), ('J', 'Submitted', 'x', $1, $2, 16)`, [USERS.elec.id, d])).toMatch(/24 hours in one day/);
      expect(await t.asSystem('select id from public.timecards where work_date = $1', [d])).toEqual([]);
    });

    it('a rejected card does not count until it is sent back, and moving a card onto a full day is refused', async () => {
      const d = '2026-09-09';
      const first = await card('foreman', { worker_user_id: USERS.elec.id, work_date: d, regular_hours: 16 });
      await setStatus('pm', first, 'Rejected');
      await card('foreman', { worker_user_id: USERS.elec.id, work_date: d, regular_hours: 16 });
      expect(await setStatus('pm', first, 'Approved').catch((e) => e.message)).toMatch(/24 hours in one day/);
      expect(await t.fails('foreman', `update public.timecards set status = 'Submitted' where id = $1`, [first])).toMatch(/24 hours in one day/);
      const elsewhere = await card('foreman', { worker_user_id: USERS.elec.id, work_date: '2026-09-10', regular_hours: 16 });
      expect(await t.fails('foreman', 'update public.timecards set work_date = $1 where id = $2', [d, elsewhere])).toMatch(/24 hours in one day/);
    });

    it('an older pair of cards over the limit cannot be approved past it', async () => {
      const d = '2026-09-11';
      const [{ id: one }] = await t.asService<{ id: string }>(`insert into public.timecards (company_id, title, status, employee_name, worker_user_id, work_date, regular_hours) values ($1, 'J', 'Submitted', 'x', $2, $3, 16) returning id`, [company, USERS.elec.id, d]);
      await t.asService(`insert into public.timecards (company_id, title, status, employee_name, worker_user_id, work_date, regular_hours) values ($1, 'J', 'Submitted', 'x', $2, $3, 16)`, [company, USERS.elec.id, d]);
      expect(await setStatus('pm', one, 'Approved').catch((e) => e.message)).toMatch(/24 hours in one day/);
      expect((await read(one)).status).toBe('Submitted');
    });

    it('two workers can share a date, and so can two people who only have a typed name', async () => {
      const d = '2026-09-14';
      await card('foreman', { worker_user_id: USERS.elec.id, work_date: d, regular_hours: 16 });
      await card('foreman', { worker_user_id: USERS.elec2.id, work_date: d, regular_hours: 16 });
      await card('foreman', { employee_name: 'Mike', work_date: d, regular_hours: 16 });
      await card('foreman', { employee_name: 'Mike', work_date: d, regular_hours: 16 });
    });

    it('being refused for your role is what an electrician hears, not the hours', async () => {
      const d = '2026-09-15';
      await card('elec', { employee_name: 'Sam Sparks', work_date: d, regular_hours: 24 });
      expect(await t.fails('elec', `insert into public.timecards (title, status, employee_name, work_date, regular_hours) values ('J', 'Approved', 'Sam Sparks', $1, 8)`, [d])).toMatch(/foreman/i);
    });
  });

  describe('locks', () => {
    it('an approved card cannot be edited or deleted', async () => {
      const cardId = await card('foreman');
      await setStatus('pm', cardId, 'Approved');
      for (const who of ['owner', 'pm', 'foreman'] as const) {
        expect(await t.fails(who, 'update public.timecards set regular_hours = 1 where id = $1', [cardId])).toMatch(/locked/);
        expect(await t.fails(who, `update public.timecards set notes = 'x' where id = $1`, [cardId])).toMatch(/locked/);
        expect(await t.fails(who, 'delete from public.timecards where id = $1', [cardId])).toMatch(/approved/);
      }
    });

    it('only an approver can un-approve, and then the card opens up', async () => {
      const cardId = await card('elec', { employee_name: 'Sam Sparks' });
      await setStatus('pm', cardId, 'Approved');
      expect(await t.fails('elec', `update public.timecards set status = 'Submitted' where id = $1`, [cardId])).toMatch(/foreman/i);
      await t.as('foreman', `update public.timecards set status = 'Submitted' where id = $1`, [cardId]);
      expect(await read(cardId)).toMatchObject({ status: 'Submitted', hourly_cost: null, labour_cost: null, approved_by: null, approved_at: null });
      expect((await t.as('elec', 'update public.timecards set regular_hours = 5 where id = $1 returning id', [cardId])).length).toBe(1);
      expect((await t.as('elec', 'delete from public.timecards where id = $1 returning id', [cardId])).length).toBe(1);
    });

    it('a foreman cannot un-approve their own card', async () => {
      const cardId = await card('foreman', { employee_name: 'Frank Foreman' });
      await setStatus('pm', cardId, 'Approved');
      expect(await t.fails('foreman', `update public.timecards set status = 'Submitted' where id = $1`, [cardId])).toMatch(/your own/);
    });

    it('re-approving freezes the rate afresh', async () => {
      const cardId = await card('foreman', { employee_id: tessa, employee_name: 'Tessa Volt' });
      await setStatus('pm', cardId, 'Approved');
      await t.as('owner', 'update public.employees set hourly_cost = 60 where id = $1', [tessa]);
      await setStatus('pm', cardId, 'Submitted');
      await setStatus('pm', cardId, 'Approved');
      expect(Number((await read(cardId)).hourly_cost)).toBe(60);
      await t.as('owner', 'update public.employees set hourly_cost = 40 where id = $1', [tessa]);
    });

    it('an electrician can delete their own open card but not another worker\'s', async () => {
      const mine = await card('elec', { employee_name: 'Sam Sparks' });
      const written = await card('foreman', { employee_name: 'Sam Sparks', worker_user_id: USERS.elec.id });
      expect((await t.as('elec', 'delete from public.timecards where id = $1 returning id', [written])).length).toBe(0);
      expect((await t.as('elec', 'delete from public.timecards where id = $1 returning id', [mine])).length).toBe(1);
    });
  });

  describe('hours', () => {
    const bad = (regular: number, overtime: number) => t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours, overtime_hours) values ('J', 'Submitted', 'X', $1, $2)`, [regular, overtime]);

    it('refuses zero, negative and more than 24', async () => {
      expect(await bad(0, 0)).toMatch(/hours worked/);
      expect(await bad(-1, 5)).toMatch(/negative/);
      expect(await bad(20, 4.25)).toMatch(/24 hours/);
    });

    it('takes exactly 24', async () => {
      const cardId = await card('foreman', { regular_hours: 16, overtime_hours: 8 });
      expect(Number((await read(cardId)).regular_hours)).toBe(16);
    });

    it('checks on edit too', async () => {
      const cardId = await card('foreman');
      expect(await t.fails('foreman', 'update public.timecards set overtime_hours = 20 where id = $1', [cardId])).toMatch(/24 hours/);
    });

    it('an old card with bad hours can be rejected but not approved', async () => {
      await t.pg.exec('alter table public.timecards disable trigger user');
      const [{ id: cardId }] = await t.asSystem<{ id: string }>(`insert into public.timecards (company_id, title, status, employee_name) values ($1, 'Old', 'Submitted', 'X') returning id`, [company]);
      await t.pg.exec('alter table public.timecards enable trigger user');
      expect(await setStatus('pm', cardId, 'Approved').catch((e) => e.message)).toMatch(/hours worked/);
      expect((await setStatus('pm', cardId, 'Rejected')).length).toBe(1);
    });
  });

  describe('batches', () => {
    it('approve-all approves the crew and reports the card it could not', async () => {
      const a = await card('elec', { employee_name: 'Sam Sparks' });
      const b = await card('elec2', { employee_name: 'Tessa Volt' });
      const own = await card('foreman', { employee_name: 'Frank Foreman' });
      const [{ out }] = await t.as<{ out: { done: number; skipped: { id: string; worker: string; reason: string }[] } }>('foreman', `select public.decide_timecards($1::uuid[], 'approve') as out`, [[a, b, own]]);
      expect(out.done).toBe(2);
      expect(out.skipped).toHaveLength(1);
      expect(out.skipped[0]).toMatchObject({ id: own, worker: 'Frank Foreman' });
      expect(out.skipped[0].reason).toMatch(/your own/);
      expect((await read(a)).status).toBe('Approved');
      expect((await read(own)).status).toBe('Submitted');
    });

    it('leaves a card that is not in the right state alone', async () => {
      const cardId = await card('foreman2');
      await setStatus('pm', cardId, 'Approved');
      const [{ out }] = await t.as<{ out: { done: number } }>('pm', `select public.decide_timecards($1::uuid[], 'approve') as out`, [[cardId]]);
      expect(out.done).toBe(0);
    });

    it('an electrician gets nothing done through the batch', async () => {
      const cardId = await card('elec', { employee_name: 'Sam Sparks' });
      const [{ out }] = await t.as<{ out: { done: number; skipped: unknown[] } }>('elec', `select public.decide_timecards($1::uuid[], 'approve') as out`, [[cardId]]);
      expect(out.done).toBe(0);
      expect(out.skipped).toHaveLength(1);
      expect((await read(cardId)).status).toBe('Submitted');
    });

    it('refuses an unknown action and an oversized batch', async () => {
      expect(await t.fails('pm', `select public.decide_timecards('{}'::uuid[], 'pay')`)).toMatch(/Unknown action/);
      expect(await t.fails('pm', `select public.decide_timecards(array_fill(gen_random_uuid(), array[501]), 'approve')`)).toMatch(/500/);
    });
  });

  describe('payroll export', () => {
    const DAY = '2026-06-10';
    const exportAs = async (who: U, again = false) => (await t.as<{ out: Timecard[] }>(who, `select public.export_timecards($1, $1, $2) as out`, [DAY, again]))[0].out;

    it('moves only approved cards in the dates, once', async () => {
      const approved = await card('foreman', { employee_name: 'A', work_date: DAY });
      const open = await card('foreman', { employee_name: 'B', work_date: DAY });
      const otherDay = await card('foreman', { employee_name: 'C', work_date: '2026-06-11' });
      await setStatus('pm', approved, 'Approved');
      await setStatus('pm', otherDay, 'Approved');
      const first = await exportAs('pm');
      expect(first.map((c) => c.id)).toEqual([approved]);
      expect(Number(first[0].labour_cost)).toBeGreaterThan(0);
      const row = await read(approved);
      expect(row.status).toBe('Exported');
      expect(row.exported_at).not.toBeNull();
      expect(row.approved_by).toBe(USERS.pm.id);
      expect((await read(open)).status).toBe('Submitted');
      expect((await read(otherDay)).status).toBe('Approved');
      expect(await exportAs('pm')).toEqual([]);
      expect((await exportAs('pm', true)).map((c) => c.id)).toEqual([approved]);
    });

    it('a foreman or electrician cannot export or set Exported', async () => {
      expect(await t.fails('foreman', `select public.export_timecards('2026-01-01', '2026-01-02')`)).toMatch(/project manager/);
      expect(await t.fails('elec', `select public.export_timecards('2026-01-01', '2026-01-02', true)`)).toMatch(/project manager/);
      const cardId = await card('foreman2', { work_date: DAY });
      await setStatus('pm', cardId, 'Approved');
      expect(await t.fails('foreman', `update public.timecards set status = 'Exported' where id = $1`, [cardId])).toMatch(/project manager/);
    });

    it('a card can only reach Exported from Approved', async () => {
      const cardId = await card('foreman');
      expect(await t.fails('pm', `update public.timecards set status = 'Exported' where id = $1`, [cardId])).toMatch(/approved/i);
    });

    it('an exported card is locked, and reopening puts it back to Approved with pay intact', async () => {
      const cardId = await card('foreman', { employee_id: tessa, employee_name: 'Tessa Volt', work_date: '2026-06-20' });
      await setStatus('pm', cardId, 'Approved');
      await t.as('pm', `select public.export_timecards('2026-06-20', '2026-06-20')`);
      expect(await t.fails('owner', 'update public.timecards set regular_hours = 1 where id = $1', [cardId])).toMatch(/locked/);
      expect(await t.fails('owner', 'delete from public.timecards where id = $1', [cardId])).toMatch(/approved/);
      const [{ out }] = await t.as<{ out: { done: number; skipped: unknown[] } }>('foreman', `select public.decide_timecards($1::uuid[], 'reopen') as out`, [[cardId]]);
      expect(out).toMatchObject({ done: 0, skipped: [expect.anything()] });
      expect(await t.fails('pm', `update public.timecards set status = 'Submitted' where id = $1`, [cardId])).toMatch(/goes back to Approved/);
      await t.as('pm', `select public.decide_timecards($1::uuid[], 'reopen')`, [[cardId]]);
      const row = await read(cardId);
      expect(row).toMatchObject({ status: 'Approved', exported_at: null });
      expect(Number(row.labour_cost)).toBe(320);
    });

    it('returns more rows than the API row limit as one value', async () => {
      const [{ type }] = await t.asSystem<{ type: string }>(`select pg_get_function_result('public.export_timecards(date, date, boolean)'::regprocedure) as type`);
      expect(type).toBe('jsonb');
    });
  });

  describe('workers list', () => {
    it('a foreman gets logins and employees, joined where they match, and no rates', async () => {
      const rows = await t.as<Record<string, unknown>>('foreman', 'select * from public.timecard_workers()');
      expect(Object.keys(rows[0]).sort()).toEqual(['employee_id', 'name', 'user_id']);
      const tessas = rows.filter((r) => r.name === 'Tessa Volt');
      expect(tessas).toEqual([{ employee_id: tessa, user_id: USERS.elec2.id, name: 'Tessa Volt' }]);
      expect(rows.some((r) => r.name === 'Big Earner' && r.user_id === null)).toBe(true);
      expect(rows.some((r) => r.name === 'Rival Worker')).toBe(false);
    });

    it('an electrician gets only themselves', async () => {
      expect((await t.as<{ name: string }>('elec', 'select * from public.timecard_workers()')).map((r) => r.name)).toEqual(['Sam Sparks']);
    });
  });

  describe('a lapsed company', () => {
    it('is read-only, and a lost payroll file can still be downloaded', async () => {
      const cardId = await card('foreman', { work_date: '2026-07-01' });
      const toExport = await card('foreman2', { work_date: '2026-07-02' });
      await setStatus('pm', toExport, 'Approved');
      await t.as('pm', `select public.export_timecards('2026-07-02', '2026-07-02')`);
      const approved = await card('foreman2', { work_date: '2026-07-03' });
      await setStatus('pm', approved, 'Approved');
      await t.setLapsed(company, true);
      try {
        expect(await t.fails('foreman', `insert into public.timecards (title, status, employee_name, regular_hours) values ('J', 'Submitted', 'X', 8)`)).toMatch(/row-level security/);
        expect((await t.as('foreman', 'update public.timecards set regular_hours = 1 where id = $1 returning id', [cardId])).length).toBe(0);
        expect((await t.as('foreman', 'delete from public.timecards where id = $1 returning id', [cardId])).length).toBe(0);
        const [{ out }] = await t.as<{ out: { done: number } }>('pm', `select public.decide_timecards($1::uuid[], 'approve') as out`, [[cardId]]);
        expect(out.done).toBe(0);
        expect(await t.fails('pm', `select public.export_timecards('2026-07-03', '2026-07-03')`)).toMatch(/subscription has ended/);
        const [{ again }] = await t.as<{ again: Timecard[] }>('pm', `select public.export_timecards('2026-07-02', '2026-07-02', true) as again`);
        expect(again.map((c) => c.id)).toEqual([toExport]);
      } finally {
        await t.setLapsed(company, false);
      }
    });
  });

  describe('the system', () => {
    it('a company cascade deletes approved and exported cards', async () => {
      const [{ id: gone }] = await t.asSystem<{ id: string }>(`insert into public.companies (name, province) values ('Gone', 'SK') returning id`);
      await t.asSystem(`insert into public.timecards (company_id, title, status, employee_name, regular_hours) values ($1, 'J', 'Approved', 'X', 8), ($1, 'J', 'Exported', 'Y', 8)`, [gone]);
      await t.asSystem('delete from public.companies where id = $1', [gone]);
      expect((await t.asSystem('select id from public.timecards where company_id = $1', [gone])).length).toBe(0);
    });

    it('the migration can run again', async () => {
      await t.pg.exec(readMigration('20261104000100_timecards.sql'));
      expect((await t.as('foreman', 'select * from public.timecard_workers()')).length).toBeGreaterThan(0);
      const cardId = await card('elec', { employee_name: 'Sam Sparks' });
      expect(await t.fails('elec', `update public.timecards set status = 'Approved' where id = $1`, [cardId])).toMatch(/foreman/i);
    });
  });
});

const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'foreman@alpha.ca' };
const ACTIVE = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01T00:00:00Z', current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null };
const LAPSED = { ...ACTIVE, subscription_status: 'canceled' };
const PROJECT = '33333333-3333-4333-8333-333333333333';
const WORKER_ID = '44444444-4444-4444-8444-444444444444';
const EMPLOYEE_ID = '55555555-5555-4555-8555-555555555555';

function signedIn(role: string, options: { company?: typeof ACTIVE; rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null } } = {}) {
  const fake = fakeSupabase({ company_users: [{ user_id: USER.id, role, company: options.company ?? ACTIVE }], projects: [{ id: PROJECT, title: 'Canola Plant' }], timecards: [] }, { rpc: options.rpc });
  const client = Object.assign(fake, { auth: { getUser: async () => ({ data: { user: USER }, error: null }) } });
  mocks.server = client;
  return client;
}
const post = (body: unknown) => new Request('https://app.test/api/timecards', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('API', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('entering time', () => {
    const CREW = [
      { employee_id: EMPLOYEE_ID, user_id: WORKER_ID, name: 'Tessa Volt' },
      { employee_id: null, user_id: USER.id, name: 'Frank Foreman' },
    ];
    const workersRpc = (list: unknown[]) => (name: string) => (name === 'timecard_workers' ? { data: list, error: null } : { data: null, error: null });
    const entry = (extra: Record<string, unknown> = {}) => ({ work_date: '2026-11-02', project_id: PROJECT, entries: [{ worker_user_id: WORKER_ID, employee_id: EMPLOYEE_ID, regular_hours: '8', overtime_hours: '1.5' }], ...extra });

    it('a foreman saves a crew, with names from the server and the job from the project', async () => {
      const client = signedIn('foreman', { rpc: workersRpc(CREW) });
      const res = await enterTime(post(entry({ entries: [{ worker_user_id: WORKER_ID, employee_name: 'Forged', regular_hours: 8 }, { employee_name: 'Day Labourer', overtime_hours: 4 }] })));
      expect(res.status).toBe(201);
      expect((await res.json()).saved).toBe(2);
      expect(client.tables.timecards).toEqual([
        expect.objectContaining({ title: 'Canola Plant', status: 'Submitted', project_id: PROJECT, employee_name: 'Tessa Volt', worker_user_id: WORKER_ID, employee_id: EMPLOYEE_ID, regular_hours: 8, overtime_hours: 0 }),
        expect.objectContaining({ employee_name: 'Day Labourer', worker_user_id: null, employee_id: null, overtime_hours: 4 }),
      ]);
    });

    it('never passes on pay or approval fields', async () => {
      const client = signedIn('foreman', { rpc: workersRpc(CREW) });
      await enterTime(post(entry({ status: 'Approved', hourly_cost: 500, labour_cost: 9, approved_by: USER.id, entries: [{ worker_user_id: WORKER_ID, regular_hours: 8, hourly_cost: 500, status: 'Approved' }] })));
      const row = client.tables.timecards[0];
      expect(row.status).toBe('Submitted');
      for (const k of ['hourly_cost', 'labour_cost', 'approved_by', 'approved_at']) expect(row).not.toHaveProperty(k);
    });

    it('an electrician\'s time is always their own, whoever they name', async () => {
      const client = signedIn('electrician', { rpc: workersRpc([{ employee_id: null, user_id: USER.id, name: 'Sam Sparks' }]) });
      const res = await enterTime(post(entry({ entries: [{ worker_user_id: WORKER_ID, employee_name: 'Tessa Volt', regular_hours: 8 }] })));
      expect(res.status).toBe(201);
      expect(client.tables.timecards[0]).toMatchObject({ employee_name: 'Sam Sparks', worker_user_id: USER.id });
    });

    it('takes a job that is not a project', async () => {
      const client = signedIn('foreman', { rpc: workersRpc(CREW) });
      const res = await enterTime(post(entry({ project_id: null, job: 'Shop' })));
      expect(res.status).toBe(201);
      expect(client.tables.timecards[0]).toMatchObject({ title: 'Shop', project_id: null });
    });

    it.each([
      ['no job', { project_id: null }, /project or type/],
      ['an unknown project', { project_id: '66666666-6666-4666-8666-666666666666' }, /from the list/],
      ['a bad date', { work_date: '2026-02-31' }, /date/],
      ['no workers', { entries: [] }, /at least one/],
      ['no hours', { entries: [{ worker_user_id: WORKER_ID }] }, /hours worked/],
      ['too many hours', { entries: [{ worker_user_id: WORKER_ID, regular_hours: 20, overtime_hours: 5 }] }, /24 hours/],
      ['negative hours', { entries: [{ worker_user_id: WORKER_ID, regular_hours: -1, overtime_hours: 5 }] }, /negative/],
      ['a worker not in the list', { entries: [{ worker_user_id: '77777777-7777-4777-8777-777777777777', regular_hours: 8 }] }, /from the list/],
      ['a row with nobody on it', { entries: [{ regular_hours: 8 }] }, /from the list/],
    ])('refuses %s', async (_name, change, message) => {
      const client = signedIn('foreman', { rpc: workersRpc(CREW) });
      const res = await enterTime(post(entry(change)));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(message);
      expect(client.tables.timecards).toEqual([]);
    });

    it('refuses bad JSON, a lapsed company and a signed-out visitor', async () => {
      signedIn('foreman', { rpc: workersRpc(CREW) });
      expect((await enterTime(post('{nope'))).status).toBe(400);
      signedIn('foreman', { company: LAPSED, rpc: workersRpc(CREW) });
      expect((await enterTime(post(entry()))).status).toBe(402);
      mocks.server = Object.assign(fakeSupabase({}), { auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
      expect((await enterTime(post(entry()))).status).toBe(401);
    });

    it('passes on what the trigger says', async () => {
      const client = signedIn('foreman', { rpc: workersRpc(CREW) });
      client.from = ((orig) => (table: string) => {
        const b = orig(table);
        if (table !== 'timecards') return b;
        return { ...b, insert: () => ({ select: async () => ({ data: null, error: { code: '22023', message: 'A timecard cannot be more than 24 hours in one day.' } }) }) } as unknown as typeof b;
      })(client.from);
      const res = await enterTime(post(entry()));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/24 hours/);
    });
  });

  describe('saving one card', () => {
    const CARD_ID = '88888888-8888-4888-8888-888888888888';
    const put = (body: unknown, cardId = CARD_ID) => saveCard(new Request(`https://app.test/api/timecards/${cardId}`, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: { id: cardId } });
    const withCard = (role: string) => {
      const client = signedIn(role);
      client.tables.timecards.push({ id: CARD_ID, title: 'Job', status: 'Submitted', regular_hours: 8 });
      return client;
    };

    it('saves the fields, and asks only for columns a signed-in user can read', async () => {
      const client = withCard('foreman');
      const res = await put({ regular_hours: 6, notes: 'Short day' });
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({ id: CARD_ID, regular_hours: 6, notes: 'Short day' });
      const update = client.log.find((c) => c.table === 'timecards' && c.op === 'update')!;
      expect(update.columns).toBe(TIMECARD_COLUMNS);
      expect(update.columns).not.toMatch(/hourly_cost|labour_cost|\*/);
    });

    it('never passes on pay or approval fields', async () => {
      const client = withCard('foreman');
      await put({ regular_hours: 6, hourly_cost: 500, labour_cost: 9, approved_by: USER.id, approved_at: '2000-01-01' });
      const { values } = client.log.find((c) => c.op === 'update')!;
      expect(values).toEqual({ regular_hours: 6 });
    });

    it('refuses a status nobody may pick, a bad body, a bad id, a missing card, a lapsed company and a signed-out visitor', async () => {
      withCard('foreman');
      expect((await put({ status: 'Exported' })).status).toBe(400);
      expect((await put('{nope')).status).toBe(400);
      expect((await put({ notes: 'x' }, 'not-a-uuid')).status).toBe(404);
      expect((await put({ notes: 'x' }, WORKER_ID)).status).toBe(404);
      signedIn('foreman', { company: LAPSED });
      expect((await put({ notes: 'x' })).status).toBe(402);
      mocks.server = Object.assign(fakeSupabase({}), { auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
      expect((await put({ notes: 'x' })).status).toBe(401);
    });

    it('passes on what the trigger says', async () => {
      const client = signedIn('foreman');
      client.from = ((orig) => (table: string) => {
        const b = orig(table);
        if (table !== 'timecards') return b;
        return { ...b, update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'P0001', message: 'This timecard is approved and locked.' } }) }) }) }) } as unknown as typeof b;
      })(client.from);
      const res = await put({ notes: 'x' });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/locked/);
    });
  });

  describe('loading cards', () => {
    const row = { id: 'a', title: 'J', status: 'Approved', employee_name: 'Sam', work_date: '2026-11-02', regular_hours: 8, overtime_hours: 0 };
    const client = (rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }) => {
      const fake = fakeSupabase({ timecards: [{ ...row }] }, { rpc });
      // The stand-in has no date filters, and these tests hold one card, inside the week
      const from = fake.from;
      fake.from = ((table: string) => Object.assign(from(table), { gte() { return this; }, lte() { return this; } })) as typeof fake.from;
      return fake as unknown as Parameters<typeof loadWeek>[0];
    };

    it('a week below project manager never asks for pay', async () => {
      const rpc = vi.fn(() => ({ data: null, error: null }));
      const { cards } = await loadWeek(client(rpc), '2026-11-02', '2026-11-08');
      expect(rpc).not.toHaveBeenCalled();
      expect(cards[0]).toMatchObject({ id: 'a', hourly_cost: null, labour_cost: null });
    });

    it('a project manager\'s week comes with the frozen pay', async () => {
      const rpc = vi.fn(() => ({ data: [{ id: 'a', hourly_cost: '40.00', labour_cost: '320.00' }], error: null }));
      const { cards } = await loadWeek(client(rpc), '2026-11-02', '2026-11-08', null, true);
      expect(rpc).toHaveBeenCalledWith('timecard_pay', { p_ids: ['a'] });
      expect(cards[0]).toMatchObject({ hourly_cost: '40.00', labour_cost: '320.00' });
    });

    it('asks for nothing when there are no cards, and a failed pay read does not pass as no pay', async () => {
      const rpc = vi.fn(() => ({ data: null, error: { message: 'nope' } }));
      expect(await cardsWithPay(client(rpc), [])).toEqual([]);
      expect(rpc).not.toHaveBeenCalled();
      await expect(cardsWithPay(client(rpc), [row as unknown as Timecard])).rejects.toThrow(/Could not load pay/);
    });
  });

  describe('deciding', () => {
    const IDS = [WORKER_ID];

    it('a foreman\'s decision goes to the database, with the reason', async () => {
      let call: Record<string, unknown> | null = null;
      signedIn('foreman', { rpc: (name, args) => { if (name === 'decide_timecards') call = args; return { data: { done: 1, skipped: [] }, error: null }; } });
      const res = await decideCards(post({ ids: IDS, action: 'reject', reason: ' Wrong job ' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ done: 1, skipped: [] });
      expect(call).toEqual({ p_ids: IDS, p_action: 'reject', p_reason: 'Wrong job' });
    });

    it('an electrician is turned away before it reaches the database', async () => {
      const rpc = vi.fn(() => ({ data: null, error: null }));
      signedIn('electrician', { rpc });
      expect((await decideCards(post({ ids: IDS, action: 'approve' }))).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    });

    it('refuses bad input and a lapsed company', async () => {
      signedIn('foreman');
      expect((await decideCards(post({ ids: ['x'], action: 'approve' }))).status).toBe(400);
      expect((await decideCards(post({ ids: IDS, action: 'pay' }))).status).toBe(400);
      expect((await decideCards(post({ ids: [], action: 'approve' }))).status).toBe(400);
      signedIn('foreman', { company: LAPSED });
      expect((await decideCards(post({ ids: IDS, action: 'approve' }))).status).toBe(402);
    });

    it('a database failure does not leak', async () => {
      signedIn('foreman', { rpc: () => ({ data: null, error: { code: 'XX000', message: 'secret internals' } }) });
      const res = await decideCards(post({ ids: IDS, action: 'approve' }));
      expect(res.status).toBe(500);
      expect(await res.text()).not.toMatch(/secret/);
    });
  });

  describe('exporting', () => {
    const RANGE = { from: '2026-11-02', to: '2026-11-08' };
    const ROW = { employee_name: '=HYPERLINK("http://evil")', work_date: '2026-11-02', title: 'Canola, Plant', regular_hours: 8, overtime_hours: 2, hourly_cost: 40, labour_cost: 440, approved_by_name: 'Frank', approved_at: '2026-11-03T00:00:00Z', notes: '@SUM(A1)' };

    it('returns the file for a project manager', async () => {
      let call: Record<string, unknown> | null = null;
      signedIn('project_manager', { rpc: (name, args) => { call = { name, ...args }; return { data: [ROW], error: null }; } });
      const res = await exportPayroll(post(RANGE));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/csv/);
      expect(res.headers.get('content-disposition')).toContain('payroll-2026-11-02-to-2026-11-08.csv');
      expect(res.headers.get('x-timecard-count')).toBe('1');
      expect(call).toEqual({ name: 'export_timecards', p_from: RANGE.from, p_to: RANGE.to, p_again: false });
      const text = await res.text();
      expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
      expect(text).toContain('"Canola, Plant"');
      expect(text).toContain(`'@SUM(A1)`);
    });

    it.each(['foreman', 'electrician'])('turns away a %s', async (role) => {
      const rpc = vi.fn(() => ({ data: [ROW], error: null }));
      signedIn(role, { rpc });
      expect((await exportPayroll(post(RANGE))).status).toBe(403);
      expect((await exportPayroll(post({ ...RANGE, again: true }))).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    });

    it('says so when there is nothing to export', async () => {
      signedIn('owner', { rpc: () => ({ data: [], error: null }) });
      const res = await exportPayroll(post(RANGE));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/No approved/);
    });

    it('a lapsed company can only download again', async () => {
      signedIn('owner', { company: LAPSED, rpc: () => ({ data: [ROW], error: null }) });
      expect((await exportPayroll(post(RANGE))).status).toBe(402);
      expect((await exportPayroll(post({ ...RANGE, again: true }))).status).toBe(200);
    });

    it('refuses bad dates', async () => {
      signedIn('owner');
      expect((await exportPayroll(post({ from: 'nope', to: RANGE.to }))).status).toBe(400);
      expect((await exportPayroll(post({ from: RANGE.to, to: RANGE.from }))).status).toBe(400);
    });
  });
});

const tc = (extra: Partial<Timecard> = {}): Timecard => ({
  id: '1', title: 'Canola', status: 'Submitted', notes: null, project_id: null, employee_name: 'Sam', employee_id: null, worker_user_id: null, work_date: '2026-11-02', regular_hours: 8, overtime_hours: 1, reject_reason: null, hourly_cost: null, labour_cost: null, approved_by_name: null, approved_at: null, exported_at: null, created_by: null, ...extra,
});

describe('rules in code', () => {
  it('the registry lets foremen in and keeps pay out of the client\'s hands', () => {
    const mod = getModule('timecards')!;
    expect(mod.ownRowsBelow).toBe(2);
    expect(DETAIL_PAGES.timecards).toBe('/timecards');
    const parsed = parseRecord(mod, { hourly_cost: 500, labour_cost: 5, approved_by: 'x', approved_at: 'y', exported_at: 'z', regular_hours: 8 }, 'update');
    expect(parsed).toEqual({ ok: true, data: { regular_hours: 8 } });
    expect(parseRecord(mod, { status: 'Exported' }, 'update').ok).toBe(false);
    expect(parseRecord(mod, { regular_hours: -1 }, 'update').ok).toBe(false);
  });

  it('works out weeks from Monday', () => {
    expect(weekStart('2026-11-04')).toBe('2026-11-02');
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(weekDays('2026-12-28')[6]).toBe('2027-01-03');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(formatWeek('2026-11-02')).toMatch(/Nov.*2.*Nov.*8.*2026/);
  });

  it('reads the week from the address, ignoring junk', () => {
    expect(resolveWeek('2026-11-04', '2026-01-15')).toBe('2026-11-02');
    expect(resolveWeek('garbage', '2026-11-04')).toBe('2026-11-02');
    expect(resolveWeek('2026-02-31', '2026-11-04')).toBe('2026-11-02');
    expect(resolveWeek(undefined, '2026-11-04')).toBe('2026-11-02');
  });

  it('today is the company\'s today', () => {
    const lateSundayInVancouver = new Date('2026-11-09T05:00:00Z');
    expect(companyDate('BC', lateSundayInVancouver)).toBe('2026-11-08');
    expect(companyDate('NS', lateSundayInVancouver)).toBe('2026-11-09');
  });

  it('checks hours', () => {
    expect(hoursProblem(8, 0)).toBeNull();
    expect(hoursProblem(16, 8)).toBeNull();
    expect(hoursProblem(0, 0)).toMatch(/hours worked/);
    expect(hoursProblem(24, 0.25)).toMatch(/24/);
    expect(hoursProblem(-1, 2)).toMatch(/negative/);
  });

  it('groups and totals', () => {
    const cards = [tc({ id: 'a', employee_name: 'Zed', work_date: '2026-11-03' }), tc({ id: 'b', employee_name: 'Amy', title: 'Shop', labour_cost: 100 }), tc({ id: 'c', employee_name: 'zed', work_date: '2026-11-02' })];
    const byWorker = groupCards(cards, 'worker');
    expect(byWorker.map((g) => g.label)).toEqual(['Amy', 'Zed']);
    expect(byWorker[1].cards.map((c) => c.id)).toEqual(['c', 'a']);
    expect(groupCards(cards, 'job').map((g) => g.label)).toEqual(['Canola', 'Shop']);
    expect(totals(cards)).toEqual({ regular: 24, overtime: 3, cost: 100 });
    expect(totals([...cards, tc({ status: 'Rejected', regular_hours: 99 })]).regular).toBe(24);
  });

  it('hides pay', () => {
    expect(hidePay(tc({ hourly_cost: 40, labour_cost: 320 }))).toMatchObject({ hourly_cost: null, labour_cost: null, regular_hours: 8 });
  });
});

describe('the payroll file', () => {
  it.each(['=1+1', '+1', '-1', '@x', ' =1', '\t=1', '\r=1', '\n=1', ' =1', '﻿=1', '＝1', '＋1', '－1', '＠1'])('neutralizes a formula: %j', (value) => {
    const out = csvCell(value);
    expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('leaves ordinary text alone and quotes what needs it', () => {
    expect(csvCell('Tessa Volt')).toBe('Tessa Volt');
    expect(csvCell('8.00')).toBe('8.00');
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell(null)).toBe('');
    expect(csvCell('Smith, Jo')).toBe('"Smith, Jo"');
    expect(csvCell('6" pipe')).toBe('"6"" pipe"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('cannot break out of its cell into a formula on the next line', () => {
    const csv = payrollCsv([tc({ notes: 'x\r\n=cmd()' })]);
    expect(csv).toContain('"x\r\n=cmd()"');
  });

  it('has a header, one line a card, money to the cent, and a byte order mark', () => {
    const csv = payrollCsv([tc({ hourly_cost: '40', labour_cost: 380, approved_by_name: 'Frank', approved_at: '2026-11-03' })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Worker,Date,Job,Regular Hours,Overtime Hours,Hourly Cost,Labour Cost,Approved By,Approved At,Notes');
    expect(lines[1]).toBe('Sam,2026-11-02,Canola,8.00,1.00,40.00,380.00,Frank,2026-11-03,');
  });
});

describe('the weekly page', () => {
  const props = {
    week: '2026-11-02',
    today: '2026-11-04',
    project: null,
    partial: false,
    workers: [{ employee_id: null, user_id: 'u', name: 'Sam' }],
    projects: [{ id: PROJECT, title: 'Canola' }],
    canEnter: true,
    canApprove: false,
    isCrewLead: false,
    canSeePay: false,
    canExport: false,
    canWrite: true,
  };
  const render = (extra: Partial<Parameters<typeof TimecardBoard>[0]> = {}) => renderToStaticMarkup(createElement(TimecardBoard, { ...props, cards: [], ...extra }));

  it('shows an empty week', () => {
    const html = render();
    expect(html).toContain('No hours for this week');
    expect(html).toContain('Enter my time');
    expect(html).not.toContain('Approve all');
    expect(html).not.toContain('Export payroll');
  });

  it('gives a foreman crew entry and approve-all but no pay or export', () => {
    const html = render({ canApprove: true, isCrewLead: true, cards: [tc(), tc({ id: '2', employee_name: 'Amy' })] });
    expect(html).toContain('Enter crew time');
    expect(html).toContain('Approve all (2)');
    expect(html).toContain('Add everyone');
    expect(html).not.toContain('Export payroll');
    expect(html).not.toContain('Approved labour');
  });

  it('gives a project manager pay and export', () => {
    const html = render({ canApprove: true, isCrewLead: true, canSeePay: true, canExport: true, cards: [tc({ status: 'Approved', hourly_cost: 40, labour_cost: 380 })] });
    expect(html).toContain('Export payroll');
    expect(html).toContain('Approved labour');
    expect(html).toContain('$380.00');
    expect(html).toContain('Un-approve');
  });

  it('warns about an approved card with no pay rate', () => {
    expect(render({ canSeePay: true, cards: [tc({ status: 'Approved', hourly_cost: 0, labour_cost: 0 })] })).toContain('no pay rate');
  });

  it('shows an electrician why a card came back, with no approve buttons', () => {
    const html = render({ cards: [tc({ status: 'Rejected', reject_reason: 'Wrong job' })] });
    expect(html).toContain('Wrong job');
    expect(html).not.toContain('>Approve<');
  });

  it('a lapsed company can look but not enter', () => {
    const html = render({ canEnter: false, canWrite: false, cards: [tc()] });
    expect(html).toContain('read-only');
    expect(html).not.toContain('Save time');
  });
});
