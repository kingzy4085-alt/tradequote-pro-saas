// Adversarial usability review, walked from the code as a first-time contractor and as an electrician
// on a phone. Tests named [BUG] are reproduced defects and stay failing until the fix lands; the rest
// walk the same journey through the database and pin that the steps between the bugs work.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';
import { bootDb, type TestDb } from './helpers/db';

const mocks = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('@/lib/context', () => ({ getContext: async () => mocks.result, getPageContext: async () => mocks.result }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => null, createSupabaseServerClient: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  usePathname: () => '/',
}));

import EstimateEditor from '@/app/(app)/estimates/[id]/estimate-editor';
import HelpPage from '@/app/(app)/help/page';
import ProjectPage from '@/app/(app)/projects/[id]/page';
import BillingPage from '@/app/(app)/settings/billing/page';
import TimecardBoard from '@/app/(app)/timecards/timecard-board';
import ModuleRoute from '@/app/(app)/[module]/page';
import OnboardingForm from '@/app/(setup)/onboarding/onboarding-form';
import PricingView from '@/app/pricing/pricing-view';
import AppShell from '@/components/app-shell';
import SignaturePad from '@/components/signature-pad';
import { AUTOMATION_RULES } from '@/lib/alerts';
import { summariseJobs } from '@/lib/dashboard';
import { PROJECT_TABS, type JobCost } from '@/lib/job-cost';
import { MODULES, getModule, pickableStatuses, type ModuleDef } from '@/lib/modules';
import { ROLE_RANK, type Role } from '@/lib/roles';
import type { Timecard } from '@/lib/timecards';
import { parseRecord } from '@/lib/validation';

const uid = (n: number) => `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`;
const USERS = {
  owner: { id: uid(1), email: 'owner@first.ca' },
  pm: { id: uid(2), email: 'pm@first.ca' },
  foreman: { id: uid(3), email: 'foreman@first.ca' },
  elec: { id: uid(4), email: 'elec@first.ca' },
  ontario: { id: uid(5), email: 'owner@ontario.ca' },
  sask: { id: uid(6), email: 'owner@sask.ca' },
};
type U = keyof typeof USERS;

const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';
let t: TestDb<U>;

beforeAll(async () => {
  t = await bootDb(USERS);
  await t.createCompany('owner', 'First Electric');
  await t.join('owner', 'pm', 'project_manager', 'Pat PM');
  await t.join('owner', 'foreman', 'foreman', 'Frank Foreman');
  await t.join('owner', 'elec', 'electrician', 'Sam Sparks');
});

// What a page sends: the same steps the shared form and the editors take ---------------------------

/** The new-record form as components/module-page.tsx builds it: every shown field blank, hidden and computed left out. */
function blankForm(mod: ModuleDef, title: string): Record<string, unknown> {
  const form: Record<string, unknown> = { title, status: pickableStatuses(mod)[0], notes: '' };
  for (const def of mod.fields) {
    if (def.computed || def.hidden || def.legacy) continue;
    form[def.key] = def.required ? 'Filled in' : def.type === 'boolean' ? false : '';
  }
  return form;
}

/** Inserts what the API would, as this user, and returns the row. */
async function insertParsed(who: U, mod: ModuleDef, form: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseRecord(mod, form, 'create');
  if (!parsed.ok) throw new Error(`The form was refused: ${JSON.stringify(parsed.errors)}`);
  const keys = Object.keys(parsed.data);
  const [row] = await t.as<Record<string, unknown>>(who, `insert into public.${mod.table} (${keys.map((k) => `"${k}"`).join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, keys.map((k) => jsonParam(parsed.data[k])));
  return row;
}

async function updateParsed(who: U, mod: ModuleDef, id: unknown, form: Record<string, unknown>) {
  const parsed = parseRecord(mod, form, 'update');
  if (!parsed.ok) throw new Error(`The form was refused: ${JSON.stringify(parsed.errors)}`);
  const keys = Object.keys(parsed.data);
  return t.as<{ id: string }>(who, `update public.${mod.table} set ${keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ')} where id = $1 returning id`, [id, ...keys.map((k) => jsonParam(parsed.data[k]))]);
}

const jsonParam = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v);

const ROLE_FOR_RANK: Record<number, U> = { 1: 'elec', 2: 'foreman', 3: 'pm', 4: 'owner', 5: 'owner' };
const customPages = new Set(['timecards', 'job-costing']);
const listedModules = MODULES.filter((m) => !customPages.has(m.slug));

describe('every "+ New" form, left as blank as it lets you, as the lowest role that sees the button', () => {
  it.each(listedModules.map((m) => [m.slug, m] as const))('%s saves, and saves again from its edit form', async (_slug, mod) => {
    const who = ROLE_FOR_RANK[mod.write];
    const row = await insertParsed(who, mod, blankForm(mod, `First ${mod.slug}`));
    expect(row.id).toBeTruthy();
    const remove = async () => expect(await t.as(ROLE_FOR_RANK[mod.remove], `delete from public.${mod.table} where id = $1 returning id`, [row.id])).toHaveLength(1);
    if (mod.editOnDetail) return remove();
    const [read] = await t.asSystem<Record<string, unknown>>(`select * from public.${mod.table} where id = $1`, [row.id]);
    const form: Record<string, unknown> = { title: read.title, status: read.status, notes: read.notes ?? '' };
    for (const def of mod.fields) {
      if (def.computed || def.hidden) continue;
      const v = read[def.key];
      form[def.key] = def.type === 'boolean' ? Boolean(v) : v === null || v === undefined ? '' : def.type === 'date' ? new Date(v as string).toISOString().slice(0, 10) : String(v);
    }
    if (mod.systemStatuses?.includes(String(read.status))) delete form.status;
    expect(await updateParsed(who, mod, row.id, form)).toHaveLength(1);
    await remove();
  });
});

// The first job, end to end ---------------------------------------------------------------------

describe('the first job: estimate, proposal, project, timecard, invoice', () => {
  let estimate: unknown;
  let proposal: unknown;
  let project: unknown;
  const lines = [{ description: 'New MCC', quantity: 1, unit: 'ea', material_unit_cost: 1000, labour_hours_per_unit: 10 }];

  const saveLines = (items: unknown[] = lines) => t.as('pm', 'select public.save_estimate_items($1, $2::jsonb)', [estimate, JSON.stringify(items)]);

  it('the estimate takes its lines and becomes a proposal', async () => {
    estimate = (await insertParsed('pm', getModule('estimates')!, { ...blankForm(getModule('estimates')!, 'Unit 3 MCC'), client_name: 'Cargill' })).id;
    await t.asSystem('update public.estimates set labour_rate = 100 where id = $1', [estimate]);
    await saveLines();
    [{ id: proposal }] = await t.as<{ id: string }>('pm', 'select public.create_proposal_from_estimate($1) as id', [estimate]);
    expect(proposal).toBeTruthy();
  });

  /**
   * estimate-editor.tsx save() always sends two requests: the header, then every line. Once the proposal
   * is Sent the Save button stays live, and the banner says only "its price and lines are locked".
   * Fixing a typo in the scope, or moving the estimate to Submitted, leaves the lines exactly as they were.
   */
  it('[BUG] once a proposal is Sent, pressing Save on its estimate to fix the scope saves half and then shows an error', async () => {
    await updateParsed('pm', getModule('proposals')!, proposal, { status: 'Sent' });
    const headerSaved = await updateParsed('pm', getModule('estimates')!, estimate, { scope: 'Fixed a typo', status: 'Submitted' });
    expect(headerSaved).toHaveLength(1);
    // The same lines, unchanged, from the second request of the same Save press
    await expect(saveLines()).resolves.toBeDefined();
  });

  it('an accepted proposal makes a project', async () => {
    await updateParsed('pm', getModule('proposals')!, proposal, { status: 'Accepted' });
    [{ id: project }] = await t.as<{ id: string }>('pm', 'select public.create_project_from_proposal($1) as id', [proposal]);
    expect(project).toBeTruthy();
  });

  /** The estimate error tells them to set the proposal back to Draft. guard_proposal refuses that once the project exists. */
  it('[BUG] after the project exists the estimate Save still fails, and its message points at a step the app refuses', async () => {
    const message = await saveLines().then(() => '', (e: Error) => e.message);
    if (message.includes('Set the proposal back to Draft')) {
      const refusal = await updateParsed('pm', getModule('proposals')!, proposal, { status: 'Draft' }).then(() => '', (e: Error) => e.message);
      expect(`${message} ... then: ${refusal}`).not.toMatch(/stays accepted/);
    }
    expect(message).toBe('');
  });

  it('crew can see the job and an electrician enters time on it', async () => {
    const [worker] = await t.as<{ user_id: string; name: string }>('elec', 'select * from public.timecard_workers()');
    expect(worker.name).toBe('Sam Sparks');
    const [card] = await t.as<{ id: string; status: string }>(
      'elec',
      `insert into public.timecards (title, status, project_id, work_date, regular_hours, overtime_hours, employee_name, worker_user_id) values ('Unit 3 MCC', 'Submitted', $1, '2026-11-04', 8, 0, $2, $3) returning id, status`,
      [project, worker.name, worker.user_id]
    );
    const [{ out }] = await t.as<{ out: { done: number } }>('foreman', `select public.decide_timecards($1::uuid[], 'reject', 'Wrong day') as out`, [[card.id]]);
    expect(out.done).toBe(1);
    // timecard-editor.tsx: "Save and resubmit"
    expect(await updateParsed('elec', getModule('timecards')!, card.id, { work_date: '2026-11-03', project_id: project, title: 'Unit 3 MCC', regular_hours: '8', overtime_hours: '0', notes: '', status: 'Submitted' })).toHaveLength(1);
    const [{ out: again }] = await t.as<{ out: { done: number } }>('foreman', `select public.decide_timecards($1::uuid[], 'approve') as out`, [[card.id]]);
    expect(again.done).toBe(1);
  });

  it('the project bills: new invoice, save exactly what the editor sends, mark sent, mark paid', async () => {
    const [{ id }] = await t.as<{ id: string }>('owner', 'select public.create_invoice_from_project($1) as id', [project]);
    const [inv] = await t.as<Record<string, unknown>>('owner', 'select * from public.invoices where id = $1', [id]);
    const lines = inv.lines as { type: string; description: string; amount: number }[];
    expect(lines).toHaveLength(1);
    const form = Object.fromEntries(['title', 'project_id', 'client_id', 'client_name', 'client_address', 'issue_date', 'due_date', 'tax_pct', 'holdback_pct', 'holdback_release_date', 'notes'].map((k) => [k, inv[k] === null || inv[k] === undefined ? '' : inv[k] instanceof Date ? (inv[k] as Date).toISOString().slice(0, 10) : String(inv[k])]));
    const parsed = parseRecord(getModule('invoices')!, form, 'update');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await t.as('owner', 'select public.save_invoice($1, $2::jsonb, $3::jsonb)', [id, JSON.stringify(parsed.data), JSON.stringify(lines.map((l) => ({ type: l.type, description: l.description, amount: l.amount })))]);
    expect(await updateParsed('owner', getModule('invoices')!, id, { status: 'Sent' })).toHaveLength(1);
    expect(await t.as('owner', 'select id from public.receivables where invoice_id = $1', [id])).toHaveLength(1);
    expect(await updateParsed('owner', getModule('invoices')!, id, { status: 'Paid' })).toHaveLength(1);
  });

  /** module-page.tsx shows Edit and Delete on every receivable row. guard_receivable refuses both on one from an invoice, whatever is typed. */
  it('[BUG] a receivable from an invoice offers Edit and Delete buttons that can only ever fail', async () => {
    const mod = getModule('receivables')!;
    const [row] = await t.as<{ id: string }>('owner', 'select id from public.receivables where invoice_id is not null limit 1');
    const refused = await updateParsed('owner', mod, row.id, { notes: 'Called them' }).then(() => '', (e: Error) => e.message);
    expect(refused).toContain('follows its invoice');
    const page = readFileSync('components/module-page.tsx', 'utf8');
    expect(page).toContain('canWrite && !mod.editOnDetail');
    expect(page).toMatch(/row\.invoice_id/);
  });

  /**
   * create_project_from_proposal inserts status 'Planning'. projects/[id]/page.tsx shows that as a badge
   * with no control and no link to change it: the only way is Back to Projects, then the Edit button in
   * the far column of the list. Until someone finds it the Command Center leaves the job out.
   */
  it('[BUG] a new project starts in Planning, and its own page gives no way to start it, so the dashboard counts $0', async () => {
    const [row] = await t.as<{ status: string }>('pm', 'select status from public.projects where id = $1', [project]);
    const job = { project_id: String(project), project_title: 'Unit 3 MCC', project_status: row.status, status: 'On Track', revised_contract: 2300, billed_amount: 0, margin: 2300, margin_pct: 100 } as unknown as JobCost;
    const pm = fakeSupabase(
      { projects: [{ id: project, title: 'Unit 3 MCC', status: 'Planning' }], rfis: [] },
      { rpc: (name) => (name === 'job_cost_rollup' ? { data: [job], error: null } : { data: [], error: null }) }
    );
    mocks.result = { status: 'ok', ctx: { supabase: pm, role: 'owner', canWrite: true, user: { id: 'u' }, company: { id: 'c', name: 'First', province: 'SK' } } };
    const page = renderToStaticMarkup(await ProjectPage({ params: { id: String(project) }, searchParams: {} }));
    const canMoveIt = />\s*Edit|Edit project|Start (the )?job|Mark active/i.test(page);
    // Fixed either way: the project starts Active, or its page can move it there
    expect({ activeJobs: summariseJobs([job]).activeJobs, canMoveIt: canMoveIt || row.status === 'Active' }).toEqual({ activeJobs: row.status === 'Active' ? 1 : 0, canMoveIt: true });
  });
});

describe('an electrician signing a LOTO permit, exactly as the editor sends it', () => {
  it('walks lock-on, verified and lock-off to Released', async () => {
    const mod = getModule('loto-permits')!;
    const { id } = await insertParsed('elec', mod, { ...blankForm(mod, 'LOTO-1 Conveyor 7'), equipment_isolated: 'Conveyor 7', authorized_person: 'Sam Sparks' });
    await updateParsed('elec', mod, id, { lock_number: '42', record_date: '2026-11-04', isolation_points: 'MCC-3 bucket 4' });
    await t.as('elec', `update public.loto_permits set energy_sources = '["Electrical"]'::jsonb where id = $1`, [id]);
    const sign = (slot: string) => t.as('elec', 'select public.sign_safety_record($1, $2, $3, $4, $5)', ['loto-permits', id, slot, 'Sam Sparks', SIGNATURE]);
    await sign('lock_on');
    await updateParsed('elec', mod, id, { verification_method: 'Meter, try-start' });
    await sign('verified');
    await updateParsed('elec', mod, id, { release_notes: 'All clear' });
    await sign('lock_off');
    const [row] = await t.as<{ status: string }>('elec', 'select status from public.loto_permits where id = $1', [id]);
    expect(row.status).toBe('Released');
  });
});

// Messages a contractor should never read ---------------------------------------------------------

describe('what the form says when something is left blank', () => {
  const RAW = /expected|received|Too small|Too big|Invalid input|Invalid option|invalid_type/i;

  /** module-page.tsx is noValidate and shows these under the field. A "*" field left blank is the most common mistake there is. */
  it('[BUG] leaving a starred field blank on a new LOTO permit shows "Invalid input: expected string, received null"', () => {
    const mod = getModule('loto-permits')!;
    const parsed = parseRecord(mod, { ...blankForm(mod, 'LOTO-2'), equipment_isolated: '', authorized_person: '' }, 'create');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.equipment_isolated).not.toMatch(RAW);
  });

  /** estimate-editor.tsx, record-editor.tsx, draw-editor.tsx and others all PUT the title as typed. */
  it('[BUG] clearing the name on any editor shows "Too small: expected string to have >=1 characters"', () => {
    const parsed = parseRecord(getModule('estimates')!, { title: '' }, 'update');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.title).not.toMatch(RAW);
  });

  /** The bucket allows jpeg, png, webp and heic up to 10 MB, and the picker takes image/*. A file compress() can't read goes up as it is. */
  it('[BUG] a photo the bucket refuses shows the storage service\'s own words', () => {
    for (const file of ['components/record-editor.tsx', 'app/(app)/daily-logs/[id]/daily-log-editor.tsx']) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('Photo not uploaded: ${uploadError.message}');
    }
  });
});

// Dead ends ---------------------------------------------------------------------------------------

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = joinPath(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

describe('ways out', () => {
  /**
   * The manifest is display: standalone and the FAQ sells that ("opens full-screen like any other app"),
   * so there is no browser toolbar. Every "Print" link opens in the same window, and the five print pages
   * hold one thing to press: Print / Save PDF.
   */
  it('[BUG] the print pages have no way back to the app', () => {
    const pages = walk('app/print').filter((f) => f.endsWith('page.tsx'));
    expect(pages.length).toBe(5);
    expect(readFileSync('app/manifest.ts', 'utf8')).toContain("display: 'standalone'");
    for (const file of ['components/record-editor.tsx', 'app/(app)/proposals/[id]/proposal-editor.tsx', 'app/(app)/invoices/[id]/invoice-editor.tsx']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\/print\/[^\n]*target="_blank"/);
    }
    const withoutWayBack = pages.filter((f) => !/<Link\b|<a\s+href=|history\.back|router\.back/.test(readFileSync(f, 'utf8')));
    expect(withoutWayBack).toEqual([]);
  });

  /**
   * onboarding-form.tsx has no sign-out, and the middleware sends a signed-in visitor on /login or /signup
   * to /, which the app layout sends back to /onboarding. Someone who signed up with the wrong address, so
   * their invitation doesn't show, can't get out to use the right one. Their only button makes a new company.
   */
  it('[BUG] onboarding has no way to sign out', () => {
    const html = renderToStaticMarkup(createElement(OnboardingForm, { email: 'sam@gmail.com', invitations: [] }));
    expect(html).toContain('Create Company');
    expect(html).toMatch(/\/auth\/signout|Sign out/i);
  });

  /** The shell has this right: canManageBilling picks "Ask your company owner". The board always links, and BillingPage is notFound below rank 4. */
  it('[BUG] a lapsed electrician is told to "Update billing" and the link is a 404', async () => {
    const html = renderToStaticMarkup(createElement(TimecardBoard, { ...BOARD, cards: [], canEnter: false, canWrite: false }));
    signInAs('electrician');
    const opens = await BillingPage({ searchParams: {} }).then(() => true, () => false);
    expect({ linked: html.includes('href="/settings/billing"'), opens }).not.toEqual({ linked: true, opens: false });
  });

  /** A project manager sees pay, so sees this notice. /employees is read: ADMIN, and CompanyForm is canEdit only at rank 4. */
  it('[BUG] a project manager told to fix a $0 labour rate is linked to a page they get a 404 on', async () => {
    const card = { id: 'c1', title: 'Job', status: 'Approved', employee_name: 'Sam', work_date: '2026-11-03', regular_hours: 8, overtime_hours: 0, hourly_cost: 0, labour_cost: 0 } as unknown as Timecard;
    const html = renderToStaticMarkup(createElement(TimecardBoard, { ...BOARD, cards: [card], canSeePay: true, canApprove: true, isCrewLead: true, canExport: true }));
    signInAs('project_manager');
    const opens = await ModuleRoute({ params: { module: 'employees' }, searchParams: {} }).then(() => true, () => false);
    expect({ linked: html.includes('href="/employees"'), opens }).not.toEqual({ linked: true, opens: false });
  });

  /** help/page.tsx renders one list for every role. Its "Open ..." links go to modules this role gets not-found on. */
  it('[BUG] How to Use links an electrician to pages that 404 for them', () => {
    const html = renderToStaticMarkup(createElement(HelpPage));
    const hrefs = [...html.matchAll(/href="\/([a-z-]+)"/g)].map((m) => m[1]).filter((s) => getModule(s));
    const blocked = [...new Set(hrefs.filter((s) => ROLE_RANK.electrician < getModule(s)!.read))];
    expect(blocked).toEqual([]);
  });

  /**
   * job_costing counts a PO as committed until a payable points at it. That column is `hidden` in the
   * registry, the shared form strips hidden fields before sending, and nothing else in the app sets it.
   * So the bill is added to actual cost and the PO stays committed: the same money twice, for good.
   */
  it('[BUG] a bill can never be matched to its PO, so its cost shows as actual and as committed', async () => {
    const pays = getModule('payables')!;
    const pos = getModule('purchase-orders')!;
    const [{ id: job }] = await t.as<{ id: string }>('pm', `insert into public.projects (title, status) values ('PO job', 'Active') returning id`);
    const po = await insertParsed('pm', pos, { ...blankForm(pos, 'PO-1'), project_id: job, status: 'Issued', amount: '1000' });
    // The form now carries the link, so a bill can name its PO
    await insertParsed('owner', pays, { ...blankForm(pays, 'Westburne 88123'), project_id: job, status: 'Approved', amount: '1000', purchase_order_id: po.id });
    const sources = [...walk('app'), ...walk('components')].filter((f) => /\.tsx?$/.test(f) && readFileSync(f, 'utf8').includes('purchase_order_id'));
    const [row] = await t.asSystem<{ actual_material: string; committed: string }>('select actual_material, committed from public.job_costing where project_id = $1', [job]);
    expect({ actual: Number(row.actual_material), committed: Number(row.committed), pagesThatSetTheLink: sources.length > 0 }).toEqual({ actual: 1000, committed: 0, pagesThatSetTheLink: true });
  });

  /**
   * The spec puts LOTO, tailgate and safety sign-offs in the loop the hub shows, and the hub has a "New draw"
   * button. job-cost.ts PROJECT_TABS holds none of them, so a draw made there can't be found from there.
   */
  it('[BUG] the project hub has no tab for its safety records or its draws', () => {
    const tabs = PROJECT_TABS.map((t) => t.slug as string);
    expect(['loto-permits', 'tailgate-logs', 'safety-inspections', 'progress-billing'].filter((slug) => !tabs.includes(slug))).toEqual([]);
  });

  /** signup/page.tsx: after signing up, the card has text and nothing to press. A typo in the address means reloading a page you don't know you can leave. */
  it('[BUG] the "Check your email" screen has no way to resend, fix the address or go back', () => {
    const source = readFileSync('app/(auth)/signup/page.tsx', 'utf8');
    const screen = source.slice(source.indexOf('if (sent)'), source.indexOf('title="Start your free trial"'));
    expect(screen).toContain('Check your email');
    expect(screen).toMatch(/<Link|<Button|<button|footer=/);
  });

  /** "The worker sees this" says the reject box. The only rule on timecards is for approvers, so a reject from last week sits unseen. */
  it('[BUG] nothing tells an electrician their timecard was rejected', () => {
    const forWorker = AUTOMATION_RULES.filter((r) => r.module === 'timecards' && r.minRank === 1);
    expect(forWorker.map((r) => r.key)).not.toEqual([]);
  });
});

function signInAs(role: Role) {
  mocks.result = { status: 'ok', ctx: { supabase: fakeSupabase({}), role, canWrite: false, user: { id: 'u' }, company: { id: 'c', name: 'First', province: 'SK', subscription_status: 'trialing', trial_ends_at: '2020-01-01' } } };
}

const BOARD = {
  week: '2026-11-02',
  today: '2026-11-04',
  project: null,
  partial: false,
  workers: [{ employee_id: null, user_id: 'u', name: 'Sam' }],
  projects: [{ id: 'p1', title: 'Canola' }],
  canEnter: true,
  canApprove: false,
  isCrewLead: false,
  canSeePay: false,
  canExport: false,
  canWrite: true,
};

// Copy that promises what isn't there ------------------------------------------------------------

describe('what the copy promises', () => {
  /**
   * create_company takes the province and nothing reads it for tax or holdback: lib/provinces.ts holds a name
   * and a time zone, default_tax is 5 for everyone. An Ontario contractor's first estimate is under-taxed by 8 points.
   */
  it('[BUG] onboarding says the province sets GST/PST and holdback rules. It sets neither', async () => {
    await t.createCompany('ontario', 'Ontario Electric', 'ON');
    await t.createCompany('sask', 'Sask Electric', 'SK');
    const [on] = await t.as<{ default_tax: string }>('ontario', 'select default_tax from public.companies where id = public.user_company_id()');
    const [sk] = await t.as<{ default_tax: string }>('sask', 'select default_tax from public.companies where id = public.user_company_id()');
    const html = renderToStaticMarkup(createElement(OnboardingForm, { email: 'a@b.ca', invitations: [] }));
    const promised = html.includes('GST/PST and holdback rules');
    expect({ promised, sameTaxEverywhere: Number(on.default_tax) === Number(sk.default_tax) }).not.toEqual({ promised: true, sameTaxEverywhere: true });
  });

  /**
   * default_labour_rate is 0, onboarding doesn't ask, and a new estimate takes it. Labour hours then price at
   * nothing: the printed proposal quotes material only, and the page says nothing. The timecard board warns
   * about the same $0 rate; the estimate that goes to the client doesn't.
   */
  it('[BUG] a first estimate with labour hours and no labour rate quotes the labour for free, with no warning', () => {
    const html = renderToStaticMarkup(
      createElement(EstimateEditor, {
        estimate: { id: 'e1', title: 'First bid', status: 'Draft', labour_rate: 0, markup_percentage: 15, tax_percentage: 5 },
        initialItems: [{ description: 'Pull cable', quantity: 10, unit: 'ea', material_unit_cost: 0, labour_hours_per_unit: 8 }],
        statuses: ['Draft'],
        proposal: null,
        canWrite: true,
      })
    );
    expect(html).toContain('80.00');
    expect(html).toMatch(/no labour rate|labour rate is \$?0|set (a|your) labour rate/i);
  });

  /** Tailwind sizes: this estimates the height of what a phone user taps from the classes that set it. */
  const px = (cls: string): number => {
    const min = /min-h-\[(\d+)px\]/.exec(cls) ?? /(?:^|\s)min-h-(\d+)/.exec(cls);
    const fixed = /(?:^|\s)h-(\d+)(?:\s|$)/.exec(cls);
    if (fixed) return Number(fixed[1]) * 4;
    const py = /(?:^|\s)py-([\d.]+)/.exec(cls);
    const line = /text-xs/.test(cls) ? 16 : /text-sm/.test(cls) ? 20 : 24;
    const height = line + (py ? Number(py[1]) * 8 : 0);
    return min ? Math.max(height, min[0].includes('[') ? Number(min[1]) : Number(min[1]) * 4) : height;
  };
  const tappable = (html: string) => [...html.matchAll(/<(button|a)\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({ text: m[3].replace(/<[^>]+>/g, '').trim(), height: px(m[2]) }));

  /** Sold as "Big 48px touch targets" and "big buttons that work with gloves on". */
  it('[BUG] the buttons an electrician and a foreman actually press are 20 to 36px, on a page that promises 48', () => {
    const promise = renderToStaticMarkup(createElement(PricingView));
    expect(promise).toContain('48px touch targets');
    const card = { id: 'c1', title: 'Job', status: 'Submitted', employee_name: 'Sam', work_date: '2026-11-03', regular_hours: 8, overtime_hours: 0, hourly_cost: null, labour_cost: null } as unknown as Timecard;
    const board = tappable(renderToStaticMarkup(createElement(TimecardBoard, { ...BOARD, cards: [card], canApprove: true, isCrewLead: true })));
    const pad = tappable(renderToStaticMarkup(createElement(SignaturePad, { onChange: () => {} })));
    const shell = tappable(renderToStaticMarkup(createElement(AppShell, { groups: [{ label: 'Field', items: [{ href: '/timecards', label: 'Timecards' }] }], companyName: 'First', userLabel: 'sam', canWrite: true, trialDaysLeft: null, canManageBilling: false, children: null })));
    const small = [...board, ...pad, ...shell].filter((b) => b.height < 44).map((b) => `${b.text} ${b.height}px`);
    expect(small).toEqual([]);
  });

  it('a company whose card is failing is told so, with the fix offered only to those who can make it', () => {
    const shell = (props: object) => renderToStaticMarkup(createElement(AppShell, { groups: [], companyName: 'First', userLabel: 'sam', canWrite: true, trialDaysLeft: null, canManageBilling: true, children: null, ...props }));
    expect(shell({})).not.toContain('payment did not go through');
    expect(shell({ pastDue: true })).toMatch(/payment did not go through[\s\S]*href="\/settings\/billing"/);
    const crew = shell({ pastDue: true, canManageBilling: false });
    expect(crew).toContain('payment did not go through');
    expect(crew).not.toContain('href="/settings/billing"');
    // Once editing has stopped, the read-only notice says it instead
    expect(shell({ pastDue: true, canWrite: false })).not.toContain('payment did not go through');
  });
});

describe('the first form a contractor fills in', () => {
  /** estimates: `client_id` and `client_name` are both labelled Client, and `title` and `project_id` are both labelled Project. */
  it('[BUG] the New Estimate form shows two fields called Client and two called Project', () => {
    const mod = getModule('estimates')!;
    const labels = [mod.titleLabel, ...mod.fields.filter((f) => !f.computed && !f.hidden && !f.legacy).map((f) => f.label)];
    const repeated = labels.filter((label, i) => labels.indexOf(label) !== i);
    expect(repeated).toEqual([]);
  });
});
