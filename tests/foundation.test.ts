// Tests for the shared pieces feature work builds on: linked fields, computed fields,
// system statuses, the project filter, the detail-page map, the cron check and the letterhead.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ server: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mocks.server, createSupabaseServerClient: () => mocks.server }));

import { GET as linkOptions } from '@/app/api/link-options/route';
import ModulePage from '@/components/module-page';
import { dbError } from '@/lib/api';
import { CompanyProfileSchema } from '@/lib/company';
import { authorizedCron, requireCron } from '@/lib/cron';
import { listRecords } from '@/lib/crud';
import { DETAIL_PAGES, detailHref } from '@/lib/detail-pages';
import { MODULES, getModule, linkTarget, pickableStatuses, type ModuleDef } from '@/lib/modules';
import { Letterhead, loadLetterhead } from '@/lib/print';
import { SignatureImage, SignerName } from '@/lib/signature';
import { parseRecord } from '@/lib/validation';

const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@alpha.ca' };
const COMPANY = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha', province: 'SK', subscription_status: 'active', trial_ends_at: '2030-01-01T00:00:00Z', current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null };
const PROJECT = '33333333-3333-4333-8333-333333333333';

function signedIn(tables: Record<string, Record<string, unknown>[]> = {}, role = 'owner') {
  const fake = fakeSupabase({ company_users: [{ user_id: USER.id, role, company: COMPANY }], ...tables });
  const client = Object.assign(fake, { auth: { getUser: async () => ({ data: { user: USER }, error: null }) } });
  mocks.server = client;
  return client;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('registry links', () => {
  const JOB_SCOPED = ['rfis', 'change-orders', 'submittals', 'drawings', 'documents', 'daily-logs', 'field-logs', 'timecards', 'crew-schedule', 'tailgate-logs', 'safety-logs', 'loto-permits', 'inspections', 'punch-list', 'commissioning', 'cable-testing', 'quality-control', 'non-conformance', 'tasks', 'job-costing', 'progress-billing', 'invoices', 'receivables', 'payables', 'purchase-orders', 'equipment-rentals', 'estimates', 'proposals'];

  it.each(JOB_SCOPED)('%s links to a project', (slug) => {
    const f = getModule(slug)!.fields.find((x) => x.key === 'project_id');
    expect(f?.type).toBe('project');
    expect(linkTarget(f!)).toBe('projects');
  });

  it.each(['estimates', 'proposals', 'projects', 'invoices'])('%s links to a client', (slug) => {
    const f = getModule(slug)!.fields.find((x) => x.key === 'client_id');
    expect(f?.type).toBe('client');
    expect(linkTarget(f!)).toBe('crm');
  });

  it('keeps the old free-text columns', () => {
    for (const slug of ['punch-list', 'change-orders', 'purchase-orders']) expect(getModule(slug)!.fields.find((f) => f.key === 'project_name')?.legacy).toBe(true);
    for (const slug of ['estimates', 'proposals', 'projects', 'invoices']) expect(getModule(slug)!.fields.some((f) => f.key === 'client_name')).toBe(true);
  });

  it('has the new fields the rules need', () => {
    const has = (slug: string, key: string, type: string) => expect(getModule(slug)!.fields.find((f) => f.key === key)?.type).toBe(type);
    has('sub-compliance', 'wcb_clearance_expiry', 'date');
    has('vendors', 'wcb_clearance_expiry', 'date');
    has('warehouse-inventory', 'reorder_point', 'number');
    has('fleet', 'next_service_date', 'date');
    has('fleet', 'next_service_km', 'number');
    has('site-vault', 'expiry_date', 'date');
    has('employees', 'hourly_cost', 'money');
    has('payables', 'purchase_order_id', 'uuid');
    has('progress-billing', 'holdback_release_date', 'date');
    expect(getModule('payables')!.fields.find((f) => f.key === 'purchase_order_id')?.references).toBe('purchase_orders');
  });

  it('every module leaves a status a person can pick', () => {
    for (const m of MODULES) expect(pickableStatuses(m).length).toBeGreaterThan(0);
  });

  it('every link points at a real module table', () => {
    const tables = new Set(MODULES.map((m) => m.table));
    for (const m of MODULES) for (const f of m.fields) if (linkTarget(f)) expect(tables.has(linkTarget(f)!)).toBe(true);
  });
});

describe('validating links, computed fields and system statuses', () => {
  const invoice: ModuleDef = {
    ...getModule('invoices')!,
    systemStatuses: ['Overdue'],
    fields: [...getModule('invoices')!.fields, { key: 'balance', label: 'Balance', type: 'money', computed: true }],
  };

  it('accepts a project id, clears it when blank, and refuses anything else', () => {
    const rfis = getModule('rfis')!;
    expect(parseRecord(rfis, { project_id: PROJECT }, 'update')).toEqual({ ok: true, data: { project_id: PROJECT } });
    expect(parseRecord(rfis, { project_id: '' }, 'update')).toEqual({ ok: true, data: { project_id: null } });
    const bad = parseRecord(rfis, { project_id: 'not-a-uuid' }, 'update');
    expect(!bad.ok && bad.errors.project_id).toBe('Pick one from the list');
  });

  it('drops whatever the client sends for a computed field', () => {
    const r = parseRecord(invoice, { title: 'INV', balance: 1 }, 'create');
    expect(r.ok && 'balance' in r.data).toBe(false);
    expect(parseRecord(invoice, { balance: 1 }, 'update').ok).toBe(false);
  });

  it('refuses a system status and never starts a record on one', () => {
    expect(parseRecord(invoice, { title: 'INV', status: 'Overdue' }, 'create').ok).toBe(false);
    expect(parseRecord(invoice, { status: 'Overdue' }, 'update').ok).toBe(false);
    expect(parseRecord(invoice, { status: 'Paid' }, 'update').ok).toBe(true);
    const first: ModuleDef = { ...invoice, statuses: ['Overdue', 'Draft'] };
    const r = parseRecord(first, { title: 'INV' }, 'create');
    expect(r.ok && r.data.status).toBe('Draft');
  });

  it('refuses negative costs and service readings', () => {
    expect(parseRecord(getModule('employees')!, { hourly_cost: -1 }, 'update').ok).toBe(false);
    expect(parseRecord(getModule('employees')!, { hourly_cost: '41.255' }, 'update')).toEqual({ ok: true, data: { hourly_cost: 41.26 } });
    expect(parseRecord(getModule('warehouse-inventory')!, { reorder_point: -1 }, 'update').ok).toBe(false);
  });

  it('company settings accept sensible values only', () => {
    expect(CompanyProfileSchema.safeParse({ overtime_multiplier: '1.5', default_holdback_pct: '10' }).success).toBe(true);
    expect(CompanyProfileSchema.safeParse({ overtime_multiplier: 0.5 }).success).toBe(false);
    expect(CompanyProfileSchema.safeParse({ default_holdback_pct: 101 }).success).toBe(false);
  });
});

describe('listing records by project', () => {
  const list = (slug: string, qs: string) => listRecords(new Request(`https://app.test/api/modules/${slug}?${qs}`), { params: { module: slug } });

  it('filters by project', async () => {
    signedIn({ rfis: [{ id: 'a', project_id: PROJECT }, { id: 'b', project_id: null }] });
    const json = await (await list('rfis', `project=${PROJECT}`)).json();
    expect(json.data.map((r: { id: string }) => r.id)).toEqual(['a']);
  });

  it('refuses a malformed project id instead of showing everything', async () => {
    signedIn({ rfis: [{ id: 'a' }] });
    expect((await list('rfis', 'project=junk')).status).toBe(400);
  });

  it('ignores the filter on a module with no project', async () => {
    signedIn({ vendors: [{ id: 'a' }] });
    expect((await (await list('vendors', 'project=junk')).json()).data.length).toBe(1);
  });
});

describe('picker choices', () => {
  const options = (type: string) => linkOptions(new Request(`https://app.test/api/link-options?type=${type}`));

  it('returns only id and title, sorted by title', async () => {
    const client = signedIn({ projects: [{ id: 'b', title: 'Zed', contract_value: 9 }, { id: 'a', title: 'Alpha', contract_value: 9 }] });
    const res = await options('project');
    expect(res.status).toBe(200);
    expect((await res.json()).data.map((r: { title: string }) => r.title)).toEqual(['Alpha', 'Zed']);
    expect(client.log.find((c) => c.table === 'projects')!.columns).toBe('id, title');
  });

  it('crew can list projects but not clients', async () => {
    signedIn({ projects: [{ id: 'a', title: 'Job' }], crm: [{ id: 'c', title: 'Client' }] }, 'electrician');
    expect((await options('project')).status).toBe(200);
    expect((await options('client')).status).toBe(403);
  });

  it('refuses any other list', async () => {
    signedIn();
    expect((await options('employees')).status).toBe(400);
    expect((await options('')).status).toBe(400);
  });
});

describe('module page', () => {
  const html = (slug: string, initialProject?: string) => renderToStaticMarkup(createElement(ModulePage, { slug, canWrite: true, canDelete: true, initialProject }));

  it('offers a project filter on job-scoped modules only', () => {
    expect(html('rfis')).toContain('All projects');
    expect(html('vendors')).not.toContain('All projects');
  });

  it('shows the project as a list column, but never a client link or a hidden id', () => {
    expect(html('rfis')).toMatch(/<th[^>]*>Project<\/th>/);
    expect(html('invoices')).toMatch(/<th[^>]*>Client<\/th>/);
    expect(html('payables')).not.toContain('Purchase Order');
  });

  it('takes the filter from the address', () => {
    expect(html('rfis', PROJECT)).toContain(`value="${PROJECT}" selected`);
    // A junk value is ignored rather than sent to the API
    expect(html('rfis', 'junk')).not.toContain('junk');
  });

  it('the old project text is not a list column', () => {
    expect(html('punch-list')).not.toContain('(old text)');
  });
});

describe('deleting a record that others link to', () => {
  it('says what to do', async () => {
    const res = dbError({ code: '23503', message: 'violates foreign key constraint' }, 'deleting');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/still linked/);
  });
});

describe('detail pages', () => {
  it('knows which modules have one', () => {
    expect(detailHref('estimates', 'x')).toBe('/estimates/x');
    expect(detailHref('daily-logs', 'x')).toBe('/daily-logs/x');
    expect(detailHref('rfis', 'x')).toBeNull();
  });

  it('only names real modules', () => {
    for (const slug of Object.keys(DETAIL_PAGES)) expect(getModule(slug)).toBeDefined();
  });
});

describe('cron check', () => {
  const req = (auth?: string) => new Request('https://app.test/api/cron/x', { headers: auth ? { authorization: auth } : {} });

  it('accepts only the exact secret', () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect(authorizedCron(req('Bearer cron-secret'))).toBe(true);
    expect(authorizedCron(req('Bearer wrong-secret'))).toBe(false);
    expect(authorizedCron(req())).toBe(false);
    expect(requireCron(req('Bearer cron-secret'))).toBeNull();
    expect(requireCron(req('Bearer wrong-secret'))?.status).toBe(401);
  });

  it('fails closed when the secret is not set', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(requireCron(req('Bearer '))?.status).toBe(500);
  });

  it('the trial email job uses it', () => {
    const route = readFileSync('app/api/cron/trial-emails/route.ts', 'utf8');
    expect(route).toContain('requireCron(request)');
    expect(route).not.toContain('timingSafeEqual');
  });
});

describe('signature checks', () => {
  it('accepts a PNG data URL and a name', () => {
    expect(SignatureImage.safeParse('data:image/png;base64,AAAA').success).toBe(true);
    expect(SignerName.safeParse(' Pat ').data).toBe('Pat');
  });

  it('refuses other data, oversize images and blank names', () => {
    expect(SignatureImage.safeParse('javascript:alert(1)').success).toBe(false);
    expect(SignatureImage.safeParse('data:image/png;base64,' + 'A'.repeat(300_000)).success).toBe(false);
    expect(SignerName.safeParse('  ').success).toBe(false);
  });
});

describe('letterhead', () => {
  it('shows the company and the document name', () => {
    const page = renderToStaticMarkup(createElement(Letterhead, { company: { name: 'Alpha Electric', address: '1 Main St', phone: '306-555-0100', contact: null, email: 'a@alpha.ca' }, document: 'Invoice' }, 'Due soon'));
    for (const text of ['Alpha Electric', '1 Main St', '306-555-0100 · a@alpha.ca', 'Invoice', 'Due soon']) expect(page).toContain(text);
  });

  it('reads only the columns a client may see, for the caller\'s company', async () => {
    const client = signedIn({ companies: [{ id: COMPANY.id, name: 'Alpha Electric', stripe_customer_id: 'cus_x' }] });
    const company = await loadLetterhead({ supabase: client as never, company: COMPANY as never });
    expect(company.name).toBe('Alpha Electric');
    const call = client.log.find((c) => c.table === 'companies')!;
    expect(call.columns).not.toContain('stripe');
    expect(call.filters).toContainEqual(['eq', 'id', COMPANY.id]);
  });

  it('falls back to the name in the session if the row cannot be read', async () => {
    const client = signedIn({ companies: [] });
    expect((await loadLetterhead({ supabase: client as never, company: COMPANY as never })).name).toBe('Alpha');
  });
});
