// The client profile page (/crm/[id]): who sees which section and which money, and the three sums.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROFILE_SECTIONS, clientMoney, mailHref, newRecordBody, profileAccess, telHref } from '@/lib/client-profile';
import { detailHref } from '@/lib/detail-pages';
import { getModule } from '@/lib/modules';
import { parseRecord } from '@/lib/validation';

const CLIENT = '00000000-0000-4000-8000-000000000c01';

describe('who sees what on a client profile', () => {
  it('the crew cannot open it: the client list is for project managers and up', () => {
    expect(profileAccess('electrician')).toBeNull();
    expect(profileAccess('foreman')).toBeNull();
  });

  it('a project manager sees estimates, proposals, projects and the pipeline, but no invoices or receivables', () => {
    const pm = profileAccess('project_manager')!;
    expect(pm.sections.map((s) => s.slug)).toEqual(['estimates', 'proposals', 'projects']);
    expect(pm).toMatchObject({ pipeline: true, finance: false, canEditNotes: true });
    expect(pm.canCreate).toEqual(['estimates', 'proposals', 'projects']);
  });

  it('admins and owners see everything', () => {
    for (const role of ['admin', 'owner'] as const) {
      const access = profileAccess(role)!;
      expect(access.sections.map((s) => s.slug)).toEqual(['estimates', 'proposals', 'projects', 'invoices']);
      expect(access).toMatchObject({ pipeline: true, finance: true });
      expect(access.canCreate).toContain('invoices');
    }
  });

  it('every section is a module with a client link and a detail page, and reads only real columns', () => {
    for (const section of PROFILE_SECTIONS) {
      const mod = getModule(section.slug)!;
      const known = new Set(['id', 'title', 'status', ...mod.fields.filter((f) => !f.restricted).map((f) => f.key)]);
      expect(mod.fields.some((f) => f.key === 'client_id'), section.slug).toBe(true);
      expect(section.columns.split(', ').filter((c) => !known.has(c)), section.slug).toEqual([]);
      expect(detailHref(section.slug, 'x')).toBe(`/${section.slug}/x`);
    }
  });

  it('the Clients list and search link to the profile', () => {
    expect(detailHref('crm', CLIENT)).toBe(`/crm/${CLIENT}`);
  });
});

describe('the figures', () => {
  it('lifetime value is paid invoices; outstanding is sent and overdue; drafts and void count for nothing', () => {
    const money = clientMoney({
      invoices: [
        { id: 'a', status: 'Paid', total: 1000.1 },
        { id: 'b', status: 'Paid', total: '2000.2' },
        { id: 'c', status: 'Sent', total: 300 },
        { id: 'd', status: 'Overdue', total: 50.55 },
        { id: 'e', status: 'Draft', total: 999 },
        { id: 'f', status: 'Void', total: 999 },
      ],
    });
    expect(money).toMatchObject({ lifetimeValue: 3000.3, outstanding: 350.55, unpaidInvoices: 2, overdueInvoices: 1 });
  });

  it('the pipeline is sent proposals plus submitted estimates, and an estimate with a proposal out is counted once', () => {
    const money = clientMoney({
      estimates: [
        { id: 'e1', status: 'Submitted', total_amount: 500 },
        { id: 'e2', status: 'Submitted', total_amount: 700 },
        { id: 'e3', status: 'Submitted', total_amount: 40 },
        { id: 'e4', status: 'Draft', total_amount: 9000 },
        { id: 'e5', status: 'Won', total_amount: 9000 },
      ],
      proposals: [
        { id: 'p1', status: 'Sent', total_amount: 750, estimate_id: 'e2' },
        { id: 'p2', status: 'Draft', total_amount: 9000, estimate_id: 'e1' },
        { id: 'p3', status: 'Declined', total_amount: 9000, estimate_id: 'e3' },
        { id: 'p4', status: 'Accepted', total_amount: 9000, estimate_id: null },
      ],
    });
    expect(money).toMatchObject({ pipeline: 1250, sentProposals: 1, submittedEstimates: 1 });
  });

  it('a client with nothing linked, or a role that was sent no rows, reads zero', () => {
    expect(clientMoney({})).toEqual({ lifetimeValue: 0, pipeline: 0, sentProposals: 0, submittedEstimates: 0, outstanding: 0, unpaidInvoices: 0, overdueInvoices: 0 });
    expect(clientMoney({ invoices: [{ id: 'a', status: 'Paid', total: null }] }).lifetimeValue).toBe(0);
  });
});

describe('contact links', () => {
  it('a phone number becomes a tel: link without its punctuation or extension', () => {
    expect(telHref('(306) 555-0142')).toBe('tel:3065550142');
    expect(telHref('+1 306 555 0142')).toBe('tel:+13065550142');
    expect(telHref('306-555-0142 ext. 12')).toBe('tel:3065550142');
    expect(telHref('call the gatehouse')).toBeNull();
    expect(telHref(null)).toBeNull();
  });

  it('only a real address becomes a mailto: link', () => {
    expect(mailHref(' pat@cargill.ca ')).toBe('mailto:pat@cargill.ca');
    expect(mailHref('pat at cargill')).toBeNull();
    expect(mailHref(null)).toBeNull();
  });
});

describe('new record for this client', () => {
  it('each draft is linked by client_id and passes the module\'s own validation', () => {
    for (const section of PROFILE_SECTIONS) {
      const body = newRecordBody(section.slug, { id: CLIENT, title: 'Cargill Ltd.' });
      const parsed = parseRecord(getModule(section.slug)!, body, 'create');
      expect(parsed.ok, section.slug).toBe(true);
      if (parsed.ok) expect(parsed.data).toMatchObject({ client_id: CLIENT, client_name: 'Cargill Ltd.', status: getModule(section.slug)!.statuses[0] });
    }
  });
});

describe('the page', () => {
  const page = readFileSync('app/(app)/crm/[id]/page.tsx', 'utf8');

  it('is never cached, links records by client_id, and never matches on a typed name', () => {
    expect(page).toContain("export const dynamic = 'force-dynamic'");
    expect(page).toContain(".eq('client_id', params.id)");
    expect(page).not.toMatch(/\.(eq|ilike|or)\('client_name'/);
  });

  it('the phone and email links are 48px tall on a phone', () => {
    expect(page).toMatch(/CONTACT_LINK = 'min-h-\[48px\] lg:min-h-0/);
  });

  it('notes save through the existing crm route', () => {
    expect(readFileSync('app/(app)/crm/[id]/client-notes.tsx', 'utf8')).toContain('`/api/modules/crm/${clientId}`, \'PUT\', { notes }');
  });
});
