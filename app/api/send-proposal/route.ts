import { NextResponse } from 'next/server';
import { jsonError, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';

const proposals = getModule('proposals')!;

export async function POST(request: Request) {
  const ctx = await requireApi({ minRank: proposals.write, write: true });
  if (ctx instanceof Response) return ctx;

  try {
    const { clientEmail, clientName, estimateNumber, totalAmount } = await request.json();

    const mailOptions = {
      from: 'TradeQuote PRO <onboarding@resend.dev>',
      to: [clientEmail],
      subject: `Estimate #${estimateNumber} from TradeQuote PRO`,
      html: `
        <h2>Hello ${clientName},</h2>
        <p>Your formal estimate (#${estimateNumber}) for $${totalAmount} is ready for review.</p>
      `
    };

    return NextResponse.json({ success: true, message: 'Proposal sent successfully', mailOptions });
  } catch (err: unknown) {
    console.error('Proposal send failed', err);
    return jsonError(500, 'Unable to send proposal');
  }
}
