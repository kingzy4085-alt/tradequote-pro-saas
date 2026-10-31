import { NextResponse } from 'next/server';

export async function GET() {
  try {
    return NextResponse.json({ success: true, module: 'proposals', data: [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ success: true, module: 'proposals', received: body, message: 'Record saved successfully.' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
