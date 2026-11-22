// The assistant's costing tools, run against the real cost engine and calculator registry with
// Supabase faked. No network: nothing here calls the Anthropic SDK.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assistantTools, runAssistantTool, SYSTEM_PROMPT, validateCalcInput, type AssistantToolContext } from '@/lib/assistant';
import { CALCULATORS, getCalculator, inputSchema, runCalculator } from '@/lib/calc/registry';
import { CATALOG, COSTBOOK_AS_OF, billingRate, getRegion, labourCost, priceTakeoff, salesTax } from '@/lib/costbook';
import type { Role } from '@/lib/roles';
import { fakeSupabase } from './helpers/fake-supabase';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const names = (role: Role) => assistantTools(role).map((t) => t.name);
const ctxFor = (role: Role, rows: Record<string, unknown>[] = [], province = 'AB', options: Parameters<typeof fakeSupabase>[1] = {}) => {
  const supabase = fakeSupabase({ material_price_book: rows }, options);
  return { supabase: supabase as never, role, companyId: COMPANY_ID, province } satisfies AssistantToolContext;
};
const run = async (tc: AssistantToolContext, name: string, input: unknown) => {
  const out = await runAssistantTool(tc, name, input);
  return { ...out, json: out.isError ? null : JSON.parse(out.content) };
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('tool definitions per role', () => {
  it('gives crew the record search and unpriced calculators only', () => {
    expect(names('electrician')).toEqual(['search_company_records', 'run_calculator']);
    expect(names('foreman')).toEqual(['search_company_records', 'run_calculator']);
    const calc = assistantTools('foreman').find((t) => t.name === 'run_calculator')!;
    expect(calc.description).not.toContain('priced');
  });

  it('gives roles that can read estimates every tool', () => {
    for (const role of ['project_manager', 'admin', 'owner'] as Role[]) {
      expect(names(role)).toEqual(['search_company_records', 'lookup_costs', 'labour_rates', 'run_calculator']);
    }
    expect(assistantTools('owner').find((t) => t.name === 'run_calculator')!.description).toContain('priced');
  });

  it('lists every calculator id and keeps the tool list stable between calls (cacheable)', () => {
    const calc = assistantTools('owner').find((t) => t.name === 'run_calculator')!;
    const ids = (calc.input_schema.properties as { id: { enum: string[] } }).id.enum;
    expect(ids).toEqual(CALCULATORS.map((c) => c.id));
    expect(JSON.stringify(assistantTools('owner'))).toBe(JSON.stringify(assistantTools('owner')));
  });

  it('refuses a tool the role is not offered, even if the model asks for it', async () => {
    for (const [name, input] of [['lookup_costs', { query: 'wire' }], ['labour_rates', { labour_class: 'electrician' }]] as const) {
      const out = await run(ctxFor('electrician'), name, input);
      expect(out.isError).toBe(true);
      expect(out.content).toContain('not available');
    }
    expect((await run(ctxFor('electrician'), 'no_such_tool', {})).isError).toBe(true);
  });
});

describe('system prompt', () => {
  it('is stable and states the pricing rules', () => {
    expect(SYSTEM_PROMPT).toContain(COSTBOOK_AS_OF);
    for (const word of ['lookup_costs', 'labour_rates', 'run_calculator', 'salesTax', 'Never invent']) expect(SYSTEM_PROMPT).toContain(word);
    expect(SYSTEM_PROMPT).toContain('copyrighted');
    expect(SYSTEM_PROMPT).toMatch(/company has saved its own price/);
  });
});

describe('lookup_costs', () => {
  const item = CATALOG[0];
  const word = item.description.split(/\s+/)[0];

  it('prices catalog items for the company region from the reference catalog', async () => {
    const out = await run(ctxFor('project_manager', [], 'BC'), 'lookup_costs', { query: item.code });
    expect(out.isError).toBe(false);
    expect(out.json.region).toBe(getRegion('BC').name);
    expect(out.json.referencePricesAsOf).toBe(COSTBOOK_AS_OF);
    expect(out.json.salesTax).toEqual(salesTax('BC'));
    const hit = out.json.items.find((i: { code: string }) => i.code === item.code);
    expect(hit).toMatchObject({
      code: item.code,
      unit: item.unit,
      // Exactly what the pricing engine charges in BC: regional price plus the 7% PST a BC contractor pays on materials
      unitCost: priceTakeoff([{ code: item.code, description: '', quantity: 1, unit: item.unit }], { region: getRegion('BC').code })[0].materialUnitCost,
      labourHoursPerUnit: item.labourHours,
      source: item.source,
      asOf: item.asOf,
      confidence: item.confidence,
      priceSource: 'reference',
    });
  });

  it('lets the company price win and adds company-only items', async () => {
    const rows = [
      { company_id: COMPANY_ID, item_code: item.code, description: 'x', unit: item.unit, unit_cost: '12.34' },
      { company_id: COMPANY_ID, item_code: 'SHOP-WIDGET-9', description: 'Shop widget nine', unit: 'ea', unit_cost: 7 },
      { company_id: 'other-company', item_code: item.code, description: 'x', unit: item.unit, unit_cost: 999 },
    ];
    const out = await run(ctxFor('owner', rows), 'lookup_costs', { query: item.code });
    expect(out.json.companyPricesFound).toBe(2);
    expect(out.json.items.find((i: { code: string }) => i.code === item.code)).toMatchObject({ unitCost: 12.34, priceSource: 'company', source: 'company price book' });

    const own = await run(ctxFor('owner', rows), 'lookup_costs', { query: 'widget nine' });
    expect(own.json.items).toEqual([expect.objectContaining({ code: 'SHOP-WIDGET-9', unitCost: 7, priceSource: 'company' })]);
  });

  it('carries on with reference prices when the price book cannot be read', async () => {
    const tc = ctxFor('owner', [], 'ON', { failOn: ({ table }) => (table === 'material_price_book' ? { message: 'boom' } : null) });
    const out = await run(tc, 'lookup_costs', { query: item.code });
    expect(out.isError).toBe(false);
    expect(out.json.companyPricesFound).toBe(0);
    expect(out.json.items[0].priceSource).toBe('reference');
    expect(out.content).not.toContain('boom');
  });

  it('matches by words, honours the limit and rejects bad input', async () => {
    const out = await run(ctxFor('owner'), 'lookup_costs', { query: word, limit: 2 });
    expect(out.json.items.length).toBeLessThanOrEqual(2);
    expect((await run(ctxFor('owner'), 'lookup_costs', { query: 'zzzz-nothing' })).json.items).toEqual([]);
    for (const bad of [{}, { query: '' }, { query: 'x', limit: 99 }, { query: 'x', trade: 'astrology' }]) expect((await run(ctxFor('owner'), 'lookup_costs', bad)).isError).toBe(true);
  });
});

describe('labour_rates', () => {
  it('returns the burdened cost and charge-out rate the cost engine computes', async () => {
    const out = await run(ctxFor('project_manager', [], 'ON'), 'labour_rates', { labour_class: 'electrician' });
    expect(out.json.cost).toEqual(labourCost('electrician', 'ON', { shop: 'open' }));
    expect(out.json.chargeOutRatePerHour).toBe(billingRate('electrician', 'ON', { shop: 'open', utilizationPct: 80, overheadPct: 20, profitPct: 15 }));
    expect(out.json.assumptions).toEqual({ shop: 'open', utilizationPct: 80, overheadPct: 20, profitPct: 15 });
  });

  it('honours union shop and custom assumptions, and rejects unknown classes', async () => {
    const out = await run(ctxFor('admin', [], 'AB'), 'labour_rates', { labour_class: 'pipefitter', shop: 'union', utilization_pct: 70, overhead_pct: 10, profit_pct: 5 });
    expect(out.json.cost.shop).toBe('union');
    expect(out.json.chargeOutRatePerHour).toBe(billingRate('pipefitter', 'AB', { shop: 'union', utilizationPct: 70, overheadPct: 10, profitPct: 5 }));
    for (const bad of [{ labour_class: 'wizard' }, { labour_class: 'electrician', shop: 'closed' }, { labour_class: 'electrician', utilization_pct: 5 }]) {
      expect((await run(ctxFor('admin'), 'labour_rates', bad)).isError).toBe(true);
    }
  });
});

describe('run_calculator', () => {
  const calc = CALCULATORS[0];
  const firstNumber = calc.fields.find((f) => f.type === 'number')!;

  it('validates input against inputSchema', () => {
    expect(validateCalcInput(calc, undefined)).toEqual({ ok: true, input: {} });
    expect(validateCalcInput(calc, { nope: 1 })).toMatchObject({ ok: false });
    expect(validateCalcInput(calc, { [firstNumber.key]: 'ten' })).toMatchObject({ ok: false });
    expect(validateCalcInput(calc, { [firstNumber.key]: Number.NaN })).toMatchObject({ ok: false });
    expect(validateCalcInput(calc, [1])).toMatchObject({ ok: false });
    expect(validateCalcInput(calc, { [firstNumber.key]: firstNumber.default })).toMatchObject({ ok: true });
    const select = CALCULATORS.flatMap((c) => c.fields.map((f) => ({ c, f }))).find(({ f }) => f.type === 'select');
    if (select) {
      expect(validateCalcInput(select.c, { [select.f.key]: 'not-an-option' })).toMatchObject({ ok: false });
      expect(Object.keys(inputSchema(select.c).properties)).toContain(select.f.key);
    }
  });

  it('returns the answer, warnings, references and a priced takeoff for roles that see costs', async () => {
    const rows = calc.run({}).takeoff[0]?.code ? [{ company_id: COMPANY_ID, item_code: calc.run({}).takeoff[0].code, description: 'd', unit: 'u', unit_cost: 5 }] : [];
    const out = await run(ctxFor('project_manager', rows, 'AB'), 'run_calculator', { id: calc.id, input: {} });
    const direct = runCalculator(calc.id, {})!;
    expect(out.isError).toBe(false);
    expect(out.json.summary).toEqual(direct.summary);
    expect(out.json.values).toEqual(direct.values);
    expect(out.json.warnings).toEqual(direct.warnings);
    expect(out.json.references).toEqual(direct.references);
    const companyPrices = rows.map((r) => ({ itemCode: r.item_code as string, unitCost: 5, description: 'd', unit: 'u' }));
    expect(out.json.takeoff).toEqual(JSON.parse(JSON.stringify(priceTakeoff(direct.takeoff, { region: 'AB', companyPrices }))));
    expect(out.json.salesTax).toEqual(salesTax('AB'));
    if (rows.length) expect(out.json.takeoff[0].priceSource).toBe('company');
  });

  it('gives crew the sizing answer without prices', async () => {
    const out = await run(ctxFor('electrician'), 'run_calculator', { id: calc.id });
    expect(out.isError).toBe(false);
    expect(out.json.values).toBeDefined();
    expect(out.json).not.toHaveProperty('takeoff');
    expect(out.json).not.toHaveProperty('salesTax');
  });

  it('reports bad calculators and bad input as errors the model can read', async () => {
    const tc = ctxFor('owner');
    const unknown = await run(tc, 'run_calculator', { id: 'not-a-calculator' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toContain(calc.id);
    expect((await run(tc, 'run_calculator', {})).isError).toBe(true);
    const wrong = await run(tc, 'run_calculator', { id: calc.id, input: { [firstNumber.key]: 'lots' } });
    expect(wrong.isError).toBe(true);
    expect(wrong.content).toContain(firstNumber.key);
    expect((await run(tc, 'run_calculator', { id: calc.id, input: { bogus: 1 } })).isError).toBe(true);
    expect(getCalculator(calc.id)).toBeDefined();
  });
});

describe('compliance guardrails', () => {
  it('refuses typical-value guesses for life-safety sizing and points to the AHJ', () => {
    for (const phrase of ['arc-flash incident energy', 'hazardous-location classification', 'grounding and bonding conductor sizing', 'fault current', 'engineer of record', 'authority having jurisdiction']) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
    expect(SYSTEM_PROMPT).not.toMatch(/work it out as a typical value/);
    expect(SYSTEM_PROMPT).not.toMatch(/client is charged GST only/);
  });

  it('takes tax by trade from the tool', async () => {
    const sk = await run(ctxFor('owner', [], 'SK'), 'lookup_costs', { query: 'wire' });
    expect(sk.json.salesTax).toEqual(salesTax('SK', { trade: 'electrical' }));
    expect(sk.json.salesTax.total).toBe(11);
    const mbE = await run(ctxFor('owner', [], 'MB'), 'lookup_costs', { query: 'wire' });
    expect(mbE.json.salesTax.total).toBe(12);
    const mbG = await run(ctxFor('owner', [], 'MB'), 'lookup_costs', { query: 'wire', trade: 'general' });
    expect(mbG.json.salesTax.total).toBe(5);
    const calc = await run(ctxFor('owner', [], 'MB'), 'run_calculator', { id: CALCULATORS[0].id, trade: 'general' });
    expect(calc.json.salesTax.total).toBe(5);
    const bad = await run(ctxFor('owner', [], 'MB'), 'run_calculator', { id: CALCULATORS[0].id, trade: 'nonsense' });
    expect(bad.isError).toBe(true);
  });
});

describe('code-book values are never supplied by the assistant', () => {
  const must = ['ampacity', 'derating', 'full-load current', 'overcurrent percentages', 'volume allowances', 'conduit diameters', 'never fill it in from memory'];
  it('says so in the system prompt', () => {
    for (const m of must) expect(SYSTEM_PROMPT, m).toContain(m);
    expect(SYSTEM_PROMPT).toContain('never report a Pass or Fail that depends on a value you supplied yourself');
  });
  it('says so in the run_calculator tool description for every role', () => {
    for (const role of ['electrician', 'owner'] as Role[]) {
      const d = assistantTools(role).find((t) => t.name === 'run_calculator')!.description ?? '';
      for (const m of must) expect(d, `${role}: ${m}`).toContain(m);
      expect(d).toContain('never report a Pass that depends on a value you supplied yourself');
    }
  });
});
