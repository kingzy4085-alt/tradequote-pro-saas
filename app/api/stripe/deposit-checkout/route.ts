import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, readJson, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const proposals = getModule('proposals')!;
const bodySchema = z.object({ proposalId: uuidSchema, amount: z.number().positive().finite().optional() });

// Placeholder: deposit payments are not built yet, so this only validates the request and returns no checkout URL.
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;

  let raw: unknown;
  try {
    raw = await readJson(request, 10_000);
  } catch (err) {
    if (err instanceof RangeError) return jsonError(413, 'That request is too large');
    return jsonError(400, 'Send a valid proposal');
  }
  if (!bodySchema.safeParse(raw).success) return jsonError(400, 'A valid proposal is required');

  return NextResponse.json({ success: true, url: '#' });
}
