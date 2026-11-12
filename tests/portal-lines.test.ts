// Line items on the client portal. A shared proposal built from an estimate shows the client each
// line at its sell price and the totals, as the printed proposal does, and never a cost, labour
// hours, the labour rate or the markup. The database works the prices out (public.portal_view), so
// these tests hold it to lib/estimate-math.ts, which prints the contractor's copy. They call it the
// way lib/portal-server.ts does: as the service role.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { estimateTotals, lineSellPrice, type EstimateLine } from '@/lib/estimate-math';
import { formatMoney } from '@/lib/format';
import { hashPortalToken, newPortalToken, type PortalView } from '@/lib/portal';
import { bootDb, readMigration, type TestDb } from './helpers/db';

const mocks = vi.hoisted(() => ({ view: null as PortalView | null }));
vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
// The page reads the link through the server's service-role file; here it gets the payload the test hands it
vi.mock('@/lib/portal-server', () => ({ portalIp: () => '203.0.113.9', loadPortal: async () => ({ status: 'ok', view: mocks.view }) }));

import PortalPage from '@/app/portal/[token]/page';

const users = {
  ownerA: { id: '00000000-0000-4000-8000-0000000000a1', email: 'owner@alpha.ca' },
  pmA: { id: '00000000-0000-4000-8000-0000000000a3', email: 'pm@alpha.ca' },
  ownerB: { id: '00000000-0000-4000-8000-0000000000b1', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

interface Rates {
  labour_rate: number | null;
  markup_percentage: number;
  tax_percentage: number;
}
interface Item {
  description: string;
  quantity: number;
  unit: string;
  material_unit_cost: number;
  labour_hours_per_unit: number;
}

const VIEW = 'select public.portal_view($1) as v';
const SHARE = 'select public.create_proposal_share($1, $2) as expires';
const MIGRATION = '20261113000120_portal_lines.sql';
const line = (description: string, quantity: number, unit: string, material_unit_cost: number, labour_hours_per_unit: number): Item => ({ description, quantity, unit, material_unit_cost, labour_hours_per_unit });

/** A small seeded generator (mulberry32), so the generated estimates are the same on every run. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every number anywhere in a payload. */
const numbersIn = (value: unknown): number[] =>
  typeof value === 'number' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(numbersIn) : [];

const toCents = (x: number) => Math.round(x * 100);

describe('line items on the client portal', () => {
  let t: TestDb<U>;
  let alpha: string;
  let n = 0;

  /** A sent proposal made from a new estimate of company A, with a live link. */
  async function sharedEstimate(rates: Rates, items: Item[]): Promise<{ estimate: string; proposal: string; hash: string }> {
    const [{ id: estimate }] = await t.as<{ id: string }>(
      'pmA',
      `insert into public.estimates (title, status, client_name, client_address, labour_rate, markup_percentage, tax_percentage)
       values ($1, 'Draft', 'Cargill', '12 Plant Road, Regina SK', $2, $3, $4) returning id`,
      [`Panel job ${++n}`, rates.labour_rate, rates.markup_percentage, rates.tax_percentage]
    );
    await t.as('pmA', 'select public.save_estimate_items($1, $2)', [estimate, JSON.stringify(items)]);
    const [{ id: proposal }] = await t.as<{ id: string }>('pmA', 'select public.create_proposal_from_estimate($1) as id', [estimate]);
    await t.as('pmA', `update public.proposals set status = 'Sent' where id = $1`, [proposal]);
    const hash = hashPortalToken(newPortalToken());
    await t.as('pmA', SHARE, [proposal, hash]);
    return { estimate, proposal, hash };
  }

  /** A sent proposal typed by hand, with no estimate behind it, and a live link. */
  async function sharedByHand(): Promise<string> {
    const [{ id }] = await t.as<{ id: string }>('pmA', `insert into public.proposals (title, status, client_name, total_amount, scope_of_work) values ($1, 'Sent', 'Cargill', 12500, 'Replace MCC') returning id`, [`Typed ${++n}`]);
    const hash = hashPortalToken(newPortalToken());
    await t.as('pmA', SHARE, [id, hash]);
    return hash;
  }

  // As the server: the only caller the database allows
  const view = async (hash: string) => (await t.asService<{ v: PortalView | null }>(VIEW, [hash]))[0].v!;

  /** What the printed proposal prints for this estimate: lib/estimate-math.ts on the stored rows, read as the contractor. */
  async function printed(estimate: string) {
    const [est] = await t.as<{ labour_rate: unknown; markup_percentage: unknown; tax_percentage: unknown }>('ownerA', 'select labour_rate, markup_percentage, tax_percentage from public.estimates where id = $1', [estimate]);
    const items = await t.as<EstimateLine>('ownerA', 'select description, quantity, unit, material_unit_cost, labour_hours_per_unit from public.estimate_items where estimate_id = $1 order by sort, id', [estimate]);
    const totals = estimateTotals(items, est.labour_rate, est.markup_percentage, est.tax_percentage);
    return {
      lines: items.map((it, i) => ({ description: it.description, quantity: Number(it.quantity), unit: it.unit, amount: lineSellPrice(totals, i, est.labour_rate) })),
      totals: { subtotal: totals.beforeTax, tax_percentage: Number(est.tax_percentage) || 0, tax: totals.tax, total: totals.total },
      money: totals,
    };
  }

  /** The link shows exactly what the printed proposal prints, and the lines add up to the subtotal. */
  async function expectPrinted(hash: string, estimate: string) {
    const v = await view(hash);
    const want = await printed(estimate);
    expect(v.lines).toEqual(want.lines);
    expect(v.totals).toEqual(want.totals);
    expect(v.lines!.reduce((s, l) => s + toCents(l.amount), 0)).toBe(toCents(v.totals!.subtotal));
    expect(v.proposal!.total_amount).toBe(v.totals!.total);
    return { v, want };
  }

  beforeAll(async () => {
    t = await bootDb(users);
    alpha = await t.createCompany('ownerA', 'Alpha Electric');
    await t.createCompany('ownerB', 'Bravo Power');
    await t.join('ownerA', 'pmA', 'project_manager');
    await t.as('ownerA', `update public.companies set tax_number = '123456789 RT0001' where id = $1`, [alpha]);
  });

  it('prices each line as the printed proposal does: markup folded in, shares in whole cents', async () => {
    // Three lines that cost the same and a subtotal of 3101 cents: two lines get the spare cent, the first two
    const even = await sharedEstimate({ labour_rate: 0, markup_percentage: 3.37, tax_percentage: 5 }, [
      line('Duplex receptacle', 1, 'ea', 10, 0),
      line('Decora switch', 1, 'ea', 10, 0),
      line('Cover plate', 1, 'ea', 10, 0),
    ]);
    const { v } = await expectPrinted(even.hash, even.estimate);
    expect(v.lines!.map((l) => l.amount)).toEqual([10.34, 10.34, 10.33]);
    expect(v.totals).toEqual({ subtotal: 31.01, tax_percentage: 5, tax: 1.55, total: 32.56 });

    // Half a cent of material (1.5 x 0.33), part hours, a line of labour only, a line of nothing, and Quebec's 14.975% tax
    const odd = await sharedEstimate({ labour_rate: 87.5, markup_percentage: 12.5, tax_percentage: 14.975 }, [
      line('Cable tray, 300 mm', 1.5, 'm', 0.33, 0.125),
      line('Ground rod', 3, 'ea', 24.99, 0.75),
      line('Commissioning', 1, 'ls', 0, 6.333),
      line('Owner-supplied fixtures', 0, 'ea', 120, 0.5),
    ]);
    const second = await expectPrinted(odd.hash, odd.estimate);
    expect(second.v.lines![3].amount).toBe(0);

    // No labour rate on the company (hours count for nothing) and no markup or tax: the price is the material
    const plain = await sharedEstimate({ labour_rate: null, markup_percentage: 0, tax_percentage: 0 }, [line('Panel, 200 A', 1, 'ea', 1840.33, 7.75), line('Breakers', 12, 'ea', 18.45, 0.2)]);
    const third = await expectPrinted(plain.hash, plain.estimate);
    expect(third.v.lines!.map((l) => l.amount)).toEqual([1840.33, 221.4]);
    expect(third.v.totals).toEqual({ subtotal: 2061.73, tax_percentage: 0, tax: 0, total: 2061.73 });

    // One big line
    const big = await sharedEstimate({ labour_rate: 112.35, markup_percentage: 18.75, tax_percentage: 13 }, [line('Teck90 cable, 3C #2', 1250, 'm', 3.47, 0.042)]);
    const fourth = await expectPrinted(big.hash, big.estimate);
    expect(fourth.v.lines![0].amount).toBe(fourth.v.totals!.subtotal);

    // Shares that tie at exactly half a cent (742.5 and 247.5 of 990). Exact decimal sums would give the
    // spare cent to the first line; the TypeScript's doubles give it to the second, so the portal must too.
    const tie = await sharedEstimate({ labour_rate: 0, markup_percentage: 12.5, tax_percentage: 13 }, [line('Device box', 3, 'ea', 2.2, 0), line('Mud ring', 1, 'ea', 2.2, 0)]);
    const fifth = await expectPrinted(tie.hash, tie.estimate);
    expect(fifth.v.lines!.map((l) => l.amount)).toEqual([7.42, 2.48]);
    expect(fifth.v.totals).toEqual({ subtotal: 9.9, tax_percentage: 13, tax: 1.29, total: 11.19 });
  });

  it('agrees with the TypeScript to the cent on every line of a dozen generated estimates', async () => {
    const rand = generator(20261113);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    for (let e = 0; e < 12; e++) {
      const rates = { labour_rate: Math.round(rand() * 15_000) / 100, markup_percentage: pick([0, 7.5, 10, 12.5, 15, 17.25, 20, 33.33]), tax_percentage: pick([0, 5, 6, 11, 13, 14.975, 15]) };
      const items = Array.from({ length: 1 + Math.floor(rand() * 15) }, (_, i) =>
        line(
          `Line ${i + 1}`,
          rand() < 0.5 ? pick([1, 2, 3, 4, 10, 12, 25, 30, 150]) : Math.round(rand() * 200_000) / 1000,
          pick(['ea', 'm', 'ft', 'ls', 'h']),
          rand() < 0.15 ? 0 : Math.round(rand() * 50_000) / 100,
          rand() < 0.2 ? 0 : Math.round(rand() * 4_000) / 1000
        )
      );
      const { estimate, hash } = await sharedEstimate(rates, items);
      await expectPrinted(hash, estimate);
    }
  });

  it('agrees on estimates built to tie and to land on fractions of a cent', async () => {
    const rand = generator(7);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    for (let e = 0; e < 16; e++) {
      const rates = { labour_rate: pick([0, 0.1, 0.3, 33.33, 87.5, 112.35]), markup_percentage: pick([0, 0.01, 3.37, 12.5, 33.33, 99.99]), tax_percentage: pick([0, 5, 9.975, 13, 14.975]) };
      // Even rounds: every line the same, so the spare cents go by position alone.
      // Odd rounds: decimals binary can't hold exactly (0.1, 0.3) and amounts far below a cent.
      const same = line('Same', pick([0.1, 0.3, 1, 7]), 'ea', pick([0.1, 0.33, 1.1, 10]), pick([0, 0.1, 0.333]));
      const items = Array.from({ length: 2 + Math.floor(rand() * 10) }, (_, i) =>
        e % 2 === 0
          ? { ...same, description: `Line ${i + 1}` }
          : line(`Line ${i + 1}`, pick([0.001, 0.1, 0.2, 0.3, 1.1, 3.3]), 'ea', pick([0, 0.01, 0.05, 0.1, 0.3, 1.15]), pick([0, 0.001, 0.1, 0.3]))
      );
      const { estimate, hash } = await sharedEstimate(rates, items);
      await expectPrinted(hash, estimate);
    }
  });

  it('never sends a cost, labour hours, the labour rate or the markup', async () => {
    const { estimate, proposal, hash } = await sharedEstimate({ labour_rate: 93.17, markup_percentage: 17.25, tax_percentage: 5 }, [
      line('Main breaker panel, 200 A', 1, 'ea', 1840.33, 7.75),
      line('Branch circuit wiring', 120, 'm', 2.41, 0.065),
      line('Permit and inspection', 1, 'ls', 350, 0),
    ]);
    const { v, want } = await expectPrinted(hash, estimate);
    const text = JSON.stringify(v);

    // Only these fields, at every level
    expect(Object.keys(v).sort()).toEqual(['company', 'decided_at', 'expires_at', 'lines', 'proposal', 'signer_name', 'state', 'totals']);
    for (const l of v.lines!) expect(Object.keys(l).sort()).toEqual(['amount', 'description', 'quantity', 'unit']);
    expect(Object.keys(v.totals!).sort()).toEqual(['subtotal', 'tax', 'tax_percentage', 'total']);
    expect(Object.keys(v.proposal!).sort()).toEqual(['client_address', 'client_name', 'created_on', 'scope_of_work', 'terms', 'title', 'total_amount', 'valid_until']);
    expect(Object.keys(v.company).sort()).toEqual(['address', 'contact', 'email', 'name', 'phone', 'tax_number']);
    expect(text).not.toMatch(/cost|hour|labou?r|rate|markup|material|stripe|token/i);
    // No id of any record
    const [{ ids }] = await t.asSystem<{ ids: string[] }>('select array_agg(id::text) as ids from public.estimate_items where estimate_id = $1', [estimate]);
    for (const id of [estimate, proposal, alpha, ...ids]) expect(text).not.toContain(id);

    // And none of the numbers behind the price: unit costs, hours, the rate, the markup and every sum of cost
    const sent = numbersIn(v);
    const m = want.money;
    for (const secret of [1840.33, 7.75, 2.41, 0.065, 350, 93.17, 17.25, m.material, m.labourHours, m.labour, m.subtotal, m.markup, ...m.lines.map((l) => l.material)]) {
      expect(sent, String(secret)).not.toContain(secret);
    }
    // What the client does see: the address it was prepared for, and the company's GST/HST number
    expect(v.proposal!.client_address).toBe('12 Plant Road, Regina SK');
    expect(v.company.tax_number).toBe('123456789 RT0001');
  });

  it('a proposal typed by hand has no lines and no totals: the client sees its total alone', async () => {
    const v = await view(await sharedByHand());
    expect(v.state).toBe('open');
    expect(v.lines).toBeUndefined();
    expect(v.totals).toBeUndefined();
    expect(v.proposal).toMatchObject({ client_name: 'Cargill', total_amount: 12500, client_address: null });
  });

  it('an estimate with no lines sends an empty list and zero totals', async () => {
    const { hash } = await sharedEstimate({ labour_rate: 90, markup_percentage: 15, tax_percentage: 5 }, []);
    const v = await view(hash);
    expect(v.lines).toEqual([]);
    expect(v.totals).toEqual({ subtotal: 0, tax_percentage: 5, tax: 0, total: 0 });
  });

  it('a closed link shows no lines; an answered one keeps showing them', async () => {
    const items = [line('Transformer pad', 1, 'ea', 2200, 4), line('Bonding jumpers', 6, 'ea', 11.5, 0.25)];
    const revoked = await sharedEstimate({ labour_rate: 95, markup_percentage: 20, tax_percentage: 5 }, items);
    await t.as('pmA', 'select public.revoke_proposal_share($1)', [revoked.proposal]);
    const closed = await view(revoked.hash);
    expect(closed.state).toBe('closed');
    expect(closed.lines).toBeUndefined();
    expect(closed.totals).toBeUndefined();
    expect(JSON.stringify(closed)).not.toMatch(/Transformer|Bonding/);

    const signed = await sharedEstimate({ labour_rate: 95, markup_percentage: 20, tax_percentage: 5 }, items);
    await t.asService('select public.portal_decide($1, $2, $3, $4, $5, $6, $7)', [signed.hash, 'accepted', 'Dana Smith', 'data:image/png;base64,iVBORw0KGgo=', null, null, null]);
    const { v } = await expectPrinted(signed.hash, signed.estimate);
    expect(v.state).toBe('accepted');
    expect(v.lines!.map((l) => l.description)).toEqual(['Transformer pad', 'Bonding jumpers']);
  });

  it("never reads another company's estimate, even with the link forced onto one", async () => {
    const [{ id: theirs }] = await t.as<{ id: string }>('ownerB', `insert into public.estimates (title, status, labour_rate, markup_percentage, tax_percentage) values ('Bravo secret bid', 'Draft', 80, 20, 5) returning id`);
    await t.as('ownerB', 'select public.save_estimate_items($1, $2)', [theirs, JSON.stringify([line('Bravo switchgear', 1, 'ea', 12345, 10)])]);
    const [{ id: proposal }] = await t.as<{ id: string }>('pmA', `insert into public.proposals (title, status, total_amount) values ('Forced', 'Sent', 100) returning id`);
    const hash = hashPortalToken(newPortalToken());
    await t.as('pmA', SHARE, [proposal, hash]);
    // Past every trigger that would refuse it, as only a database owner could
    await t.asSystem('alter table public.proposals disable trigger user');
    try {
      await t.asSystem('update public.proposals set estimate_id = $1 where id = $2', [theirs, proposal]);
    } finally {
      await t.asSystem('alter table public.proposals enable trigger user');
    }
    const v = await view(hash);
    expect(v.state).toBe('open');
    expect(v.lines).toBeUndefined();
    expect(v.totals).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain('Bravo');
    expect(numbersIn(v)).toEqual([100]);
  });

  it('only the server can call it: not a visitor with the public key, not a signed-in user', async () => {
    const { hash } = await sharedEstimate({ labour_rate: 90, markup_percentage: 15, tax_percentage: 5 }, [line('Disconnect, 60 A', 1, 'ea', 210, 1.5)]);
    for (const who of [null, 'ownerA', 'pmA', 'ownerB'] as const) expect(await t.fails(who, VIEW, [hash])).toMatch(/permission denied/);
    const grants = async () =>
      (
        await t.asSystem<Record<string, unknown>>(
          `select p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
             has_function_privilege('service_role', p.oid, 'execute') as server
           from pg_proc p where p.oid = 'public.portal_view(text)'::regprocedure`
        )
      )[0];
    expect(await grants()).toEqual({ prosecdef: true, proconfig: ['search_path=""'], anon: false, signed_in: false, server: true });
    // Safe to run again, and running it again changes nothing about who may call it
    await t.pg.exec(readMigration(MIGRATION));
    await t.pg.exec(readMigration(MIGRATION));
    expect(await grants()).toEqual({ prosecdef: true, proconfig: ['search_path=""'], anon: false, signed_in: false, server: true });
    expect((await view(hash)).lines).toHaveLength(1);
  });

  describe("the client's page", () => {
    const render = async (v: PortalView) => {
      mocks.view = v;
      return renderToStaticMarkup(await PortalPage({ params: { token: newPortalToken() } }));
    };

    it('lists the lines and totals the way the printed proposal does', async () => {
      const { hash } = await sharedEstimate({ labour_rate: 87.5, markup_percentage: 12.5, tax_percentage: 14.975 }, [
        line('Cable tray, 300 mm', 1.5, 'm', 0.33, 0.125),
        line('Ground rod', 3, 'ea', 24.99, 0.75),
      ]);
      const v = await view(hash);
      const html = await render(v);
      expect(html).toMatch(/<table[\s\S]*Description[\s\S]*Qty[\s\S]*Unit[\s\S]*Amount/);
      for (const l of v.lines!) {
        expect(html).toContain(`>${l.description}<`);
        expect(html).toContain(`>${formatMoney(l.amount)}<`);
      }
      expect(html).toContain('>1.5<');
      // One piece of text each, so nothing splits them
      expect(html).toContain(`>Tax (14.975%)<`);
      expect(html).toContain(`>Subtotal</dt><dd>${formatMoney(v.totals!.subtotal)}<`);
      expect(html).toContain(`>Total (CAD)</dt><dd>${formatMoney(v.totals!.total)}<`);
      expect(html).toContain('12 Plant Road, Regina SK');
      expect(html).toContain('GST/HST No. 123456789 RT0001');
      expect(html).not.toContain('Total price');
      expect(html).not.toMatch(/markup|labour|hours/i);
    });

    it('an estimate with no lines shows its totals and no table', async () => {
      const { hash } = await sharedEstimate({ labour_rate: 90, markup_percentage: 15, tax_percentage: 5 }, []);
      const html = await render(await view(hash));
      expect(html).not.toContain('<table');
      expect(html).toContain(`>Subtotal</dt><dd>${formatMoney(0)}<`);
      expect(html).toContain('>Tax (5%)<');
      expect(html).not.toContain('Total price');
    });

    it('a proposal typed by hand keeps its single total and shows no table', async () => {
      const html = await render(await view(await sharedByHand()));
      expect(html).toContain('Total price');
      expect(html).toContain(formatMoney(12500));
      expect(html).not.toContain('<table');
      expect(html).not.toContain('Subtotal');
    });
  });
});
