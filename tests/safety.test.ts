// The safety record engine: what the database enforces on LOTO permits, tailgate
// meetings and safety inspections, plus the API route and the shared delete.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootDb, type TestDb } from './helpers/db';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ server: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mocks.server, createSupabaseServerClient: () => mocks.server }));

import { PUT } from '@/app/api/records/[module]/[id]/route';
import PrintRecord from '@/app/print/record/[module]/[id]/page';
import RecordEditor from '@/components/record-editor';
import { deleteRecord, listColumns } from '@/lib/crud';
import { DETAIL_PAGES } from '@/lib/detail-pages';
import { getModule, pickableStatuses } from '@/lib/modules';
import { RECORD_MODULES, RecordAction, checklistChoices, cleanText, deleteBlock, isLocked, isRecordPhotoPath, missingFor, nextSlots, recordConfig, type RecordRow, type RecordSignature } from '@/lib/records';
import { parseRecord } from '@/lib/validation';

const USERS = {
  owner: { id: '00000000-0000-4000-8000-000000000001', email: 'owner@alpha.ca' },
  pm: { id: '00000000-0000-4000-8000-000000000002', email: 'pm@alpha.ca' },
  foreman: { id: '00000000-0000-4000-8000-000000000003', email: 'foreman@alpha.ca' },
  sparky: { id: '00000000-0000-4000-8000-000000000004', email: 'sparky@alpha.ca' },
  rival: { id: '00000000-0000-4000-8000-000000000005', email: 'owner@rival.ca' },
};
type U = keyof typeof USERS;

const SIG = 'data:image/png;base64,AAAA';
let t: TestDb<U>;
let company: string;
let rivalCompany: string;

async function newPermit(fill = true): Promise<string> {
  const [row] = await t.as<{ id: string }>('sparky', `insert into public.loto_permits (title, status, equipment_isolated, authorized_person) values ('Conveyor 7', 'Draft', 'Conveyor 7 drive', 'Tessa') returning id`);
  if (fill) await fillLockOn(row.id);
  return row.id;
}
const fillLockOn = (id: string) =>
  t.as('sparky', `update public.loto_permits set lock_number = 'L-12', record_date = '2026-11-04', isolation_points = 'Breaker 7', energy_sources = '["Electrical"]' where id = $1`, [id]);
const fillRest = (id: string) => t.as('sparky', `update public.loto_permits set verification_method = 'Meter at the T-leads', release_notes = 'Crew clear' where id = $1`, [id]);

const sign = (who: U, module: string, id: string, slot: string, name = 'Tessa', signature = SIG) =>
  t.as<{ row: { status: string; signatures: RecordSignature[]; attendees_count: number } }>(who, 'select public.sign_safety_record($1, $2, $3, $4, $5) as row', [module, id, slot, name, signature]);
const signFails = (who: U, module: string, id: string, slot: string, name = 'Tessa') => t.fails(who, 'select public.sign_safety_record($1, $2, $3, $4, $5)', [module, id, slot, name, SIG]);
const reopen = (who: U, module: string, id: string, reason = 'Wrong breaker') => t.as<{ row: { status: string; signatures: RecordSignature[]; reopen_log: { reason: string; by_name: string; removed: { name: string }[] }[] } }>(who, 'select public.reopen_safety_record($1, $2, $3) as row', [module, id, reason]);
const statusOf = async (table: string, id: string) => (await t.asSystem<{ status: string }>(`select status from public.${table} where id = $1`, [id]))[0].status;

async function released(): Promise<string> {
  const id = await newPermit();
  await fillRest(id);
  await sign('sparky', 'loto-permits', id, 'lock_on');
  await sign('sparky', 'loto-permits', id, 'verified');
  await sign('sparky', 'loto-permits', id, 'lock_off');
  return id;
}

beforeAll(async () => {
  t = await bootDb(USERS);
  company = await t.createCompany('owner', 'Alpha Electric');
  await t.join('owner', 'pm', 'project_manager');
  await t.join('owner', 'foreman', 'foreman');
  await t.join('owner', 'sparky', 'electrician');
  rivalCompany = await t.createCompany('rival', 'Rival Electric');
}, 60_000);
afterAll(() => t.pg.close());

describe('LOTO slot order', () => {
  it('refuses verification before lock-on', async () => {
    const id = await newPermit();
    await fillRest(id);
    expect(await signFails('sparky', 'loto-permits', id, 'verified')).toMatch(/Lock-on has to be signed before Zero energy verification/);
    expect(await statusOf('loto_permits', id)).toBe('Draft');
  });

  it('refuses Released without verification', async () => {
    const id = await newPermit();
    await fillRest(id);
    await sign('sparky', 'loto-permits', id, 'lock_on');
    expect(await signFails('sparky', 'loto-permits', id, 'lock_off')).toMatch(/Zero energy verification has to be signed before Lock-off/);
    expect(await statusOf('loto_permits', id)).toBe('Locked Out');
  });

  it('refuses Released as a first signature too', async () => {
    const id = await newPermit();
    await fillRest(id);
    expect(await signFails('sparky', 'loto-permits', id, 'lock_off')).toMatch(/has to be signed before/);
  });

  it('walks lock-on, verified, lock-off, with status following', async () => {
    const id = await newPermit();
    await fillRest(id);
    expect((await sign('sparky', 'loto-permits', id, 'lock_on'))[0].row.status).toBe('Locked Out');
    expect((await sign('foreman', 'loto-permits', id, 'verified', 'Mike'))[0].row.status).toBe('Verified Zero Energy');
    const [{ row }] = await sign('sparky', 'loto-permits', id, 'lock_off');
    expect(row.status).toBe('Released');
    expect(row.signatures.map((s) => s.slot)).toEqual(['lock_on', 'verified', 'lock_off']);
  });

  it('refuses signing the same slot twice', async () => {
    const id = await newPermit();
    await sign('sparky', 'loto-permits', id, 'lock_on');
    expect(await signFails('sparky', 'loto-permits', id, 'lock_on', 'Someone Else')).toMatch(/already been signed/);
  });

  it('refuses a slot that does not exist', async () => {
    const id = await newPermit();
    expect(await signFails('sparky', 'loto-permits', id, 'supervisor')).toMatch(/not a sign-off/);
  });

  it('takes who and when from the session, never the request', async () => {
    const id = await newPermit();
    const forged = JSON.stringify([{ slot: 'lock_on', name: 'Tessa', signature: SIG, signed_at: '2001-01-01T00:00:00Z', user_id: USERS.owner.id }]);
    const [row] = await t.as<{ signatures: RecordSignature[] }>('sparky', 'update public.loto_permits set signatures = $1::jsonb where id = $2 returning signatures', [forged, id]);
    expect(row.signatures[0].user_id).toBe(USERS.sparky.id);
    expect(row.signatures[0].signed_at.startsWith('2001')).toBe(false);
  });

  it('refuses rewriting or dropping past signatures by hand', async () => {
    const id = await newPermit();
    await fillRest(id);
    await sign('sparky', 'loto-permits', id, 'lock_on');
    const swapped = JSON.stringify([{ slot: 'lock_on', name: 'Forged', signature: SIG }]);
    expect(await t.fails('pm', 'update public.loto_permits set signatures = $1::jsonb where id = $2', [swapped, id])).toMatch(/cannot be changed/);
    const skipAhead = JSON.stringify([{ slot: 'lock_on', name: 'A', signature: SIG }, { slot: 'verified', name: 'B', signature: SIG }, { slot: 'lock_off', name: 'C', signature: SIG }]);
    expect(await t.fails('owner', 'update public.loto_permits set signatures = $1::jsonb where id = $2', [skipAhead, id])).toMatch(/cannot be changed/);
  });

  it('refuses a blank name or a signature that is not a drawing', async () => {
    const id = await newPermit();
    expect(await t.fails('sparky', 'select public.sign_safety_record($1, $2, $3, $4, $5)', ['loto-permits', id, 'lock_on', '  ', SIG])).toMatch(/name of the person/);
    expect(await t.fails('sparky', 'select public.sign_safety_record($1, $2, $3, $4, $5)', ['loto-permits', id, 'lock_on', 'Tessa', 'javascript:alert(1)'])).toMatch(/Draw a signature/);
  });
});

describe('status is never set by hand', () => {
  it('overrides a status sent on insert', async () => {
    const [row] = await t.as<{ status: string }>('sparky', `insert into public.loto_permits (title, status, equipment_isolated, authorized_person) values ('X', 'Released', 'E', 'P') returning status`);
    expect(row.status).toBe('Draft');
  });

  it('overrides a status sent on update', async () => {
    const id = await newPermit();
    const [row] = await t.as<{ status: string }>('owner', `update public.loto_permits set status = 'Released' where id = $1 returning status`, [id]);
    expect(row.status).toBe('Draft');
  });

  it('ignores signatures sent on insert', async () => {
    const forged = JSON.stringify([{ slot: 'lock_on', name: 'A', signature: SIG }]);
    const [row] = await t.as<{ signatures: unknown[] }>('sparky', `insert into public.loto_permits (title, status, equipment_isolated, authorized_person, signatures) values ('X', 'Draft', 'E', 'P', $1::jsonb) returning signatures`, [forged]);
    expect(row.signatures).toEqual([]);
  });

  it('the API refuses the derived statuses', () => {
    for (const status of ['Locked Out', 'Verified Zero Energy', 'Released']) expect(parseRecord(getModule('loto-permits')!, { status }, 'update').ok).toBe(false);
    expect(parseRecord(getModule('tailgate-logs')!, { status: 'Completed' }, 'update').ok).toBe(false);
    expect(parseRecord(getModule('safety-inspections')!, { status: 'Signed Off' }, 'update').ok).toBe(false);
  });
});

describe('required fields before signing', () => {
  it('lists what is missing', async () => {
    const id = await newPermit(false);
    const message = await signFails('sparky', 'loto-permits', id, 'lock_on');
    expect(message).toMatch(/Fill these in/);
    for (const label of ['Lock #', 'Date', 'Isolation points', 'Energy sources']) expect(message).toContain(label);
    expect(message).not.toContain('Equipment isolated');
  });

  it('needs the verification method before verifying', async () => {
    const id = await newPermit();
    await sign('sparky', 'loto-permits', id, 'lock_on');
    expect(await signFails('sparky', 'loto-permits', id, 'verified')).toMatch(/How zero energy was verified/);
  });

  it('refuses blanking a field a signature depends on', async () => {
    const id = await newPermit();
    await sign('sparky', 'loto-permits', id, 'lock_on');
    expect(await t.fails('sparky', `update public.loto_permits set isolation_points = '  ' where id = $1`, [id])).toMatch(/Isolation points/);
    expect(await t.fails('sparky', `update public.loto_permits set energy_sources = '[]' where id = $1`, [id])).toMatch(/Energy sources/);
  });

  it('corrective actions are only needed when the result was not satisfactory', async () => {
    const [{ id }] = await t.as<{ id: string }>('sparky', `insert into public.safety_inspections (title, status, inspection_type, record_date, location, result, findings) values ('Walk', 'Draft', 'Site Walk', '2026-11-04', 'Unit 3', 'Corrective Action Needed', 'Blocked exit') returning id`);
    expect(await signFails('sparky', 'safety-inspections', id, 'inspector')).toMatch(/Corrective actions/);
    await t.as('sparky', `update public.safety_inspections set result = 'Satisfactory' where id = $1`, [id]);
    expect((await sign('sparky', 'safety-inspections', id, 'inspector'))[0].row.status).toBe('Signed Off');
  });
});

describe('lock on final sign-off', () => {
  it('refuses any edit, new photo or later signature', async () => {
    const id = await released();
    expect(await t.fails('owner', `update public.loto_permits set title = 'Changed' where id = $1`, [id])).toMatch(/signed off and locked/);
    expect(await t.fails('owner', `update public.loto_permits set notes = 'Changed' where id = $1`, [id])).toMatch(/signed off and locked/);
    const photo = `${company}/loto-permits/${id}/a.jpg`;
    expect(await t.fails('owner', `update public.loto_permits set photos = $1::jsonb where id = $2`, [JSON.stringify([photo]), id])).toMatch(/signed off and locked/);
    expect(await signFails('owner', 'loto-permits', id, 'lock_off', 'Another')).toMatch(/signed off and locked/);
  });

  it('an unsigned or part-signed record can still be edited', async () => {
    const id = await newPermit();
    await sign('sparky', 'loto-permits', id, 'lock_on');
    const [row] = await t.as<{ notes: string }>('sparky', `update public.loto_permits set notes = 'Still working' where id = $1 returning notes`, [id]);
    expect(row.notes).toBe('Still working');
  });

  it('a signed-for field opens again once its sign-off is reopened, and not before', async () => {
    const id = await newPermit();
    await sign('sparky', 'loto-permits', id, 'lock_on');
    expect(await t.fails('owner', `update public.loto_permits set lock_number = 'L-99' where id = $1`, [id])).toMatch(/Lock # was signed for/);
    await reopen('pm', 'loto-permits', id);
    const [row] = await t.as<{ lock_number: string }>('sparky', `update public.loto_permits set lock_number = 'L-99' where id = $1 returning lock_number`, [id]);
    expect(row.lock_number).toBe('L-99');
  });

  it('a foreman can take a crew member\'s photo off; crew can take off their own', async () => {
    const id = await newPermit();
    const mine = `${company}/loto-permits/${id}/mine.jpg`;
    const theirs = `${company}/loto-permits/${id}/theirs.jpg`;
    await t.as('sparky', `insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [mine]);
    await t.as('pm', `insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [theirs]);
    await t.as('pm', 'update public.loto_permits set photos = $1::jsonb where id = $2', [JSON.stringify([mine, theirs]), id]);
    expect(await t.fails('sparky', `update public.loto_permits set photos = '[]' where id = $1`, [id])).toMatch(/whoever added it/);
    const [own] = await t.as<{ photos: string[] }>('sparky', 'update public.loto_permits set photos = $1::jsonb where id = $2 returning photos', [JSON.stringify([theirs]), id]);
    expect(own.photos).toEqual([theirs]);
    const [cleared] = await t.as<{ photos: string[] }>('foreman', `update public.loto_permits set photos = '[]' where id = $1 returning photos`, [id]);
    expect(cleared.photos).toEqual([]);
  });

  it('a record with no signatures can still be saved with an old item still on its checklist', async () => {
    const id = await newPermit();
    await t.asSystem('alter table public.loto_permits disable trigger loto_permits_guard');
    await t.asSystem(`update public.loto_permits set ppe = '["Old item"]' where id = $1`, [id]);
    await t.asSystem('alter table public.loto_permits enable trigger loto_permits_guard');
    const [row] = await t.as<{ ppe: string[] }>('sparky', `update public.loto_permits set ppe = '["Old item", "Hi-vis"]' where id = $1 returning ppe`, [id]);
    expect(row.ppe).toEqual(['Old item', 'Hi-vis']);
  });
});

describe('reopen', () => {
  it('is refused below project manager', async () => {
    const id = await released();
    for (const who of ['foreman', 'sparky'] as const) expect(await t.fails(who, 'select public.reopen_safety_record($1, $2, $3)', ['loto-permits', id, 'Mistake'])).toMatch(/project manager or above/);
    expect(await statusOf('loto_permits', id)).toBe('Released');
  });

  it('is refused below project manager by direct update as well', async () => {
    const id = await released();
    expect(await t.fails('foreman', `update public.loto_permits set signatures = '[]' where id = $1`, [id])).toMatch(/project manager or above/);
  });

  it('a project manager steps back one slot, with a reason on file', async () => {
    const id = await released();
    const [{ row }] = await reopen('pm', 'loto-permits', id);
    expect(row.status).toBe('Verified Zero Energy');
    expect(row.signatures.map((s) => s.slot)).toEqual(['lock_on', 'verified']);
    expect(row.reopen_log).toHaveLength(1);
    expect(row.reopen_log[0].reason).toBe('Wrong breaker');
    expect(row.reopen_log[0].by_name).toBe('pm');
    expect(row.reopen_log[0].removed[0].name).toBe('Tessa');
    // Unlocked again
    await t.as('sparky', `update public.loto_permits set release_notes = 'Corrected' where id = $1`, [id]);
    expect((await sign('sparky', 'loto-permits', id, 'lock_off'))[0].row.status).toBe('Released');
  });

  it('needs a reason', async () => {
    const id = await released();
    expect(await t.fails('pm', 'select public.reopen_safety_record($1, $2, $3)', ['loto-permits', id, '   '])).toMatch(/reason/);
  });

  it('cannot change anything else in the same update', async () => {
    const id = await released();
    expect(await t.fails('pm', `update public.loto_permits set signatures = '[]', title = 'Sneaky' where id = $1`, [id])).toMatch(/changes nothing else|reason/);
  });

  it('cannot be forged through the reopen history column', async () => {
    const id = await newPermit();
    const [row] = await t.as<{ reopen_log: unknown[] }>('owner', `update public.loto_permits set reopen_log = '[{"reason":"forged"}]' where id = $1 returning reopen_log`, [id]);
    expect(row.reopen_log).toEqual([]);
  });

  it('a reopen naming the sign-off it meant changes nothing when that sign-off is already gone', async () => {
    const id = await released();
    const reopenSlot = (slot: string, reason: string) => t.as<{ row: { status: string } }>('pm', 'select public.reopen_safety_record($1, $2, $3, $4) as row', ['loto-permits', id, reason, slot]);
    expect((await reopenSlot('lock_off', 'Crew not clear'))[0].row.status).toBe('Verified Zero Energy');
    // Another tab, with a different reason, still looking at the released permit
    await expect(reopenSlot('lock_off', 'Second tab')).rejects.toThrow(/already changed/);
    expect(await statusOf('loto_permits', id)).toBe('Verified Zero Energy');
    expect((await reopenSlot('verified', 'Bad meter'))[0].row.status).toBe('Locked Out');
  });

  it('refuses a record with nothing signed', async () => {
    const id = await newPermit();
    expect(await t.fails('pm', 'select public.reopen_safety_record($1, $2, $3)', ['loto-permits', id, 'Nothing'])).toMatch(/no sign-offs/);
  });
});

describe('delete', () => {
  it('an unsigned record can be deleted by whoever has the rank', async () => {
    const id = await newPermit();
    expect(await t.as('owner', 'delete from public.loto_permits where id = $1 returning id', [id])).toHaveLength(1);
  });

  it('a signed record cannot, even by the owner', async () => {
    const id = await released();
    expect(await t.fails('owner', 'delete from public.loto_permits where id = $1', [id])).toMatch(/stays on file/);
  });

  it('a part-signed record cannot either', async () => {
    const id = await newPermit();
    await sign('sparky', 'loto-permits', id, 'lock_on');
    expect(await t.fails('owner', 'delete from public.loto_permits where id = $1', [id])).toMatch(/stays on file/);
  });

  it('nor one reopened back to nothing, because it was signed once', async () => {
    const id = await newPermit();
    await sign('sparky', 'loto-permits', id, 'lock_on');
    await reopen('pm', 'loto-permits', id);
    expect(await t.fails('owner', 'delete from public.loto_permits where id = $1', [id])).toMatch(/stays on file/);
  });

  it('removing a whole company still cascades through signed records', async () => {
    const [{ id: temp }] = await t.asSystem<{ id: string }>(`insert into public.companies (name, province) values ('Temp', 'SK') returning id`);
    await t.asSystem(`insert into public.tailgate_logs (company_id, title, status, topic, meeting_date, hazards, controls) values ($1, 'T', 'Needs Sign-off', 'A', '2026-11-04', 'B', 'C')`, [temp]);
    await t.asSystem(`update public.tailgate_logs set signatures = $1::jsonb where company_id = $2`, [JSON.stringify([{ slot: 'attendee', name: 'A', signature: SIG }]), temp]);
    await t.asSystem('delete from public.companies where id = $1', [temp]);
    expect(await t.asSystem('select id from public.tailgate_logs where company_id = $1', [temp])).toHaveLength(0);
  });
});

describe('tailgate meetings', () => {
  const newMeeting = async () => {
    const [{ id }] = await t.as<{ id: string }>('sparky', `insert into public.tailgate_logs (title, status, topic, meeting_date, hazards, controls) values ('Morning FLHA', 'Needs Sign-off', 'Energized work', '2026-11-04', 'MCC live', 'LOTO in place') returning id`);
    return id;
  };

  it('records who attended and counts them', async () => {
    const id = await newMeeting();
    await sign('sparky', 'tailgate-logs', id, 'attendee', 'Tessa');
    const [{ row }] = await sign('foreman', 'tailgate-logs', id, 'attendee', 'Raj');
    expect(row.status).toBe('Needs Sign-off');
    expect(row.attendees_count).toBe(2);
    expect(row.signatures.map((s) => s.name)).toEqual(['Tessa', 'Raj']);
  });

  it('refuses the same attendee twice, whatever the case', async () => {
    const id = await newMeeting();
    await sign('sparky', 'tailgate-logs', id, 'attendee', 'Tessa');
    expect(await signFails('sparky', 'tailgate-logs', id, 'attendee', ' tessa ')).toMatch(/already signed in/);
  });

  it('refuses a supervisor before any attendee', async () => {
    const id = await newMeeting();
    expect(await signFails('foreman', 'tailgate-logs', id, 'supervisor', 'Mike')).toMatch(/Attendee sign-in has to be signed before/);
  });

  it('supervisor completes and locks; no more attendees after that', async () => {
    const id = await newMeeting();
    await sign('sparky', 'tailgate-logs', id, 'attendee', 'Tessa');
    expect((await sign('foreman', 'tailgate-logs', id, 'supervisor', 'Mike'))[0].row.status).toBe('Completed');
    expect(await signFails('sparky', 'tailgate-logs', id, 'attendee', 'Late Larry')).toMatch(/signed off and locked/);
    expect(await t.fails('owner', `update public.tailgate_logs set hazards = 'Other' where id = $1`, [id])).toMatch(/locked/);
  });

  it('the attendee count cannot be typed in', async () => {
    const id = await newMeeting();
    await sign('sparky', 'tailgate-logs', id, 'attendee', 'Tessa');
    const [row] = await t.as<{ attendees_count: number }>('owner', 'update public.tailgate_logs set attendees_count = 40 where id = $1 returning attendees_count', [id]);
    expect(Number(row.attendees_count)).toBe(1);
    expect(parseRecord(getModule('tailgate-logs')!, { attendees_count: 40 }, 'update').ok).toBe(false);
  });

  it('reopening a completed meeting removes the supervisor and keeps the attendees', async () => {
    const id = await newMeeting();
    await sign('sparky', 'tailgate-logs', id, 'attendee', 'Tessa');
    await sign('foreman', 'tailgate-logs', id, 'supervisor', 'Mike');
    const [{ row }] = await reopen('pm', 'tailgate-logs', id);
    expect(row.status).toBe('Needs Sign-off');
    expect(row.signatures.map((s) => s.name)).toEqual(['Tessa']);
  });

});

describe('tenancy and roles', () => {
  it('another company cannot see, sign or reopen a record', async () => {
    const id = await newPermit();
    expect(await t.as('rival', 'select id from public.loto_permits where id = $1', [id])).toHaveLength(0);
    expect(await signFails('rival', 'loto-permits', id, 'lock_on')).toMatch(/Not found/);
    expect(await t.fails('rival', 'select public.reopen_safety_record($1, $2, $3)', ['loto-permits', id, 'Mine now'])).toMatch(/Not found/);
  });

  it('refuses a project from another company', async () => {
    const [{ id: project }] = await t.as<{ id: string }>('rival', `insert into public.projects (title, status) values ('Theirs', 'Active') returning id`);
    const id = await newPermit();
    expect(await t.fails('sparky', 'update public.loto_permits set project_id = $1 where id = $2', [project, id])).toMatch(/could not be found/);
  });

  it('a lapsed company can read but cannot sign', async () => {
    const id = await newPermit();
    await t.setLapsed(company, true);
    try {
      expect(await t.as('sparky', 'select id from public.loto_permits where id = $1', [id])).toHaveLength(1);
      expect(await signFails('sparky', 'loto-permits', id, 'lock_on')).toMatch(/Not found/);
    } finally {
      await t.setLapsed(company, false);
    }
  });

  it('visitors have no way in', async () => {
    expect(await t.fails(null, 'select * from public.safety_inspections')).toMatch(/permission denied/);
    expect(await t.fails(null, `select public.sign_safety_record('loto-permits', gen_random_uuid(), 'lock_on', 'A', 'B')`)).toMatch(/permission denied/);
    expect(await t.fails(null, `select public.reopen_safety_record('loto-permits', gen_random_uuid(), 'A')`)).toMatch(/permission denied/);
    expect(await t.fails(null, `select public.safety_photo_open('a/b/c/d')`)).toMatch(/permission denied/);
  });

  it('an unknown record type is refused', async () => {
    expect(await t.fails('sparky', `select public.sign_safety_record('daily-logs', gen_random_uuid(), 'x', 'A', 'B')`)).toMatch(/Unknown record type/);
  });
});

describe('photos', () => {
  const upload = (who: U, name: string) => t.as(who, `insert into storage.objects (bucket_id, name) values ('job-photos', $1) returning id`, [name]);

  it('a row only accepts photos in its own folder', async () => {
    const id = await newPermit();
    const good = `${company}/loto-permits/${id}/a.jpg`;
    const [row] = await t.as<{ photos: string[] }>('sparky', 'update public.loto_permits set photos = $1::jsonb where id = $2 returning photos', [JSON.stringify([good]), id]);
    expect(row.photos).toEqual([good]);
    for (const bad of [`${company}/loto-permits/${crypto.randomUUID()}/a.jpg`, `${rivalCompany}/loto-permits/${id}/a.jpg`, `${company}/tailgate-logs/${id}/a.jpg`, `${company}/loto-permits/${id}/../x.jpg`]) {
      expect(await t.fails('sparky', 'update public.loto_permits set photos = $1::jsonb where id = $2', [JSON.stringify([bad]), id])).toMatch(/Invalid photo/);
    }
  });

  it('storage takes a file for an open record in the caller\'s company', async () => {
    const id = await newPermit();
    expect(await upload('sparky', `${company}/loto-permits/${id}/a.jpg`)).toHaveLength(1);
  });

  it('storage refuses another company, an unknown record or the wrong depth', async () => {
    const id = await newPermit();
    await expect(upload('rival', `${company}/loto-permits/${id}/a.jpg`)).rejects.toThrow();
    await expect(upload('sparky', `${company}/loto-permits/${crypto.randomUUID()}/a.jpg`)).rejects.toThrow();
    await expect(upload('sparky', `${company}/loto-permits/${id}/deep/a.jpg`)).rejects.toThrow();
    await expect(upload('sparky', `${company}/rfis/${id}/a.jpg`)).rejects.toThrow();
  });

  it('storage refuses adding to, or removing from, a locked record', async () => {
    const id = await newPermit();
    const name = `${company}/loto-permits/${id}/keep.jpg`;
    await upload('sparky', name);
    await fillRest(id);
    await sign('sparky', 'loto-permits', id, 'lock_on');
    await sign('sparky', 'loto-permits', id, 'verified');
    await sign('sparky', 'loto-permits', id, 'lock_off');
    await expect(upload('sparky', `${company}/loto-permits/${id}/late.jpg`)).rejects.toThrow();
    expect(await t.as('owner', 'delete from storage.objects where name = $1 returning id', [name])).toHaveLength(0);
  });

  it('crew can remove their own file but not someone else\'s', async () => {
    const id = await newPermit();
    const name = `${company}/loto-permits/${id}/owners.jpg`;
    await upload('pm', name);
    expect(await t.as('sparky', 'delete from storage.objects where name = $1 returning id', [name])).toHaveLength(0);
    expect(await t.as('foreman', 'delete from storage.objects where name = $1 returning id', [name])).toHaveLength(1);
  });
});

describe('screens and database agree', () => {
  it.each(Object.keys(RECORD_MODULES))('%s has the same rules in both', async (slug) => {
    const [{ rules }] = await t.asSystem<{ rules: { table: string; start: string; checklists: string[]; options: unknown; selects: unknown; slots: { key: string; label: string; status: string; multiple: boolean; required: { key: string; label: string; unless?: unknown }[] }[] } }>('select public.safety_record_rules($1) as rules', [slug]);
    const config = RECORD_MODULES[slug];
    expect(rules.table).toBe(getModule(slug)!.table);
    expect(rules.start).toBe(config.start);
    expect(rules.checklists).toEqual(config.checklists.map((c) => c.key));
    expect(rules.slots).toEqual(config.slots.map(({ attest: _attest, ...s }) => s));
    expect(rules.options).toEqual(Object.fromEntries(config.checklists.map((c) => [c.key, c.options])));
    expect(rules.selects).toEqual(Object.fromEntries(getModule(slug)!.fields.filter((f) => f.type === 'select').map((f) => [f.key, f.options])));
  });

  it.each(Object.keys(RECORD_MODULES))('%s: the registry matches the engine', (slug) => {
    const config = RECORD_MODULES[slug];
    const mod = getModule(slug)!;
    expect(DETAIL_PAGES[slug]).toBe(`/${slug}`);
    expect(mod.statuses).toEqual(expect.arrayContaining([config.start, ...config.slots.map((s) => s.status)]));
    expect(pickableStatuses(mod)).toEqual([config.start]);
    const keys = mod.fields.map((f) => f.key);
    for (const required of config.slots.flatMap((s) => s.required)) expect(keys).toContain(required.key);
    expect(keys).toContain(config.dateKey);
    for (const key of ['photos', 'signatures', 'reopen_log', ...config.checklists.map((c) => c.key)]) expect(mod.fields.find((f) => f.key === key)?.type).toBe('list');
  });

  it('both read text the same way, invisible characters and all', async () => {
    const samples = ['Tessa', ' Tessa  Ray\t\n', 'Tessa‍', 'Tes​sa', '­͏؜', '\u0001\u007F\u009F', '\u0085a\u0085', '       　', '‌‍‎‏‪‮⁠⁯', '⠀ㅤ️﻿ﾠ￹', '\u{1D173}\u{E0001}\u{E0100}', 'Zoë Müller-Ñ'];
    for (const sample of samples) {
      const [{ clean }] = await t.asSystem<{ clean: string }>('select public.safety_clean_text($1) as clean', [sample]);
      expect(clean).toBe(cleanText(sample));
    }
    expect(cleanText('⁠\u0001')).toBe('');
    expect(missingFor(recordConfig('tailgate-logs')!, recordConfig('tailgate-logs')!.slots[0], { topic: '⁠', meeting_date: 'x', hazards: 'x', controls: 'x' })).toEqual(['Topic']);
  });

  it('lists leave signature images and other JSON out', () => {
    const columns = listColumns(getModule('loto-permits')!).split(', ');
    for (const key of ['signatures', 'photos', 'reopen_log', 'ppe']) expect(columns).not.toContain(key);
  });
});

describe('the engine in lib/records', () => {
  const loto = recordConfig('loto-permits')!;
  const tailgate = recordConfig('tailgate-logs')!;
  const sig = (slot: string): RecordSignature => ({ slot, name: 'A', signature: SIG, signed_at: '2026-11-04T00:00:00Z' });

  it('offers slots in order', () => {
    expect(nextSlots(loto, []).map((s) => s.key)).toEqual(['lock_on']);
    expect(nextSlots(loto, [sig('lock_on')]).map((s) => s.key)).toEqual(['verified']);
    expect(nextSlots(loto, [sig('lock_on'), sig('verified'), sig('lock_off')])).toEqual([]);
    expect(nextSlots(tailgate, []).map((s) => s.key)).toEqual(['attendee']);
    expect(nextSlots(tailgate, [sig('attendee')]).map((s) => s.key)).toEqual(['attendee', 'supervisor']);
  });

  it('locks on the last slot only', () => {
    expect(isLocked(loto, [])).toBe(false);
    expect(isLocked(loto, [sig('lock_on'), sig('verified')])).toBe(false);
    expect(isLocked(loto, [sig('lock_on'), sig('verified'), sig('lock_off')])).toBe(true);
    expect(isLocked(tailgate, [sig('attendee')])).toBe(false);
  });

  it('a later slot also needs what earlier slots needed', () => {
    expect(missingFor(loto, loto.slots[1], { equipment_isolated: 'E' })).toContain('Lock #');
    expect(missingFor(loto, loto.slots[1], { equipment_isolated: 'E' })).toContain('How zero energy was verified');
  });

  it('blocks delete once signed or ever reopened', () => {
    expect(deleteBlock({ signatures: [], reopen_log: [] })).toBeNull();
    expect(deleteBlock({ signatures: [sig('lock_on')], reopen_log: [] })).toMatch(/stays on file/);
    expect(deleteBlock({ signatures: [], reopen_log: [{}] })).toMatch(/stays on file/);
  });

  it('validates what can be sent', () => {
    expect(RecordAction.safeParse({ action: 'sign', slot: 'lock_on', name: 'A', signature: 'nope' }).success).toBe(false);
    expect(RecordAction.safeParse({ action: 'reopen', reason: '  ' }).success).toBe(false);
    expect(RecordAction.safeParse({ action: 'status', status: 'Released' }).success).toBe(false);
    expect(RecordAction.safeParse({ action: 'sign', slot: 'lock_on', name: '⁠', signature: SIG }).success).toBe(false);
    expect(RecordAction.safeParse({ action: 'reopen', reason: '‍' }).success).toBe(false);
  });

  it('a photo path has to name a file directly in the folder', () => {
    expect(isRecordPhotoPath('c/m/i/', 'c/m/i/a.jpg')).toBe(true);
    for (const bad of ['c/m/i/', 'c/m/i/deep/a.jpg', 'c/m/i/../a.jpg', 'c/m/x/a.jpg']) expect(isRecordPhotoPath('c/m/i/', bad)).toBe(false);
  });

  it('a checklist shows its options plus anything a record still holds', () => {
    const ppe = loto.checklists[1];
    expect(checklistChoices(ppe, ['Hi-vis'])).toEqual(ppe.options);
    expect(checklistChoices(ppe, ['Old item'])).toEqual([...ppe.options, 'Old item']);
  });
});

describe('routes', () => {
  const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' };
  const COMPANY = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01T00:00:00Z', current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null };
  const ID = '22222222-2222-4222-8222-222222222222';

  function signedIn(tables: Record<string, Record<string, unknown>[]> = {}, role = 'owner', extra: Record<string, unknown> = {}) {
    const fake = fakeSupabase({ company_users: [{ user_id: USER.id, role, company: COMPANY }], ...tables });
    const client = Object.assign(fake, { auth: { getUser: async () => ({ data: { user: USER }, error: null }) } }, extra);
    mocks.server = client;
    return client;
  }
  const put = (module: string, body: unknown, id = ID) => PUT(new Request(`http://x/api/records/${module}/${id}`, { method: 'PUT', body: JSON.stringify(body) }), { params: { module, id } });
  const del = (module: string) => deleteRecord(new Request('http://x', { method: 'DELETE' }), { params: { module, id: ID } });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('404s anything that is not a record module', async () => {
    signedIn();
    expect((await put('daily-logs', { action: 'reopen', reason: 'x' })).status).toBe(404);
    expect((await put('loto-permits', { action: 'reopen', reason: 'x' }, 'nope')).status).toBe(404);
    expect((await put('constructor', { action: 'reopen', reason: 'x' })).status).toBe(404);
  });

  it('refuses a reopen below project manager before reaching the database', async () => {
    const rpc = vi.fn();
    signedIn({}, 'foreman', { rpc });
    const res = await put('loto-permits', { action: 'reopen', reason: 'Mistake' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/project manager/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends a signature to the database as the signed-in user', async () => {
    const rpc = vi.fn(async () => ({ data: { id: ID, status: 'Locked Out' }, error: null }));
    signedIn({}, 'electrician', { rpc });
    const res = await put('loto-permits', { action: 'sign', slot: 'lock_on', name: 'Tessa', signature: SIG });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('sign_safety_record', { p_module: 'loto-permits', p_id: ID, p_slot: 'lock_on', p_name: 'Tessa', p_signature: SIG });
  });

  it('shows the database rule as a 409 with its message', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'P0001', message: 'Lock-on has to be signed before Lock-off.' } }));
    signedIn({}, 'electrician', { rpc });
    const res = await put('loto-permits', { action: 'sign', slot: 'lock_off', name: 'Tessa', signature: SIG });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/has to be signed before/);
  });

  it('refuses a checklist item that is not on the list', async () => {
    signedIn();
    expect((await put('loto-permits', { action: 'save', checklists: { ppe: ['Cape'] } })).status).toBe(400);
    expect((await put('loto-permits', { action: 'save', checklists: { signatures: [] } })).status).toBe(400);
  });

  it('refuses a photo outside the record\'s folder', async () => {
    signedIn();
    expect((await put('loto-permits', { action: 'photos', photos: ['other-company/loto-permits/x/a.jpg'] })).status).toBe(400);
    const folder = `${COMPANY.id}/loto-permits/${ID}/`;
    expect((await put('loto-permits', { action: 'photos', photos: [folder] })).status).toBe(400);
    expect((await put('loto-permits', { action: 'photos', photos: [`${folder}deep/a.jpg`] })).status).toBe(400);
  });

  it('a checklist item the record already holds can stay, and a new off-list one still cannot join it', async () => {
    signedIn({ loto_permits: [{ id: ID, ppe: ['Old item'] }] });
    expect((await put('loto-permits', { action: 'save', checklists: { ppe: ['Old item', 'Cape'] } })).status).toBe(400);
    expect((await put('loto-permits', { action: 'save', checklists: { ppe: ['Old item', 'Hi-vis'] } })).status).toBe(200);
  });

  it('delete refuses a signed record without touching its photos', async () => {
    const remove = vi.fn();
    signedIn({ loto_permits: [{ id: ID, photos: ['a.jpg'], signatures: [{ slot: 'lock_on' }], reopen_log: [] }] }, 'owner', { storage: { from: () => ({ remove }) } });
    const res = await del('loto-permits');
    expect(res.status).toBe(409);
    expect(remove).not.toHaveBeenCalled();
  });

  it('delete removes the photos of an unsigned record first', async () => {
    const remove = vi.fn(async () => ({ error: null }));
    signedIn({ safety_inspections: [{ id: ID, photos: ['a.jpg'], signatures: [], reopen_log: [] }] }, 'owner', { storage: { from: () => ({ remove }) } });
    const res = await del('safety-inspections');
    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(['a.jpg']);
  });

  it('delete keeps the record when its photos could not be removed', async () => {
    const remove = vi.fn(async () => ({ error: { message: 'down' } }));
    signedIn({ tailgate_logs: [{ id: ID, photos: ['a.jpg'], signatures: [], reopen_log: [] }] }, 'owner', { storage: { from: () => ({ remove }) } });
    const res = await del('tailgate-logs');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/the meeting was kept/);
  });
});

describe('pages', () => {
  const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' };
  const COMPANY = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha Electric', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01T00:00:00Z', current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null };
  const ID = '22222222-2222-4222-8222-222222222222';
  const signature = (slot: string, name: string): RecordSignature => ({ slot, name, signature: SIG, signed_at: '2026-11-04T15:00:00Z' });
  const permit = (signatures: RecordSignature[], status: string, extra: Record<string, unknown> = {}): RecordRow => ({
    id: ID, company_id: COMPANY.id, title: 'Conveyor 7', status, notes: null, photos: [], signatures, reopen_log: [], ppe: ['Hi-vis'], energy_sources: ['Electrical'],
    equipment_isolated: 'Conveyor 7 drive', authorized_person: 'Tessa', lock_number: 'L-12', record_date: '2026-11-04', isolation_points: 'Breaker 7', verification_method: null, release_notes: null, project_id: null, ...extra,
  });
  const editor = (row: RecordRow, access: { canWrite?: boolean; canReopen?: boolean; canDelete?: boolean } = {}) =>
    renderToStaticMarkup(createElement(RecordEditor, { slug: 'loto-permits', initial: row, canWrite: true, canReopen: false, canDelete: true, ...access }));

  it('a new permit offers lock-on, and delete', () => {
    const html = editor(permit([], 'Draft'));
    expect(html).toContain('Sign: Lock-on');
    expect(html).not.toContain('Sign: Lock-off');
    expect(html).toContain('Delete this permit');
    expect(html).toContain('No photos yet');
  });

  it('says what is missing before the next signature', () => {
    expect(editor(permit([signature('lock_on', 'Tessa')], 'Locked Out'))).toContain('Fill these in before signing: How zero energy was verified');
  });

  it('a signed record shows its signer and has no delete', () => {
    const html = editor(permit([signature('lock_on', 'Tessa Nguyen')], 'Locked Out'));
    expect(html).toContain('Tessa Nguyen');
    expect(html).not.toContain('Delete this permit');
  });

  it('a released permit is locked: no sign box, and reopen only for those allowed', () => {
    const row = permit([signature('lock_on', 'A'), signature('verified', 'B'), signature('lock_off', 'C')], 'Released');
    const crew = editor(row);
    expect(crew).toContain('A project manager or above can reopen it');
    expect(crew).not.toContain('Name of person signing');
    expect(crew).not.toContain('Why is it being reopened');
    expect(editor(row, { canReopen: true })).toContain('Why is it being reopened');
  });

  it('signed-for fields are disabled and the rest stay open until the lock', () => {
    const html = editor(permit([signature('lock_on', 'Tessa')], 'Locked Out'));
    expect(html).toMatch(/<input[^>]*id="f-lock_number"[^>]*disabled/);
    expect(html).not.toMatch(/<textarea[^>]*id="f-verification_method"[^>]*disabled/);
    expect(html).toContain('Greyed-out fields have been signed for');
  });

  it('someone who cannot write gets a read-only view', () => {
    const html = editor(permit([], 'Draft'), { canWrite: false, canDelete: false });
    expect(html).toContain('but you can&#x27;t change it');
    expect(html).not.toContain('Name of person signing');
  });

  it('the print page has the letterhead, checklists, signatures and photos', async () => {
    const path = COMPANY.id + '/loto-permits/' + ID + '/a.jpg';
    const row = permit([signature('lock_on', 'Tessa Nguyen')], 'Locked Out', { photos: [path], project_id: 'p1' });
    const fake = fakeSupabase({
      company_users: [{ user_id: USER.id, role: 'electrician', company: COMPANY }],
      companies: [{ id: COMPANY.id, name: 'Alpha Electric', phone: '306-555-0100' }],
      projects: [{ id: 'p1', title: 'Canola Shutdown' }],
      loto_permits: [row],
    });
    mocks.server = Object.assign(fake, {
      auth: { getUser: async () => ({ data: { user: USER }, error: null }) },
      storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://files/' + p })), error: null }) }) },
    });
    const html = renderToStaticMarkup(await PrintRecord({ params: { module: 'loto-permits', id: ID } }));
    for (const text of ['Alpha Electric', '306-555-0100', 'LOTO Permit', 'Canola Shutdown', 'Tessa Nguyen', 'Breaker 7', 'Not final', SIG, 'https://files/' + path, 'I isolated the energy sources']) expect(html).toContain(text);
    expect(html).toContain('☑</span> Electrical');
    expect(html).toContain('☐</span> Hydraulic');
    expect(html).not.toContain('>photos<');
  });

  it('the print page 404s for another module or a bad id', async () => {
    await expect(PrintRecord({ params: { module: 'invoices', id: ID } })).rejects.toThrow();
    await expect(PrintRecord({ params: { module: 'loto-permits', id: 'nope' } })).rejects.toThrow();
  });
});
