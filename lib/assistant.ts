import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { MODULES, getModule } from '@/lib/modules';
import { provinceName } from '@/lib/provinces';
import { withRestrictedMoney } from '@/lib/project-money';
import { hasRank, type Role } from '@/lib/roles';
import { escapeSearch } from '@/lib/crud';

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

How to answer
- Code questions depend on jurisdiction and edition. Use the user's province unless they say otherwise. Use web search to confirm the current edition adopted there and any amendments, and name the code, edition and section you are relying on. If you can't confirm a section number, say so rather than guessing one.
- Summarize code requirements in your own words. The Canadian Electrical Code and other CSA standards are copyrighted; do not reproduce their text.
- You give general information, not a stamped engineering opinion or a ruling. When the answer affects safety or compliance, tell the user to confirm with the authority having jurisdiction, the engineer of record, or the current code book.
- Material prices: you do not have live supplier pricing. Give typical ranges only when you can find a recent public source, cite it with its date, and tell the user to get a current quote from their supplier (Westburne, Nedco, Guillevin, EECOL, Wesco and others price per account).
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
