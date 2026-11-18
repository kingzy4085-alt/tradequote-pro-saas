// Route-level tests for the Stripe webhook and checkout, with Stripe and Supabase mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fake-supabase';

type Sub = { id: string; customer: string; status: string; current_period_end: number; created: number; metadata?: Record<string, string> };

const mocks = vi.hoisted(() => ({
  stripe: null as unknown,
  admin: null as unknown,
  ctx: null as unknown,
}));

vi.mock('@/lib/billing', async (original) => ({
  ...(await original<typeof import('@/lib/billing')>()),
  getStripe: () => {
    if (!mocks.stripe) throw new Error('Missing environment variable STRIPE_SECRET_KEY.');
    return mocks.stripe;
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mocks.admin, createSupabaseServerClient: () => mocks.admin }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), requireApi: async () => mocks.ctx }));

import { POST as checkout } from '@/app/api/billing/checkout/route';
import { POST as webhook } from '@/app/api/stripe/webhook/route';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const PERIOD = 1_900_000_000;

function fakeStripe(subs: Sub[]) {
  const store = new Map(subs.map((s) => [s.id, s]));
  return {
    store,
    webhooks: {
      constructEvent: (body: string, signature: string) => {
        if (signature !== 'good') throw new Error('bad signature');
        return JSON.parse(body);
      },
    },
    subscriptions: {
      retrieve: vi.fn(async (id: string) => {
        const sub = store.get(id);
        if (!sub) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
        return sub;
      }),
      list: vi.fn(async ({ customer }: { customer: string }) => ({ data: [...store.values()].filter((s) => s.customer === customer) })),
    },
    customers: { create: vi.fn(async () => ({ id: 'cus_new' })) },
    checkout: { sessions: { create: vi.fn(async () => ({ url: 'https://checkout.example/s' })) } },
  };
}

const sub = (id: string, status: string, extra: Partial<Sub> = {}): Sub => ({ id, customer: 'cus_1', status, current_period_end: PERIOD, created: 1, ...extra });

let eventCounter = 0;
function post(type: string, object: Record<string, unknown>, signature = 'good', id = `evt_${++eventCounter}`) {
  return webhook(
    new Request('https://app.test/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: JSON.stringify({ id, type, data: { object } }),
    })
  );
}

function setup(company: Record<string, unknown>, subs: Sub[]) {
  const stripe = fakeStripe(subs);
  const admin = fakeSupabase(
    { companies: [{ id: COMPANY, stripe_customer_id: 'cus_1', stripe_subscription_id: null, subscription_status: 'trialing', ...company }], stripe_events: [] },
    { keys: { stripe_events: 'id' } }
  );
  mocks.stripe = stripe;
  mocks.admin = admin;
  return { stripe, admin, company: () => admin.tables.companies[0] };
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.STRIPE_PRICE_ID = 'price_test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('webhook: signature and configuration', () => {
  it('rejects a missing or bad signature with 400', async () => {
    setup({}, []);
    const noSig = await webhook(new Request('https://app.test/x', { method: 'POST', body: '{}' }));
    expect(noSig.status).toBe(400);
    const bad = await post('customer.subscription.updated', { id: 'sub_1' }, 'forged');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid signature');
  });

  it('reports a missing webhook secret as misconfiguration (500), not a bad signature', async () => {
    setup({}, []);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await post('customer.subscription.updated', { id: 'sub_1' });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Webhook is not configured');
  });

  it('reports a missing Stripe key as misconfiguration instead of throwing', async () => {
    setup({}, []);
    mocks.stripe = null;
    const res = await post('customer.subscription.updated', { id: 'sub_1' });
    expect(res.status).toBe(500);
  });
});

describe('webhook: a free trial survives a failed first payment', () => {
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it.each(['incomplete', 'incomplete_expired', 'canceled', 'unpaid'])('a first subscription that is %s leaves the trial company as it was', async (status) => {
    const { company } = setup({ trial_ends_at: future }, [sub('sub_try', status)]);
    expect((await post('customer.subscription.created', sub('sub_try', status))).status).toBe(200);
    expect(company()).toMatchObject({ subscription_status: 'trialing', stripe_subscription_id: null });
  });

  it('the same subscription activates the company once the payment goes through', async () => {
    const { company, stripe } = setup({ trial_ends_at: future }, [sub('sub_try', 'incomplete')]);
    await post('customer.subscription.created', sub('sub_try', 'incomplete'));
    stripe.store.set('sub_try', sub('sub_try', 'active'));
    await post('customer.subscription.updated', sub('sub_try', 'active'));
    expect(company()).toMatchObject({ subscription_status: 'active', stripe_subscription_id: 'sub_try' });
  });

  it('once the trial is over, an unpaid attempt is recorded as before', async () => {
    const { company } = setup({ trial_ends_at: past }, [sub('sub_try', 'incomplete')]);
    await post('customer.subscription.created', sub('sub_try', 'incomplete'));
    expect(company()).toMatchObject({ subscription_status: 'incomplete', stripe_subscription_id: 'sub_try' });
  });
});

describe('webhook: reordered events', () => {
  it('a late "created" with status incomplete cannot lock a paying customer', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_1', subscription_status: 'active' }, [sub('sub_1', 'active')]);
    const res = await post('customer.subscription.created', sub('sub_1', 'incomplete'));
    expect(res.status).toBe(200);
    expect(company().subscription_status).toBe('active');
  });

  it('a late "updated" cannot reactivate a cancelled company', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_1', subscription_status: 'canceled' }, [sub('sub_1', 'canceled')]);
    await post('customer.subscription.updated', sub('sub_1', 'active'));
    expect(company().subscription_status).toBe('canceled');
  });

  it('checkout completed sets the subscription from Stripe', async () => {
    const { company } = setup({}, [sub('sub_1', 'active')]);
    await post('checkout.session.completed', { mode: 'subscription', subscription: 'sub_1', client_reference_id: COMPANY });
    expect(company()).toMatchObject({ stripe_subscription_id: 'sub_1', subscription_status: 'active' });
    expect(company().current_period_end).toBe(new Date(PERIOD * 1000).toISOString());
  });

  it('ignores a one-off payment checkout', async () => {
    const { company, stripe } = setup({}, []);
    expect((await post('checkout.session.completed', { mode: 'payment' })).status).toBe(200);
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(company().subscription_status).toBe('trialing');
  });
});

describe('webhook: two subscriptions', () => {
  it('deleting an old subscription does not cancel a company on a newer live one', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_new', subscription_status: 'active' }, [sub('sub_old', 'canceled'), sub('sub_new', 'active')]);
    await post('customer.subscription.deleted', sub('sub_old', 'canceled'));
    expect(company()).toMatchObject({ stripe_subscription_id: 'sub_new', subscription_status: 'active' });
  });

  it('events for another live subscription are ignored while the current one is live', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_1', subscription_status: 'active' }, [sub('sub_1', 'active'), sub('sub_2', 'past_due')]);
    await post('customer.subscription.updated', sub('sub_2', 'past_due'));
    expect(company()).toMatchObject({ stripe_subscription_id: 'sub_1', subscription_status: 'active' });
  });

  it('a paid subscription replaces an unfinished first attempt straight away', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_try', subscription_status: 'incomplete' }, [sub('sub_try', 'incomplete'), sub('sub_paid', 'active')]);
    await post('customer.subscription.created', sub('sub_paid', 'active'));
    expect(company()).toMatchObject({ stripe_subscription_id: 'sub_paid', subscription_status: 'active' });
  });

  it('an unfinished attempt stays put against another unfinished one', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_try', subscription_status: 'incomplete' }, [sub('sub_try', 'incomplete'), sub('sub_try2', 'incomplete')]);
    await post('customer.subscription.created', sub('sub_try2', 'incomplete'));
    expect(company()).toMatchObject({ stripe_subscription_id: 'sub_try', subscription_status: 'incomplete' });
  });

  it('a new subscription takes over once the current one has ended', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_old', subscription_status: 'canceled' }, [sub('sub_old', 'canceled'), sub('sub_new', 'active')]);
    await post('customer.subscription.created', sub('sub_new', 'active'));
    expect(company()).toMatchObject({ stripe_subscription_id: 'sub_new', subscription_status: 'active' });
  });

  it('a new one still takes over when the old one is gone from Stripe', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_gone', subscription_status: 'active' }, [sub('sub_new', 'active')]);
    await post('customer.subscription.updated', sub('sub_new', 'active'));
    expect(company().stripe_subscription_id).toBe('sub_new');
  });

  it('when the current one ends and another is live, the company moves to the live one', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_1', subscription_status: 'active' }, [sub('sub_1', 'canceled'), sub('sub_2', 'active')]);
    await post('customer.subscription.deleted', sub('sub_1', 'canceled'));
    expect(company()).toMatchObject({ stripe_subscription_id: 'sub_2', subscription_status: 'active' });
  });

  it('an ended subscription never replaces another ended one', async () => {
    const { company } = setup({ stripe_subscription_id: 'sub_1', subscription_status: 'canceled' }, [sub('sub_1', 'canceled'), sub('sub_0', 'canceled')]);
    await post('customer.subscription.deleted', sub('sub_0', 'canceled'));
    expect(company().stripe_subscription_id).toBe('sub_1');
  });
});

describe('webhook: finding the company', () => {
  it('falls back to metadata.company_id and links the customer', async () => {
    const { company } = setup({ stripe_customer_id: null }, [sub('sub_1', 'active', { metadata: { company_id: COMPANY } })]);
    await post('customer.subscription.updated', sub('sub_1', 'active'));
    expect(company()).toMatchObject({ stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_status: 'active' });
  });

  it('metadata cannot move a subscription onto a company billing through another customer', async () => {
    const { company } = setup({ stripe_customer_id: 'cus_other' }, [sub('sub_1', 'active', { metadata: { company_id: COMPANY } })]);
    expect((await post('customer.subscription.updated', sub('sub_1', 'active'))).status).toBe(200);
    expect(company()).toMatchObject({ stripe_customer_id: 'cus_other', stripe_subscription_id: null, subscription_status: 'trialing' });
  });

  it('an unknown customer is acknowledged without changing anything', async () => {
    const { admin, company } = setup({ stripe_customer_id: 'cus_other' }, [sub('sub_1', 'active')]);
    const res = await post('customer.subscription.updated', sub('sub_1', 'active'));
    expect(res.status).toBe(200);
    expect(company().stripe_subscription_id).toBeNull();
    expect(admin.tables.stripe_events[0].processed_at).toBeTruthy();
  });
});

describe('webhook: idempotency', () => {
  it('a finished event is reported as a duplicate and not run again', async () => {
    const { stripe } = setup({}, [sub('sub_1', 'active')]);
    await post('customer.subscription.updated', sub('sub_1', 'active'), 'good', 'evt_same');
    stripe.subscriptions.retrieve.mockClear();
    const res = await post('customer.subscription.updated', sub('sub_1', 'active'), 'good', 'evt_same');
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it('a recorded event without processed_at runs again when Stripe retries', async () => {
    const { admin, company } = setup({}, [sub('sub_1', 'active')]);
    admin.tables.stripe_events.push({ id: 'evt_crashed', type: 'customer.subscription.updated', processed_at: null });
    const res = await post('customer.subscription.updated', sub('sub_1', 'active'), 'good', 'evt_crashed');
    expect(await res.json()).toEqual({ received: true });
    expect(company().subscription_status).toBe('active');
    expect(admin.tables.stripe_events[0].processed_at).toBeTruthy();
  });

  it('a failure returns 500 and leaves the event retryable', async () => {
    const { stripe, admin, company } = setup({}, [sub('sub_1', 'active')]);
    stripe.subscriptions.retrieve.mockRejectedValueOnce(new Error('Stripe is down'));
    const first = await post('customer.subscription.updated', sub('sub_1', 'active'), 'good', 'evt_retry');
    expect(first.status).toBe(500);
    expect(admin.tables.stripe_events[0].processed_at).toBeUndefined();
    const second = await post('customer.subscription.updated', sub('sub_1', 'active'), 'good', 'evt_retry');
    expect(second.status).toBe(200);
    expect(company().subscription_status).toBe('active');
  });

  it('unhandled event types are acknowledged and not recorded', async () => {
    const { admin } = setup({}, []);
    expect((await post('invoice.paid', {})).status).toBe(200);
    expect(admin.tables.stripe_events).toEqual([]);
  });
});

describe('checkout', () => {
  function company(extra: Record<string, unknown> = {}) {
    return { id: COMPANY, name: 'Alpha', province: 'SK', subscription_status: 'trialing', trial_ends_at: '2030-01-01', current_period_end: null, stripe_customer_id: 'cus_1', stripe_subscription_id: null, ...extra };
  }
  const asOwner = (extra?: Record<string, unknown>) => {
    mocks.ctx = { user: { id: 'u1', email: 'owner@alpha.ca' }, role: 'owner', company: company(extra), canWrite: true };
  };

  it.each([
    ['active', { subscription_status: 'active', stripe_subscription_id: 'sub_1' }],
    ['past_due', { subscription_status: 'past_due', stripe_subscription_id: 'sub_1' }],
    ['a live subscription with any other status', { subscription_status: 'trialing', stripe_subscription_id: 'sub_1' }],
  ])('sends %s to the portal without creating a session', async (_name, extra) => {
    const { stripe } = setup({}, []);
    asOwner(extra);
    const res = await checkout();
    expect(res.status).toBe(409);
    expect((await res.json()).portal).toBe(true);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });

  it.each(['active', 'past_due', 'unpaid', 'trialing'])('Stripe showing a %s subscription we have not heard about blocks a second one', async (status) => {
    const { stripe } = setup({}, [sub('sub_1', status)]);
    asOwner();
    const res = await checkout();
    expect(res.status).toBe(409);
    expect((await res.json()).portal).toBe(true);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('a cancelled company can subscribe again, with an idempotency key', async () => {
    const { stripe } = setup({}, [sub('sub_old', 'canceled')]);
    asOwner({ subscription_status: 'canceled', stripe_subscription_id: 'sub_old' });
    const res = await checkout();
    expect(await res.json()).toEqual({ url: 'https://checkout.example/s' });
    const [params, opts] = stripe.checkout.sessions.create.mock.calls[0] as unknown as [{ client_reference_id: string }, { idempotencyKey: string }];
    expect(params.client_reference_id).toBe(COMPANY);
    expect(opts.idempotencyKey).toMatch(new RegExp(`^checkout:${COMPANY}:price_test:\\d+$`));
  });

  it('a double click uses the same idempotency key', async () => {
    const { stripe } = setup({}, []);
    asOwner();
    await checkout();
    await checkout();
    const keys = stripe.checkout.sessions.create.mock.calls.map((c) => (c as unknown as [unknown, { idempotencyKey: string }])[1].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('creates the Stripe customer once, with its own idempotency key', async () => {
    const { stripe, admin } = setup({ stripe_customer_id: null }, []);
    asOwner({ stripe_customer_id: null });
    expect((await checkout()).status).toBe(200);
    expect((stripe.customers.create.mock.calls[0] as unknown as [unknown, { idempotencyKey: string }])[1].idempotencyKey).toBe(`customer:${COMPANY}:u1`);
    expect(admin.tables.companies[0].stripe_customer_id).toBe('cus_new');
  });

  it('refuses to start if Stripe cannot confirm there is no live subscription', async () => {
    const { stripe } = setup({}, []);
    asOwner();
    stripe.subscriptions.list.mockRejectedValueOnce(new Error('Stripe is down'));
    expect((await checkout()).status).toBe(502);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});
