import Anthropic from '@anthropic-ai/sdk';
import { jsonError, requireApi } from '@/lib/api';
import { MAX_REQUEST_BYTES, InputError, friendlyError, generateDraft, priceDraft, readScopeForm } from '@/lib/ai-estimate';
import { loadCompanyPrices } from '@/lib/company-prices';
import { getModule } from '@/lib/modules';
import { consumeUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST multipart: scope (text, optional) and files (up to 3 PDFs or images).
// Returns { draft, lines, estimateLines }. A draft only: nothing is saved.
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: getModule('estimates')?.write ?? 3, write: true });
  if (ctx instanceof Response) return ctx;

  if (!process.env.ANTHROPIC_API_KEY) return jsonError(503, 'The AI estimate is not configured yet.');

  // Refuse an honest oversized upload before buffering it
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) return jsonError(413, 'That upload is too large. Each file must be 10 MB or smaller.');
  let scopeInput;
  try {
    scopeInput = await readScopeForm(await request.formData());
  } catch (err) {
    if (err instanceof InputError) return jsonError(400, err.message);
    return jsonError(400, 'Invalid request');
  }

  // The hourly per-user AI limit every paid AI call shares (CLAUDE.md), then the company's daily allowance
  if (!(await consumeUserRateLimit(ctx.supabase, 'ai'))) return jsonError(429, 'You have drafted a lot of estimates this hour. Try again later.');

  // Same daily allowance as the assistant
  const { data: usage, error: usageError } = await ctx.supabase.rpc('consume_ai_message').single<{ allowed: boolean; used: number; daily_limit: number }>();
  if (usageError || !usage) {
    console.error('AI usage check failed', usageError);
    return jsonError(500, 'Could not check your assistant allowance');
  }
  if (!usage.allowed) {
    return jsonError(429, usage.daily_limit === 0 ? 'The assistant is available on an active trial or subscription.' : `Your company has used today's ${usage.daily_limit} assistant questions. The limit resets at midnight.`);
  }

  try {
    const draft = await generateDraft(new Anthropic(), scopeInput, ctx.company.province, request.signal);
    const companyPrices = await loadCompanyPrices(ctx.supabase, ctx.company.id);
    return Response.json(priceDraft(draft, { province: ctx.company.province, companyPrices }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error('AI estimate failed', err);
    const { status, message } = friendlyError(err);
    return jsonError(status, message);
  }
}
