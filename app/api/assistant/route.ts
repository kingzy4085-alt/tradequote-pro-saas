import Anthropic from '@anthropic-ai/sdk';
import { jsonError, readJson, requireApi } from '@/lib/api';
import { ChatRequest, SYSTEM_PROMPT, capHistory, collectSources, contextPrompt, recordSearchTool, runRecordSearch, type Source } from '@/lib/assistant';
import { env } from '@/lib/env';
import { provinceTimeZone } from '@/lib/provinces';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_TURNS = 6;

// Streams newline-delimited JSON events to the chat page:
// {type:"text",text} {type:"status",text} {type:"sources",items} {type:"error",text} {type:"done"}
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: 1 });
  if (ctx instanceof Response) return ctx;

  let input;
  try {
    input = ChatRequest.safeParse(await readJson(request, 400_000));
  } catch {
    return jsonError(400, 'Invalid request');
  }
  if (!input.success) return jsonError(400, input.error.issues[0]?.message ?? 'Invalid request');

  if (!process.env.ANTHROPIC_API_KEY) return jsonError(503, 'The AI Assistant is not configured yet.');

  const { data: usage, error: usageError } = await ctx.supabase.rpc('consume_ai_message').single<{ allowed: boolean; used: number; daily_limit: number }>();
  if (usageError || !usage) {
    console.error('AI usage check failed', usageError);
    return jsonError(500, 'Could not check your assistant allowance');
  }
  if (!usage.allowed) {
    return jsonError(429, usage.daily_limit === 0 ? 'The assistant is available on an active trial or subscription.' : `Your company has used today's ${usage.daily_limit} assistant questions. The limit resets at midnight.`);
  }

  const client = new Anthropic();
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    recordSearchTool(ctx.role),
    {
      type: 'web_search_20260209',
      name: 'web_search',
      max_uses: 5,
      user_location: { type: 'approximate', country: 'CA', region: ctx.company.province, timezone: provinceTimeZone(ctx.company.province) },
    },
  ];
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextPrompt({ companyName: ctx.company.name, province: ctx.company.province, role: ctx.role, today: new Date().toISOString().slice(0, 10) }) },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = capHistory(input.data.messages).map((m) => ({ role: m.role, content: m.content }));

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      const sources = new Map<string, Source>();
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const stream = client.beta.messages.stream(
            {
              model: env.anthropicModel(),
              max_tokens: 16000,
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default',
              output_config: { effort: 'medium' },
              system,
              tools,
              messages,
            },
            { signal: request.signal }
          );

          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              send({ type: 'text', text: event.delta.text });
            } else if (event.type === 'content_block_start') {
              if (event.content_block.type === 'server_tool_use') send({ type: 'status', text: 'Searching the web…' });
              if (event.content_block.type === 'tool_use') send({ type: 'status', text: 'Checking your company records…' });
            }
          }
          const message = await stream.finalMessage();
          collectSources(message.content, sources);

          if (message.stop_reason === 'refusal') {
            send({ type: 'text', text: "\n\nI can't help with that request." });
            break;
          }
          if (message.stop_reason === 'max_tokens') {
            send({ type: 'text', text: '\n\n_(Answer cut short — ask me to continue.)_' });
            break;
          }
          if (message.stop_reason === 'pause_turn') {
            messages.push({ role: 'assistant', content: message.content });
            continue;
          }
          if (message.stop_reason !== 'tool_use') break;

          // Run every client tool call from this turn, then return all results together
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const block of message.content) {
            if (block.type !== 'tool_use') continue;
            const out =
              block.name === 'search_company_records'
                ? await runRecordSearch(ctx.supabase, ctx.role, block.input)
                : { content: `Unknown tool ${block.name}`, isError: true };
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out.content, is_error: out.isError });
          }
          messages.push({ role: 'assistant', content: message.content });
          messages.push({ role: 'user', content: results });
          send({ type: 'text', text: '\n\n' });
        }
        if (sources.size) send({ type: 'sources', items: [...sources.values()].slice(0, 12) });
        send({ type: 'done' });
      } catch (err) {
        if (request.signal.aborted) return controller.close();
        console.error('Assistant request failed', err);
        const text =
          err instanceof Anthropic.RateLimitError
            ? 'The assistant is busy right now. Try again in a minute.'
            : err instanceof Anthropic.AuthenticationError
              ? 'The assistant is not configured correctly. Contact support.'
              : err instanceof Anthropic.APIError && err.status >= 500
                ? 'The AI service is having trouble. Try again shortly.'
                : 'Something went wrong while answering.';
        send({ type: 'error', text });
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
