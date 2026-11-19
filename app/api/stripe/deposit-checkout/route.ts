import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, readJson, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const proposals = getModule('proposals')!;

const Body = z.object({ proposalId: uuidSchema, amount: z.number().positive().finite().optional() });

// Placeholder: deposit payments are not built yet (owner decision pending), so no Stripe session is created.
export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 10_000);
  } catch {
    return jsonError(400, 'Send the request as JSON');
  }
  if (!Body.safeParse(body).success) return jsonError(400, 'A valid proposal is required');

  return NextResponse.json({ success: true, url: '#' });
}
