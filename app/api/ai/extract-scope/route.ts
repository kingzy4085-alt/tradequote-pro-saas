import { z } from 'zod';
import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { jsonError, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { consumeUserRateLimit } from '@/lib/rate-limit';

// Scope figures go into estimates, so whoever may write estimates may use this (same as parse-voice)
const estimates = getModule('estimates')!;
const MAX_SCOPE_BYTES = 10_000_000;
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

const ScopeResult = z.object({
  estimatedLabor: z.number().finite().nonnegative(),
  estimatedMaterials: z.number().finite().nonnegative(),
  description: z.string().max(5000),
});

function getGeminiClient() {
  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  return key ? new GoogleGenerativeAI(key) : null;
}

export async function POST(request: Request) {
  try {
    // requireApi returns (not throws) the 401/402/403 response, so it has to be checked
    const ctx = await requireApi({ minRank: estimates.write, write: true });
    if (ctx instanceof Response) return ctx;

    if (Number(request.headers.get('content-length')) > MAX_SCOPE_BYTES + 64_000) return jsonError(413, 'That file is too large. Keep it under 10 MB.');
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError(400, 'Send the file as a form upload');
    }
    const file = formData.get('file');
    if (!(file instanceof Blob) || file.size === 0) return jsonError(400, 'No file uploaded');
    if (file.size > MAX_SCOPE_BYTES) return jsonError(413, 'That file is too large. Keep it under 10 MB.');
    if (!ALLOWED_TYPES.includes(file.type)) return jsonError(415, 'Upload a PDF, PNG, JPG or WebP file.');

    // Each call costs money, so each user gets an hourly allowance (set in the database)
    if (!(await consumeUserRateLimit(ctx.supabase, 'ai'))) return jsonError(429, 'You have used a lot of AI requests this hour. Try again later.');

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString('base64');

    const genAI = getGeminiClient();
    if (!genAI) return jsonError(503, 'AI extraction is not set up on this server yet');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Analyze the following scope document and extract:
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

    const result = await model.generateContent([
        {
            inlineData: {
                data: base64Data,
                mimeType: file.type
            }
        },
        prompt
    ]);

    const responseText = result.response.text();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) return jsonError(502, 'The AI could not read that document. Try a clearer file.');

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonMatch[0]);
    } catch {
      return jsonError(502, 'The AI could not read that document. Try a clearer file.');
    }
    const checked = ScopeResult.safeParse(parsedJson);
    if (!checked.success) return jsonError(502, 'The AI could not read that document. Try a clearer file.');
    // A draft only: the contractor reviews these figures before anything is saved
    const data = checked.data;

    return NextResponse.json({
      success: true,
      data
    });
  } catch (err: unknown) {
    console.error('AI extraction failed', err);
    return jsonError(500, 'Could not extract the scope. Try again in a moment.');
  }
}




