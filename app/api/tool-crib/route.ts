import { NextResponse } from 'next/server';

export async function GET() {
  try {
    return NextResponse.json({ success: true, module: 'tool-crib', data: [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ success: true, module: 'tool-crib', received: body, message: 'Record saved successfully.' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
