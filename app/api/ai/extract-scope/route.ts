import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { jsonError, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { consumeUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The extracted figures feed an estimate, so whoever may write estimates may use this
const estimates = getModule('estimates')!;

const MAX_SCOPE_BYTES = 10 * 1024 * 1024;
const SCOPE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

const ScopeResult = z.object({
  estimatedLabor: z.number().finite().nonnegative(),
  estimatedMaterials: z.number().finite().nonnegative(),
  description: z.string().max(5000),
});

function getGeminiClient() {
  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  return key ? new GoogleGenerativeAI(key) : null;
}

/** Reads a scope document and returns a draft for the contractor to review. Nothing is saved here. */
export async function POST(request: Request) {
  // requireApi returns (not throws) the 401/402/403 response, so it has to be checked
  const ctx = await requireApi({ minRank: estimates.write, write: true });
  if (ctx instanceof Response) return ctx;

  const genAI = getGeminiClient();
  if (!genAI) return jsonError(503, 'AI extraction is not set up on this server yet');

  if (Number(request.headers.get('content-length')) > MAX_SCOPE_BYTES + 64_000) return jsonError(413, 'That file is too large. Keep it under 10 MB.');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'Send the document as a form upload');
  }
  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) return jsonError(400, 'No file uploaded');
  if (file.size > MAX_SCOPE_BYTES) return jsonError(413, 'That file is too large. Keep it under 10 MB.');
  if (!SCOPE_TYPES.includes(file.type)) return jsonError(415, 'Upload a PDF, PNG, JPEG or WebP file.');

  // Each call costs money, so each user gets an hourly allowance (set in the database)
  if (!(await consumeUserRateLimit(ctx.supabase, 'ai'))) return jsonError(429, 'You have used a lot of AI extractions this hour. Try again later.');

  try {
    const base64Data = Buffer.from(await file.arrayBuffer()).toString('base64');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Analyze the following scope document and extract:
1. Estimated Labor (in hours)
2. Estimated Material Cost (in CAD)
3. A summary of the scope of work

Only use figures that appear in the document; use 0 when it gives none. Do not invent prices.

Return ONLY a JSON object with this structure:
{
  "estimatedLabor": number,
  "estimatedMaterials": number,
  "description": string
}
`;

    const result = await model.generateContent([{ inlineData: { data: base64Data, mimeType: file.type } }, prompt]);
    const jsonMatch = result.response.text().match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? ScopeResult.safeParse(JSON.parse(jsonMatch[0])) : null;
    if (!parsed?.success) return jsonError(502, 'We could not read figures from that document. Try a clearer copy.');

    return NextResponse.json({ success: true, data: parsed.data });
  } catch (err) {
    console.error('AI extraction failed', err);
    return jsonError(502, 'We could not read that document just now. Try again in a moment.');
  }
}
