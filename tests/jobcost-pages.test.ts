// The pages and routes in front of the job costing rules. What the database enforces is in tests/jobcost.test.ts.
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('@/lib/context', () => ({
  getContext: async () => mocks.result,
  getPageContext: async () => mocks.result,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import JobCostPage from '@/app/(app)/job-costing/[project]/page';
import JobCostingPage from '@/app/(app)/job-costing/page';
import ProjectPage from '@/app/(app)/projects/[id]/page';
import ProposalPage from '@/app/(app)/proposals/[id]/page';
import { POST as convertEstimate } from '@/app/api/estimates/[id]/convert/route';
import { POST as addEntry } from '@/app/api/job-costing/[project]/entries/route';
import { PATCH as patchJob } from '@/app/api/job-costing/[project]/route';
import { DELETE as deleteEntry } from '@/app/api/job-costing/entries/[id]/route';
import { GET as getRollup } from '@/app/api/job-costing/route';
import { POST as newInvoice } from '@/app/api/projects/[id]/invoice/route';
import { POST as convertProposal } from '@/app/api/proposals/[id]/convert/route';
import PrintProposal from '@/app/print/proposal/[id]/page';
import { GET as cronJobCosts } from '@/app/api/cron/job-costs/route';

const ID = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';
const COMPANY = { id: '33333333-3333-4333-8333-333333333333', name: 'Alpha Electric', province: 'SK' };

const JOB = {
  id: ROW,
  company_id: COMPANY.id,
  project_id: ID,
  status: 'At Risk',
  project_title: 'Unit 3 MCC',
  project_status: 'Active',
  client_name: 'Cargill',
  contract_value: 90000,
  approved_changes: 10000,
  revised_contract: 100000,
  budget: 50000,
  budget_labour_hours: 200,
  budget_labour: 20000,
  budget_material: 30000,
  budget_other: 0,
  co_revenue: 10000,
  co_cost: 0,
  co_labour_hours: 0,
  actual_cost: 44000,
  actual_labour_hours: 150,
  actual_labour: 15000,
  actual_material: 29000,
  actual_other: 0,
  committed: 1234.5,
  billed_amount: 40000,
  paid_amount: 20000,
  margin: 56000,
  margin_pct: 56,
  cost_used_pct: 88,
  entries: {},
};

const PROJECT = { id: ID, title: 'Unit 3 MCC', status: 'Active', client_name: 'Cargill', site: '1 Plant Rd', start_date: '2026-11-01', end_date: '2026-12-01', revised_end_date: '2026-12-05', contract_value: 90000, approved_changes: 10000, revised_contract: 100000, approved_days: 4 };

function signIn(role: string, tables: Record<string, Record<string, unknown>[]> = {}, canWrite = true) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const supabase = fakeSupabase(
    { projects: [PROJECT], job_costing: [], job_cost_entries: [], ...tables },
    {
      rpc: (name, args) => {
        rpcCalls.push({ name, args });
        if (name === 'job_cost_rollup') return { data: [JOB], error: null };
        return { data: ROW, error: null };
      },
    }
  );
  mocks.result = { status: 'ok', ctx: { supabase, role, canWrite, user: { id: 'u' }, company: COMPANY } };
  return { supabase, rpcCalls };
}

const html = async (page: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await page);
const post = (body?: unknown) => new Request('http://test/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  mocks.result = { status: 'signed-out' };
});

describe('the proposal the client sees', () => {
  const tables = {
    proposals: [{ id: ID, title: 'Unit 3 MCC', status: 'Sent', client_name: 'Cargill', total_amount: 4305, valid_until: '2026-12-04', scope_of_work: 'Replace the MCC', terms: 'Net 30', estimate_id: ROW, created_at: '2026-11-04T12:00:00Z' }],
    estimates: [{ id: ROW, client_address: '1 Plant Rd', labour_rate: 80, markup_percentage: 25, tax_percentage: 5 }],
    estimate_items: [{ id: 'i1', estimate_id: ROW, sort: 0, description: 'New MCC panel', quantity: 2, unit: 'ea', material_unit_cost: 1000, labour_hours_per_unit: 10 }],
    companies: [{ id: COMPANY.id, name: 'Alpha Electric', address: '9 Shop St', phone: '306-555-0100' }],
  };

  it("prints the estimate's lines on the letterhead at one price each", async () => {
    signIn('project_manager', tables);
    const page = await html(PrintProposal({ params: { id: ID } }));
    expect(page).toContain('New MCC panel');
    expect(page).toContain('Alpha Electric');
    expect(page).toContain('9 Shop St');
    expect(page).toContain('1 Plant Rd');
    // (2000 material + 20 h x 80) x 1.25
    expect(page).toContain('$4,500.00');
    expect(page).toContain('Net 30');
  });

  it('shows no cost, labour or markup detail', async () => {
    signIn('project_manager', tables);
    const page = (await html(PrintProposal({ params: { id: ID } }))).toLowerCase();
    expect(page).not.toMatch(/markup|labour|material|hrs|per hour/);
    expect(page).not.toContain('$2,000.00');
    expect(page).not.toContain('$1,600.00');
  });

  it('a hand-typed proposal prints its typed total', async () => {
    signIn('project_manager', { proposals: [{ ...tables.proposals[0], estimate_id: null, total_amount: 5000 }], companies: tables.companies });
    const page = await html(PrintProposal({ params: { id: ID } }));
    expect(page).toContain('$5,000.00');
    expect(page).toContain('before applicable taxes');
  });

  it('is not for a foreman', async () => {
    signIn('foreman', tables);
    await expect(PrintProposal({ params: { id: ID } })).rejects.toThrow('NOT_FOUND');
  });

  it('fails loudly rather than print a client document with its lines missing', async () => {
    const { supabase } = signIn('project_manager', tables);
    const realFrom = supabase.from.bind(supabase);
    const failing = (table: string) => (table === 'estimate_items' ? fakeSupabase({}, { failOn: () => ({ message: 'boom' }) }).from(table) : realFrom(table));
    (mocks.result as { ctx: { supabase: unknown } }).ctx.supabase = { ...supabase, from: failing };
    await expect(PrintProposal({ params: { id: ID } })).rejects.toThrow('Could not load');
  });
});

describe('the proposal page', () => {
  const proposal = { id: ID, title: 'Unit 3 MCC', status: 'Accepted', notes: null, client_name: 'Cargill', total_amount: 4725, valid_until: null, scope_of_work: null, terms: null, project_id: null, estimate_id: ROW };

  it('offers Create project once accepted, and locks a price that came from an estimate', async () => {
    signIn('project_manager', { proposals: [proposal] });
    const page = await html(ProposalPage({ params: { id: ID } }));
    expect(page).toContain('Create project');
    expect(page).toContain('$4,725.00');
    expect(page).toContain('the estimate');
    expect(page).not.toContain('id="p-total" type="number"');
  });

  it('offers no Create project before that', async () => {
    signIn('project_manager', { proposals: [{ ...proposal, status: 'Draft' }] });
    expect(await html(ProposalPage({ params: { id: ID } }))).not.toContain('Create project');
  });

  it('opens the project once one was made from it, and locks the status', async () => {
    signIn('project_manager', { proposals: [{ ...proposal, project_id: ROW }], projects: [{ id: ROW, proposal_id: ID }] });
    const page = await html(ProposalPage({ params: { id: ID } }));
    expect(page).toContain('Open project');
    expect(page).not.toContain('Create project');
    expect(page).not.toContain('Apply to project');
    expect(page).not.toContain('id="p-status"');
  });

  it('a quote linked to an existing job can still change status and be applied', async () => {
    signIn('project_manager', { proposals: [{ ...proposal, status: 'Draft', project_id: ROW }] });
    const draft = await html(ProposalPage({ params: { id: ID } }));
    expect(draft).toContain('id="p-status"');
    expect(draft).not.toContain('Apply to project');
    signIn('project_manager', { proposals: [{ ...proposal, project_id: ROW }] });
    const page = await html(ProposalPage({ params: { id: ID } }));
    expect(page).toContain('Apply to project');
    expect(page).toContain('Open project');
    expect(page).not.toContain('Create project');
  });

  it('a lapsed company can read it but not act on it', async () => {
    signIn('project_manager', { proposals: [proposal] }, false);
    const page = await html(ProposalPage({ params: { id: ID } }));
    expect(page).not.toContain('Create project');
    expect(page).toContain('view this proposal but not change it');
  });
});

describe('the project hub', () => {
  const records = { rfis: [{ id: ROW, title: 'Confirm feeder size', status: 'Open', project_id: ID, rfi_number: 'RFI-7' }], invoices: [], change_orders: [], submittals: [], drawings: [], daily_logs: [], field_logs: [], timecards: [], punch_list: [] };
  const open = (tab?: string) => html(ProjectPage({ params: { id: ID }, searchParams: { tab } }));

  it('shows the owner the header, the money and every tab', async () => {
    signIn('owner', records);
    const page = await open();
    for (const text of ['Unit 3 MCC', '1 Plant Rd', '$100,000.00', 'Budget, actual and billed', '$44,000.00', '56%', 'Invoices', 'Punch List', 'New invoice', 'New draw', 'Confirm feeder size', 'RFI-7']) expect(page).toContain(text);
  });

  it('prefills a new record with the project', async () => {
    signIn('owner', records);
    const page = (await open()).replace(/&amp;/g, '&');
    expect(page).toContain(`/rfis?project=${ID}&new=1`);
  });

  it('a project manager sees the money but no invoices, and can only make a draw', async () => {
    signIn('project_manager', records);
    const page = await open();
    expect(page).toContain('Budget, actual and billed');
    expect(page).not.toContain('>Invoices<');
    expect(page).not.toContain('New invoice');
    expect(page).toContain('New draw');
  });

  it('a tab the role cannot read falls back to one it can', async () => {
    signIn('project_manager', records);
    expect(await open('invoices')).toContain('Confirm feeder size');
  });

  it('a foreman sees the records and never asks for the money', async () => {
    const { rpcCalls } = signIn('foreman', records);
    const page = await open();
    expect(page).not.toContain('Budget, actual and billed');
    expect(page).not.toContain('New draw');
    expect(page).toContain('Change Orders');
    expect(rpcCalls.map((c) => c.name)).not.toContain('job_cost_rollup');
  });

  it('keeps what the job is worth from the crew', async () => {
    for (const role of ['foreman', 'electrician']) {
      signIn(role, records);
      const page = await open();
      expect(page).not.toContain('Revised contract');
      expect(page).not.toContain('$100,000.00');
      expect(page).not.toContain('$90,000.00');
      expect(page).toContain('1 Plant Rd');
    }
  });

  it('an electrician sees only the tabs their role reads', async () => {
    signIn('electrician', records);
    const page = await open();
    expect(page).not.toContain('Change Orders');
    expect(page).toContain('Timecards');
    expect(page).toContain('Confirm feeder size');
  });

  it('never asks for pay on the timecards tab', async () => {
    const { supabase } = signIn('owner', records);
    await open('timecards');
    const read = supabase.log.find((l) => l.table === 'timecards' && l.columns !== 'id');
    expect(read?.columns).toBeTruthy();
    expect(read?.columns).not.toMatch(/labour_cost|hourly_cost|\*/);
  });

  it('says so when a tab is empty', async () => {
    signIn('owner', records);
    expect(await open('submittals')).toContain('No submittals on this project yet.');
  });

  it('a project that is not there is not found', async () => {
    signIn('owner', { ...records, projects: [] });
    await expect(open()).rejects.toThrow('NOT_FOUND');
    await expect(ProjectPage({ params: { id: 'nope' }, searchParams: {} })).rejects.toThrow('NOT_FOUND');
  });
});

describe('the job costing pages', () => {
  const list = (status?: string) => html(JobCostingPage({ searchParams: { status } }));

  it('lists jobs in cards and a table, on the numbers from the rollup', async () => {
    signIn('project_manager');
    const page = await list();
    for (const text of ['Unit 3 MCC', '$44,000.00', '88%', '$1,234.50', 'At Risk', '1 job needs a look']) expect(page).toContain(text);
  });

  it('filters by status', async () => {
    signIn('project_manager');
    expect(await list('Over Budget')).toContain('No jobs are over budget.');
    expect(await list('At Risk')).not.toContain('No jobs are');
  });

  it('keeps older typed-in rows visible, apart from the totals', async () => {
    signIn('project_manager', { job_costing: [{ id: ROW, title: 'Old typed job', budget: 900, actual_cost: 100, project_id: null }] });
    expect(await list()).toContain('Old typed job');
  });

  it('is not for a foreman', async () => {
    signIn('foreman');
    await expect(list()).rejects.toThrow('NOT_FOUND');
    await expect(JobCostPage({ params: { project: ID } })).rejects.toThrow('NOT_FOUND');
  });

  it('shows one job with its budget, its entries and a credit', async () => {
    signIn('project_manager', { job_cost_entries: [{ id: ROW, project_id: ID, category: 'Equipment', description: 'Rental credit', amount: -200, entry_date: '2026-11-02' }] });
    const page = await html(JobCostPage({ params: { project: ID } }));
    for (const text of ['Budget against actual', 'Set the budget', 'Rental credit', 'credit', 'Close job', 'Add cost', '150 h of 200 h']) expect(page).toContain(text);
  });

  it('a lapsed company reads it but gets no forms', async () => {
    signIn('project_manager', {}, false);
    const page = await html(JobCostPage({ params: { project: ID } }));
    expect(page).not.toContain('Set the budget');
    expect(page).not.toContain('Add cost');
    expect(page).toContain('view this job but not change it');
  });
});

describe('the routes', () => {
  it('conversions call their RPC and hand back the record', async () => {
    const { rpcCalls } = signIn('project_manager');
    const res = await convertEstimate(post(), { params: { id: ID } });
    expect(res.status).toBe(201);
    expect((await res.json()).data.id).toBe(ROW);
    await convertProposal(post(), { params: { id: ID } });
    expect(rpcCalls).toEqual([
      { name: 'create_proposal_from_estimate', args: { p_estimate: ID } },
      { name: 'create_project_from_proposal', args: { p_proposal: ID } },
    ]);
  });

  it('refuse a role below the module, a lapsed company and a bad id before reaching the database', async () => {
    const { rpcCalls } = signIn('foreman');
    expect((await convertEstimate(post(), { params: { id: ID } })).status).toBe(403);
    expect((await newInvoice(post(), { params: { id: ID } })).status).toBe(403);
    signIn('project_manager');
    expect((await newInvoice(post(), { params: { id: ID } })).status).toBe(403);
    const lapsed = signIn('project_manager', {}, false);
    expect((await convertEstimate(post(), { params: { id: ID } })).status).toBe(402);
    expect((await convertEstimate(post(), { params: { id: 'nope' } })).status).toBe(404);
    expect(lapsed.rpcCalls).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it('returns the rollup only to a project manager or above', async () => {
    signIn('project_manager');
    expect((await (await getRollup(new Request(`http://test/x?project=${ID}`))).json()).data[0].project_id).toBe(ID);
    signIn('foreman');
    expect((await getRollup(new Request('http://test/x'))).status).toBe(403);
  });

  it('saves a budget, rounded and never negative', async () => {
    const { rpcCalls } = signIn('project_manager');
    const patch = (body: unknown) => patchJob(new Request('http://test/x', { method: 'PATCH', body: JSON.stringify(body) }), { params: { project: ID } });
    expect((await patch({ hours: '10', labour: '1000.555', material: '', other: 0 })).status).toBe(200);
    expect(rpcCalls[0]).toEqual({ name: 'set_job_budget', args: { p_project: ID, p_hours: 10, p_labour: 1000.56, p_material: 0, p_other: 0 } });
    expect((await patch({ hours: -1 })).status).toBe(400);
  });

  it('closes and reopens a job', async () => {
    const { rpcCalls } = signIn('project_manager');
    const patch = (body: unknown) => patchJob(new Request('http://test/x', { method: 'PATCH', body: JSON.stringify(body) }), { params: { project: ID } });
    await patch({ closed: true });
    await patch({ closed: false });
    expect(rpcCalls).toEqual([
      { name: 'set_job_closed', args: { p_project: ID, p_closed: true } },
      { name: 'set_job_closed', args: { p_project: ID, p_closed: false } },
    ]);
    expect((await patch({ closed: 'yes' })).status).toBe(400);
  });

  it('adds an entry, takes a credit, and refuses a bad one with a plain message', async () => {
    const { supabase } = signIn('project_manager');
    const good = await addEntry(post({ category: 'Equipment', description: ' Lift ', amount: '-200', entry_date: '2026-11-04' }), { params: { project: ID } });
    expect(good.status).toBe(201);
    expect(supabase.log.find((l) => l.op === 'insert')?.values).toMatchObject({ project_id: ID, category: 'Equipment', description: 'Lift', amount: -200 });
    const bad = await addEntry(post({ category: 'Other', description: 'x', amount: 0, entry_date: '2026-11-04' }), { params: { project: ID } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Enter an amount/);
  });

  it('deleting an entry that is not there says not found', async () => {
    signIn('project_manager');
    expect((await deleteEntry(new Request('http://test/x', { method: 'DELETE' }), { params: { id: ID } })).status).toBe(404);
  });

  it('the nightly route wants the cron secret', async () => {
    const before = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'a-long-enough-test-secret';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await cronJobCosts(new Request('http://test/x'))).status).toBe(401);
    spy.mockRestore();
    process.env.CRON_SECRET = before;
  });
});
