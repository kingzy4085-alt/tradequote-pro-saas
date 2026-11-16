import { NextResponse } from 'next/server';
import { sendSMSNotification } from '@/lib/notifications/sms';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { phone } = await req.json();
  const portalUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/portal/proposals/${id}`;

  const result = await sendSMSNotification({
    to: phone,
    message: `You have a new project proposal ready for review and secure deposit payment: ${portalUrl}`,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}