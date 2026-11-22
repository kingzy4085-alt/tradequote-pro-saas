import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { MODULES, getModule } from '@/lib/modules';
import { provinceName } from '@/lib/provinces';
import { withRestrictedMoney } from '@/lib/project-money';
import { hasRank, type Role } from '@/lib/roles';
import { escapeSearch } from '@/lib/crud';
import { CATALOG, COSTBOOK_AS_OF, billingRate, getItem, getRegion, labourCost, priceItem, priceTakeoff, salesTax, searchCatalog } from '@/lib/costbook';
import { TRADES } from '@/lib/costbook/types';
import type { CompanyPrice, LabourClass, ShopType } from '@/lib/costbook';
import type { Trade } from '@/lib/costbook/types';
import { CALCULATORS, getCalculator, inputSchema } from '@/lib/calc/registry';
import type { Calculator } from '@/lib/calc/registry';
import { loadCompanyPrices } from '@/lib/company-prices';

export const MAX_HISTORY = 40;
export const MAX_MESSAGE_CHARS = 8_000;

export const ChatRequest = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) }))
    .min(1)
    .max(MAX_HISTORY)
    // zod still runs refinements after .min() fails, so guard against an empty list
    .refine((m) => m.length > 0 && m[0].role === 'user' && m[m.length - 1].role === 'user', 'Conversation must start and end with a user message'),
});

/** Roughly what one question's conversation history may cost, so the daily limit also bounds spend. */
export const MAX_HISTORY_TOKENS = 12_000;

// About four characters per token for English; close enough for a budget
const approxTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Keeps the most recent messages that fit the token budget. The latest question is
 * always kept, and the result still starts with a user message as the API requires.
 */
export function capHistory<T extends { role: 'user' | 'assistant'; content: string }>(messages: T[], maxTokens = MAX_HISTORY_TOKENS): T[] {
  let start = messages.length - 1;
  let tokens = approxTokens(messages[start].content);
  while (start > 0) {
    const next = tokens + approxTokens(messages[start - 1].content);
    if (next > maxTokens) break;
    tokens = next;
    start--;
  }
  while (messages[start].role !== 'user') start++;
  return messages.slice(start);
}

/** Stable instructions — cached across every request, so nothing per-request goes in here. */
export const SYSTEM_PROMPT = `You are the TradeQuote PRO assistant: a senior construction and electrical contracting advisor for Canadian contractors — estimators, project managers, office admins, foremen and electricians working industrial shutdowns, commercial and institutional jobs.

What you help with
- Canadian code questions: the National Building Code, National Fire Code and National Plumbing Code, provincial adoptions (for example the BC Building Code and Alberta's NBC Alberta Edition), the Canadian Electrical Code (CSA C22.1) and provincial amendments, occupational health and safety rules, WCB/WorkSafe requirements, and permits and inspections.
- Estimating and bidding: labour units, crew sizing, productivity, markups, contingency, holdbacks and prompt-payment rules, change orders, and how to structure a proposal.
- Field work: installation methods, testing and commissioning, LOTO and energized-work safety, troubleshooting.
- Office and admin: progress billing, GST/HST/PST basics, subcontractor compliance, scheduling.
- The user's own company records, through the search_company_records tool.
- Costing: reference material prices, labour cost and charge-out rates, and sized takeoffs, through the lookup_costs, labour_rates and run_calculator tools.

How to answer
- Code questions depend on jurisdiction and edition. Use the user's province unless they say otherwise. Use web search to confirm the current edition adopted there and any amendments, and name the code, edition and section you are relying on. If you can't confirm a section number, say so rather than guessing one.
- Summarize code requirements in your own words. The Canadian Electrical Code and other CSA standards are copyrighted; do not reproduce their text.
- You give general information, not a stamped engineering opinion or a ruling. When the answer affects safety or compliance, tell the user to confirm with the authority having jurisdiction, the engineer of record, or the current code book.
- Material prices: you do not have live supplier pricing. Never invent a price, a labour rate or a labour unit. For anything priced, call lookup_costs. Its reference prices are retail baselines for the company's region, dated ${COSTBOOK_AS_OF} (each item also carries its own source and date), not a supplier quote. Where the company has saved its own price (priceSource "company") that price wins over the reference one; say which you used. A unit cost of 0 with priceSource "reference" means no reference price is on file yet: say so instead of quoting it. Outside the tools, give typical ranges only when you can find a recent public source, cite it with its date, and tell the user to get a current quote from their supplier (Westburne, Nedco, Guillevin, EECOL, Wesco and others price per account).
- Labour: call labour_rates for the burdened cost per paid hour and the suggested charge-out rate for a trade in the user's province (open shop or union). State the assumptions the tool returns (utilization, overhead, profit).
- Sizes, ratings and quantities (conductor and breaker sizes, voltage drop, conduit fill, concrete volumes and similar): call run_calculator and quote its answer, warnings and references. Do not size equipment from memory. If no calculator covers it, say so and tell the user to confirm against the code book; for ordinary estimating only (typical productivity, crew size, contingency), you may give a typical value and label it as one. Never estimate, guess or give a "typical value" for arc-flash incident energy or PPE category, hazardous-location classification, grounding and bonding conductor sizing, fault current, or anything life-safety: for those, refer the user to the engineer of record, the current code book and the authority having jurisdiction. run_calculator also returns a priced takeoff for users who can see costs; use it when asked to price a job.
- Tax: for GST/HST/PST/QST, use the salesTax rules the tools return. Take tax from the tool result, never from memory: rules differ by province and trade (for example Saskatchewan and Manitoba electrical, plumbing and HVAC differ from BC and Manitoba general trades). Pass the job's trade to the tool when it is not electrical, and quote the note the tool returns.
- To draft estimate lines: call lookup_costs for the items and run_calculator for quantities, then list each line with quantity, unit, unit cost, labour hours and where the price came from.
- For questions about their jobs, estimates, crews or records, call search_company_records instead of assuming. Only report what the records show.
- Be direct and practical, like an experienced super talking to their crew. Use metric and imperial where the trade does. Keep answers as short as the question allows; use short lists or tables when they help.`;

export function contextPrompt(opts: { companyName: string; province: string; role: Role; today: string }): string {
  return `Current user: ${opts.role.replace('_', ' ')} at ${opts.companyName}, based in ${provinceName(opts.province)} (${opts.province}), Canada. Today is ${opts.today}.`;
}

const RecordSearchInput = z.object({
  module: z.string(),
  query: z.string().max(100).optional(),
  status: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export function recordSearchTool(role: Role): Anthropic.Beta.BetaTool {
  const readable = MODULES.filter((m) => hasRank(role, m.read));
  return {
    name: 'search_company_records',
    description:
      "Search the user's company records in TradeQuote PRO. Returns the most recent matching records with their fields. Only modules the user's role can read are available. Modules: " +
      readable.map((m) => `${m.slug} (${m.label}; statuses: ${m.statuses.join(', ')})`).join('; '),
    input_schema: {
      type: 'object',
      properties: {
        module: { type: 'string', enum: readable.map((m) => m.slug), description: 'Which module to search' },
        query: { type: 'string', description: 'Text to match in the record name/title. Omit to list recent records.' },
        status: { type: 'string', description: 'Only records with this exact status' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'How many records to return (default 10)' },
      },
      required: ['module'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  };
}

/** Runs the record search as the signed-in user, so row level security still applies. */
export async function runRecordSearch(supabase: SupabaseClient, role: Role, rawInput: unknown): Promise<{ content: string; isError: boolean }> {
  const parsed = RecordSearchInput.safeParse(rawInput);
  if (!parsed.success) return { content: 'Invalid input: ' + parsed.error.issues.map((i) => i.message).join('; '), isError: true };
  const { module: slug, query, status, limit = 10 } = parsed.data;
  const mod = getModule(slug);
  if (!mod || !hasRank(role, mod.read)) return { content: `Module "${slug}" is not available to this user.`, isError: true };

  const hydrated = mod.slug === 'projects' || mod.slug === 'change-orders';
  const columns = [...(hydrated ? ['id'] : []), 'title', 'status', 'notes', 'created_at', ...mod.fields.filter((f) => f.type !== 'list' && !f.restricted).map((f) => f.key)].join(', ');
  let q = supabase.from(mod.table).select(columns, { count: 'exact' }).order('created_at', { ascending: false }).limit(limit);
  if (query) q = q.ilike('title', `%${escapeSearch(query)}%`);
  if (status) q = q.eq('status', status);
  const { data, count, error } = await q;
  if (error) {
    console.error('Assistant record search failed', error);
    return { content: 'The records could not be loaded.', isError: true };
  }
  let records: unknown = data;
  if (hydrated) {
    const full = await withRestrictedMoney(mod.slug, supabase, role, (data ?? []) as unknown as { id: string }[]);
    if ('error' in full) {
      console.error('Assistant record search failed', full.error);
      return { content: 'The records could not be loaded.', isError: true };
    }
    records = full.rows.map(({ id: _id, ...row }) => row);
  }
  return { content: JSON.stringify({ module: mod.label, total_matching: count, returned: data?.length ?? 0, records }), isError: false };
}

// Costing tools -----------------------------------------------------------------------------

// Exhaustive on purpose: adding a LabourClass to the cost engine fails the build until it is listed here
const LABOUR_CLASS_SET: Record<LabourClass, true> = {
  electrician: true,
  industrial_electrician: true,
  apprentice_electrician: true,
  plumber: true,
  pipefitter: true,
  hvac_mechanic: true,
  sheet_metal: true,
  carpenter: true,
  drywaller: true,
  insulator: true,
  concrete_finisher: true,
  roofer: true,
  painter: true,
  floor_installer: true,
  welder: true,
  equipment_operator: true,
  labourer: true,
};
export const LABOUR_CLASSES = Object.keys(LABOUR_CLASS_SET) as LabourClass[];

/** Who sees prices, wages and charge-out rates: the same people who can read estimates. */
export const costingRank = () => getModule('estimates')?.read ?? 3;

const LookupCostsInput = z.object({
  query: z.string().trim().min(1).max(100),
  trade: z.enum(TRADES as [Trade, ...Trade[]]).optional(),
  limit: z.number().int().min(1).max(15).optional(),
});

const LabourRatesInput = z.object({
  labour_class: z.enum(LABOUR_CLASSES as [LabourClass, ...LabourClass[]]),
  shop: z.enum(['open', 'union']).optional(),
  utilization_pct: z.number().min(30).max(100).optional(),
  overhead_pct: z.number().min(0).max(100).optional(),
  profit_pct: z.number().min(0).max(100).optional(),
});

const calcSummary = (c: Calculator) => `${c.id}: ${c.summary} Fields: ${c.fields.map((f) => `${f.key}${f.unit ? ` (${f.unit})` : ''}`).join(', ')}.`;

/**
 * The tools a role may use, in a fixed order so the request prefix stays cacheable. Costing tools
 * need the rank that can read estimates; below it, calculators still answer but return no prices.
 */
export function assistantTools(role: Role): Anthropic.Beta.BetaTool[] {
  const tools: Anthropic.Beta.BetaTool[] = [recordSearchTool(role)];
  const sees = hasRank(role, costingRank());
  if (sees) {
    tools.push(
      {
        name: 'lookup_costs',
        description: `Search the reference cost catalog for materials and assemblies, priced for the company's region with the company's own saved prices applied first. Returns code, description, unit, unit cost (CAD before tax), labour hours per unit, source, asOf, confidence and priceSource (company, reference). Reference prices are retail baselines dated ${COSTBOOK_AS_OF}. Search with plain trade words, e.g. "14/2 NMD90", "EMT 3/4", "20 A breaker".`,
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Words that must all appear in the item code or description' },
            trade: { type: 'string', enum: [...TRADES], description: 'Only items of this trade. Also sets the trade used for the sales tax rules (default electrical)' },
            limit: { type: 'integer', minimum: 1, maximum: 15, description: 'How many items to return (default 8)' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        eager_input_streaming: true,
      },
      {
        name: 'labour_rates',
        description:
          "Burdened labour cost per paid hour (wage, vacation, stat holidays, CPP, EI, WCB, union benefits) and the suggested charge-out rate for a labour class in the company's province. Defaults: open shop, 80% utilization, 20% overhead, 15% profit.",
        input_schema: {
          type: 'object',
          properties: {
            labour_class: { type: 'string', enum: LABOUR_CLASSES, description: 'Trade classification' },
            shop: { type: 'string', enum: ['open', 'union'], description: 'Open shop (default) or union wages and benefits' },
            utilization_pct: { type: 'number', minimum: 30, maximum: 100, description: 'Share of paid hours that are billable' },
            overhead_pct: { type: 'number', minimum: 0, maximum: 100 },
            profit_pct: { type: 'number', minimum: 0, maximum: 100 },
          },
          required: ['labour_class'],
          additionalProperties: false,
        },
        eager_input_streaming: true,
      }
    );
  }
  if (CALCULATORS.length) {
    tools.push({
      name: 'run_calculator',
      description:
        'Run one of the built-in trade calculators for sizes, ratings and quantities. Returns the answer, warnings, the code references relied on' +
        (sees ? ' and the takeoff priced for the company region with company prices' : '') +
        '. Omitted fields use the calculator default. Calculators: ' +
        CALCULATORS.map(calcSummary).join(' '),
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: CALCULATORS.map((c) => c.id), description: 'Which calculator' },
          trade: { type: 'string', enum: [...TRADES], description: 'Trade of the job, used for sales tax rules (default electrical)' },
          input: { type: 'object', description: "The calculator's fields by key, as listed in the description", additionalProperties: true },
        },
        required: ['id'],
        additionalProperties: false,
      },
      eager_input_streaming: true,
    });
  }
  return tools;
}

/** Checks a calculator input against inputSchema(calc): known keys only, right types, listed options. */
export function validateCalcInput(calc: Calculator, raw: unknown): { ok: true; input: Record<string, number | string | boolean> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, input: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'input must be an object of field values' };
  const schema = inputSchema(calc).properties as Record<string, { type: string; enum?: string[] }>;
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const spec = schema[key];
    if (!spec) return { ok: false, error: `Unknown field "${key}". Fields: ${Object.keys(schema).join(', ')}` };
    if (spec.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: `Field "${key}" must be a number` };
    } else if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') return { ok: false, error: `Field "${key}" must be true or false` };
    } else if (typeof value !== 'string' || (spec.enum && !spec.enum.includes(value))) {
      return { ok: false, error: `Field "${key}" must be one of: ${(spec.enum ?? []).join(', ')}` };
    }
    out[key] = value as number | string | boolean;
  }
  return { ok: true, input: out };
}

export interface AssistantToolContext {
  supabase: SupabaseClient;
  role: Role;
  companyId: string;
  province: string;
}

type ToolOutput = { content: string; isError: boolean };
const ok = (data: unknown): ToolOutput => ({ content: JSON.stringify(data), isError: false });
const bad = (message: string): ToolOutput => ({ content: message, isError: true });
const notAllowed = (name: string): ToolOutput => bad(`The ${name} tool is not available to this user.`);

async function runLookupCosts(tc: AssistantToolContext, rawInput: unknown): Promise<ToolOutput> {
  if (!hasRank(tc.role, costingRank())) return notAllowed('lookup_costs');
  const parsed = LookupCostsInput.safeParse(rawInput);
  if (!parsed.success) return bad('Invalid input: ' + parsed.error.issues.map((i) => i.message).join('; '));
  const { query, trade, limit = 8 } = parsed.data;
  const region = getRegion(tc.province);
  const companyPrices = await loadCompanyPrices(tc.supabase, tc.companyId);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = searchCatalog(query, { trade, limit });
  const items: Record<string, unknown>[] = [];
  for (const item of hits) {
    const priced = priceItem(item.code, { region: region.code, companyPrices });
    if (!priced) continue;
    const own = priced.priceSource === 'company';
    items.push({
      code: item.code,
      description: priced.description,
      unit: priced.unit,
      unitCost: priced.materialUnitCost,
      labourHoursPerUnit: priced.labourHoursPerUnit,
      labourClass: priced.labourClass,
      source: own ? 'company price book' : item.source,
      asOf: own ? null : item.asOf,
      confidence: priced.confidence,
      priceSource: priced.priceSource,
      pack: item.pack ?? null,
    });
  }
  // The company's own items that are not in the reference catalog
  if (!trade) {
    for (const p of companyPrices) {
      if (items.length >= limit) break;
      if (getItem(p.itemCode) || items.some((i) => i.code === p.itemCode)) continue;
      const hay = `${p.itemCode} ${p.description ?? ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      items.push({
        code: p.itemCode,
        description: p.description || p.itemCode,
        unit: p.unit || 'ea',
        unitCost: p.unitCost,
        labourHoursPerUnit: p.labourHours ?? null,
        labourClass: null,
        source: 'company price book',
        asOf: null,
        confidence: null,
        priceSource: 'company',
        pack: null,
      });
    }
  }
  return ok({
    region: region.name,
    currency: 'CAD, before tax',
    referencePricesAsOf: COSTBOOK_AS_OF,
    salesTax: salesTax(tc.province, { trade: trade ?? 'electrical' }),
    catalogSize: CATALOG.length,
    companyPricesFound: companyPrices.length,
    returned: items.length,
    items,
    note: items.length ? 'Reference prices are retail baselines. A company price (priceSource "company") overrides them. unitCost 0 with priceSource "reference" means no price is on file yet.' : 'Nothing matched. Try fewer or simpler words.',
  });
}

function runLabourRates(tc: AssistantToolContext, rawInput: unknown): ToolOutput {
  if (!hasRank(tc.role, costingRank())) return notAllowed('labour_rates');
  const parsed = LabourRatesInput.safeParse(rawInput);
  if (!parsed.success) return bad('Invalid input: ' + parsed.error.issues.map((i) => i.message).join('; '));
  const { labour_class, shop = 'open', utilization_pct = 80, overhead_pct = 20, profit_pct = 15 } = parsed.data;
  const opts = { shop: shop as ShopType, utilizationPct: utilization_pct, overheadPct: overhead_pct, profitPct: profit_pct };
  return ok({
    province: tc.province,
    cost: labourCost(labour_class, tc.province, { shop: opts.shop }),
    chargeOutRatePerHour: billingRate(labour_class, tc.province, opts),
    assumptions: { shop, utilizationPct: utilization_pct, overheadPct: overhead_pct, profitPct: profit_pct },
    note: 'Cost is per paid hour including statutory burden. The charge-out rate grosses cost up for non-billable hours, then adds overhead and profit.',
  });
}

async function runCalculatorTool(tc: AssistantToolContext, rawInput: unknown): Promise<ToolOutput> {
  const id = rawInput && typeof rawInput === 'object' ? (rawInput as { id?: unknown }).id : undefined;
  const calc = typeof id === 'string' ? getCalculator(id) : undefined;
  if (!calc) return bad(`Unknown calculator. Available: ${CALCULATORS.map((c) => c.id).join(', ')}`);
  const tradeParsed = z.enum(TRADES as [Trade, ...Trade[]]).optional().safeParse((rawInput as { trade?: unknown }).trade);
  if (!tradeParsed.success) return bad(`Unknown trade. Available: ${TRADES.join(', ')}`);
  const checked = validateCalcInput(calc, (rawInput as { input?: unknown }).input);
  if (!checked.ok) return bad(`Invalid input for ${calc.id}: ${checked.error}`);

  let result;
  try {
    result = calc.run({ ...Object.fromEntries(calc.fields.map((f) => [f.key, f.default])), ...checked.input });
  } catch (err) {
    console.error('Calculator failed', calc.id, err);
    return bad('That calculator could not run with these values.');
  }
  const out: Record<string, unknown> = {
    calculator: calc.name,
    summary: result.summary,
    values: result.values,
    warnings: result.warnings,
    references: result.references,
  };
  if (hasRank(tc.role, costingRank())) {
    const region = getRegion(tc.province);
    const companyPrices: CompanyPrice[] = await loadCompanyPrices(tc.supabase, tc.companyId);
    out.takeoff = priceTakeoff(result.takeoff, { region: region.code, companyPrices });
    out.salesTax = salesTax(tc.province, { trade: tradeParsed.data ?? 'electrical' });
    out.pricingNote = `Priced for ${region.name}; reference prices are baselines dated ${COSTBOOK_AS_OF} and company prices win. Tax is not included.`;
  }
  return ok(out);
}

/** Runs a client tool by name. Unknown names are errors the model can read. */
export async function runAssistantTool(tc: AssistantToolContext, name: string, input: unknown): Promise<ToolOutput> {
  try {
    switch (name) {
      case 'search_company_records':
        return await runRecordSearch(tc.supabase, tc.role, input);
      case 'lookup_costs':
        return await runLookupCosts(tc, input);
      case 'labour_rates':
        return runLabourRates(tc, input);
      case 'run_calculator':
        return await runCalculatorTool(tc, input);
      default:
        return bad(`Unknown tool ${name}`);
    }
  } catch (err) {
    console.error('Assistant tool failed', name, err);
    return bad('That tool could not complete.');
  }
}

export interface Source {
  url: string;
  title: string;
}

/** Collects the web pages Claude cited in its answer, de-duplicated. */
export function collectSources(content: Anthropic.Beta.BetaContentBlock[], into: Map<string, Source>) {
  for (const block of content) {
    if (block.type !== 'text' || !block.citations) continue;
    for (const c of block.citations) {
      if (c.type === 'web_search_result_location' && c.url && !into.has(c.url)) {
        into.set(c.url, { url: c.url, title: c.title || new URL(c.url).hostname });
      }
    }
  }
}
