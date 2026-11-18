import { describe, expect, it } from 'vitest';
import { getModule } from '@/lib/modules';
import { PIPELINE_STAGES, stageOf, stageTotals, statusForDrop, toCard, winRate, type PipelineCard } from '@/lib/pipeline';
import { cleanQuery, hitHref, quickActions, searchFilter, searchTargets, toHit } from '@/lib/search';

describe('global search', () => {
  it('never queries a module the role cannot read', () => {
    const crew = searchTargets('electrician').map((t) => t.mod.slug);
    expect(crew).toContain('tasks');
    for (const slug of ['crm', 'estimates', 'proposals', 'invoices']) expect(crew).not.toContain(slug);
    for (const target of searchTargets('electrician')) expect(target.mod.read).toBeLessThanOrEqual(1);
    expect(searchTargets('owner').map((t) => t.mod.slug)).toEqual(expect.arrayContaining(['crm', 'estimates', 'proposals', 'projects', 'invoices']));
  });

  it('only names columns the registry has and a signed-in user may read', () => {
    for (const target of searchTargets('owner')) {
      expect(target.columns[0]).toBe('title');
      for (const column of target.columns.slice(1)) {
        const field = target.mod.fields.find((f) => f.key === column);
        expect(field, `${target.mod.slug}.${column}`).toBeDefined();
        expect(field!.restricted, `${target.mod.slug}.${column}`).not.toBe(true);
      }
    }
  });

  it('ignores text too short to search, and caps long text', () => {
    expect(cleanQuery(null)).toBeNull();
    expect(cleanQuery(' a ')).toBeNull();
    expect(cleanQuery('  Smith ')).toBe('Smith');
    expect(cleanQuery('x'.repeat(500))).toHaveLength(80);
  });

  it('escapes what ilike reads as a wildcard and what would end the filter early', () => {
    expect(searchFilter(['title', 'client_name'], 'Smith')).toBe('title.ilike.%Smith%,client_name.ilike.%Smith%');
    const hostile = searchFilter(['title'], '100%_a\\b,c(d)"e');
    expect(hostile).toBe('title.ilike.%100\\%\\_a\\\\b c d  e%');
    // One column in, one condition out: nothing typed can add a second
    expect(hostile.split(',')).toHaveLength(1);
  });

  it('links a hit to its own page, or to its list narrowed to that record', () => {
    const id = '7b0e7a52-6c5e-4d0e-9a55-0f6f3d2b9d11';
    expect(hitHref('estimates', id, 'Panel upgrade')).toBe(`/estimates/${id}`);
    expect(hitHref('vendors', id, 'Smith & Sons')).toBe('/vendors?q=Smith+%26+Sons');
  });

  it('shows the column that matched when the title did not', () => {
    const target = searchTargets('owner').find((t) => t.mod.slug === 'crm')!;
    const hit = toHit(target, { id: '1', title: 'Cargill Ltd.', status: 'Active Client', contact_person: 'Dana Smith', email: 'dana@example.com', phone: null, project_site: null }, 'smith');
    expect(hit).toMatchObject({ title: 'Cargill Ltd.', status: 'Active Client', detail: 'Dana Smith' });
    expect(toHit(target, { id: '2', title: 'Smith Electric', status: 'Lead', contact_person: null, email: null, phone: null, project_site: null }, 'smith').detail).toBeNull();
  });

  it('offers a create shortcut only where the role can write and the company can still edit', () => {
    expect(quickActions('owner', false)).toEqual([]);
    const owner = quickActions('owner', true);
    expect(owner.map((a) => a.label)).toEqual(expect.arrayContaining(['New Estimate', 'New Client', 'New Invoice']));
    const crew = quickActions('electrician', true).map((a) => a.label);
    expect(crew).not.toContain('New Estimate');
    expect(crew).not.toContain('New Invoice');
    expect(crew).toContain('New Daily Log');
  });
});

const card = (over: Partial<PipelineCard>): PipelineCard => ({ id: '1', kind: 'estimates', title: 'Job', client: null, amount: 1000, status: 'Draft', date: null, updated_at: '', ...over });

describe('quote pipeline', () => {
  it('every stage maps to a real status of each module, and every status has a stage', () => {
    for (const kind of ['estimates', 'proposals'] as const) {
      const statuses = getModule(kind)!.statuses;
      const mapped = PIPELINE_STAGES.map((s) => s.accepts[kind]);
      expect([...mapped].sort()).toEqual([...statuses].sort());
    }
  });

  it('puts a card in the column for its status', () => {
    expect(stageOf(card({ status: 'Submitted' }))).toBe('sent');
    expect(stageOf(card({ kind: 'proposals', status: 'Accepted' }))).toBe('won');
    expect(stageOf(card({ kind: 'proposals', status: 'Declined' }))).toBe('lost');
    expect(stageOf(card({ status: 'Something else' }))).toBeNull();
  });

  it('gives the status a drop would set, and nothing for a drop that changes nothing', () => {
    expect(statusForDrop(card({ status: 'Draft' }), 'sent')).toBe('Submitted');
    expect(statusForDrop(card({ kind: 'proposals', status: 'Sent' }), 'won')).toBe('Accepted');
    expect(statusForDrop(card({ status: 'Draft' }), 'draft')).toBeNull();
    expect(statusForDrop(card({ status: 'Draft' }), 'nowhere')).toBeNull();
  });

  it('totals each stage in cents and skips cards with no price', () => {
    const totals = stageTotals([card({ amount: 0.1 }), card({ id: '2', amount: 0.2 }), card({ id: '3', amount: null }), card({ id: '4', status: 'Won', amount: 500 })]);
    expect(totals.draft).toEqual({ count: 3, amount: 0.3 });
    expect(totals.won).toEqual({ count: 1, amount: 500 });
    expect(totals.sent).toEqual({ count: 0, amount: 0 });
  });

  it('reports no win rate until something is decided', () => {
    expect(winRate([card({}), card({ id: '2', status: 'Submitted' })])).toBeNull();
    expect(winRate([card({ status: 'Won' }), card({ id: '2', status: 'Lost' }), card({ id: '3', kind: 'proposals', status: 'Accepted' })])).toBe(67);
  });

  it('reads a database row into a card without inventing a price', () => {
    expect(toCard('estimates', { id: 'a', title: 'Shutdown', status: 'Draft', client_name: '', total_amount: null, bid_due: '2026-12-01', updated_at: 'x' })).toEqual({
      id: 'a', kind: 'estimates', title: 'Shutdown', client: null, amount: null, status: 'Draft', date: '2026-12-01', updated_at: 'x',
    });
    expect(toCard('proposals', { id: 'b', title: 'P', status: 'Sent', client_name: 'Cargill', total_amount: '1250.50', valid_until: null, updated_at: 'y' })).toMatchObject({ amount: 1250.5, client: 'Cargill', date: null });
  });
});
