import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { jsonError, requireApi } from '@/lib/api';
import { ASSEMBLY_COLUMNS, ASSEMBLY_LIST_LIMIT } from '@/lib/assemblies';
import { getModule } from '@/lib/modules';
import { consumeUserRateLimit } from '@/lib/rate-limit';
import { MAX_VOICE_BYTES, normalizeAudioType, parseVoiceResult, PRICE_SOURCES, referenceCatalog, voicePrompt } from '@/lib/voice-estimate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Voice lines go into an estimate, so whoever may write estimates may use this
const estimates = getModule('estimates')!;
const MODEL = 'gemini-2.5-flash';

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    transcript: { type: SchemaType.STRING },
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          description: { type: SchemaType.STRING },
          quantity: { type: SchemaType.NUMBER },
          unit: { type: SchemaType.STRING },
          material_unit_cost: { type: SchemaType.NUMBER },
          labour_hours_per_unit: { type: SchemaType.NUMBER },
          price_source: { type: SchemaType.STRING, format: 'enum', enum: [...PRICE_SOURCES] },
        },
        required: ['description', 'quantity', 'unit', 'material_unit_cost', 'labour_hours_per_unit', 'price_source'],
      },
    },
    notes: { type: SchemaType.STRING },
  },
  required: ['transcript', 'items', 'notes'],
};

const TOO_LONG = 'That recording is too long. Keep it under 5 minutes.';

/**
 * Takes a recorded voice note (multipart field "audio"), transcribes it and returns estimate lines
 * in the estimate_items shape. Nothing is saved here: the editor adds the lines for the contractor
 * to check, and saving goes through PUT /api/estimates/[id]/items like any other edit.
 */
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: estimates.write, write: true });
  if (ctx instanceof Response) return ctx;

  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!key) return jsonError(503, 'Voice estimating is not set up on this server yet');

  // Refuse honest oversized uploads before buffering them; the real size is checked below
  if (Number(request.headers.get('content-length')) > MAX_VOICE_BYTES + 64_000) return jsonError(413, TOO_LONG);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'Send the recording as a form upload');
  }
  const audio = form.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) return jsonError(400, 'Record a voice note first');
  if (audio.size > MAX_VOICE_BYTES) return jsonError(413, TOO_LONG);
  const mimeType = normalizeAudioType(audio.type);
  if (!mimeType) return jsonError(415, 'That file is not a recording we can read. Use webm, m4a, mp3 or wav.');

  // Each call costs money, so each user gets an hourly allowance (set in the database)
  if (!(await consumeUserRateLimit(ctx.supabase, 'ai'))) return jsonError(429, 'You have used a lot of voice estimates this hour. Try again later.');

  // The company's own assembly prices, so the model can fill in costs that weren't said out loud.
  // Read through the user's session, so RLS keeps it to their company. Optional: carry on without it.
  let catalog = '';
  const { data: assemblies, error: asmError } = await ctx.supabase.from('assemblies').select(ASSEMBLY_COLUMNS).order('name').limit(ASSEMBLY_LIST_LIMIT);
  if (asmError) console.error('Voice estimate: could not load assemblies for reference', asmError);
  else catalog = referenceCatalog((assemblies ?? []) as Parameters<typeof referenceCatalog>[0]);

  let raw: string;
  try {
    const model = new GoogleGenerativeAI(key).getGenerativeModel({
      model: MODEL,
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.1 },
    });
    const base64 = Buffer.from(await audio.arrayBuffer()).toString('base64');
    const result = await model.generateContent([{ inlineData: { data: base64, mimeType } }, voicePrompt({ catalog, province: ctx.company.province })]);
    raw = result.response.text();
  } catch (err) {
    console.error('Voice estimate: AI request failed', err);
    return jsonError(502, 'We could not process that recording just now. Try again in a moment.');
  }

  try {
    return NextResponse.json({ data: parseVoiceResult(raw) });
  } catch (err) {
    console.error('Voice estimate: unreadable AI response', err);
    return jsonError(502, 'We could not make sense of that recording. Try again, speaking a little slower.');
  }
}
