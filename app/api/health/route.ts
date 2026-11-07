import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Uptime check for hosting; says nothing about configuration or data
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
