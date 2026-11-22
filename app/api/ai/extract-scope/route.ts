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
const MAX_SCOPE_BYTES = 10_000_000;
const SCOPE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

const resultSchema = z.object({
  estimatedLabor: z.number().finite().nonnegative(),
  estimatedMaterials: z.number().finite().nonnegative(),
  description: z.string(),
});

function getGeminiClient() {
  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  return key ? new GoogleGenerativeAI(key) : null;
}

const PROMPT = `Analyze the following scope document and extract:
1. Estimated Labor (in hours)
2. Estimated Material Cost (in CAD)
3. A summary of the scope of work

Return ONLY a JSON object with this structure:
{
  "estimatedLabor": number,
  "estimatedMaterials": number,
  "description": string
}
`;

// Nothing is saved here: the contractor reviews the figures before they go into an estimate.
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
  if (!(file instanceof Blob) || file.size === 0) return jsonError(400, 'Choose a document to upload');
  if (file.size > MAX_SCOPE_BYTES) return jsonError(413, 'That file is too large. Keep it under 10 MB.');
  if (!SCOPE_TYPES.includes(file.type)) return jsonError(415, 'Upload a PDF, PNG, JPG or WebP file');

  // Each call costs money, so each user gets an hourly allowance (set in the database)
  if (!(await consumeUserRateLimit(ctx.supabase, 'ai'))) return jsonError(429, 'You have used a lot of AI requests this hour. Try again later.');

  let responseText: string;
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const base64Data = Buffer.from(await file.arrayBuffer()).toString('base64');
    const result = await model.generateContent([{ inlineData: { data: base64Data, mimeType: file.type } }, PROMPT]);
    responseText = result.response.text();
  } catch (err) {
    console.error('Scope extraction: AI request failed', err);
    return jsonError(502, 'We could not read that document just now. Try again in a moment.');
  }

  try {
    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in AI response');
    const data = resultSchema.parse(JSON.parse(match[0]));
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Scope extraction: unreadable AI response', err);
    return jsonError(502, 'We could not make sense of that document. Try again with a clearer copy.');
  }
}
