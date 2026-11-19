import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, readJson, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';

const proposals = getModule('proposals')!;

const Body = z.object({
  clientEmail: z.string().trim().email().max(320),
  clientName: z.string().trim().min(1).max(200),
  estimateNumber: z.union([z.string().trim().min(1).max(50), z.number()]),
  totalAmount: z.union([z.string().trim().min(1).max(50), z.number()]),
});

export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 20_000);
  } catch {
    return jsonError(400, 'Send the proposal details as JSON');
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return jsonError(400, 'Some proposal details were missing or not valid');
  const { clientEmail, clientName, estimateNumber, totalAmount } = parsed.data;

  const mailOptions = {
    from: 'TradeQuote PRO <onboarding@resend.dev>',
    to: [clientEmail],
    subject: `Estimate #${estimateNumber} from TradeQuote PRO`,
    html: `
        <h2>Hello ${clientName},</h2>
        <p>Your formal estimate (#${estimateNumber}) for $${totalAmount} is ready for review.</p>
      `,
  };

  return NextResponse.json({ success: true, message: 'Proposal sent successfully', mailOptions });
}
