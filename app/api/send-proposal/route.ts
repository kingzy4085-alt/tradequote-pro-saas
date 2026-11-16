import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireApi } from '@/lib/api';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    await requireApi({ minRank: 20, write: true });
    const { clientEmail, clientName, estimateNumber, totalAmount } = await request.json();

    const data = await resend.emails.send({
      from: 'TradeQuote PRO <onboarding@tradequotepro.com>',
      to: [clientEmail],
      subject: `Estimate #${estimateNumber} from TradeQuote PRO`,
      html: `
        <h2>Hello ${clientName},</h2>
        <p>Your formal estimate (#${estimateNumber}) for $${totalAmount} is ready for review.</p>
        <p>Best regards,<br>Ingzys Automation</p>
      `,
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}



