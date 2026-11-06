// Adversarial checks on the safety record engine, written by the verifier and not the
// builder. Tests named "BUG:" reproduce a defect and are left failing for the fixer.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { bootDb, migrationFiles, OLD_BASELINE_FIXTURE, BASELINE_FILE, readMigration, type TestDb } from './helpers/db';
import { fakeSupabase } from './helpers/fake-supabase';
import { RecordAction, formatSignedAt, type RecordSignature } from '@/lib/records';

const mocks = vi.hoisted(() => ({ server: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mocks.server, createSupabaseServerClient: () => mocks.server }));

import { PUT } from '@/app/api/records/[module]/[id]/route';
import { deleteRecord } from '@/lib/crud';
import { getModule } from '@/lib/modules';
import { parseRecord } from '@/lib/validation';

const USERS = {
  owner: { id: '10000000-0000-4000-8000-000000000001', email: 'owner@alpha.ca' },
  pm: { id: '10000000-0000-4000-8000-000000000002', email: 'pm@alpha.ca' },
  foreman: { id: '10000000-0000-4000-8000-000000000003', email: 'foreman@alpha.ca' },
  sparky: { id: '10000000-0000-4000-8000-000000000004', email: 'sparky@alpha.ca' },
  rival: { id: '10000000-0000-4000-8000-000000000005', email: 'owner@rival.ca' },
  leaver: { id: '10000000-0000-4000-8000-000000000006', email: 'leaver@alpha.ca' },
  gone: { id: '10000000-0000-4000-8000-000000000007', email: 'gone@alpha.ca' },
  // Round two: "foreman" is removed from the company by an earlier test
  foreman2: { id: '10000000-0000-4000-8000-000000000008', email: 'foreman2@alpha.ca' },
};
type U = keyof typeof USERS;

const SIG = 'data:image/png;base64,AAAA';
const LOTO = 'loto-permits';
const TAILGATE = 'tailgate-logs';
const INSPECTION = 'safety-inspections';
let t: TestDb<U>;
let company: string;

type Row = { status: string; signatures: RecordSignature[]; attendees_count: number; reopen_log: { reason: string; removed: { name: string }[] }[] };

const FILLED = `lock_number = 'L-12', record_date = '2026-11-04', isolation_points = 'Breaker 7', energy_sources = '["Electrical"]', verification_method = 'Meter', release_notes = 'Clear'`;

async function permit(who: U = 'sparky'): Promise<string> {
  const [{ id }] = await t.as<{ id: string }>(who, `insert into public.loto_permits (title, status, equipment_isolated, authorized_person) values ('Conveyor', 'Draft', 'Drive', 'Tessa') returning id`);
  await t.as(who, `update public.loto_permits set ${FILLED} where id = $1`, [id]);
  return id;
}
async function meeting(): Promise<string> {
  const [{ id }] = await t.as<{ id: string }>('sparky', `insert into public.tailgate_logs (title, status, topic, meeting_date, hazards, controls) values ('FLHA', 'Needs Sign-off', 'Live MCC', '2026-11-04', 'Arc flash', 'LOTO') returning id`);
  return id;
}
async function inspection(): Promise<string> {
  const [{ id }] = await t.as<{ id: string }>('sparky', `insert into public.safety_inspections (title, status, inspection_type, record_date, location, result, findings) values ('Walk', 'Draft', 'Site Walk', '2026-11-04', 'Unit 3', 'Satisfactory', 'Fine') returning id`);
  return id;
}
const sign = async (who: U, module: string, id: string, slot: string, name = 'Tessa', signature = SIG) =>
  (await t.as<{ row: Row }>(who, 'select public.sign_safety_record($1, $2, $3, $4, $5) as row', [module, id, slot, name, signature]))[0].row;
const signFails = (who: U, module: string, id: string, slot: string, name = 'Tessa', signature: string | null = SIG) =>
  t.fails(who, 'select public.sign_safety_record($1, $2, $3, $4, $5)', [module, id, slot, name, signature]);
const reopen = async (who: U, module: string, id: string, reason = 'Wrong breaker') =>
  (await t.as<{ row: Row }>(who, 'select public.reopen_safety_record($1, $2, $3) as row', [module, id, reason]))[0].row;
const reopenFails = (who: U, module: string, id: string, reason: string | null = 'Wrong breaker') =>
  t.fails(who, 'select public.reopen_safety_record($1, $2, $3)', [module, id, reason]);
const lotoRow = async (id: string) => (await t.asSystem<Row & Record<string, unknown>>('select * from public.loto_permits where id = $1', [id]))[0];
const upload = (who: U, name: string) => t.as(who, `insert into storage.objects (bucket_id, name) values ('job-photos', $1) returning id`, [name]);

async function released(who: U = 'sparky'): Promise<string> {
  const id = await permit(who);
  await sign(who, LOTO, id, 'lock_on');
  await sign(who, LOTO, id, 'verified');
  await sign(who, LOTO, id, 'lock_off');
  return id;
}

beforeAll(async () => {
  t = await bootDb(USERS);
  company = await t.createCompany('owner', 'Alpha Electric');
  await t.join('owner', 'pm', 'project_manager');
  await t.join('owner', 'foreman', 'foreman');
  await t.join('owner', 'sparky', 'electrician');
  await t.join('owner', 'leaver', 'electrician');
  await t.join('owner', 'gone', 'electrician');
  await t.join('owner', 'foreman2', 'foreman');
  await t.createCompany('rival', 'Rival Electric');
}, 120_000);
afterAll(() => t.pg.close());

describe('wrong role', () => {
  it('electrician and foreman cannot reopen, by RPC or by direct update', async () => {
    const id = await released();
    expect(await reopenFails('sparky', LOTO, id)).toMatch(/project manager or above/);
    expect(await reopenFails('foreman', LOTO, id)).toMatch(/project manager or above/);
    const kept = JSON.stringify((await lotoRow(id)).signatures.slice(0, 2));
    expect(await t.fails('foreman', 'update public.loto_permits set signatures = $1::jsonb where id = $2', [kept, id])).toMatch(/project manager or above/);
    expect((await lotoRow(id)).status).toBe('Released');
  });

  it('an electrician cannot delete even an unsigned record', async () => {
    const id = await permit();
    expect(await t.as('sparky', 'delete from public.loto_permits where id = $1 returning id', [id])).toHaveLength(0);
    expect(await lotoRow(id)).toBeTruthy();
  });

  it('BUG: an electrician cannot sign the supervisor slot of a tailgate meeting', async () => {
    const id = await meeting();
    await sign('sparky', TAILGATE, id, 'attendee', 'Tessa');
    // Rank 1 signs as the supervisor under someone else's name and locks a record they can't reopen
    expect(await signFails('sparky', TAILGATE, id, 'supervisor', 'Mike the Foreman')).toMatch(/supervisor|foreman|rank/i);
  });
});

describe('other tenant', () => {
  it('cannot update, delete or sign, and the row is unchanged', async () => {
    const id = await released();
    expect(await t.as('rival', `update public.loto_permits set notes = 'x' where id = $1 returning id`, [id])).toHaveLength(0);
    expect(await t.as('rival', 'delete from public.loto_permits where id = $1 returning id', [id])).toHaveLength(0);
    expect(await signFails('rival', LOTO, id, 'lock_on')).toMatch(/Not found/);
    expect(await reopenFails('rival', LOTO, id)).toMatch(/Not found/);
    expect((await lotoRow(id)).status).toBe('Released');
  });

  it('cannot take a row over with a PostgREST-style upsert on its id', async () => {
    const id = await permit();
    const message = await t.fails('rival', `insert into public.loto_permits (id, title, status, equipment_isolated, authorized_person) values ($1, 'Mine', 'Draft', 'E', 'P')
      on conflict (id) do update set title = excluded.title`, [id]);
    expect(message).toMatch(/row-level security|violates/);
    expect((await lotoRow(id)).title).toBe('Conveyor');
  });

  it('cannot read, add to or remove from another company\'s photo folder', async () => {
    const id = await permit();
    const name = `${company}/${LOTO}/${id}/a.jpg`;
    await upload('sparky', name);
    expect(await t.as('rival', 'select id from storage.objects where name = $1', [name])).toHaveLength(0);
    expect(await t.as('rival', 'delete from storage.objects where name = $1 returning id', [name])).toHaveLength(0);
    await expect(upload('rival', `${company}/${LOTO}/${id}/b.jpg`)).rejects.toThrow();
  });

  it('moving a record to another company does nothing', async () => {
    const id = await permit();
    const [{ id: other }] = await t.asSystem<{ id: string }>(`select id from public.companies where name = 'Rival Electric'`);
    await t.as('owner', 'update public.loto_permits set company_id = $1, created_by = $2 where id = $3', [other, USERS.rival.id, id]).catch(() => undefined);
    const row = await lotoRow(id);
    expect(row.company_id).toBe(company);
    expect(row.created_by).toBe(USERS.sparky.id);
  });

  it('a removed member loses access', async () => {
    const id = await permit();
    await t.as('owner', 'select public.remove_member($1)', [USERS.leaver.id]);
    expect(await t.as('leaver', 'select id from public.loto_permits where id = $1', [id])).toHaveLength(0);
    expect(await signFails('leaver', LOTO, id, 'lock_on')).toMatch(/Not found/);
  });
});

describe('lapsed subscription', () => {
  it('everything is read-only, signing, reopening, editing, deleting and storage alike', async () => {
    const signed = await released();
    const open = await permit();
    const draft = await permit();
    const photo = `${company}/${LOTO}/${open}/keep.jpg`;
    await upload('sparky', photo);
    await t.setLapsed(company, true);
    try {
      expect(await t.as('sparky', 'select id from public.loto_permits where id = $1', [open])).toHaveLength(1);
      expect(await signFails('sparky', LOTO, open, 'lock_on')).toMatch(/Not found/);
      expect(await reopenFails('owner', LOTO, signed)).toMatch(/Not found/);
      expect(await t.as('owner', `update public.loto_permits set notes = 'x' where id = $1 returning id`, [open])).toHaveLength(0);
      expect(await t.as('owner', 'delete from public.loto_permits where id = $1 returning id', [draft])).toHaveLength(0);
      await expect(t.as('owner', `insert into public.loto_permits (title, status, equipment_isolated, authorized_person) values ('X', 'Draft', 'E', 'P')`)).rejects.toThrow();
      await expect(upload('owner', `${company}/${LOTO}/${open}/late.jpg`)).rejects.toThrow();
      expect(await t.as('owner', 'delete from storage.objects where name = $1 returning id', [photo])).toHaveLength(0);
      expect((await lotoRow(signed)).status).toBe('Released');
    } finally {
      await t.setLapsed(company, false);
    }
  });
});

describe('double submit', () => {
  it('a repeated sign adds nothing', async () => {
    const id = await permit();
    await sign('sparky', LOTO, id, 'lock_on');
    expect(await signFails('sparky', LOTO, id, 'lock_on')).toMatch(/already been signed/);
    expect((await lotoRow(id)).signatures).toHaveLength(1);
  });

  it('a repeated attendee sign-in adds nothing and the count holds', async () => {
    const id = await meeting();
    await sign('sparky', TAILGATE, id, 'attendee', 'Tessa');
    expect(await signFails('sparky', TAILGATE, id, 'attendee', 'Tessa')).toMatch(/already signed in/);
    const [row] = await t.asSystem<{ attendees_count: string }>('select attendees_count from public.tailgate_logs where id = $1', [id]);
    expect(Number(row.attendees_count)).toBe(1);
  });

  it('a repeated final sign-off is refused as locked', async () => {
    const id = await released();
    expect(await signFails('sparky', LOTO, id, 'lock_off')).toMatch(/locked/);
  });

  it('BUG: a repeated reopen steps back only one sign-off', async () => {
    const id = await released();
    expect((await reopen('pm', LOTO, id)).status).toBe('Verified Zero Energy');
    // A retry or second tab, carrying the same reason, for the same intent. The RPC has no
    // way to say which sign-off the caller meant, so it strips the verification too.
    await reopen('pm', LOTO, id).catch(() => undefined);
    expect((await lotoRow(id)).status).toBe('Verified Zero Energy');
  });
});

describe('going around the UI with direct updates', () => {
  it('status, count, history and stamps cannot be forged', async () => {
    const id = await permit();
    const [row] = await t.as<Row>('owner', `update public.loto_permits set status = 'Released', reopen_log = '[{"reason":"forged"}]' where id = $1 returning *`, [id]);
    expect(row.status).toBe('Draft');
    expect(row.reopen_log).toEqual([]);
    const forged = JSON.stringify([{ slot: 'lock_on', name: 'Tessa', signature: SIG, signed_at: '1999-01-01', user_id: USERS.owner.id, extra: 'x' }]);
    const [signed] = await t.as<Row>('sparky', 'update public.loto_permits set signatures = $1::jsonb where id = $2 returning *', [forged, id]);
    expect(signed.signatures[0].user_id).toBe(USERS.sparky.id);
    expect(signed.signatures[0].signed_at.startsWith('1999')).toBe(false);
    expect(Object.keys(signed.signatures[0]).sort()).toEqual(['name', 'signature', 'signed_at', 'slot', 'user_id']);
  });

  it('malformed signature columns are refused', async () => {
    const id = await permit();
    for (const bad of ['{}', '"x"', '1', 'null', '[1]', '[null]', '[{"slot":1,"name":"A","signature":"data:image/png;base64,AAAA"}]', '[{"slot":["lock_on"],"name":"A","signature":"data:image/png;base64,AAAA"}]']) {
      await expect(t.as('owner', 'update public.loto_permits set signatures = $1::jsonb where id = $2', [bad, id])).rejects.toThrow();
    }
    await expect(t.as('owner', 'update public.loto_permits set signatures = null where id = $1', [id])).rejects.toThrow();
    expect((await lotoRow(id)).signatures).toEqual([]);
  });

  it('two signatures in one write are refused', async () => {
    const id = await permit();
    const two = JSON.stringify([{ slot: 'lock_on', name: 'A', signature: SIG }, { slot: 'verified', name: 'B', signature: SIG }]);
    expect(await t.fails('owner', 'update public.loto_permits set signatures = $1::jsonb where id = $2', [two, id])).toMatch(/cannot be changed/);
  });

  it('dropping one attendee is not a reopen', async () => {
    const id = await meeting();
    await sign('sparky', TAILGATE, id, 'attendee', 'A');
    await sign('sparky', TAILGATE, id, 'attendee', 'B');
    const [{ s }] = await t.asSystem<{ s: RecordSignature[] }>('select signatures as s from public.tailgate_logs where id = $1', [id]);
    expect(await t.fails('owner', 'update public.tailgate_logs set signatures = $1::jsonb where id = $2', [JSON.stringify(s.slice(0, 1)), id])).toMatch(/changes nothing else|reason/);
  });

  it('a direct reopen with no reason is refused, even with an upsert', async () => {
    const id = await released('owner');
    const row = await lotoRow(id);
    expect(await t.fails('owner', 'update public.loto_permits set signatures = $1::jsonb where id = $2', [JSON.stringify(row.signatures.slice(0, 2)), id])).toMatch(/reason/);
    const message = await t.fails('owner', `insert into public.loto_permits (id, title, status, equipment_isolated, authorized_person) values ($1, 'x', 'Draft', 'E', 'P') on conflict (id) do update set signatures = excluded.signatures`, [id]);
    expect(message).toMatch(/reason|changes nothing else/);
    expect((await lotoRow(id)).status).toBe('Released');
  });

  it('signing and blanking a required field in one write is refused', async () => {
    const id = await permit();
    const entry = JSON.stringify([{ slot: 'lock_on', name: 'A', signature: SIG }]);
    expect(await t.fails('owner', `update public.loto_permits set signatures = $1::jsonb, lock_number = '' where id = $2`, [entry, id])).toMatch(/Lock #/);
  });

  it('locked: id, created_at and every other column stay put', async () => {
    const id = await released();
    expect(await t.fails('owner', 'update public.loto_permits set id = gen_random_uuid() where id = $1', [id])).toMatch(/locked/);
    expect(await t.fails('owner', `update public.loto_permits set created_at = '2020-01-01' where id = $1`, [id])).toMatch(/locked/);
    expect(await t.fails('owner', `update public.loto_permits set record_date = '2020-01-01' where id = $1`, [id])).toMatch(/locked/);
  });

  it('BUG: a part-signed record cannot be given a new id', async () => {
    const id = await permit();
    await sign('sparky', LOTO, id, 'lock_on');
    expect(await t.fails('sparky', 'update public.loto_permits set id = gen_random_uuid() where id = $1', [id])).toMatch(/.+/);
    expect(await lotoRow(id)).toBeTruthy();
  });

  it('BUG: a record\'s created_at cannot be rewritten, which is what the overdue-LOTO alert reads', async () => {
    const id = await permit();
    await sign('sparky', LOTO, id, 'lock_on');
    await t.fails('sparky', `update public.loto_permits set created_at = now() + interval '10 years' where id = $1`, [id]).catch(() => undefined);
    const [{ moved }] = await t.asSystem<{ moved: boolean }>(`select created_at > now() + interval '1 year' as moved from public.loto_permits where id = $1`, [id]);
    expect(moved).toBe(false);
  });

  it('BUG: what a signer attested to cannot be rewritten underneath their signature', async () => {
    const id = await permit();
    await sign('sparky', LOTO, id, 'lock_on', 'Tessa');
    // Tessa attested "I isolated the energy sources listed here" for this equipment and lock
    expect(await t.fails('sparky', `update public.loto_permits set equipment_isolated = 'Some other panel', lock_number = 'L-99', energy_sources = '["Thermal"]' where id = $1`, [id])).toMatch(/signed|locked|reopen/i);
  });

  it('BUG: a tailgate\'s hazards cannot be rewritten after attendees signed for them', async () => {
    const id = await meeting();
    await sign('sparky', TAILGATE, id, 'attendee', 'Tessa');
    expect(await t.fails('foreman', `update public.tailgate_logs set hazards = 'Nothing much' where id = $1`, [id])).toMatch(/signed|locked|reopen/i);
  });

  it('BUG: crew cannot unlink a photo they could not delete', async () => {
    const id = await permit();
    const name = `${company}/${LOTO}/${id}/pm.jpg`;
    await upload('pm', name);
    await t.as('pm', 'update public.loto_permits set photos = $1::jsonb where id = $2', [JSON.stringify([name]), id]);
    expect(await t.as('sparky', 'delete from storage.objects where name = $1 returning id', [name])).toHaveLength(0);
    // Storage refused, but the record, its screen and its printout drop the photo anyway
    await t.as('sparky', `update public.loto_permits set photos = '[]' where id = $1`, [id]).catch(() => undefined);
    expect((await lotoRow(id)).photos).toEqual([name]);
  });
});

describe('what counts as filled in or signed, at the database', () => {
  it('BUG: an empty PNG data URL is not a signature (database)', async () => {
    const id = await permit();
    expect(await signFails('sparky', LOTO, id, 'lock_on', 'Tessa', 'data:image/png;base64,')).toMatch(/Draw a signature/);
  });

  it('BUG: an empty PNG data URL is not a signature (API schema)', () => {
    expect(RecordAction.safeParse({ action: 'sign', slot: 'lock_on', name: 'Tessa', signature: 'data:image/png;base64,' }).success).toBe(false);
  });

  it('BUG: text that is not base64 is not a signature', async () => {
    const id = await permit();
    expect(await signFails('sparky', LOTO, id, 'lock_on', 'Tessa', 'data:image/png;base64,not an image!!')).toMatch(/Draw a signature/);
  });

  it('BUG: a tab or non-breaking space is not a signer name', async () => {
    const a = await permit();
    expect(await signFails('sparky', LOTO, a, 'lock_on', '\t\n')).toMatch(/name of the person/);
    const b = await permit();
    expect(await signFails('sparky', LOTO, b, 'lock_on', ' ')).toMatch(/name of the person/);
  });

  it('BUG: a required field of only tabs or newlines is blank', async () => {
    const id = await permit();
    await t.as('sparky', `update public.loto_permits set isolation_points = E'\\t\\n' where id = $1`, [id]);
    expect(await signFails('sparky', LOTO, id, 'lock_on')).toMatch(/Isolation points/);
  });

  it('BUG: a blank or made-up checklist entry does not satisfy Energy sources', async () => {
    const blank = await permit();
    await t.as('sparky', `update public.loto_permits set energy_sources = '[" "]' where id = $1`, [blank]);
    expect(await signFails('sparky', LOTO, blank, 'lock_on')).toMatch(/Energy sources/);
    const madeUp = await permit();
    // The print page only ticks known options, so this signs with nothing ticked on paper
    await t.as('sparky', `update public.loto_permits set energy_sources = '["Vibes"]' where id = $1`, [madeUp]).catch(() => undefined);
    expect((await lotoRow(madeUp)).energy_sources).toEqual(['Electrical']);
  });

  it('BUG: an inspection result outside the list cannot dodge or fake the corrective-action rule', async () => {
    const id = await inspection();
    await t.as('sparky', `update public.safety_inspections set result = 'Totally Fine' where id = $1`, [id]).catch(() => undefined);
    const [{ result }] = await t.asSystem<{ result: string }>('select result from public.safety_inspections where id = $1', [id]);
    expect(result).toBe('Satisfactory');
  });

  it('BUG: a reason of only tabs or newlines is no reason', async () => {
    const id = await released();
    expect(await reopenFails('pm', LOTO, id, '\n\t')).toMatch(/reason/);
  });

  it('a space-only reason and a null reason are refused', async () => {
    const id = await released();
    expect(await reopenFails('pm', LOTO, id, '   ')).toMatch(/reason/);
    expect(await reopenFails('pm', LOTO, id, null)).toMatch(/reason/);
  });

  it('null arguments are refused cleanly', async () => {
    const id = await permit();
    expect(await signFails('sparky', LOTO, id, 'lock_on', 'Tessa', null)).toMatch(/Draw a signature/);
    expect(await t.fails('sparky', 'select public.sign_safety_record($1, $2, $3, $4, $5)', [LOTO, id, null, 'Tessa', SIG])).toMatch(/not a sign-off/);
    expect(await t.fails('sparky', 'select public.sign_safety_record($1, $2, $3, $4, $5)', [LOTO, id, 'lock_on', null, SIG])).toMatch(/name of the person/);
    expect(await t.fails('sparky', 'select public.sign_safety_record($1, $2, $3, $4, $5)', [LOTO, null, 'lock_on', 'Tessa', SIG])).toMatch(/Not found/);
    expect(await t.fails('sparky', 'select public.sign_safety_record($1, $2, $3, $4, $5)', [null, id, 'lock_on', 'Tessa', SIG])).toMatch(/Unknown record type/);
  });
});

describe('boundary values', () => {
  it('signer name: 200 characters in, 201 out', async () => {
    const a = await permit();
    expect((await sign('sparky', LOTO, a, 'lock_on', 'x'.repeat(200))).signatures[0].name).toHaveLength(200);
    const b = await permit();
    expect(await signFails('sparky', LOTO, b, 'lock_on', 'x'.repeat(201))).toMatch(/name of the person/);
  });

  it('signature: 300,000 characters in, 300,001 out', async () => {
    const head = 'data:image/png;base64,';
    const a = await permit();
    expect((await sign('sparky', LOTO, a, 'lock_on', 'T', head + 'A'.repeat(300_000 - head.length))).status).toBe('Locked Out');
    const b = await permit();
    expect(await signFails('sparky', LOTO, b, 'lock_on', 'T', head + 'A'.repeat(300_001 - head.length))).toMatch(/Draw a signature/);
  });

  it('photos: 50 in, 51 out; a 300 character path in, 301 out', async () => {
    const id = await permit();
    const prefix = `${company}/${LOTO}/${id}/`;
    const list = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => `${prefix}${i}.jpg`));
    await t.as('sparky', 'update public.loto_permits set photos = $1::jsonb where id = $2', [list(50), id]);
    expect(await t.fails('sparky', 'update public.loto_permits set photos = $1::jsonb where id = $2', [list(51), id])).toMatch(/up to 50/);
    const path = (len: number) => JSON.stringify([prefix + 'a'.repeat(len - prefix.length)]);
    await t.as('sparky', 'update public.loto_permits set photos = $1::jsonb where id = $2', [path(300), id]);
    expect(await t.fails('sparky', 'update public.loto_permits set photos = $1::jsonb where id = $2', [path(301), id])).toMatch(/Invalid photo/);
  });

  it('checklists: 50 items in, 51 out; made-up items and 101 characters out; non-strings out', async () => {
    const id = await permit();
    const set = (v: unknown) => t.as('sparky', 'update public.loto_permits set ppe = $1::jsonb where id = $2', [JSON.stringify(v), id]);
    await set(Array.from({ length: 50 }, () => 'Hi-vis'));
    await expect(set(Array.from({ length: 51 }, () => 'Hi-vis'))).rejects.toThrow(/Invalid checklist/);
    await expect(set(['Cape'])).rejects.toThrow(/Invalid checklist/);
    await expect(set(['x'.repeat(100)])).rejects.toThrow(/Invalid checklist/);
    await expect(set(['x'.repeat(101)])).rejects.toThrow(/Invalid checklist/);
    await expect(set([1])).rejects.toThrow(/Invalid checklist/);
    await expect(set('Hard hat')).rejects.toThrow(/Invalid checklist/);
  });

  it('BUG: a meeting with 100 attendees can still get its supervisor sign-off', async () => {
    const id = await meeting();
    for (let i = 0; i < 100; i++) await sign('sparky', TAILGATE, id, 'attendee', `Worker ${i}`);
    const row = await sign('foreman', TAILGATE, id, 'supervisor', 'Mike');
    expect(row.status).toBe('Completed');
  }, 120_000);

  it('BUG: the same attendee cannot sign in twice by adding a space inside their name', async () => {
    const id = await meeting();
    await sign('sparky', TAILGATE, id, 'attendee', 'Tessa Ray');
    expect(await signFails('sparky', TAILGATE, id, 'attendee', 'Tessa  Ray')).toMatch(/already signed in/);
  });

  it('stored times survive the trip to the printout', async () => {
    const id = await permit();
    const row = await sign('sparky', LOTO, id, 'lock_on');
    expect(formatSignedAt(row.signatures[0].signed_at)).not.toBe('—');
    const after = await reopen('pm', LOTO, id);
    expect(formatSignedAt((after.reopen_log[0] as unknown as { at: string }).at)).not.toBe('—');
  });

  it('the count stays a whole number that matches who signed', async () => {
    const id = await meeting();
    await sign('sparky', TAILGATE, id, 'attendee', 'A');
    await sign('sparky', TAILGATE, id, 'attendee', 'B');
    await t.as('owner', 'update public.tailgate_logs set attendees_count = 2.5 where id = $1', [id]);
    const [row] = await t.asSystem<{ attendees_count: string }>('select attendees_count from public.tailgate_logs where id = $1', [id]);
    expect(Number(row.attendees_count)).toBe(2);
  });
});

describe('status changes out of order', () => {
  it('every wrong next step on LOTO is refused at each state', async () => {
    const id = await permit();
    expect(await signFails('sparky', LOTO, id, 'verified')).toMatch(/has to be signed before/);
    expect(await signFails('sparky', LOTO, id, 'lock_off')).toMatch(/has to be signed before/);
    await sign('sparky', LOTO, id, 'lock_on');
    expect(await signFails('sparky', LOTO, id, 'lock_on')).toMatch(/already been signed/);
    expect(await signFails('sparky', LOTO, id, 'lock_off')).toMatch(/has to be signed before/);
    await sign('sparky', LOTO, id, 'verified');
    expect(await signFails('sparky', LOTO, id, 'lock_on')).toMatch(/already been signed/);
    expect(await signFails('sparky', LOTO, id, 'verified')).toMatch(/already been signed/);
    expect((await sign('sparky', LOTO, id, 'lock_off')).status).toBe('Released');
    for (const slot of ['lock_on', 'verified', 'lock_off']) expect(await signFails('sparky', LOTO, id, slot)).toMatch(/locked/);
  });

  it('slots from another module do not count', async () => {
    const id = await permit();
    for (const slot of ['attendee', 'supervisor', 'inspector', 'LOCK_ON', '', ' lock_on']) {
      expect(await signFails('sparky', LOTO, id, slot)).toMatch(/not a sign-off/);
    }
    expect(await signFails('sparky', TAILGATE, id, 'attendee')).toMatch(/Not found/);
  });

  it('reopen walks all the way back with the status following, then forward again', async () => {
    const id = await released();
    // Each step back gives its own reason: the same reason again is the same reopen repeated
    expect((await reopen('pm', LOTO, id, 'Crew not clear')).status).toBe('Verified Zero Energy');
    expect((await reopen('pm', LOTO, id, 'Meter out of calibration')).status).toBe('Locked Out');
    const row = await reopen('pm', LOTO, id, 'Wrong panel');
    expect(row.status).toBe('Draft');
    expect(row.reopen_log).toHaveLength(3);
    expect(await reopenFails('pm', LOTO, id)).toMatch(/no sign-offs/);
    expect(await signFails('sparky', LOTO, id, 'verified')).toMatch(/has to be signed before/);
    expect((await sign('sparky', LOTO, id, 'lock_on')).status).toBe('Locked Out');
  });

  it('inspection locks on its only slot; corrective actions needed unless Satisfactory', async () => {
    const id = await inspection();
    await t.as('sparky', `update public.safety_inspections set result = 'Corrective Action Needed' where id = $1`, [id]);
    expect(await signFails('sparky', INSPECTION, id, 'inspector')).toMatch(/Corrective actions/);
    await t.as('sparky', `update public.safety_inspections set corrective_actions = 'Clear exit' where id = $1`, [id]);
    expect((await sign('sparky', INSPECTION, id, 'inspector')).status).toBe('Signed Off');
    expect(await t.fails('owner', `update public.safety_inspections set corrective_actions = '' where id = $1`, [id])).toMatch(/locked/);
    expect(await t.fails('owner', 'delete from public.safety_inspections where id = $1', [id])).toMatch(/stays on file/);
  });

  it('BUG: a permit marked Locked Out before this engine keeps saying so after an edit', async () => {
    // Rows that exist when the migration lands. The equipment is physically locked out.
    const id = await permit();
    await t.asSystem('alter table public.loto_permits disable trigger loto_permits_guard');
    await t.asSystem(`update public.loto_permits set status = 'Locked Out' where id = $1`, [id]);
    await t.asSystem('alter table public.loto_permits enable trigger loto_permits_guard');
    await t.as('sparky', `update public.loto_permits set notes = 'typo fix' where id = $1`, [id]);
    expect((await lotoRow(id)).status).toBe('Locked Out');
  });
});

describe('deleting referenced records', () => {
  const project = async () => (await t.as<{ id: string }>('owner', `insert into public.projects (title, status) values ('Job', 'Active') returning id`))[0].id;

  it('a project with a signed permit on it cannot be deleted out from under it', async () => {
    const p = await project();
    const id = await permit();
    await t.as('sparky', 'update public.loto_permits set project_id = $1 where id = $2', [p, id]);
    await sign('sparky', LOTO, id, 'lock_on');
    await expect(t.as('owner', 'delete from public.projects where id = $1', [p])).rejects.toThrow();
    expect((await lotoRow(id)).project_id).toBe(p);
  });

  it('removing a member keeps their signatures on the record', async () => {
    const id = await permit();
    await sign('foreman', LOTO, id, 'lock_on', 'Mike');
    await t.as('owner', 'select public.remove_member($1)', [USERS.foreman.id]);
    const row = await lotoRow(id);
    expect(row.signatures[0].name).toBe('Mike');
    expect(row.signatures[0].user_id).toBe(USERS.foreman.id);
    expect((await reopen('owner', LOTO, id)).reopen_log[0].removed[0].name).toBe('Mike');
  });

  it('removing a whole company goes through locked records that have a project', async () => {
    const [{ id: temp }] = await t.asSystem<{ id: string }>(`insert into public.companies (name, province) values ('Temp', 'SK') returning id`);
    const [{ id: p }] = await t.asSystem<{ id: string }>(`insert into public.projects (company_id, title, status) values ($1, 'J', 'Active') returning id`, [temp]);
    const [{ id }] = await t.asSystem<{ id: string }>(`insert into public.tailgate_logs (company_id, project_id, title, status, topic, meeting_date, hazards, controls) values ($1, $2, 'T', 'Needs Sign-off', 'A', '2026-11-04', 'B', 'C') returning id`, [temp, p]);
    await t.asSystem('update public.tailgate_logs set signatures = $1::jsonb where id = $2', [JSON.stringify([{ slot: 'attendee', name: 'A', signature: SIG }]), id]);
    await t.asSystem(`update public.tailgate_logs set signatures = signatures || $1::jsonb where id = $2`, [JSON.stringify([{ slot: 'supervisor', name: 'M', signature: SIG }]), id]);
    await t.asService('delete from public.companies where id = $1', [temp]);
    expect(await t.asSystem('select id from public.tailgate_logs where id = $1', [id])).toHaveLength(0);
  });

  it('BUG: a person can be deleted from auth when they created a locked permit', async () => {
    const id = await released('gone');
    // created_by is ON DELETE SET NULL, and the lock refuses that update
    await t.asSystem('delete from auth.users where id = $1', [USERS.gone.id]);
    expect((await lotoRow(id)).status).toBe('Released');
    expect((await lotoRow(id)).created_by).toBeNull();
  });
});

describe('privileges and upgrades', () => {
  it('BUG: signed-in users hold no TRUNCATE on record tables, which fires no row trigger', async () => {
    const [row] = await t.asSystem<{ can: boolean }>(`select has_table_privilege('authenticated', 'public.loto_permits', 'TRUNCATE') as can`);
    expect(row.can).toBe(false);
  });

  it('the service role is held to the lock too, and still derives status', async () => {
    const id = await released();
    await expect(t.asService(`update public.loto_permits set notes = 'x' where id = $1`, [id])).rejects.toThrow(/locked/);
    const open = await permit();
    const [row] = await t.asService<Row>(`update public.loto_permits set status = 'Released' where id = $1 returning status`, [open]);
    expect(row.status).toBe('Draft');
  });

  it('re-running the registry sync and safety migrations leaves locked records alone', async () => {
    const id = await released();
    const before = await lotoRow(id);
    for (const f of migrationFiles().filter((x) => /registry_sync|safety_records/.test(x))) await t.pg.exec(readMigration(f));
    const after = await lotoRow(id);
    expect(after.signatures).toEqual(before.signatures);
    expect(after.status).toBe('Released');
  });

  it('an old database with hand-set statuses upgrades', async () => {
    const baseline = readFileSync(OLD_BASELINE_FIXTURE, 'utf8');
    const old = await bootDb({ a: USERS.owner }, { baselineSql: baseline, include: (f) => f === BASELINE_FILE });
    try {
      const [{ id: c }] = await old.asSystem<{ id: string }>(`insert into public.companies (name, province) values ('Old', 'SK') returning id`);
      await old.asSystem(`insert into public.loto_permits (company_id, title, status, equipment_isolated, authorized_person) values ($1, 'Old permit', 'Released', 'E', 'P')`, [c]);
      await old.asSystem(`insert into public.tailgate_logs (company_id, title, status, attendees_count) values ($1, 'Old meeting', 'Completed', 12)`, [c]);
      for (const f of migrationFiles().filter((x) => x !== BASELINE_FILE)) await old.pg.exec(readMigration(f));
      const [loto] = await old.asSystem<{ status: string; signatures: unknown[] }>('select status, signatures from public.loto_permits');
      expect(loto.status).toBe('Released');
      expect(loto.signatures).toEqual([]);
    } finally {
      await old.pg.close();
    }
  }, 120_000);
});

// Round two: run against the engine after the first round's fixes.
describe('round 2: text you cannot see', () => {
  // Each of these renders as nothing, or moves the text around, on the printout
  const INVISIBLE: [string, string][] = [
    ['zero-width non-joiner', '‌'],
    ['zero-width joiner', '‍'],
    ['left-to-right mark', '‎'],
    ['word joiner', '⁠'],
    ['soft hyphen', '­'],
    ['combining grapheme joiner', '͏'],
    ['control character', '\u0001'],
  ];

  it.each(INVISIBLE)('BUG: a %s alone is not a signer name', async (_label, char) => {
    const id = await permit();
    expect(await signFails('sparky', LOTO, id, 'lock_on', char)).toMatch(/name of the person/);
  });

  it('BUG: a required field holding only a word joiner is blank', async () => {
    const id = await permit();
    await t.as('sparky', 'update public.loto_permits set isolation_points = $1 where id = $2', ['⁠', id]);
    expect(await signFails('sparky', LOTO, id, 'lock_on')).toMatch(/Isolation points/);
  });

  it('BUG: a reopen reason of only a zero-width joiner is no reason', async () => {
    const id = await released();
    expect(await reopenFails('pm', LOTO, id, '‍')).toMatch(/reason/);
  });

  it('BUG: the same attendee cannot sign in twice with an invisible character in their name', async () => {
    const id = await meeting();
    await sign('sparky', TAILGATE, id, 'attendee', 'Tessa');
    expect(await signFails('sparky', TAILGATE, id, 'attendee', 'Tessa‍')).toMatch(/already signed in/);
  });

  it('BUG: a signer name must be text, not a JSON object written straight to the column', async () => {
    const id = await permit();
    const entry = JSON.stringify([{ slot: 'lock_on', name: { first: 'Nobody' }, signature: SIG }]);
    await t.as('sparky', 'update public.loto_permits set signatures = $1::jsonb where id = $2', [entry, id]).catch(() => undefined);
    expect((await lotoRow(id)).signatures).toEqual([]);
  });
});

describe('round 2: going around the UI', () => {
  it('BUG: a new permit cannot be future-dated with created_at, which the overdue alert reads', async () => {
    const [row] = await t.as<{ future: boolean }>('sparky', `insert into public.loto_permits (title, status, equipment_isolated, authorized_person, created_at)
      values ('Hidden', 'Draft', 'E', 'P', now() + interval '10 years') returning created_at > now() + interval '1 year' as future`);
    expect(row.future).toBe(false);
  });

  it('BUG: a write that changes nothing leaves a locked record untouched', async () => {
    const id = await released();
    const stamp = async () => (await t.asSystem<{ at: string }>('select updated_at::text as at from public.loto_permits where id = $1', [id]))[0].at;
    const before = await stamp();
    await t.as('sparky', 'update public.loto_permits set title = title where id = $1', [id]).catch(() => undefined);
    expect(await stamp()).toBe(before);
  });

  it('a later attendee cannot change what earlier attendees signed for in the same write', async () => {
    const id = await meeting();
    await sign('sparky', TAILGATE, id, 'attendee', 'A');
    const entry = JSON.stringify([{ slot: 'attendee', name: 'B', signature: SIG }]);
    expect(await t.fails('sparky', `update public.tailgate_logs set signatures = signatures || $1::jsonb, topic = 'Other' where id = $2`, [entry, id])).toMatch(/Topic was signed for/);
  });

  it('an electrician cannot sign the supervisor slot by writing the column directly', async () => {
    const id = await meeting();
    await sign('sparky', TAILGATE, id, 'attendee', 'A');
    const entry = JSON.stringify([{ slot: 'supervisor', name: 'Boss', signature: SIG }]);
    expect(await t.fails('sparky', 'update public.tailgate_logs set signatures = signatures || $1::jsonb where id = $2', [entry, id])).toMatch(/foreman or above/);
  });

  it('an upsert on an id in the caller\'s own company cannot jump a slot', async () => {
    const id = await permit();
    const three = JSON.stringify([{ slot: 'lock_on', name: 'A', signature: SIG }, { slot: 'verified', name: 'B', signature: SIG }, { slot: 'lock_off', name: 'C', signature: SIG }]);
    await t.as('owner', `insert into public.loto_permits (id, title, status, equipment_isolated, authorized_person, signatures) values ($1, 'x', 'Released', 'E', 'P', $2::jsonb)
      on conflict (id) do update set signatures = $2::jsonb`, [id, three]).catch(() => undefined);
    const row = await lotoRow(id);
    expect(row.signatures).toEqual([]);
    expect(row.status).toBe('Draft');
  });

  it('a new record cannot point at another company\'s project', async () => {
    const [{ id: theirs }] = await t.as<{ id: string }>('rival', `insert into public.projects (title, status) values ('Theirs', 'Active') returning id`);
    expect(await t.fails('sparky', `insert into public.loto_permits (title, status, equipment_isolated, authorized_person, project_id) values ('X', 'Draft', 'E', 'P', $1)`, [theirs])).toMatch(/could not be found/);
  });

  it('BUG: a photo path has to name a file, not just the record\'s folder', async () => {
    const id = await permit();
    const folder = `${company}/${LOTO}/${id}/`;
    await t.as('sparky', 'update public.loto_permits set photos = $1::jsonb where id = $2', [JSON.stringify([folder]), id]).catch(() => undefined);
    expect((await lotoRow(id)).photos).toEqual([]);
  });

  it('BUG: the row refuses a photo path that storage would refuse, one folder too deep', async () => {
    const id = await permit();
    const deep = `${company}/${LOTO}/${id}/deep/a.jpg`;
    await expect(upload('sparky', deep)).rejects.toThrow();
    await t.as('sparky', 'update public.loto_permits set photos = $1::jsonb where id = $2', [JSON.stringify([deep]), id]).catch(() => undefined);
    expect((await lotoRow(id)).photos).toEqual([]);
  });

  it('the API drops signatures, history, photos and checklists from a plain field save', () => {
    for (const slug of [LOTO, TAILGATE, INSPECTION]) {
      const parsed = parseRecord(getModule(slug)!, { title: 'T', signatures: [{ slot: 'x' }], reopen_log: [{}], photos: ['a'], ppe: ['b'], company_id: 'c', created_at: '2000-01-01' }, 'update');
      expect(parsed).toEqual({ ok: true, data: { title: 'T' } });
    }
  });
});

describe('round 2: reopen and caps', () => {
  it('BUG: reopening again after a re-sign really reopens, even with the same reason', async () => {
    const id = await released();
    expect((await reopen('pm', LOTO, id, 'Crew not clear')).status).toBe('Verified Zero Energy');
    expect((await sign('sparky', LOTO, id, 'lock_off')).status).toBe('Released');
    // A new sign-off happened since the last reopen, so this is not a retry of it.
    // The call succeeds and hands back a row, so the caller believes the permit is open.
    expect((await reopen('pm', LOTO, id, 'Crew not clear')).status).toBe('Verified Zero Energy');
  });

  it('the 101st attendee is refused and the reopen clears the whole slot', async () => {
    const id = await meeting();
    for (let i = 0; i < 100; i++) await sign('sparky', TAILGATE, id, 'attendee', `Worker ${i}`);
    expect(await signFails('sparky', TAILGATE, id, 'attendee', 'Worker 100')).toMatch(/up to 100/);
    const row = await reopen('pm', TAILGATE, id, 'Wrong meeting');
    expect(row.signatures).toEqual([]);
    expect(row.status).toBe('Needs Sign-off');
    expect(Number(row.attendees_count)).toBe(0);
    expect(row.reopen_log[0].removed).toHaveLength(100);
  }, 120_000);

  it('a reopen after reopen keeps every earlier history entry', async () => {
    const id = await released();
    await reopen('pm', LOTO, id, 'First');
    await t.as('sparky', `update public.loto_permits set release_notes = 'Again' where id = $1`, [id]);
    await sign('sparky', LOTO, id, 'lock_off', 'Ray');
    const row = await reopen('owner', LOTO, id, 'Second');
    expect(row.reopen_log.map((r) => r.reason)).toEqual(['First', 'Second']);
    expect(row.reopen_log.map((r) => r.removed[0].name)).toEqual(['Tessa', 'Ray']);
  });

  it('a foreman signs the supervisor slot; an owner can sign in as an attendee', async () => {
    const id = await meeting();
    await sign('owner', TAILGATE, id, 'attendee', 'Boss');
    expect((await sign('foreman2', TAILGATE, id, 'supervisor', 'Mike')).status).toBe('Completed');
  });
});

describe('round 2: deleting', () => {
  it('nobody signed in can remove a company or truncate past the delete rule', async () => {
    const id = await released();
    await t.as('owner', 'delete from public.companies where id = $1', [company]).catch(() => undefined);
    await t.as('owner', 'truncate public.companies cascade').catch(() => undefined);
    await t.as('owner', 'truncate public.loto_permits').catch(() => undefined);
    await t.as(null, 'truncate public.loto_permits').catch(() => undefined);
    await t.asService('truncate public.loto_permits').catch(() => undefined);
    expect((await lotoRow(id)).status).toBe('Released');
  });

  it('per-module delete ranks hold on unsigned records', async () => {
    const a = await permit();
    expect(await t.as('pm', 'delete from public.loto_permits where id = $1 returning id', [a])).toHaveLength(0);
    expect(await t.as('owner', 'delete from public.loto_permits where id = $1 returning id', [a])).toHaveLength(1);
    const m = await meeting();
    expect(await t.as('foreman2', 'delete from public.tailgate_logs where id = $1 returning id', [m])).toHaveLength(0);
    expect(await t.as('pm', 'delete from public.tailgate_logs where id = $1 returning id', [m])).toHaveLength(1);
  });

  it('a project with an unsigned permit on it is also refused, not silently unlinked', async () => {
    const [{ id: p }] = await t.as<{ id: string }>('owner', `insert into public.projects (title, status) values ('Job', 'Active') returning id`);
    const id = await permit();
    await t.as('sparky', 'update public.loto_permits set project_id = $1 where id = $2', [p, id]);
    await expect(t.as('owner', 'delete from public.projects where id = $1', [p])).rejects.toThrow();
    expect((await lotoRow(id)).project_id).toBe(p);
  });
});

// The real route and shared delete, with a thin client that sends each call to the
// test database as the signed-in user, so error codes are the database's own.
describe('round 2: the API against the real rules', () => {
  type Filter = [string, unknown];

  function clientFor(who: U, role: string, row: Record<string, unknown>) {
    const fake = fakeSupabase({ company_users: [{ user_id: USERS[who].id, role, company: row }] });
    const run = async (sql: string, params: unknown[]) => {
      try {
        return { data: await t.as<Record<string, unknown>>(who, sql, params), error: null };
      } catch (e) {
        const err = e as { code?: string; message: string };
        return { data: null, error: { code: err.code, message: err.message } };
      }
    };
    const table = (name: string) => {
      let op: 'select' | 'update' | 'delete' = 'select';
      let values: Record<string, unknown> = {};
      let columns = '*';
      const filters: Filter[] = [];
      const exec = async () => {
        const params: unknown[] = [];
        const where = filters.map(([c, v]) => { params.push(v); return `${c} = $${params.length}`; }).join(' and ');
        if (op === 'select') return run(`select ${columns} from public.${name} where ${where}`, params);
        if (op === 'delete') return run(`delete from public.${name} where ${where} returning ${columns}`, params);
        const sets = Object.entries(values).map(([c, v]) => {
          params.push(Array.isArray(v) ? JSON.stringify(v) : v);
          return `${c} = $${params.length}${Array.isArray(v) ? '::jsonb' : ''}`;
        }).join(', ');
        return run(`update public.${name} set ${sets} where ${where} returning ${columns}`, params);
      };
      const builder = {
        select(c = '*') { columns = c; return builder; },
        update(v: Record<string, unknown>) { op = 'update'; values = v; return builder; },
        delete() { op = 'delete'; return builder; },
        eq(c: string, v: unknown) { filters.push([c, v]); return builder; },
        async maybeSingle() { const r = await exec(); return r.error ? r : { data: r.data?.[0] ?? null, error: null }; },
        then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) { return exec().then(ok, bad); },
      };
      return builder;
    };
    return {
      auth: { getUser: async () => ({ data: { user: USERS[who] }, error: null }) },
      from: (name: string) => (name === 'company_users' ? fake.from(name) : table(name)),
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
      rpc: async (name: string, args: Record<string, unknown>) => {
        const keys = Object.keys(args);
        const r = await run(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as row`, keys.map((k) => args[k]));
        return r.error ? r : { data: (r.data?.[0] as { row: unknown }).row, error: null };
      },
    };
  }

  async function act(who: U, role: string, companyId = company) {
    const [row] = await t.asSystem<Record<string, unknown>>('select id, name, province, subscription_status, trial_ends_at, current_period_end, stripe_customer_id, stripe_subscription_id from public.companies where id = $1', [companyId]);
    mocks.server = clientFor(who, role, row);
  }
  const put = async (who: U, role: string, id: string, body: unknown, slug = LOTO, companyId = company) => {
    await act(who, role, companyId);
    const res = await PUT(new Request(`http://x/api/records/${slug}/${id}`, { method: 'PUT', body: JSON.stringify(body) }), { params: { module: slug, id } });
    return { status: res.status, json: await res.json() };
  };
  const del = async (who: U, role: string, id: string, slug = LOTO, companyId = company) => {
    await act(who, role, companyId);
    const res = await deleteRecord(new Request('http://x', { method: 'DELETE' }), { params: { module: slug, id } });
    return { status: res.status, json: await res.json() };
  };
  const signBody = (slot: string, name = 'Tessa') => ({ action: 'sign', slot, name, signature: SIG });

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('out-of-order signing is a 409 with the rule in plain words', async () => {
    const id = await permit();
    const res = await put('sparky', 'electrician', id, signBody('lock_off'));
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/Lock-on has to be signed before Lock-off/);
  });

  it('double-submitting a sign-off: the first lands, the second is a 409 and adds nothing', async () => {
    const id = await permit();
    expect((await put('sparky', 'electrician', id, signBody('lock_on'))).status).toBe(200);
    expect((await put('sparky', 'electrician', id, signBody('lock_on'))).status).toBe(409);
    expect((await lotoRow(id)).signatures).toHaveLength(1);
  });

  it('double-submitting a reopen from the screen steps back once', async () => {
    const id = await released();
    const body = { action: 'reopen', reason: 'Crew not clear', slot: 'lock_off' };
    expect((await put('pm', 'project_manager', id, body)).status).toBe(200);
    expect((await put('pm', 'project_manager', id, { ...body, reason: 'Second tab' })).status).toBe(409);
    expect((await lotoRow(id)).status).toBe('Verified Zero Energy');
  });

  it('a foreman reopening is a 403 without reaching the database', async () => {
    const id = await released();
    expect((await put('foreman2', 'foreman', id, { action: 'reopen', reason: 'Oops' })).status).toBe(403);
    expect((await lotoRow(id)).status).toBe('Released');
  });

  it('another company gets a 404 for sign, reopen, save and delete', async () => {
    const id = await permit();
    const [{ id: rivalCompany }] = await t.asSystem<{ id: string }>(`select id from public.companies where name = 'Rival Electric'`);
    expect((await put('rival', 'owner', id, signBody('lock_on'), LOTO, rivalCompany)).status).toBe(404);
    expect((await put('rival', 'owner', id, { action: 'reopen', reason: 'Mine' }, LOTO, rivalCompany)).status).toBe(404);
    expect((await put('rival', 'owner', id, { action: 'save', fields: { notes: 'x' } }, LOTO, rivalCompany)).status).toBe(404);
    expect((await del('rival', 'owner', id, LOTO, rivalCompany)).status).toBe(404);
    expect((await lotoRow(id)).notes).toBeNull();
  });

  it('a lapsed company gets a 402 for every write', async () => {
    const id = await permit();
    await t.setLapsed(company, true);
    try {
      for (const body of [signBody('lock_on'), { action: 'save', fields: { notes: 'x' } }, { action: 'photos', photos: [] }]) expect((await put('sparky', 'electrician', id, body)).status).toBe(402);
      expect((await put('owner', 'owner', id, { action: 'reopen', reason: 'x' })).status).toBe(402);
      expect((await del('owner', 'owner', id)).status).toBe(402);
    } finally {
      await t.setLapsed(company, false);
    }
    expect((await lotoRow(id)).signatures).toEqual([]);
  });

  it('a save on a locked record is a 409; a status sent alone changes nothing', async () => {
    const locked = await released();
    expect((await put('owner', 'owner', locked, { action: 'save', fields: { notes: 'x' } })).status).toBe(409);
    const open = await permit();
    expect((await put('owner', 'owner', open, { action: 'save', fields: { status: 'Draft' } })).status).toBe(400);
    expect((await put('owner', 'owner', open, { action: 'save', fields: { status: 'Released' } })).status).toBe(400);
    expect((await lotoRow(open)).status).toBe('Draft');
  });

  it('a project from another company is a 400 with a message', async () => {
    const [{ id: theirs }] = await t.as<{ id: string }>('rival', `insert into public.projects (title, status) values ('Theirs 2', 'Active') returning id`);
    const id = await permit();
    const res = await put('sparky', 'electrician', id, { action: 'save', fields: { project_id: theirs } });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/could not be found/);
  });

  it('an impossible date is a 400 and an electrician cannot change a signed-for field', async () => {
    const id = await permit();
    expect((await put('sparky', 'electrician', id, { action: 'save', fields: { record_date: '2026-02-31' } })).status).toBe(400);
    await put('sparky', 'electrician', id, signBody('lock_on'));
    const res = await put('sparky', 'electrician', id, { action: 'save', fields: { lock_number: 'L-99' } });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/Lock # was signed for/);
  });

  it('BUG: a save keeps working on a record holding a checklist item that has since left the list', async () => {
    // The trigger's own rule: "An item already on an old row can stay"
    const id = await permit();
    await t.asSystem('alter table public.loto_permits disable trigger loto_permits_guard');
    await t.asSystem(`update public.loto_permits set ppe = '["Old item"]' where id = $1`, [id]);
    await t.asSystem('alter table public.loto_permits enable trigger loto_permits_guard');
    expect((await put('sparky', 'electrician', id, { action: 'save', checklists: { ppe: ['Old item', 'Hi-vis'] } })).status).toBe(200);
  });

  it('delete: crew and a PM on a permit are 403, a signed record is a 409, an unsigned one goes', async () => {
    const id = await permit();
    expect((await del('sparky', 'electrician', id)).status).toBe(403);
    expect((await del('pm', 'project_manager', id)).status).toBe(403);
    const signed = await released();
    const res = await del('owner', 'owner', signed);
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/stays on file/);
    expect((await del('owner', 'owner', id)).status).toBe(200);
    expect(await t.asSystem('select id from public.loto_permits where id = $1', [id])).toHaveLength(0);
  });
});
