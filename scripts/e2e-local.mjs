#!/usr/bin/env node
// End-to-end walk of the money loop against a LOCAL Supabase and a LOCAL running app.
// Real sign-ins, real HTTP routes, real PostgREST, real storage, real mail catcher. No mocks.
//
//   npm run build && npm run start -- -p 3200     (with .env.local pointing at the local stack)
//   npm run e2e:local
//
// It makes its own throwaway companies and logins, then removes them (--keep leaves them there).
// Settings come from the environment, then from .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
//   E2E_APP_URL (default http://127.0.0.1:3200), E2E_MAIL_URL (default http://127.0.0.1:54324)
// It refuses any address that isn't on this computer, and never prints a key.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');

function readSettings() {
  const file = join(ROOT, '.env.local');
  const local = existsSync(file)
    ? Object.fromEntries([...readFileSync(file, 'utf8').matchAll(/^([A-Z_0-9]+)=(.*)$/gm)].map((m) => [m[1], m[2].trim().replace(/^"|"$/g, '')]))
    : {};
  const get = (name, fallback) => process.env[name] || local[name] || fallback;
  const settings = {
    supabase: get('NEXT_PUBLIC_SUPABASE_URL'),
    anon: get('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    service: get('SUPABASE_SERVICE_ROLE_KEY'),
    cron: get('CRON_SECRET'),
    app: get('E2E_APP_URL', 'http://127.0.0.1:3200'),
    mail: get('E2E_MAIL_URL', 'http://127.0.0.1:54324'),
  };
  for (const name of ['supabase', 'anon', 'service', 'cron']) {
    if (!settings[name]) throw new Error(`Missing a setting: ${name}. See the top of this file.`);
  }
  for (const name of ['supabase', 'app', 'mail']) {
    const parsed = new URL(settings[name]);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
      throw new Error(`Refusing to run: ${name} is not a local address (${parsed.hostname}).`);
    }
  }
  return settings;
}

const S = readSettings();
const RUN = randomBytes(4).toString('hex');
const PASSWORD = () => `E2e-${randomBytes(12).toString('hex')}`;
const ZONE = 'America/Regina';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (d) => new Date(Date.parse(`${today}T00:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
const money = (v) => Math.round(Number(v) * 100) / 100;
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(SIGNATURE.split(',')[1], 'base64');

const admin = createClient(S.supabase, S.service, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(S.supabase, S.anon, { auth: { persistSession: false, autoRefreshToken: false } });

// Reporting ---------------------------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    const note = detail === undefined ? '' : ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    failures.push(`${name}${note}`);
    console.log(`  FAIL  ${name}${note}`);
  }
}
const same = (name, actual, expected) => check(name, money(actual) === money(expected), `got ${actual}, expected ${expected}`);
const section = (title) => console.log(`\n${title}`);
/** A step that everything after it needs: stop here if it didn't work. */
function must(what, { status, json }, wanted) {
  if (status !== wanted) throw new Error(`${what}: expected ${wanted}, got ${status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}
function ok(what, { data, error }) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// People ------------------------------------------------------------------------------------------
function sessionCookie(session) {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  const host = new URL(S.supabase).hostname.split('.')[0];
  const parts = [];
  for (let i = 0, n = 0; i < value.length; i += 3180, n++) parts.push(`sb-${host}-auth-token.${n}=${value.slice(i, i + 3180)}`);
  return parts.join('; ');
}

const created = { users: [], companies: [], files: [] };

async function makePerson(tag, name) {
  const email = `e2e-${RUN}-${tag}@tradequote.test`;
  const password = PASSWORD();
  const made = ok(`creating ${tag}`, await admin.auth.admin.createUser({ email, password, email_confirm: true }));
  created.users.push(made.user.id);
  const person = { tag, name, email, password, id: made.user.id, db: anonClient() };
  await signIn(person);
  return person;
}

async function signIn(person) {
  const data = ok(`signing in ${person.tag}`, await person.db.auth.signInWithPassword({ email: person.email, password: person.password }));
  person.cookie = sessionCookie(data.session);
}

async function http(who, method, path, body) {
  const res = await fetch(`${S.app}${path}`, {
    method,
    redirect: 'manual',
    headers: { ...(who ? { cookie: who.cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, headers: res.headers };
}
const GET = (who, path) => http(who, 'GET', path);
const POST = (who, path, body = {}) => http(who, 'POST', path, body);
const PUT = (who, path, body) => http(who, 'PUT', path, body);
const PATCH = (who, path, body) => http(who, 'PATCH', path, body);
const DELETE = (who, path, body) => http(who, 'DELETE', path, body);
const cron = (path, secret = S.cron) => fetch(`${S.app}${path}`, { headers: { authorization: `Bearer ${secret}` } }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

async function main() {
  section('Preflight');
  check('the app answers', (await GET(null, '/api/health')).status === 200);
  check('signed out is refused', (await GET(null, '/api/alerts')).status === 401);

  section('Company and team');
  const owner = await makePerson('owner', 'Olive Owner');
  const pm = await makePerson('pm', 'Pat Manager');
  const foreman = await makePerson('foreman', 'Fred Foreman');
  const electrician = await makePerson('electrician', 'Ellie Electrician');
  const everyone = { owner, pm, foreman, electrician };

  must('creating the company', await POST(owner, '/api/onboarding', { action: 'create', fullName: owner.name, companyName: `E2E Electric ${RUN}`, province: 'SK' }), 200);
  const companyId = ok('reading the company id', await owner.db.from('company_users').select('company_id').eq('user_id', owner.id).single()).company_id;
  created.companies.push(companyId);
  must('company defaults', await PATCH(owner, '/api/company', { default_labour_rate: 95, default_markup: 15, default_tax: 5, default_holdback_pct: 10, overtime_multiplier: 1.5, tax_number: '12345 6789 RT0001' }), 200);
  check('a PM cannot change the company', (await PATCH(pm, '/api/company', { default_tax: 1 })).status >= 400);

  for (const [person, role] of [[pm, 'project_manager'], [foreman, 'foreman'], [electrician, 'electrician']]) {
    const invited = must(`inviting ${person.tag}`, await POST(owner, '/api/team', { email: person.email, role }), 200);
    check(`${person.tag} has an account already, so is told to sign in`, /already have an account/.test(invited.message ?? ''), invited);
    const [invite] = ok('reading the invitation', await person.db.rpc('pending_invitations'));
    must(`${person.tag} accepting`, await POST(person, '/api/onboarding', { action: 'accept', fullName: person.name, token: invite.token }), 200);
  }
  const rival = await makePerson('rival', 'Rita Rival');
  must('rival company', await POST(rival, '/api/onboarding', { action: 'create', fullName: rival.name, companyName: `E2E Rival ${RUN}`, province: 'SK' }), 200);
  const rivalCompany = ok('reading the rival company', await rival.db.from('company_users').select('company_id').eq('user_id', rival.id).single()).company_id;
  created.companies.push(rivalCompany);

  section('Client and employees');
  const client = must('adding a client', await POST(pm, '/api/modules/crm', { title: `Client ${RUN}`, status: 'Active Client', contact_person: 'Sam', email: 'sam@client.test' }), 201).data;
  const addEmployee = (title, email, hourly_cost) => POST(owner, '/api/modules/employees', { title, status: 'Active', email, hourly_cost, trade: 'Journeyperson Electrician' });
  must('adding the electrician', await addEmployee(electrician.name, electrician.email, 60), 201);
  const foremanEmployee = must('adding the foreman', await addEmployee(foreman.name, foreman.email, 80), 201).data;
  check('a PM cannot open the employee list', (await GET(pm, '/api/modules/employees')).status === 403);

  section('Estimate');
  check('an electrician cannot make an estimate', (await POST(electrician, '/api/modules/estimates', { title: 'x', status: 'Draft' })).status === 403);
  check('a foreman cannot make an estimate', (await POST(foreman, '/api/modules/estimates', { title: 'x', status: 'Draft' })).status === 403);
  const estimate = must('making an estimate', await POST(pm, '/api/modules/estimates', {
    title: `Job ${RUN}`, status: 'Draft', client_id: client.id, client_name: client.title, client_address: '1 Plant Rd',
    labour_rate: 100, markup_percentage: 10, tax_percentage: 5, scope: 'Replace the MCC.', terms: 'Net 30.', total_amount: 1,
  }), 201).data;
  must('saving estimate lines', await PUT(pm, `/api/estimates/${estimate.id}/items`, { items: [
    { description: 'MCC', quantity: 1, unit: 'ea', material_unit_cost: 50000, labour_hours_per_unit: 100 },
    { description: 'Cable', quantity: 100, unit: 'm', material_unit_cost: 20, labour_hours_per_unit: 0.5 },
  ] }), 200);
  // Cost 52,000 material + 150 h x 100 = 67,000. +10% = 73,700 before tax. +5% = 77,385.
  const estimateAfter = must('reading the estimate', await GET(pm, `/api/modules/estimates/${estimate.id}`), 200).data;
  same('the total is worked out from the lines, not taken from the client', estimateAfter.total_amount, 77385);

  section('Proposal');
  const proposalId = must('Create proposal', await POST(pm, `/api/estimates/${estimate.id}/convert`), 201).data.id;
  check('clicking Create proposal again gives the same one', must('Create proposal again', await POST(pm, `/api/estimates/${estimate.id}/convert`), 201).data.id === proposalId);
  const proposal = must('reading the proposal', await GET(pm, `/api/modules/proposals/${proposalId}`), 200).data;
  same('the proposal carries the estimate total', proposal.total_amount, 77385);
  check('a proposal starts as a draft, nothing goes out on its own', proposal.status === 'Draft');
  check('no project before it is accepted', (await POST(pm, `/api/proposals/${proposalId}/convert`)).status === 409);
  must('marking it sent', await PUT(pm, `/api/modules/proposals/${proposalId}`, { status: 'Sent' }), 200);
  must('marking it accepted', await PUT(pm, `/api/modules/proposals/${proposalId}`, { status: 'Accepted' }), 200);

  section('Project');
  const projectId = must('Create project', await POST(pm, `/api/proposals/${proposalId}/convert`), 201).data.id;
  check('clicking Create project again gives the same one', must('Create project again', await POST(pm, `/api/proposals/${proposalId}/convert`), 201).data.id === projectId);
  must('starting the job', await PUT(pm, `/api/modules/projects/${projectId}`, { status: 'Active', start_date: day(-20), end_date: day(40) }), 200);
  const project = must('reading the project as PM', await GET(pm, `/api/modules/projects/${projectId}`), 200).data;
  same('the contract is the price before tax', project.contract_value, 73700);
  check('the project is linked back to the client', project.client_id === client.id);
  const wonEstimate = must('reading the estimate again', await GET(pm, `/api/modules/estimates/${estimate.id}`), 200).data;
  check('the estimate is now Won and linked', wonEstimate.status === 'Won' && wonEstimate.project_id === projectId, wonEstimate.status);
  check('an electrician reading the project gets no contract figure', !('contract_value' in must('reading the project as electrician', await GET(electrician, `/api/modules/projects/${projectId}`), 200).data));
  const hidden = await electrician.db.from('projects').select('contract_value').eq('id', projectId);
  check('PostgREST refuses the contract column to an electrician', !!hidden.error, hidden.data);
  const seeded = must('job cost rollup', await GET(pm, `/api/job-costing?project=${projectId}`), 200).data;
  same('the budget starts from the estimate: material', seeded[0].budget_material, 52000);
  same('the budget starts from the estimate: labour at its own rate', seeded[0].budget_labour, 150 * 100);

  section('Timecards');
  const entry = (extra) => ({ employee_id: null, worker_user_id: null, employee_name: null, regular_hours: 8, overtime_hours: 0, ...extra });
  const crew = (rows, date = day(-2)) => ({ work_date: date, project_id: projectId, job: null, notes: null, entries: rows });
  must('electrician enters their time', await POST(electrician, '/api/timecards', crew([entry({ overtime_hours: 2 })])), 201);
  const electricianCards = must('electrician lists cards', await GET(electrician, `/api/modules/timecards?project=${projectId}`), 200).data;
  const ellieCard = electricianCards[0];
  check('the card is theirs, and Submitted', ellieCard?.status === 'Submitted' && ellieCard?.employee_name === electrician.name, ellieCard);

  must('foreman enters his own time', await POST(foreman, '/api/timecards', crew([entry({ worker_user_id: foreman.id, regular_hours: 8 })])), 201);
  check('more than 24 hours is refused', (await POST(foreman, '/api/timecards', crew([entry({ regular_hours: 20, overtime_hours: 5, employee_name: 'Someone' })]))).status === 400);
  check('no hours is refused', (await POST(foreman, '/api/timecards', crew([entry({ regular_hours: 0, employee_name: 'Someone' })]))).status === 400);
  check('a repeat that takes one person past 24 hours in a day is refused', (await POST(electrician, '/api/timecards', crew([entry({ regular_hours: 16 })]))).status >= 400);

  const seenByElectrician = must('electrician lists cards again', await GET(electrician, `/api/modules/timecards?project=${projectId}`), 200).data;
  check('an electrician sees only their own cards', seenByElectrician.length === 1, seenByElectrician.length);
  const crewCards = must('foreman lists cards', await GET(foreman, `/api/modules/timecards?project=${projectId}`), 200).data;
  check('a foreman sees the crew', crewCards.length === 2, crewCards.length);
  const fredCard = crewCards.find((c) => c.employee_name === foreman.name);

  check('electrician self-approve refused at the route', (await POST(electrician, '/api/timecards/decide', { ids: [ellieCard.id], action: 'approve' })).status === 403);
  check('electrician self-approve refused through the edit route', (await PUT(electrician, `/api/timecards/${ellieCard.id}`, { status: 'Approved' })).status >= 400);
  const direct = await electrician.db.from('timecards').update({ status: 'Approved' }).eq('id', ellieCard.id).select('id');
  check('electrician self-approve refused straight at PostgREST', !!direct.error, direct.data);
  const viaRpc = await electrician.db.rpc('decide_timecards', { p_ids: [ellieCard.id], p_action: 'approve', p_reason: null });
  check('electrician self-approve refused through the function', !!viaRpc.error || viaRpc.data?.done === 0, viaRpc.data);
  const stillSubmitted = ok('re-reading the card', await electrician.db.from('timecards').select('status, approved_by').eq('id', ellieCard.id).single());
  check('the card is still Submitted', stillSubmitted.status === 'Submitted' && !stillSubmitted.approved_by, stillSubmitted);

  const ownTry = must('foreman tries to approve his own', await POST(foreman, '/api/timecards/decide', { ids: [fredCard.id], action: 'approve' }), 200);
  check('a foreman cannot approve his own card, and is told why', ownTry.done === 0 && /own/.test(ownTry.skipped?.[0]?.reason ?? ''), ownTry);
  const crewOk = must('foreman approves the crew', await POST(foreman, '/api/timecards/decide', { ids: [ellieCard.id], action: 'approve' }), 200);
  check('a foreman can approve crew time', crewOk.done === 1, crewOk);
  const pmOk = must('PM approves the foreman', await POST(pm, '/api/timecards/decide', { ids: [fredCard.id], action: 'approve' }), 200);
  check('a PM can approve the foreman', pmOk.done === 1, pmOk);
  const approved = ok('reading the approved card', await foreman.db.from('timecards').select('status, approved_by, approved_at').eq('id', ellieCard.id).single());
  check('approved_by is stamped from the session', approved.status === 'Approved' && approved.approved_by === foreman.id && !!approved.approved_at, approved);

  const pay = ok('reading pay as PM', await pm.db.rpc('timecard_pay', { p_ids: [ellieCard.id, fredCard.id] }));
  const payOf = (id) => pay.find((p) => p.id === id);
  same('the electrician: 8 h x 60 + 2 h x 60 x 1.5 frozen at approval', payOf(ellieCard.id)?.labour_cost, 660);
  same('the foreman: 8 h x 80', payOf(fredCard.id)?.labour_cost, 640);
  const payRefused = await foreman.db.rpc('timecard_pay', { p_ids: [ellieCard.id] });
  check('a foreman cannot read pay', !!payRefused.error || (payRefused.data ?? []).length === 0, payRefused.data);
  const payColumn = await pm.db.from('timecards').select('labour_cost').eq('id', ellieCard.id);
  check('the pay column is closed to PostgREST', !!payColumn.error);
  check('an approved card is locked', (await PUT(foreman, `/api/timecards/${ellieCard.id}`, { regular_hours: 1 })).status === 409);
  check('an approved card cannot be deleted', (await DELETE(pm, `/api/modules/timecards/${ellieCard.id}`)).status === 409);
  must('raising the foreman\'s rate afterwards', await PUT(owner, `/api/modules/employees/${foremanEmployee.id}`, { hourly_cost: 500 }), 200);
  const frozen = ok('re-reading pay', await pm.db.rpc('timecard_pay', { p_ids: [fredCard.id] }));
  same('the frozen rate does not move', frozen[0]?.labour_cost, 640);
  must('putting the rate back', await PUT(owner, `/api/modules/employees/${foremanEmployee.id}`, { hourly_cost: 80 }), 200);

  section('Change order');
  check('a foreman cannot write a change order', (await POST(foreman, '/api/modules/change-orders', { title: 'x', status: 'Draft', project_id: projectId })).status === 403);
  const co = must('writing a change order', await POST(pm, '/api/modules/change-orders', {
    title: `Extra tray ${RUN}`, status: 'Draft', project_id: projectId, material_cost: 1000, labour_hours: 10, labour_rate: 100, markup_pct: 10, tax_pct: 5, days_impact: 2, price: 999999, total: 999999,
  }), 201).data;
  // 1000 + 10 x 100 = 2000, +10% = 2200 price, +5% = 2310. Cost side: 1000 + 10 x 95 = 1950.
  same('the price is worked out, not taken from the client', co.price, 2200);
  same('the total is worked out', co.total, 2310);
  same('the budget cost uses the company labour rate', co.budget_cost, 1950);
  check('it gets a number from the company counter', Number(co.co_number) >= 1, co.co_number);
  const approveBody = { action: 'approve', approved_by: 'Sam Client', signature: SIGNATURE };
  check('a draft cannot jump to approved', (await PUT(pm, `/api/change-orders/${co.id}`, approveBody)).status === 409);
  must('sending it', await PUT(pm, `/api/modules/change-orders/${co.id}`, { status: 'Sent' }), 200);
  check('approval needs a signature', (await PUT(pm, `/api/change-orders/${co.id}`, { action: 'approve', approved_by: 'Sam' })).status === 400);
  check('Approved cannot be picked as a plain status', (await PUT(pm, `/api/modules/change-orders/${co.id}`, { status: 'Approved' })).status === 400);
  must('approving it with a signature', await PUT(pm, `/api/change-orders/${co.id}`, approveBody), 200);
  const projectAfterCo = must('reading the project', await GET(pm, `/api/modules/projects/${projectId}`), 200).data;
  same('approved changes on the project', projectAfterCo.approved_changes, 2200);
  same('revised contract', projectAfterCo.revised_contract, 75900);
  check('the end date moves by the approved days', projectAfterCo.revised_end_date === day(42), projectAfterCo.revised_end_date);
  check('an approved change order is locked', (await PUT(pm, `/api/modules/change-orders/${co.id}`, { material_cost: 1 })).status === 409);
  check('an approved change order cannot be deleted', (await DELETE(pm, `/api/modules/change-orders/${co.id}`)).status === 409);
  const foremanCo = must('foreman reads the change order', await GET(foreman, `/api/modules/change-orders/${co.id}`), 200).data;
  check('a foreman sees no price on it', foremanCo.price === undefined && foremanCo.material_cost === undefined, foremanCo.price);

  section('Other costs on the job');
  const po = must('issuing a PO', await POST(pm, '/api/modules/purchase-orders', { title: `PO ${RUN}`, status: 'Issued', project_id: projectId, vendor: 'Supplier', amount: 3000, required_date: day(-3) }), 201).data;
  must('approved bill', await POST(owner, '/api/modules/payables', { title: `Bill ${RUN}`, status: 'Approved', project_id: projectId, vendor: 'Supplier', amount: 500, due_date: day(5) }), 201);
  must('unapproved bill', await POST(owner, '/api/modules/payables', { title: `Bill 2 ${RUN}`, status: 'To Approve', project_id: projectId, vendor: 'Supplier', amount: 7777, due_date: day(5) }), 201);
  check('a PM cannot add a bill', (await POST(pm, '/api/modules/payables', { title: 'x', status: 'Approved', project_id: projectId, amount: 1 })).status === 403);

  section('Invoice');
  check('a PM cannot start an invoice', (await POST(pm, `/api/projects/${projectId}/invoice`)).status === 403);
  const invoiceId = must('New invoice on the project', await POST(owner, `/api/projects/${projectId}/invoice`), 201).data.id;
  check('clicking New invoice again gives the same draft', must('New invoice again', await POST(owner, `/api/projects/${projectId}/invoice`), 201).data.id === invoiceId);
  const fresh = must('reading the draft', await GET(owner, `/api/invoices/${invoiceId}`), 200).data;
  check('it starts as a draft', fresh.status === 'Draft');
  check('numbers start at 1001', Number(fresh.invoice_number) === 1001, fresh.invoice_number);
  same('it opens with the balance of the contract', fresh.lines?.[0]?.amount, 75900);
  const saved = must('pricing the invoice', await PUT(owner, `/api/invoices/${invoiceId}`, {
    tax_pct: 5, holdback_pct: 10, issue_date: day(-1), due_date: day(29), amount: 1, total: 1,
    lines: [
      { type: 'percent', percent: 25, description: 'Progress to date' },
      { type: 'change_order', change_order_id: co.id },
      { type: 'free', description: 'Permit fee', amount: 100 },
    ],
  }), 200).data;
  // A percent bills the original contract: the change order has its own line, so it isn't billed twice
  const percentLine = saved.lines.find((l) => l.type === 'percent');
  const coLine = saved.lines.find((l) => l.type === 'change_order');
  same('the percent line is priced by the database, on the original contract', percentLine.amount, 18425);
  same('the change order line is priced by the database', coLine.amount, 2200);
  const subtotal = money(Number(percentLine.amount) + 2200 + 100);
  same('subtotal', saved.amount, subtotal);
  same('tax', saved.gst, money(subtotal * 0.05));
  same('holdback comes off the pre-tax amount', saved.holdback_amount, money(subtotal * 0.1));
  same('total due', saved.total, money(subtotal + money(subtotal * 0.05) - money(subtotal * 0.1)));
  check('Draft cannot jump to Paid', (await PUT(owner, `/api/modules/invoices/${invoiceId}`, { status: 'Paid' })).status === 409);
  check('Overdue cannot be picked by hand', (await PUT(owner, `/api/modules/invoices/${invoiceId}`, { status: 'Overdue' })).status === 400);
  must('sending the invoice', await PUT(owner, `/api/modules/invoices/${invoiceId}`, { status: 'Sent' }), 200);
  check('a sent invoice cannot be edited', (await PUT(owner, `/api/invoices/${invoiceId}`, { lines: [{ type: 'free', description: 'x', amount: 1 }] })).status === 409);
  check('a sent invoice cannot be deleted', (await DELETE(owner, `/api/modules/invoices/${invoiceId}`)).status === 409);
  const receivable = (await GET(owner, `/api/modules/receivables?project=${projectId}`)).json.data?.find((r) => r.invoice_id === invoiceId);
  check('sending made a receivable', !!receivable && receivable.status === 'Current', receivable);
  same('the receivable is what is due', receivable?.amount, saved.total);
  const coAfter = must('reading the change order', await GET(pm, `/api/modules/change-orders/${co.id}`), 200).data;
  check('the change order points at its invoice', coAfter.invoice_id === invoiceId, coAfter.invoice_id);
  check('a billed change order cannot be reopened', (await PUT(pm, `/api/change-orders/${co.id}`, { action: 'reopen' })).status === 409);
  const twice = must('a second draft', await POST(owner, '/api/modules/invoices', { title: `Second ${RUN}`, status: 'Draft', project_id: projectId }), 201).data;
  check('the same change order cannot go on two invoices', (await PUT(owner, `/api/invoices/${twice.id}`, { lines: [{ type: 'change_order', change_order_id: co.id }] })).status >= 400);
  check('a draft can be deleted', (await DELETE(owner, `/api/modules/invoices/${twice.id}`)).status === 200);
  check('an invoice cannot be read below admin', (await GET(pm, `/api/invoices/${invoiceId}`)).status === 403);

  must('recording the payment', await PUT(owner, `/api/modules/invoices/${invoiceId}`, { status: 'Paid' }), 200);
  const collected = (await GET(owner, `/api/modules/receivables?project=${projectId}`)).json.data?.find((r) => r.invoice_id === invoiceId);
  check('paid marks the receivable Collected', collected?.status === 'Collected', collected?.status);
  must('undoing the payment', await PUT(owner, `/api/modules/invoices/${invoiceId}`, { status: 'Sent' }), 200);
  const reversed = (await GET(owner, `/api/modules/receivables?project=${projectId}`)).json.data?.find((r) => r.invoice_id === invoiceId);
  check('undoing puts the receivable back', reversed?.status === 'Current', reversed?.status);
  must('recording it again', await PUT(owner, `/api/modules/invoices/${invoiceId}`, { status: 'Paid' }), 200);

  section('Job cost rollup');
  check('a foreman cannot open job cost', (await GET(foreman, `/api/job-costing?project=${projectId}`)).status === 403);
  check('an electrician cannot open job cost', (await GET(electrician, `/api/job-costing?project=${projectId}`)).status === 403);
  const directRollup = await foreman.db.rpc('job_cost_rollup', { p_project: projectId });
  check('the function refuses a foreman too', !!directRollup.error || (directRollup.data ?? []).length === 0, directRollup.data);
  must('setting the budget', await PATCH(pm, `/api/job-costing/${projectId}`, { hours: 15, labour: 1000, material: 500, other: 0 }), 200);
  const rollup = async () => must('job cost rollup', await GET(pm, `/api/job-costing?project=${projectId}`), 200).data[0];
  let job = await rollup();
  same('actual labour hours count approved cards, overtime included', job.actual_labour_hours, 18);
  same('actual labour is the frozen cost', job.actual_labour, 1300);
  same('actual material counts the approved bill only', job.actual_material, 500);
  same('committed is the unmatched PO', job.committed, 3000);
  same('change order revenue', job.co_revenue, 2200);
  same('change order cost', job.co_cost, 1950);
  same('budget includes the change order cost', job.budget, 3450);
  same('actual cost', job.actual_cost, 1800);
  same('billed', job.billed_amount, subtotal);
  same('paid is the pre-tax amount less holdback, like billed', job.paid_amount, money(saved.amount - saved.holdback_amount));
  check('52% of budget is On Track', job.status === 'On Track', job.status);
  must('adding a cost', await POST(pm, `/api/job-costing/${projectId}/entries`, { category: 'Equipment', description: 'Lift', amount: 1200, entry_date: day(-1) }), 201);
  job = await rollup();
  check('87% of budget is At Risk', job.status === 'At Risk', `${job.status} ${job.actual_cost}/${job.budget}`);
  must('adding another cost', await POST(pm, `/api/job-costing/${projectId}/entries`, { category: 'Other', description: 'Crane', amount: 600, entry_date: day(-1) }), 201);
  job = await rollup();
  check('over 100% is Over Budget', job.status === 'Over Budget', `${job.status} ${job.actual_cost}/${job.budget}`);
  must('closing the job', await PATCH(pm, `/api/job-costing/${projectId}`, { closed: true }), 200);
  must('a cost after closing', await POST(pm, `/api/job-costing/${projectId}/entries`, { category: 'Other', description: 'Late bill', amount: 1, entry_date: day(-1) }), 201);
  job = await rollup();
  check('Closed never changes on its own', job.status === 'Closed', job.status);
  must('reopening the job', await PATCH(pm, `/api/job-costing/${projectId}`, { closed: false }), 200);
  job = await rollup();
  check('reopening works the status out again', job.status === 'Over Budget', job.status);

  section('LOTO');
  const loto = must('electrician starts a permit', await POST(electrician, '/api/modules/loto-permits', { title: `LOTO ${RUN}`, status: 'Draft', project_id: projectId, equipment_isolated: 'MCC-3', authorized_person: electrician.name }), 201).data;
  const lotoPath = `/api/records/loto-permits/${loto.id}`;
  const sign = (who, slot) => PUT(who, lotoPath, { action: 'sign', slot, name: who.name, signature: SIGNATURE });
  check('lock-off before anything is refused', (await sign(electrician, 'lock_off')).status === 409);
  check('verified before lock-on is refused', (await sign(foreman, 'verified')).status === 409);
  const missing = await sign(electrician, 'lock_on');
  check('lock-on needs the fields filled in', missing.status === 409 && /Lock #|Date|Isolation|Energy/i.test(missing.json.error ?? ''), missing.json);
  must('filling in the permit', await PUT(electrician, lotoPath, { action: 'save', fields: { lock_number: 'L-1', record_date: day(0), isolation_points: 'Breaker 12' }, checklists: { energy_sources: ['Electrical'] } }), 200);
  check('status cannot be set by hand', (await PUT(electrician, `/api/modules/loto-permits/${loto.id}`, { status: 'Released' })).status === 400);
  must('lock-on', await sign(electrician, 'lock_on'), 200);
  const lockedOut = must('reading the permit', await GET(electrician, `/api/modules/loto-permits/${loto.id}`), 200).data;
  check('lock-on puts it in Locked Out', lockedOut.status === 'Locked Out', lockedOut.status);
  check('lock-off before verification is refused', (await sign(electrician, 'lock_off')).status === 409);
  check('verification needs the method', (await sign(foreman, 'verified')).status === 409);

  section('Photos on real storage');
  const folder = `${companyId}/loto-permits/${loto.id}/`;
  const storage = (who) => who.db.storage.from('job-photos');
  const put = (who, path, type = 'image/png') => storage(who).upload(path, PNG, { contentType: type });
  const mine = `${folder}electrician-${RUN}.png`;
  const his = `${folder}foreman-${RUN}.png`;
  created.files.push(mine, his);
  check('crew can add a photo to an open record', !(await put(electrician, mine)).error);
  check('a foreman can add a photo', !(await put(foreman, his)).error);
  check('another company cannot write to this folder', !!(await put(rival, `${folder}rival.png`)).error);
  check('a file that is not an image is refused', !!(await put(electrician, `${folder}notes.txt`, 'text/plain')).error);
  const otherFolder = `${rivalCompany}/loto-permits/${loto.id}/x.png`;
  check('nobody can write to another company\'s folder', !!(await put(electrician, otherFolder)).error);
  must('saving the photos on the record', await PUT(electrician, lotoPath, { action: 'photos', photos: [mine, his] }), 200);
  check('a photo path from outside the folder is refused', (await PUT(electrician, lotoPath, { action: 'photos', photos: [`${rivalCompany}/x.png`] })).status === 400);
  const signed = ok('signing a URL as the owner', await storage(owner).createSignedUrl(his, 60));
  check('the signed link downloads the file', (await fetch(signed.signedUrl)).status === 200);
  const rivalSign = await storage(rival).createSignedUrl(his, 60);
  check('another company cannot get a link to it', !!rivalSign.error);
  const crewRemoval = await PUT(electrician, lotoPath, { action: 'photos', photos: [mine] });
  check('crew cannot take someone else\'s photo off the record', crewRemoval.status === 409, crewRemoval.json);
  const crewDelete = await storage(electrician).remove([his]);
  check('crew cannot delete someone else\'s file', (crewDelete.data ?? []).length === 0, crewDelete.data);
  check('that file is still there', (ok('listing', await storage(owner).list(folder.slice(0, -1))) ?? []).some((f) => his.endsWith(f.name)));
  must('crew takes their own photo off', await PUT(electrician, lotoPath, { action: 'photos', photos: [his] }), 200);
  const ownDelete = await storage(electrician).remove([mine]);
  check('crew can delete their own file', (ownDelete.data ?? []).length === 1, ownDelete);
  const keepPhoto = `${folder}keep-${RUN}.png`;
  created.files.push(keepPhoto);
  check('foreman adds one more', !(await put(foreman, keepPhoto)).error);
  must('foreman saves both', await PUT(foreman, lotoPath, { action: 'photos', photos: [his, keepPhoto] }), 200);
  must('foreman removes one off the record', await PUT(foreman, lotoPath, { action: 'photos', photos: [keepPhoto] }), 200);
  check('a foreman can delete anyone\'s file', (ok('foreman delete', await storage(foreman).remove([his])) ?? []).length === 1);

  section('LOTO sign-off and lock');
  must('recording the verification', await PUT(foreman, lotoPath, { action: 'save', fields: { verification_method: 'Meter, try-start' } }), 200);
  must('verified', await sign(foreman, 'verified'), 200);
  check('verified signing again out of order is refused', (await sign(foreman, 'verified')).status === 409);
  must('release notes', await PUT(electrician, lotoPath, { action: 'save', fields: { release_notes: 'Done, clear.' } }), 200);
  must('lock-off', await sign(electrician, 'lock_off'), 200);
  const released = must('reading the permit', await GET(electrician, `/api/modules/loto-permits/${loto.id}`), 200).data;
  check('final sign-off releases it', released.status === 'Released', released.status);
  check('three signatures, in order', (released.signatures ?? []).map((s) => s.slot).join() === 'lock_on,verified,lock_off', released.signatures?.map((s) => s.slot));
  check('a signed permit is locked', (await PUT(electrician, lotoPath, { action: 'save', fields: { lock_number: 'L-2' } })).status === 409);
  check('a signed permit cannot be deleted, even by the owner', (await DELETE(owner, `/api/modules/loto-permits/${loto.id}`)).status === 409);
  check('no new photo on a signed permit', !!(await put(foreman, `${folder}late.png`)).error);
  const lockedDelete = await storage(owner).remove([keepPhoto]);
  check('no deleting a photo from a signed permit, even as owner', (lockedDelete.data ?? []).length === 0, lockedDelete.data);
  check('an electrician cannot reopen it', (await PUT(electrician, lotoPath, { action: 'reopen', reason: 'Oops' })).status === 403);
  check('a foreman cannot reopen it', (await PUT(foreman, lotoPath, { action: 'reopen', reason: 'Oops' })).status === 403);
  must('a PM reopens it with a reason', await PUT(pm, lotoPath, { action: 'reopen', reason: 'Wrong lock number', slot: 'lock_off' }), 200);
  const reopened = must('reading the permit', await GET(pm, `/api/modules/loto-permits/${loto.id}`), 200).data;
  check('reopen steps back one sign-off and keeps the history', reopened.status === 'Verified Zero Energy' && reopened.reopen_log?.length === 1, reopened.status);
  must('signing it off again', await sign(electrician, 'lock_off'), 200);

  section('Daily log photos');
  const log = must('foreman starts a daily log', await POST(foreman, '/api/modules/daily-logs', { title: `Log ${RUN}`, status: 'Draft', project_id: projectId, log_date: day(0) }), 201).data;
  const logFile = `${companyId}/daily-logs/${log.id}/one-${RUN}.png`;
  created.files.push(logFile);
  check('a photo goes on an open log', !(await put(electrician, logFile)).error);
  must('saving it on the log', await PUT(foreman, `/api/daily-logs/${log.id}`, { action: 'photos', photos: [logFile] }), 200);
  must('signing the log', await PUT(foreman, `/api/daily-logs/${log.id}`, { action: 'sign', signed_by: foreman.name, signature: SIGNATURE }), 200);
  check('no new photo on a signed log', !!(await put(foreman, `${companyId}/daily-logs/${log.id}/two.png`)).error);
  check('no deleting a photo from a signed log', (ok('removing', await storage(foreman).remove([logFile])) ?? []).length === 0);

  section('Daily automation');
  // Work that is late, seen at different levels
  const overdueInvoice = must('an old invoice', await POST(owner, '/api/modules/invoices', { title: `Old ${RUN}`, status: 'Draft', project_id: projectId }), 201).data;
  must('pricing the old invoice', await PUT(owner, `/api/invoices/${overdueInvoice.id}`, { issue_date: day(-40), due_date: day(-10), lines: [{ type: 'free', description: 'Old work', amount: 100 }] }), 200);
  must('sending the old invoice', await PUT(owner, `/api/modules/invoices/${overdueInvoice.id}`, { status: 'Sent' }), 200);
  const rfi = must('a late RFI', await POST(foreman, '/api/modules/rfis', { title: `RFI ${RUN}`, status: 'Open', project_id: projectId, due_date: day(-3) }), 201).data;
  const sub = must('a sub with lapsed insurance', await POST(pm, '/api/modules/sub-compliance', { title: `Sub ${RUN}`, status: 'Compliant', liability_expiry: day(-5), wcb_clearance_expiry: day(40), safety_cert_verified: true }), 201).data;

  check('the cron refuses no secret', (await fetch(`${S.app}/api/cron/automation`)).status === 401);
  check('the cron refuses a wrong secret', (await cron('/api/cron/automation', 'wrong')).status === 401);
  const snapshot = async () => ({
    alerts: ok('alerts', await admin.from('alerts').select('id, rule_key, record_id, bucket, updated_at, resolved_at, bucket_changed_at').eq('company_id', companyId).order('id')),
    invoices: ok('invoices', await admin.from('invoices').select('id, status, updated_at').eq('company_id', companyId).order('id')),
    receivables: ok('receivables', await admin.from('receivables').select('id, status, updated_at').eq('company_id', companyId).order('id')),
    subs: ok('subs', await admin.from('sub_compliance').select('id, status, updated_at').eq('company_id', companyId).order('id')),
  });

  const first = must('first automation run', await cron('/api/cron/automation'), 200);
  check('the first run did work and failed nowhere', first.failed === 0 && first.raised > 0 && first.flips > 0, first);
  check('it survives having no email configured', first.emailConfigured === false || first.immediate !== undefined, first);
  const afterFirst = await snapshot();
  check('the late invoice flipped to Overdue', afterFirst.invoices.find((i) => i.id === overdueInvoice.id)?.status === 'Overdue');
  const stateRow = ok('run state', await admin.from('automation_company_state').select('last_run_date').eq('company_id', companyId).maybeSingle());
  check('the run recorded today for this company', stateRow?.last_run_date === today, stateRow);

  const second = must('second automation run', await cron('/api/cron/automation'), 200);
  check('the second run changes nothing', second.flips === 0 && second.raised === 0 && second.changed === 0 && second.resolved === 0 && second.failed === 0, second);
  check('the second run saw this company as already done', second.alreadyRun >= 1 && second.alreadyRun === second.checked - second.skippedLocked, second);
  const afterSecond = await snapshot();
  check('the database is identical after the second run', JSON.stringify(afterFirst) === JSON.stringify(afterSecond));
  const forced = ok('running the company function again', await admin.rpc('run_company_automation', { p_company: companyId, p_today: today }));
  check('even forced, the same date changes nothing', forced.flips === 0 && forced.raised === 0 && forced.changed === 0 && forced.resolved === 0, forced);
  check('still identical after the forced run', JSON.stringify(afterFirst) === JSON.stringify(await snapshot()));

  const jobCosts1 = must('job cost cron', await cron('/api/cron/job-costs'), 200);
  check('job cost cron had no failures', jobCosts1.failed === 0, jobCosts1);
  const jobCosts2 = must('job cost cron again', await cron('/api/cron/job-costs'), 200);
  check('job cost cron changes nothing the second time', jobCosts2.changed === 0, jobCosts2);
  const digest = must('digest cron', await cron('/api/cron/digest'), 200);
  check('digest skips cleanly with no email configured', digest.notConfigured === true || digest.failed === 0, digest);
  const status = await cron('/api/cron/status');
  check('the health check answers', [200, 503].includes(status.status) && status.json?.healthy !== undefined, status);

  section('Alerts per role');
  const alertsFor = async (who) => must(`alerts for ${who.tag}`, await GET(who, '/api/alerts'), 200).data ?? [];
  const has = (rows, key, id) => rows.some((a) => a.rule_key === key && a.record_id === id);
  const seen = {};
  for (const [tag, who] of Object.entries(everyone)) seen[tag] = await alertsFor(who);
  check('electrician sees the late RFI', has(seen.electrician, 'rfis.due', rfi.id));
  check('electrician does not see sub insurance', !has(seen.electrician, 'sub_compliance.liability', sub.id));
  check('electrician does not see the late PO', !has(seen.electrician, 'purchase_orders.required', po.id));
  check('electrician does not see the overdue invoice', !has(seen.electrician, 'invoices.due', overdueInvoice.id));
  check('foreman sees sub insurance', has(seen.foreman, 'sub_compliance.liability', sub.id));
  check('foreman does not see the late PO', !has(seen.foreman, 'purchase_orders.required', po.id));
  check('foreman does not see the overdue invoice', !has(seen.foreman, 'invoices.due', overdueInvoice.id));
  check('PM sees the late PO', has(seen.pm, 'purchase_orders.required', po.id));
  check('PM does not see the overdue invoice', !has(seen.pm, 'invoices.due', overdueInvoice.id));
  check('owner sees the overdue invoice', has(seen.owner, 'invoices.due', overdueInvoice.id));
  check('owner sees everything below', has(seen.owner, 'rfis.due', rfi.id) && has(seen.owner, 'purchase_orders.required', po.id));
  const rawAlerts = ok('reading alerts straight from PostgREST', await electrician.db.from('alerts').select('rule_key'));
  check('row security holds the same line at PostgREST', !rawAlerts.some((a) => a.rule_key === 'invoices.due'), rawAlerts);
  check('another company sees none of it', (await alertsFor(rival)).length === 0);

  section('Another company, and a lapsed one');
  check('no reading across companies', (await GET(rival, `/api/modules/projects/${projectId}`)).status === 404);
  check('no listing across companies', must('rival list', await GET(rival, '/api/modules/projects'), 200).data.length === 0);
  const crossWrite = await rival.db.from('projects').update({ title: 'hacked' }).eq('id', projectId).select('id');
  check('no writing across companies', (crossWrite.data ?? []).length === 0, crossWrite.data);
  check('no converting across companies', (await POST(rival, `/api/projects/${projectId}/invoice`)).status >= 400);
  ok('lapsing the rival', await admin.from('companies').update({ subscription_status: 'trialing', trial_ends_at: new Date(Date.now() - 864e5).toISOString() }).eq('id', rivalCompany));
  const lapsedCreate = await POST(rival, '/api/modules/crm', { title: 'x', status: 'Lead' });
  check('a lapsed company is read-only at the route', lapsedCreate.status === 402, lapsedCreate.json);
  check('a lapsed company still reads', (await GET(rival, '/api/modules/crm')).status === 200);
  const lapsedWrite = await rival.db.from('crm').insert({ title: 'x', status: 'Lead' }).select('id');
  check('a lapsed company is read-only at PostgREST', !!lapsedWrite.error, lapsedWrite.data);

  section('Invite flow');
  await inviteFlow({ owner, pm, companyId });

  // The rival was lapsed above. Put it back so the checks below are about the company line, not the lapse.
  ok('restoring the rival', await admin.from('companies').update({ trial_ends_at: new Date(Date.now() + 7 * 864e5).toISOString() }).eq('id', rivalCompany));

  section('Search');
  const search = async (who, q) => must(`searching for ${q}`, await GET(who, `/api/search?q=${encodeURIComponent(q)}`), 200).groups;
  const hasHit = (groups, slug, id) => groups.some((g) => g.slug === slug && g.hits.some((h) => h.id === id));
  check('signed out cannot search', (await GET(null, '/api/search?q=client')).status === 401);
  const byName = await search(pm, `client ${RUN}`);
  check('search finds the client by name, whatever the capitals', hasHit(byName, 'crm', client.id), byName);
  check('the same search finds the estimate through its client name', hasHit(byName, 'estimates', estimate.id), byName.map((g) => g.slug));
  check('search finds a client by their email', hasHit(await search(pm, 'sam@client.test'), 'crm', client.id));
  const jobHits = await search(pm, `Job ${RUN}`);
  check('search finds the estimate by title and links to its page', jobHits.some((g) => g.slug === 'estimates' && g.hits.some((h) => h.href === `/estimates/${estimate.id}`)), jobHits);
  const crewHits = await search(electrician, `${RUN}`);
  check('an electrician never gets clients, quotes or invoices back', crewHits.every((g) => !['crm', 'estimates', 'proposals', 'invoices'].includes(g.slug)), crewHits.map((g) => g.slug));
  check('another company finds none of it', (await search(rival, `${RUN}`)).every((g) => g.hits.every((h) => !h.title.includes(`Job ${RUN}`) && h.id !== client.id)));
  check('a percent sign is searched for, not treated as "everything"', (await search(pm, '%%')).length === 0);
  check('one letter is too short to search', (await search(pm, 'a')).length === 0);

  section('Assemblies');
  const boxLine = { description: 'Device box', quantity: 2, unit: 'ea', material_unit_cost: 4, labour_hours_per_unit: 0.25 };
  const wireLine = { description: '#12 wire', quantity: 30, unit: 'm', material_unit_cost: 1.25, labour_hours_per_unit: 0.02 };
  check('a foreman cannot open the assembly library', (await GET(foreman, '/api/assemblies')).status === 403);
  must('loading the starter assemblies', await POST(pm, '/api/assemblies/starters'), 201);
  check('the starters only load into an empty library', (await POST(pm, '/api/assemblies/starters')).status === 409);
  const library = must('listing assemblies', await GET(pm, '/api/assemblies'), 200).data;
  check('the library comes back with every assembly and its lines', library.length >= 8 && library.every((a) => a.lines.length > 0 && a.lines.every((l) => 'material_unit_cost' in l && !('sort' in l))), library.length);
  const kit = must('saving an assembly', await POST(pm, '/api/assemblies', { name: `Kit ${RUN}`, category: 'Test', lines: [boxLine] }), 201).data;
  check('a second assembly with the same name is refused, whatever the capitals', (await POST(pm, '/api/assemblies', { name: `KIT ${RUN}`, lines: [boxLine] })).status === 409);
  check('an assembly with no lines is refused', (await POST(pm, '/api/assemblies', { name: `Empty ${RUN}`, lines: [] })).status === 400);
  must('editing the assembly', await PUT(pm, `/api/assemblies/${kit.id}`, { name: `Kit ${RUN} v2`, category: 'Test', lines: [wireLine, boxLine] }), 200);
  const edited = must('listing assemblies again', await GET(pm, '/api/assemblies'), 200).data.find((a) => a.id === kit.id);
  check('the edit replaced the name and the lines, in order', edited?.name === `Kit ${RUN} v2` && edited.lines.map((l) => l.description).join('|') === '#12 wire|Device box', edited);
  check('another company sees an empty library', must('rival library', await GET(rival, '/api/assemblies'), 200).data.length === 0);
  check('another company cannot change or delete it', (await PUT(rival, `/api/assemblies/${kit.id}`, { name: 'Stolen', lines: [boxLine] })).status === 404 && (await DELETE(rival, `/api/assemblies/${kit.id}`)).status === 404);
  must('deleting the assembly', await DELETE(pm, `/api/assemblies/${kit.id}`), 200);
  check('it is gone', !must('listing after delete', await GET(pm, '/api/assemblies'), 200).data.some((a) => a.id === kit.id));

  section('Client portal');
  // A new proposal: the one above is accepted and already has its project
  const offer = must('writing a proposal to share', await POST(pm, '/api/modules/proposals', {
    title: `Offer ${RUN}`, status: 'Draft', client_id: client.id, client_name: client.title, total_amount: 4200, scope_of_work: 'Add two receptacles.', notes: 'INTERNAL margin note',
  }), 201).data;
  const share = (who) => POST(who, `/api/proposals/${offer.id}/share`);
  const answer = (token, body) => POST(null, `/api/portal/${token}`, body);
  const tokenOf = (url) => new URL(url).pathname.split('/')[2];
  check('a draft cannot be shared', (await share(pm)).status === 409);
  must('marking the offer sent', await PUT(pm, `/api/modules/proposals/${offer.id}`, { status: 'Sent' }), 200);
  check('a foreman cannot share it', (await share(foreman)).status === 403);
  check('another company cannot share it', (await share(rival)).status === 404);
  check('no link yet', must('link status', await GET(pm, `/api/proposals/${offer.id}/share`), 200).data.status === 'none');
  const firstLink = must('sharing with the client', await share(pm), 201).data.url;
  check('the link is a long random token on the portal', /^\/portal\/[A-Za-z0-9_-]{43}$/.test(new URL(firstLink).pathname), firstLink.slice(0, 40));
  const firstToken = tokenOf(firstLink);
  const stored = ok('reading the stored link', await admin.from('proposal_shares').select('token_hash').eq('proposal_id', offer.id));
  check('only a hash of the token is stored', stored.length === 1 && /^[0-9a-f]{64}$/.test(stored[0].token_hash) && !stored[0].token_hash.includes(firstToken));
  check('the link is live and unopened', must('link status', await GET(pm, `/api/proposals/${offer.id}/share`), 200).data.status === 'live');

  const portalPage = await fetch(`${S.app}/portal/${firstToken}`, { redirect: 'manual' });
  const portalHtml = await portalPage.text();
  check('the client opens it with no login', portalPage.status === 200 && portalHtml.includes(`Offer ${RUN}`) && portalHtml.includes('Add two receptacles.'), portalPage.status);
  check('the client sees the price and none of the internal notes', portalHtml.includes('4,200') && !portalHtml.includes('INTERNAL'));
  check('the page is kept out of search engines', /noindex/.test(portalHtml));
  check('the contractor sees the client opened it', must('link status', await GET(pm, `/api/proposals/${offer.id}/share`), 200).data.status === 'viewed');

  const madeUp = 'A'.repeat(43);
  check('a made-up link shows nothing', !(await (await fetch(`${S.app}/portal/${madeUp}`)).text()).includes(`Offer ${RUN}`));
  check('a made-up link cannot answer', (await answer(madeUp, { decision: 'declined' })).status === 404);
  check('a link that is not a token is refused', (await answer('short', { decision: 'declined' })).status === 404);
  check('accepting needs a signature', (await answer(firstToken, { decision: 'accepted', name: 'Sam Client' })).status === 400);
  check('accepting needs a name', (await answer(firstToken, { decision: 'accepted', name: ' ', signature: SIGNATURE })).status === 400);
  const tokenHash = stored[0].token_hash;
  const directAnon = await anonClient().rpc('portal_view', { p_token_hash: tokenHash });
  const directUser = await pm.db.rpc('portal_decide', { p_token_hash: tokenHash, p_decision: 'accepted', p_name: 'Pat', p_signature: SIGNATURE, p_reason: null, p_ip: null, p_agent: null });
  check('the database refuses the portal functions to the public key and to signed-in users', !!directAnon.error && !!directUser.error, [directAnon.data, directUser.data]);
  const directTable = await anonClient().from('proposal_shares').select('token_hash');
  check('the public key cannot read the links', !!directTable.error || (directTable.data ?? []).length === 0, directTable.data);

  const secondToken = tokenOf(must('making a new link', await share(pm), 201).data.url);
  check('making a new link turns the old one off', (await answer(firstToken, { decision: 'accepted', name: 'Sam Client', signature: SIGNATURE })).status === 409);
  check('the old link no longer shows the proposal', !(await (await fetch(`${S.app}/portal/${firstToken}`)).text()).includes('Add two receptacles.'));
  must('the client accepts and signs', await answer(secondToken, { decision: 'accepted', name: 'Sam Client', signature: SIGNATURE }), 200);
  check('the proposal is now accepted', must('reading the offer', await GET(pm, `/api/modules/proposals/${offer.id}`), 200).data.status === 'Accepted');
  const signedLink = must('link status', await GET(pm, `/api/proposals/${offer.id}/share`), 200).data;
  check('the contractor sees who signed and when', signedLink.status === 'accepted' && signedLink.share.signer_name === 'Sam Client' && !!signedLink.share.decided_at, signedLink);
  check('a second answer is refused', (await answer(secondToken, { decision: 'declined' })).status === 409);
  check('the answer cannot be undone by turning the link off', must('turning off', await DELETE(pm, `/api/proposals/${offer.id}/share`), 200).ok === true && must('link status', await GET(pm, `/api/proposals/${offer.id}/share`), 200).data.status === 'accepted');
  const afterHtml = await (await fetch(`${S.app}/portal/${secondToken}`)).text();
  check('the link now shows it was accepted, and by whom', afterHtml.includes('Accepted') && afterHtml.includes('Sam Client') && !afterHtml.includes('Accept and sign'));
  check('the signed proposal becomes a project like any accepted one', (await POST(pm, `/api/proposals/${offer.id}/convert`)).status === 201);

  const declinedOffer = must('a second proposal', await POST(pm, '/api/modules/proposals', { title: `Decline ${RUN}`, status: 'Sent', client_id: client.id, client_name: client.title, total_amount: 900 }), 201).data;
  const declineToken = tokenOf(must('sharing it', await POST(pm, `/api/proposals/${declinedOffer.id}/share`), 201).data.url);
  must('the client declines', await answer(declineToken, { decision: 'declined', reason: 'Went with another bid' }), 200);
  const declined = must('link status', await GET(pm, `/api/proposals/${declinedOffer.id}/share`), 200).data;
  check('declining sets the proposal to Declined and keeps the reason', declined.status === 'declined' && declined.share.decline_reason === 'Went with another bid' && must('reading it', await GET(pm, `/api/modules/proposals/${declinedOffer.id}`), 200).data.status === 'Declined', declined);

  section('Pages load');
  for (const who of [owner, pm, foreman, electrician]) {
    const bad = [];
    for (const path of ['/', `/projects/${projectId}`, '/timecards', '/job-costing', '/invoices', `/invoices/${invoiceId}`, `/print/invoice/${invoiceId}`, `/loto-permits/${loto.id}`, `/print/record/loto-permits/${loto.id}`, `/change-orders/${co.id}`, '/alerts',
      '/pipeline', '/calendar', '/calendar?view=week', '/assemblies', `/crm/${client.id}`, `/estimates/${estimate.id}`, `/proposals/${offer.id}`, '/crm?q=Client']) {
      const { status } = await GET(who, path);
      if (status >= 500) bad.push(`${status} ${path}`);
    }
    check(`no page falls over for ${who.tag}`, bad.length === 0, bad);
  }
  const pageText = async (who, path) => (await fetch(`${S.app}${path}`, { headers: { cookie: who.cookie }, redirect: 'manual' })).text();
  check('the printed invoice carries the GST/HST number', (await pageText(owner, `/print/invoice/${invoiceId}`)).includes('GST/HST No. 12345 6789 RT0001'));
  check('so does the printed proposal', (await pageText(pm, `/print/proposal/${proposalId}`)).includes('GST/HST No. 12345 6789 RT0001'));
  const home = await pageText(owner, '/');
  check('the Command Center shows win rate and follow-ups', home.includes('Win Rate') && home.includes('Follow-ups Due'));
  const board = await pageText(pm, '/pipeline');
  check('the pipeline board lists the quotes with a win rate', board.includes(`Offer ${RUN}`) && board.includes(`Decline ${RUN}`) && board.includes('Win rate'));
  const profile = await pageText(owner, `/crm/${client.id}`);
  check('the client profile shows the client, their quotes and their money', profile.includes(`Client ${RUN}`) && profile.includes(`Job ${RUN}`) && profile.includes(`Offer ${RUN}`) && profile.includes('Lifetime value'));
  check('a project manager sees the client without the finance figures', !(await pageText(pm, `/crm/${client.id}`)).includes('Lifetime value'));
  check('the calendar and the assembly library open', (await pageText(pm, '/calendar')).includes('Calendar') && (await pageText(pm, '/assemblies')).includes('Assemblies'));
  // What matters is that none of it reaches them, whatever status a streamed "not found" page carries
  for (const [who, path, secret] of [[foreman, '/pipeline', `Offer ${RUN}`], [foreman, '/assemblies', '100A Service'], [electrician, `/crm/${client.id}`, `Client ${RUN}`]]) {
    check(`${who.tag} is not shown ${path.split('/')[1]}`, !(await pageText(who, path)).includes(secret));
  }
  check('and the project manager is shown the starters', (await pageText(pm, '/assemblies')).includes('100A Service'));
  const sanity = await rollup();
  console.log(`\nFinal job figures: revised ${sanity.revised_contract}, budget ${sanity.budget}, actual ${sanity.actual_cost}, billed ${sanity.billed_amount}, paid ${sanity.paid_amount}, ${sanity.status}`);
}

// Reads the real email from the local mail catcher and follows it like a browser would
async function findInviteLink(email) {
  for (let attempt = 0; attempt < 20; attempt++) {
    let messages = [];
    try {
      const res = await fetch(`${S.mail}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
      if (!res.ok) return null;
      messages = (await res.json()).messages ?? [];
    } catch {
      return null;
    }
    if (messages.length) {
      const full = await (await fetch(`${S.mail}/api/v1/message/${messages[0].ID}`)).json();
      const href = full.HTML?.match(/href="([^"]+)"/)?.[1];
      return href ? href.replace(/&amp;/g, '&') : null;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function inviteFlow({ owner, pm, companyId }) {
  const email = `e2e-${RUN}-new@tradequote.test`;
  check('a PM cannot invite', (await POST(pm, '/api/team', { email, role: 'electrician' })).status === 403);
  const sent = must('inviting a new person', await POST(owner, '/api/team', { email, role: 'foreman' }), 200);
  check('the email went out', /Invitation sent/.test(sent.message ?? ''), sent);
  check('a second invite to the same address is refused', (await POST(owner, '/api/team', { email, role: 'foreman' })).status === 409);

  const newUser = ok('finding the invited login', await admin.auth.admin.listUsers({ perPage: 1000 })).users.find((u) => u.email === email);
  check('auth made the login', !!newUser);
  if (newUser) created.users.push(newUser.id);

  let link = await findInviteLink(email);
  if (link) {
    console.log('  note  link read from the local mail catcher');
    check('the email uses the token link from the README', link.includes('token_hash=') && link.includes('type=invite'), link.slice(0, 60));
  } else {
    // No mail catcher here: ask the local admin API for the same link instead
    console.log('  note  no mail catcher answered, using the local admin API');
    const made = ok('generating the link', await admin.auth.admin.generateLink({ type: 'recovery', email }));
    link = `${S.app}/auth/callback?token_hash=${made.properties.hashed_token}&type=recovery&next=/onboarding`;
  }
  const target = new URL(link);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('Refusing to follow an invite link that leaves this computer');

  // Same app, whichever local name the Site URL used
  const landed = await fetch(`${S.app}${target.pathname}${target.search}`, { redirect: 'manual' });
  const place = landed.headers.get('location') ?? '';
  check('the link goes to choosing a password first, then onboarding', /\/update-password\?next=%2Fonboarding/.test(place), `${landed.status} ${place}`);
  const jar = landed.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='));
  check('the link signed them in', jar.some((c) => c.includes('auth-token')));
  const invited = { tag: 'invited', name: 'Nina New', email, cookie: jar.join('; '), db: anonClient() };

  const reused = await fetch(`${S.app}${target.pathname}${target.search}`, { redirect: 'manual' });
  check('the link only works once', /\/login/.test(reused.headers.get('location') ?? ''), reused.headers.get('location'));

  const page = await fetch(`${S.app}/update-password?next=%2Fonboarding`, { headers: { cookie: invited.cookie }, redirect: 'manual' });
  check('the password page opens', page.status === 200, page.status);

  const value = jar.filter((c) => c.includes('auth-token')).sort().map((c) => c.slice(c.indexOf('=') + 1)).join('');
  const session = JSON.parse(Buffer.from(value.replace(/^base64-/, ''), 'base64url').toString('utf8'));
  ok('restoring the session', await invited.db.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }));
  const password = PASSWORD();
  ok('choosing a password', await invited.db.auth.updateUser({ password }));

  const onboardingPage = await fetch(`${S.app}/onboarding`, { headers: { cookie: invited.cookie }, redirect: 'manual' });
  const html = await onboardingPage.text();
  check('onboarding opens and names the company', onboardingPage.status === 200 && html.includes(`E2E Electric ${RUN}`), onboardingPage.status);

  const [invite] = ok('reading the invitation', await invited.db.rpc('pending_invitations'));
  check('the invitation is for the role given', invite?.role === 'foreman', invite?.role);
  check('a bad token is refused', (await POST(invited, '/api/onboarding', { action: 'accept', fullName: invited.name, token: 'a'.repeat(64) })).status === 404);
  must('accepting', await POST(invited, '/api/onboarding', { action: 'accept', fullName: invited.name, token: invite.token }), 200);

  const fresh = anonClient();
  const again = await fresh.auth.signInWithPassword({ email, password });
  check('the new password signs in', !again.error, again.error?.message);
  const member = ok('reading membership', await fresh.from('company_users').select('company_id, role, full_name').eq('user_id', newUser.id).single());
  check('they joined the right company in the right role', member.company_id === companyId && member.role === 'foreman' && member.full_name === invited.name, member);
  const used = ok('reading the invitation row', await admin.from('invitations').select('accepted_at').eq('company_id', companyId).eq('email', email).single());
  check('the invitation is marked accepted', !!used.accepted_at);
  check('nothing is pending for them now', (ok('pending', await fresh.rpc('pending_invitations')) ?? []).length === 0);
  const home = { ...invited, cookie: sessionCookie(again.data.session) };
  check('they can use the app straight away', (await GET(home, '/api/alerts')).status === 200);
  check('and read what a foreman reads', (await GET(home, '/api/modules/change-orders')).status === 200);
  check('but not what a foreman cannot', (await GET(home, '/api/modules/invoices')).status === 403);
}

async function cleanUp() {
  if (KEEP) {
    console.log(`\n--keep: left the E2E companies and logins in place (run ${RUN}).`);
    return;
  }
  const problems = [];
  for (const companyId of created.companies) {
    const { data: folders } = await admin.storage.from('job-photos').list(companyId);
    const paths = [...created.files];
    if (folders?.length) await admin.storage.from('job-photos').remove(paths);
    const { error } = await admin.from('companies').delete().eq('id', companyId);
    if (error) problems.push(`company: ${error.message}`);
  }
  for (const id of created.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) problems.push(`login: ${error.message}`);
  }
  if (problems.length) failures.push(`Cleaning up: ${problems.join('; ')}`);
}

let crashed = null;
try {
  await main();
} catch (err) {
  crashed = err;
}
try {
  await cleanUp();
} catch (err) {
  failures.push(`Cleaning up: ${err.message}`);
}
if (crashed) failures.push(`Stopped early: ${crashed.message}`);
console.log(`\n${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length ? 1 : 0);
