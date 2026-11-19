import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, readJson, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// Deposits belong to proposals, so whoever may write proposals may start one
const proposals = getModule('proposals')!;

const Body = z.object({ proposalId: uuidSchema, amount: z.number().positive().finite().optional() });

// Placeholder: real deposit payments are not built yet, so this checks access and input and returns no payment link.
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;

  let raw: unknown;
  try {
    raw = await readJson(request);
  } catch (err) {
    if (err instanceof RangeError) return jsonError(413, 'That request is too large');
    return jsonError(400, 'Send a valid JSON body');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError(400, 'A valid proposal ID is required');

  return NextResponse.json({ success: true, url: '#' });
}
