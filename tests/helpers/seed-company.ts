// A company with something in nearly every table, written as its real users through the same
// functions the app calls. Used by the export and closure tests, which need a full company.
import { hashPortalToken, newPortalToken } from '@/lib/portal';
import type { TestDb } from './db';

type Row = Record<string, unknown>;

export const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';

/** Inserts a row as `who` and returns its id. */
export async function insertAs<U extends string>(t: TestDb<U>, who: U, table: string, row: Row): Promise<string> {
  const keys = Object.keys(row);
  const [r] = await t.as<{ id: string }>(who, `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(row));
  return r.id;
}

/** Every public table with a company_id column. */
export async function companyTables<U extends string>(t: TestDb<U>): Promise<string[]> {
  const rows = await t.asSystem<{ table_name: string }>(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'company_id' order by 1`);
  return rows.map((r) => r.table_name);
}

/** How many rows a company has in each of those tables, plus its own row in companies. */
export async function rowCounts<U extends string>(t: TestDb<U>, company: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await companyTables(t)) {
    counts[table] = Number((await t.asSystem<{ n: number }>(`select count(*)::int as n from public.${table} where company_id = $1`, [company]))[0].n);
  }
  counts.companies = Number((await t.asSystem<{ n: number }>('select count(*)::int as n from public.companies where id = $1', [company]))[0].n);
  return counts;
}

/**
 * Fills the company of `owner` (with `pm`, `foreman` and `elec` already in it), including the records
 * whose own guards refuse a signed-in user's delete: a signed daily log, a released LOTO permit, a
 * signed-off tailgate meeting, an approved timecard and change order, a paid invoice and an
 * accepted, signed proposal. Pass the same user for several roles to fill a small company.
 */
export async function seedCompany<U extends string>(t: TestDb<U>, people: { owner: U; pm: U; foreman: U; elec: U }): Promise<void> {
  const { owner, pm, foreman, elec } = people;
  const ins = (who: U, table: string, row: Row) => insertAs(t, who, table, row);
  const project = await ins(pm, 'projects', { title: 'Canola plant', status: 'Active', contract_value: 100000 });
  const client = await ins(pm, 'crm', { title: 'Cargill', status: 'Active Client' });
  await ins(pm, 'rfis', { title: 'Feeder size?', status: 'Open', project_id: project });

  // Estimate with lines, a proposal from it, shared and accepted by the client, then a project from it
  const estimate = await ins(pm, 'estimates', { title: 'MCC replacement', status: 'Submitted', client_id: client, labour_rate: 90, markup_percentage: 20, tax_percentage: 5, project_id: project });
  await t.as(pm, 'select public.save_estimate_items($1, $2::jsonb)', [estimate, JSON.stringify([{ description: 'MCC', quantity: 1, unit: 'ea', material_unit_cost: 20000, labour_hours_per_unit: 40 }])]);
  const [{ id: proposal }] = await t.as<{ id: string }>(pm, 'select public.create_proposal_from_estimate($1) as id', [estimate]);
  await t.as(pm, `update public.proposals set status = 'Sent', project_id = $2 where id = $1`, [proposal, project]);
  const hash = hashPortalToken(newPortalToken());
  await t.as(pm, 'select public.create_proposal_share($1, $2)', [proposal, hash]);
  await t.asService('select public.portal_decide($1, $2, $3, $4, $5, $6, $7)', [hash, 'accepted', 'Dana Smith', SIGNATURE, null, null, null]);
  const [{ id: won }] = await t.as<{ id: string }>(pm, 'select public.create_project_from_proposal($1) as id', [proposal]);

  // Money: an approved change order, an approved timecard, a cost entry, a bill against a PO, a paid invoice and a draw
  const co = await ins(pm, 'change_orders', { title: 'Add VFDs', status: 'Draft', project_id: won, material_cost: 1000, labour_hours: 10, labour_rate: 100, markup_pct: 20, tax_pct: 5 });
  await t.as(pm, `update public.change_orders set status = 'Sent' where id = $1`, [co]);
  await t.as(pm, `update public.change_orders set status = 'Approved', approved_by = 'Client', signature = $2 where id = $1`, [co, SIGNATURE]);
  const card = await ins(elec, 'timecards', { title: 'Labour', status: 'Submitted', project_id: won, employee_name: 'Sam', work_date: '2026-11-02', regular_hours: 8 });
  await t.as(pm, `select public.decide_timecards($1, 'approve')`, [[card]]);
  await ins(pm, 'job_cost_entries', { project_id: won, category: 'Other', description: 'Crane', amount: 500 });
  const po = await ins(pm, 'purchase_orders', { title: 'PO-1', status: 'Issued', project_id: won, amount: 700 });
  await ins(owner, 'payables', { title: 'Bill', status: 'Approved', amount: 700, project_id: won, purchase_order_id: po });
  const invoice = await ins(owner, 'invoices', { title: 'INV', status: 'Draft', project_id: won, tax_pct: 5, holdback_pct: 10, lines: JSON.stringify([{ type: 'free', description: 'Work', amount: 1000 }]) });
  await t.as(owner, `update public.invoices set status = 'Sent' where id = $1`, [invoice]);
  await t.as(owner, `update public.invoices set status = 'Paid' where id = $1`, [invoice]);
  await ins(pm, 'progress_billing', { title: 'Draw 1', status: 'Draft', project_id: won, amount_billed: 5000 });

  // Field and safety records, signed and locked where they can be
  const log = await ins(foreman, 'daily_logs', { title: 'Day 1', status: 'Draft', project_id: project });
  await t.as(foreman, `update public.daily_logs set signed_at = now(), signed_by = 'Frank', signature = $2 where id = $1`, [log, SIGNATURE]);
  const permit = await ins(elec, 'loto_permits', { title: 'LOTO-1', status: 'Draft', project_id: project, equipment_isolated: 'MCC-3', authorized_person: 'Sam', lock_number: '7', record_date: '2026-11-02', isolation_points: 'Main breaker', energy_sources: JSON.stringify(['Electrical']), verification_method: 'Meter', release_notes: 'Clear' });
  for (const slot of ['lock_on', 'verified', 'lock_off']) await t.as(elec, 'select public.sign_safety_record($1, $2, $3, $4, $5)', ['loto-permits', permit, slot, 'Sam', SIGNATURE]);
  const meeting = await ins(foreman, 'tailgate_logs', { title: 'FLHA', status: 'Needs Sign-off', project_id: project, topic: 'Lifts', meeting_date: '2026-11-02', hazards: 'Overhead', controls: 'Spotter' });
  await t.as(elec, 'select public.sign_safety_record($1, $2, $3, $4, $5)', ['tailgate-logs', meeting, 'attendee', 'Sam', SIGNATURE]);
  await t.as(foreman, 'select public.sign_safety_record($1, $2, $3, $4, $5)', ['tailgate-logs', meeting, 'supervisor', 'Frank', SIGNATURE]);
  await ins(elec, 'safety_logs', { title: 'Fall', status: 'Open', severity: 'Critical', project_id: project });
  await ins(foreman, 'warehouse_inventory', { title: 'EMT connector', status: 'In Stock', quantity: 1, reorder_point: 5 });
  await ins(owner, 'employees', { title: 'Tessa', status: 'Active', hourly_cost: 45 });

  // Library, alerts, a pending invitation and assistant use
  await t.as(pm, 'select public.save_assembly($1, $2, $3, $4::jsonb)', [null, 'EV Charger', 'Residential', JSON.stringify([{ description: 'Wire', quantity: 30, unit: 'm', material_unit_cost: 1, labour_hours_per_unit: 0.02 }])]);
  const [alert] = await t.as<{ id: string }>(owner, 'select id from public.alerts limit 1');
  if (alert) await t.as(owner, 'select public.dismiss_alert($1)', [alert.id]);
  await t.as(owner, `insert into public.invitations (company_id, email, role) values (public.user_company_id(), $1, 'foreman')`, [`new-${String(owner).toLowerCase()}@example.ca`]);
  await t.as(owner, 'select * from public.consume_ai_message()');
}
