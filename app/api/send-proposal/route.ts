import { NextResponse } from 'next/server';

export async function POST(request: Request) {
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
