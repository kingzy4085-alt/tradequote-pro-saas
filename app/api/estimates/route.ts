import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ success: true, estimates: [] });
}

export async function POST(request: Request) {
  let body = {};
  try { body = await request.json(); } catch(e) {}
  return NextResponse.json({ success: true, data: body });
}
